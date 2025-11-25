const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { exec } = require('child_process');
const config = require('../config');

const execPromise = promisify(exec);

/**
 * Obtém o caminho do yt-dlp
 */
function getYtDlpPath() {
  const localPath = path.join(config.ROOT_DIR, 'yt-dlp.exe');
  return fs.existsSync(localPath) ? localPath : 'yt-dlp';
}

/**
 * Extrai o ID do vídeo da URL do YouTube
 * @param {string} url
 * @returns {string|null}
 */
function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /youtube\.com\/shorts\/([^&\n?#]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Converte formato VTT/SRV para segmentos compatíveis com Whisper
 * @param {string} subtitleContent - Conteúdo do arquivo de legenda
 * @param {string} format - Formato da legenda (vtt, srv3, json3)
 * @returns {Array} - Segmentos no formato Whisper
 */
function parseSubtitlesToSegments(subtitleContent, format) {
  const segments = [];

  if (format === 'json3') {
    try {
      const data = JSON.parse(subtitleContent);
      if (data.events) {
        // Primeiro, coletar todos os eventos com texto
        const textEvents = data.events.filter(e => e.segs && e.segs.some(s => s.utf8 && s.utf8.trim()));

        for (let i = 0; i < textEvents.length; i++) {
          const event = textEvents[i];
          const text = event.segs.map(s => s.utf8 || '').join('').trim();

          if (text && event.tStartMs !== undefined) {
            // Calcular end time: usar duração se disponível, senão usar início do próximo evento
            let endMs = event.tStartMs + (event.dDurationMs || 0);

            // Se duração é 0 ou muito pequena, usar o início do próximo evento
            if (event.dDurationMs === undefined || event.dDurationMs < 100) {
              if (i + 1 < textEvents.length) {
                endMs = textEvents[i + 1].tStartMs;
              } else {
                // Último segmento: estimar 3 segundos ou usar duração padrão
                endMs = event.tStartMs + 3000;
              }
            }

            segments.push({
              start: event.tStartMs / 1000,
              end: endMs / 1000,
              text: text,
            });
          }
        }
      }
    } catch (error) {
      console.warn('Erro ao parsear JSON3:', error.message);
    }
  } else if (format === 'vtt') {
    // Parse VTT format
    const lines = subtitleContent.split('\n');
    let currentSegment = null;

    for (const line of lines) {
      // Match timestamp line: 00:00:00.000 --> 00:00:05.000 ou 00:00.000 --> 00:05.000
      const timestampMatch = line.match(/(\d{1,2}:\d{2}[:.]\d{3}|\d{2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{1,2}:\d{2}[:.]\d{3}|\d{2}:\d{2}:\d{2}[.,]\d{3})/);
      if (timestampMatch) {
        if (currentSegment && currentSegment.text) {
          segments.push(currentSegment);
        }
        currentSegment = {
          start: parseTimestamp(timestampMatch[1]),
          end: parseTimestamp(timestampMatch[2]),
          text: '',
        };
      } else if (currentSegment && line.trim() && !line.startsWith('WEBVTT') && !line.startsWith('Kind:') && !line.startsWith('Language:') && !line.match(/^\d+$/)) {
        // Remove tags HTML/VTT como <c>, </c>, <00:00:00.000>
        const cleanText = line.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
        if (cleanText) {
          currentSegment.text += (currentSegment.text ? ' ' : '') + cleanText;
        }
      }
    }

    if (currentSegment && currentSegment.text) {
      segments.push(currentSegment);
    }
  }

  // Consolidar apenas duplicatas exatas, preservando timing original
  return consolidateSegmentsPreservingSync(segments);
}

/**
 * Converte timestamp VTT para segundos
 * Suporta formatos: HH:MM:SS.mmm, HH:MM:SS,mmm, MM:SS.mmm
 * @param {string} timestamp
 * @returns {number}
 */
function parseTimestamp(timestamp) {
  const normalized = timestamp.replace(',', '.');
  const parts = normalized.split(':');

  if (parts.length === 2) {
    // Formato MM:SS.mmm
    const minutes = parseInt(parts[0], 10);
    const seconds = parseFloat(parts[1]);
    return minutes * 60 + seconds;
  } else if (parts.length === 3) {
    // Formato HH:MM:SS.mmm
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const seconds = parseFloat(parts[2]);
    return hours * 3600 + minutes * 60 + seconds;
  }

  return 0;
}

/**
 * Consolida segmentos preservando sincronização original
 * Apenas remove duplicatas exatas consecutivas
 * @param {Array} segments
 * @returns {Array}
 */
function consolidateSegmentsPreservingSync(segments) {
  if (segments.length === 0) return [];

  const consolidated = [];
  let lastText = '';

  for (const seg of segments) {
    // Pular apenas se o texto é EXATAMENTE igual ao anterior (duplicata)
    if (seg.text === lastText) {
      // Atualizar o end time do último segmento consolidado
      if (consolidated.length > 0) {
        consolidated[consolidated.length - 1].end = seg.end;
      }
      continue;
    }

    // Adicionar segmento mantendo timing original
    consolidated.push({
      start: seg.start,
      end: seg.end,
      text: seg.text,
    });

    lastText = seg.text;
  }

  return consolidated;
}

/**
 * Tenta baixar legendas do YouTube usando yt-dlp
 * @param {string} videoUrl - URL do vídeo
 * @param {string} outputDir - Diretório de saída
 * @param {string} videoId - ID do vídeo para nomear arquivo
 * @returns {Promise<Object|null>} - Objeto com segments ou null se não encontrar
 */
async function fetchYouTubeSubtitles(videoUrl, outputDir, videoId) {
  const ytDlpPath = getYtDlpPath();
  const outputTemplate = path.join(outputDir, `${videoId}_subs`);

  // Tentar primeiro legendas em português, depois auto-geradas
  const languages = ['pt', 'pt-BR', 'en'];

  for (const lang of languages) {
    try {
      // Tentar legendas manuais primeiro
      let command = `"${ytDlpPath}" --skip-download --write-sub --sub-lang ${lang} --sub-format json3 -o "${outputTemplate}" "${videoUrl}"`;

      console.log(`[YouTube Subs] Tentando legendas manuais (${lang})...`);

      try {
        await execPromise(command, { maxBuffer: 10 * 1024 * 1024 });
      } catch {
        // Se não encontrar manuais, tentar auto-geradas
        command = `"${ytDlpPath}" --skip-download --write-auto-sub --sub-lang ${lang} --sub-format json3 -o "${outputTemplate}" "${videoUrl}"`;
        console.log(`[YouTube Subs] Tentando legendas automáticas (${lang})...`);
        await execPromise(command, { maxBuffer: 10 * 1024 * 1024 });
      }

      // Procurar arquivo de legenda gerado
      const possibleFiles = [
        `${outputTemplate}.${lang}.json3`,
        `${outputTemplate}.${lang}.vtt`,
      ];

      for (const filePath of possibleFiles) {
        if (fs.existsSync(filePath)) {
          console.log(`[YouTube Subs] Legenda encontrada: ${filePath}`);
          const content = fs.readFileSync(filePath, 'utf-8');
          const format = filePath.endsWith('.json3') ? 'json3' : 'vtt';
          const segments = parseSubtitlesToSegments(content, format);

          // Limpar arquivo temporário
          fs.unlinkSync(filePath);

          if (segments.length > 0) {
            console.log(`[YouTube Subs] ${segments.length} segmentos extraídos`);
            // Log de amostra para debug de sincronização
            if (segments.length > 0) {
              const sample = segments[0];
              console.log(`[YouTube Subs] Amostra: ${sample.start.toFixed(2)}s-${sample.end.toFixed(2)}s: "${sample.text.substring(0, 50)}..."`);
            }
            return {
              segments,
              source: `youtube-${lang}`,
              language: lang,
            };
          }
        }
      }
    } catch (error) {
      console.log(`[YouTube Subs] Não encontrou legendas em ${lang}`);
    }
  }

  // Tentar VTT como fallback
  try {
    const command = `"${ytDlpPath}" --skip-download --write-auto-sub --sub-format vtt -o "${outputTemplate}" "${videoUrl}"`;
    console.log('[YouTube Subs] Tentando formato VTT...');
    await execPromise(command, { maxBuffer: 10 * 1024 * 1024 });

    // Procurar qualquer arquivo VTT gerado
    const files = fs.readdirSync(outputDir);
    const vttFile = files.find(f => f.startsWith(`${videoId}_subs`) && f.endsWith('.vtt'));

    if (vttFile) {
      const filePath = path.join(outputDir, vttFile);
      const content = fs.readFileSync(filePath, 'utf-8');
      const segments = parseSubtitlesToSegments(content, 'vtt');

      fs.unlinkSync(filePath);

      if (segments.length > 0) {
        console.log(`[YouTube Subs] ${segments.length} segmentos extraídos do VTT`);
        return {
          segments,
          source: 'youtube-auto',
          language: 'auto',
        };
      }
    }
  } catch (error) {
    console.log('[YouTube Subs] Falha ao obter VTT:', error.message);
  }

  console.log('[YouTube Subs] Nenhuma legenda disponível');
  return null;
}

/**
 * Calcula qualidade estimada das legendas
 * @param {Array} segments
 * @returns {Object} - Métricas de qualidade
 */
function assessSubtitleQuality(segments) {
  if (!segments || segments.length === 0) {
    return { score: 0, reason: 'Sem segmentos' };
  }

  const totalText = segments.map(s => s.text).join(' ');
  const avgSegmentLength = totalText.length / segments.length;

  // Verificar se tem muitos segmentos vazios ou muito curtos
  const shortSegments = segments.filter(s => s.text.length < 5).length;
  const shortRatio = shortSegments / segments.length;

  // Verificar gaps grandes entre segmentos
  let largeGaps = 0;
  for (let i = 1; i < segments.length; i++) {
    if (segments[i].start - segments[i - 1].end > 10) {
      largeGaps++;
    }
  }

  let score = 100;
  const issues = [];

  if (avgSegmentLength < 10) {
    score -= 30;
    issues.push('Segmentos muito curtos');
  }

  if (shortRatio > 0.3) {
    score -= 20;
    issues.push('Muitos segmentos vazios');
  }

  if (largeGaps > segments.length * 0.2) {
    score -= 20;
    issues.push('Muitos gaps na transcrição');
  }

  return {
    score: Math.max(0, score),
    issues,
    totalSegments: segments.length,
    avgLength: Math.round(avgSegmentLength),
    recommendation: score >= 70 ? 'usar' : 'fallback-whisper',
  };
}

module.exports = {
  extractVideoId,
  fetchYouTubeSubtitles,
  parseSubtitlesToSegments,
  assessSubtitleQuality,
};
