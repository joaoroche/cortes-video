const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const config = require('../config');
const { getGPUCodec } = require('../config/ffmpeg');
const { formatSRTTime, formatASSTime } = require('../utils/formatters');
const jobService = require('./jobService');

/**
 * Cria um arquivo SRT ajustado para um clipe específico
 * Os timestamps são ajustados para começar de 0 baseado no startTime do clipe
 * @param {string} originalSrtPath - Caminho do SRT original
 * @param {number} clipStartTime - Tempo de início do clipe em segundos
 * @param {number} clipEndTime - Tempo de fim do clipe em segundos
 * @param {string} outputSrtPath - Caminho do SRT ajustado
 */
function createAdjustedSRT(originalSrtPath, clipStartTime, clipEndTime, outputSrtPath) {
  const originalContent = fs.readFileSync(originalSrtPath, 'utf-8');
  const blocks = originalContent.trim().split(/\n\n+/);

  const adjustedBlocks = [];
  let newIndex = 1;

  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length < 3) continue;

    // Parse timestamp line (format: 00:00:00,000 --> 00:00:05,000)
    const timestampMatch = lines[1].match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/);
    if (!timestampMatch) continue;

    const startTime = parseSRTTimestamp(timestampMatch[1]);
    const endTime = parseSRTTimestamp(timestampMatch[2]);

    // Verificar se o segmento está dentro do range do clipe
    if (endTime <= clipStartTime || startTime >= clipEndTime) {
      continue; // Segmento fora do clipe
    }

    // Ajustar timestamps para serem relativos ao início do clipe
    const adjustedStart = Math.max(0, startTime - clipStartTime);
    const adjustedEnd = Math.min(clipEndTime - clipStartTime, endTime - clipStartTime);

    // Só incluir se tiver duração válida
    if (adjustedEnd <= adjustedStart) continue;

    const text = lines.slice(2).join('\n');

    adjustedBlocks.push(
      `${newIndex}\n${formatSRTTime(adjustedStart)} --> ${formatSRTTime(adjustedEnd)}\n${text}`
    );
    newIndex++;
  }

  fs.writeFileSync(outputSrtPath, adjustedBlocks.join('\n\n') + '\n', 'utf-8');
  return outputSrtPath;
}

/**
 * Parse timestamp SRT para segundos
 * @param {string} timestamp - Formato: HH:MM:SS,mmm
 * @returns {number}
 */
function parseSRTTimestamp(timestamp) {
  const [time, ms] = timestamp.split(',');
  const [hours, minutes, seconds] = time.split(':').map(Number);
  return hours * 3600 + minutes * 60 + seconds + parseInt(ms, 10) / 1000;
}

/**
 * Parse timestamp ASS para segundos
 * @param {string} timestamp - Formato: H:MM:SS.cc
 * @returns {number}
 */
function parseASSTimestamp(timestamp) {
  const [time, cs] = timestamp.split('.');
  const [hours, minutes, seconds] = time.split(':').map(Number);
  return hours * 3600 + minutes * 60 + seconds + parseInt(cs, 10) / 100;
}

/**
 * Cria um arquivo ASS ajustado para um clipe específico
 * @param {string} originalAssPath - Caminho do ASS original
 * @param {number} clipStartTime - Tempo de início do clipe em segundos
 * @param {number} clipEndTime - Tempo de fim do clipe em segundos
 * @param {string} outputAssPath - Caminho do ASS ajustado
 */
function createAdjustedASS(originalAssPath, clipStartTime, clipEndTime, outputAssPath) {
  const originalContent = fs.readFileSync(originalAssPath, 'utf-8');
  const lines = originalContent.split('\n');

  const adjustedLines = [];
  let inEvents = false;

  for (const line of lines) {
    if (line.startsWith('[Events]')) {
      inEvents = true;
      adjustedLines.push(line);
      continue;
    }

    if (!inEvents || !line.startsWith('Dialogue:')) {
      adjustedLines.push(line);
      continue;
    }

    // Parse linha de diálogo ASS
    // Formato: Dialogue: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
    const match = line.match(/^Dialogue:\s*(\d+),([^,]+),([^,]+),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),(.*)$/);
    if (!match) {
      continue;
    }

    const [, layer, startStr, endStr, style, name, ml, mr, mv, effect, text] = match;
    const startTime = parseASSTimestamp(startStr);
    const endTime = parseASSTimestamp(endStr);

    // Verificar se o segmento está dentro do range do clipe
    if (endTime <= clipStartTime || startTime >= clipEndTime) {
      continue;
    }

    // Ajustar timestamps
    const adjustedStart = Math.max(0, startTime - clipStartTime);
    const adjustedEnd = Math.min(clipEndTime - clipStartTime, endTime - clipStartTime);

    if (adjustedEnd <= adjustedStart) continue;

    const newLine = `Dialogue: ${layer},${formatASSTime(adjustedStart)},${formatASSTime(adjustedEnd)},${style},${name},${ml},${mr},${mv},${effect},${text}`;
    adjustedLines.push(newLine);
  }

  fs.writeFileSync(outputAssPath, adjustedLines.join('\n'), 'utf-8');
  return outputAssPath;
}

/**
 * Detecta o formato do arquivo de legenda
 * @param {string} subtitlePath - Caminho do arquivo
 * @returns {string} - 'srt' ou 'ass'
 */
function detectSubtitleFormat(subtitlePath) {
  return subtitlePath.endsWith('.ass') ? 'ass' : 'srt';
}

/**
 * Cria legenda ajustada para clipe (SRT ou ASS)
 * @param {string} originalPath - Caminho original
 * @param {number} clipStartTime
 * @param {number} clipEndTime
 * @param {string} outputPath
 * @returns {string} - Caminho do arquivo criado
 */
function createAdjustedSubtitle(originalPath, clipStartTime, clipEndTime, outputPath) {
  const format = detectSubtitleFormat(originalPath);

  if (format === 'ass') {
    return createAdjustedASS(originalPath, clipStartTime, clipEndTime, outputPath);
  } else {
    return createAdjustedSRT(originalPath, clipStartTime, clipEndTime, outputPath);
  }
}

/**
 * Verifica se há uma frase completa terminando próximo ao tempo
 * @param {Array} transcriptionSegments
 * @param {number} time
 * @param {number} tolerance
 * @returns {Object}
 */
function isSentenceEndNearTime(transcriptionSegments, time, tolerance = 2) {
  const sentenceEnders = /[.!?]$/;

  for (const segment of transcriptionSegments) {
    const segmentEndTime = segment.end;
    const text = segment.text.trim();

    if (Math.abs(segmentEndTime - time) <= tolerance && sentenceEnders.test(text)) {
      return { found: true, exactTime: segmentEndTime, bonus: 2.0 };
    }
  }

  return { found: false, exactTime: time, bonus: 0 };
}

/**
 * Calcula pontos inteligentes de corte
 * @param {number} duration
 * @param {Array} transcriptionSegments
 * @param {Array} silences
 * @param {Array} topicChanges
 * @returns {Array}
 */
function calculateSmartCutPoints(duration, transcriptionSegments, silences, topicChanges) {
  console.log(`[calculateSmartCutPoints] Duracao: ${duration}s, Segmentos: ${transcriptionSegments.length}`);

  const cutPoints = [0];
  let currentPosition = 0;
  let clipCount = 0;

  while (currentPosition < duration) {
    clipCount++;
    const minNextCut = currentPosition + config.MIN_CLIP_DURATION;
    const maxNextCut = Math.min(currentPosition + config.MAX_CLIP_DURATION, duration);

    if (minNextCut >= duration) break;

    let bestCutPoint = minNextCut;
    let bestScore = -1;

    const step = 1.0;
    for (let time = minNextCut; time <= maxNextCut; time += step) {
      let score = 0;

      // 1. Preferir cortes em silêncios (peso: 3.0)
      const nearSilence = silences.find(s => time >= s.start - 1 && time <= s.end + 1);
      if (nearSilence) score += 3.0;

      // 2. Preferir cortes em mudanças de tópico (peso: 2.5)
      const nearTopicChange = topicChanges.find(tc => Math.abs(tc.timestamp - time) < 5);
      if (nearTopicChange) score += 2.5 * nearTopicChange.confidence;

      // 3. Preferir cortes em pausas naturais (peso: 3.5)
      for (let i = 0; i < transcriptionSegments.length - 1; i++) {
        const currentSeg = transcriptionSegments[i];
        const nextSeg = transcriptionSegments[i + 1];
        const gap = nextSeg.start - currentSeg.end;

        if (gap > 0.3 && time >= currentSeg.end - 0.5 && time <= nextSeg.start + 0.5) {
          score += 3.5 * Math.min(gap, 2);
        }
      }

      // 4. Verificar frase completa (peso: 4.0)
      const sentenceCheck = isSentenceEndNearTime(transcriptionSegments, time, 2);
      if (sentenceCheck.found) {
        score += 4.0;
        if (Math.abs(sentenceCheck.exactTime - time) < 1) {
          time = sentenceCheck.exactTime;
        }
      }

      // 5. Penalizar cortes no meio de fala (peso: -3.0)
      const segmentAtTime = transcriptionSegments.find(seg => time > seg.start && time < seg.end);
      if (segmentAtTime && segmentAtTime.text.trim().length > 10) {
        score -= 3.0;
      }

      // 6. Penalizar extremos (peso: -1.0)
      const distanceFromMin = time - minNextCut;
      const distanceFromMax = maxNextCut - time;
      if (Math.min(distanceFromMin, distanceFromMax) < 5) {
        score -= 1.0;
      }

      // 7. Preferir duração ideal de 70s (peso: 1.5)
      const clipDuration = time - currentPosition;
      const durationDiff = Math.abs(clipDuration - 70);
      score += Math.max(0, 1.5 - (durationDiff / 20));

      if (score > bestScore) {
        bestScore = score;
        bestCutPoint = time;
      }
    }

    cutPoints.push(bestCutPoint);
    currentPosition = bestCutPoint;
    console.log(`[calculateSmartCutPoints] Clipe ${clipCount} - corte em ${bestCutPoint.toFixed(1)}s`);
  }

  if (cutPoints[cutPoints.length - 1] < duration) {
    cutPoints.push(duration);
  }

  return cutPoints;
}

/**
 * Cria clipes com legendas embutidas
 * @param {string} videoPath
 * @param {Array} cutPoints
 * @param {string} outputDir
 * @param {string} jobId
 * @param {string} srtPath
 * @param {number} batchSize
 * @returns {Promise<Array>}
 */
async function createClips(videoPath, cutPoints, outputDir, jobId, srtPath, batchSize = config.BATCH_SIZE) {
  const numClips = cutPoints.length - 1;
  const clips = [];
  const duration = cutPoints[cutPoints.length - 1];

  const normalizedSrtPath = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');

  for (let batchStart = 0; batchStart < numClips; batchStart += batchSize) {
    const batchEnd = Math.min(batchStart + batchSize, numClips);
    const batchPromises = [];

    console.log(`[${jobId}] Processando clipes ${batchStart + 1} a ${batchEnd} de ${numClips}...`);

    const job = jobService.getJob(jobId);
    if (job) {
      const progressBase = 60;
      const progressRange = 30;
      jobService.updateJob(jobId, {
        progress: Math.round(progressBase + (batchStart / numClips) * progressRange),
      });
    }

    for (let i = batchStart; i < batchEnd; i++) {
      let startTime = cutPoints[i];
      let endTime = cutPoints[i + 1];

      if (i > 0) startTime = Math.max(0, startTime - config.CUT_MARGIN);
      if (i < numClips - 1) endTime = Math.min(duration, endTime + config.CUT_MARGIN);

      const clipDuration = endTime - startTime;
      const clipNumber = String(i + 1).padStart(3, '0');
      const outputPath = path.join(outputDir, `clip_${clipNumber}.mp4`);

      const clipPromise = createSingleClip(
        videoPath,
        outputPath,
        startTime,
        clipDuration,
        normalizedSrtPath,
        jobId,
        clipNumber,
        i + 1,
        endTime
      );

      batchPromises.push(clipPromise);
    }

    const batchClips = await Promise.all(batchPromises);
    clips.push(...batchClips);

    console.log(`[${jobId}] Batch concluido: ${clips.length}/${numClips} clipes`);
  }

  clips.sort((a, b) => a.number - b.number);
  return clips;
}

/**
 * Cria um único clipe
 */
function createSingleClip(videoPath, outputPath, startTime, clipDuration, subtitlePath, jobId, clipNumber, number, endTime) {
  return new Promise((resolve, reject) => {
    const fadeDuration = 0.5;
    const subtitleFormat = detectSubtitleFormat(subtitlePath);

    // Criar legenda ajustada para este clipe específico
    const originalSubPath = subtitlePath.replace(/\\\:/g, ':').replace(/\//g, path.sep);
    const clipSubExt = subtitleFormat === 'ass' ? '.ass' : '.srt';
    const clipSubPath = originalSubPath.replace(/\.(srt|ass)$/, `_clip${clipNumber}${clipSubExt}`);

    try {
      createAdjustedSubtitle(originalSubPath, startTime, endTime, clipSubPath);
    } catch (err) {
      console.warn(`[${jobId}] Erro ao criar legenda ajustada para clipe ${clipNumber}:`, err.message);
    }

    const normalizedClipSubPath = clipSubPath.replace(/\\/g, '/').replace(/:/g, '\\:');

    // Para ASS, não usamos force_style pois o estilo já está no arquivo
    // Para SRT, aplicamos o estilo padrão
    let videoFilter;
    if (subtitleFormat === 'ass') {
      videoFilter = `ass='${normalizedClipSubPath}',fade=t=in:st=0:d=${fadeDuration},fade=t=out:st=${clipDuration - fadeDuration}:d=${fadeDuration}`;
    } else {
      const subtitleStyle = 'FontName=Arial,FontSize=18,Bold=1,PrimaryColour=&H00FFFF00,OutlineColour=&H00000000,BorderStyle=1,Outline=3,Shadow=1,Alignment=2,MarginV=30';
      videoFilter = `subtitles='${normalizedClipSubPath}':force_style='${subtitleStyle}',fade=t=in:st=0:d=${fadeDuration},fade=t=out:st=${clipDuration - fadeDuration}:d=${fadeDuration}`;
    }

    const audioFilter = `afade=t=in:st=0:d=${fadeDuration},afade=t=out:st=${clipDuration - fadeDuration}:d=${fadeDuration}`;

    const codec = getGPUCodec() || 'libx264';

    const outputOptions = [
      `-vf ${videoFilter}`,
      `-af ${audioFilter}`,
      `-c:v ${codec}`,
      '-c:a aac',
      '-b:a 128k',
    ];

    if (codec === 'libx264') {
      outputOptions.push(`-preset ${config.FFMPEG_PRESET}`);
      outputOptions.push('-crf 23');
    } else if (codec === 'h264_nvenc') {
      outputOptions.push('-preset p4');
      outputOptions.push('-cq 23');
    } else if (codec === 'h264_qsv') {
      outputOptions.push('-preset medium');
      outputOptions.push('-global_quality 23');
    } else if (codec === 'h264_amf') {
      outputOptions.push('-quality balanced');
      outputOptions.push('-rc cqp');
      outputOptions.push('-qp_i 23');
    }

    ffmpeg(videoPath)
      .setStartTime(startTime)
      .setDuration(clipDuration)
      .outputOptions(outputOptions)
      .output(outputPath)
      .on('start', (commandLine) => {
        console.log(`[${jobId}] FFmpeg comando: ${commandLine}`);
      })
      .on('end', () => {
        // Limpar legenda temporária do clipe
        try {
          if (fs.existsSync(clipSubPath)) fs.unlinkSync(clipSubPath);
        } catch (e) { /* ignorar */ }

        resolve({
          name: `clip_${clipNumber}.mp4`,
          url: `/downloads/${jobId}/clip_${clipNumber}.mp4`,
          number,
          startTime,
          endTime,
          duration: clipDuration,
        });
      })
      .on('error', (err, _stdout, stderr) => {
        console.error(`[${jobId}] Erro clipe ${clipNumber}:`, err.message);
        if (stderr) console.error(`[${jobId}] FFmpeg stderr:`, stderr);
        // Limpar legenda temporária mesmo em caso de erro
        try {
          if (fs.existsSync(clipSubPath)) fs.unlinkSync(clipSubPath);
        } catch (e) { /* ignorar */ }
        reject(err);
      })
      .run();
  });
}

/**
 * Cria um único clipe com interface simplificada (para cortes inteligentes)
 * @param {string} videoPath - Caminho do vídeo original
 * @param {number} startTime - Tempo de início em segundos
 * @param {number} endTime - Tempo de fim em segundos
 * @param {string} outputPath - Caminho de saída do clipe
 * @param {string} subtitlePath - Caminho do arquivo de legenda (SRT ou ASS)
 * @returns {Promise<void>}
 */
function createClipSimple(videoPath, startTime, endTime, outputPath, subtitlePath) {
  return new Promise((resolve, reject) => {
    const clipDuration = endTime - startTime;
    const fadeDuration = 0.5;
    const subtitleFormat = detectSubtitleFormat(subtitlePath);

    // Criar legenda ajustada para este clipe específico
    const clipNumber = path.basename(outputPath, '.mp4').replace('clip_', '');
    const clipSubExt = subtitleFormat === 'ass' ? '.ass' : '.srt';
    const clipSubPath = subtitlePath.replace(/\.(srt|ass)$/, `_clip${clipNumber}${clipSubExt}`);

    try {
      createAdjustedSubtitle(subtitlePath, startTime, endTime, clipSubPath);
    } catch (err) {
      console.warn(`Erro ao criar legenda ajustada:`, err.message);
    }

    const normalizedClipSubPath = clipSubPath.replace(/\\/g, '/').replace(/:/g, '\\:');

    // Para ASS, não usamos force_style pois o estilo já está no arquivo
    let videoFilter;
    if (subtitleFormat === 'ass') {
      videoFilter = `ass='${normalizedClipSubPath}',fade=t=in:st=0:d=${fadeDuration},fade=t=out:st=${clipDuration - fadeDuration}:d=${fadeDuration}`;
    } else {
      const subtitleStyle = 'FontName=Arial,FontSize=18,Bold=1,PrimaryColour=&H00FFFF00,OutlineColour=&H00000000,BorderStyle=1,Outline=3,Shadow=1,Alignment=2,MarginV=30';
      videoFilter = `subtitles='${normalizedClipSubPath}':force_style='${subtitleStyle}',fade=t=in:st=0:d=${fadeDuration},fade=t=out:st=${clipDuration - fadeDuration}:d=${fadeDuration}`;
    }

    const audioFilter = `afade=t=in:st=0:d=${fadeDuration},afade=t=out:st=${clipDuration - fadeDuration}:d=${fadeDuration}`;

    const codec = getGPUCodec() || 'libx264';

    const outputOptions = [
      `-vf ${videoFilter}`,
      `-af ${audioFilter}`,
      `-c:v ${codec}`,
      '-c:a aac',
      '-b:a 128k',
    ];

    if (codec === 'libx264') {
      outputOptions.push(`-preset ${config.FFMPEG_PRESET}`);
      outputOptions.push('-crf 23');
    } else if (codec === 'h264_nvenc') {
      outputOptions.push('-preset p4');
      outputOptions.push('-cq 23');
    } else if (codec === 'h264_qsv') {
      outputOptions.push('-preset medium');
      outputOptions.push('-global_quality 23');
    } else if (codec === 'h264_amf') {
      outputOptions.push('-quality balanced');
      outputOptions.push('-rc cqp');
      outputOptions.push('-qp_i 23');
    }

    ffmpeg(videoPath)
      .setStartTime(startTime)
      .setDuration(clipDuration)
      .outputOptions(outputOptions)
      .output(outputPath)
      .on('end', () => {
        // Limpar legenda temporária do clipe
        try {
          if (fs.existsSync(clipSubPath)) fs.unlinkSync(clipSubPath);
        } catch (e) { /* ignorar */ }
        resolve();
      })
      .on('error', (err) => {
        // Limpar legenda temporária mesmo em caso de erro
        try {
          if (fs.existsSync(clipSubPath)) fs.unlinkSync(clipSubPath);
        } catch (e) { /* ignorar */ }
        reject(err);
      })
      .run();
  });
}

module.exports = {
  calculateSmartCutPoints,
  createClips,
  createClipSimple,
  isSentenceEndNearTime,
  detectSubtitleFormat,
};
