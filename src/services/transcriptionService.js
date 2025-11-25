const fs = require('fs');
const OpenAI = require('openai');
const config = require('../config');
const {
  generateSRT,
  generateKaraokeASS,
  generateWordByWordASS,
  generateWordByWordSRT,
} = require('../utils/formatters');

// Cliente OpenAI
const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

/**
 * Processa requisições em lotes paralelos
 * @param {Array} items
 * @param {Function} processFn
 * @param {number} batchSize
 * @returns {Promise<Array>}
 */
async function processBatchParallel(items, processFn, batchSize = config.OPENAI_PARALLEL_REQUESTS) {
  const results = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(item => processFn(item).catch(err => {
        console.warn('Erro ao processar item em lote:', err.message);
        return null;
      }))
    );
    results.push(...batchResults.filter(r => r !== null));
  }

  return results;
}

/**
 * Transcreve áudio usando Whisper
 * @param {string} audioPath
 * @param {string} subtitleStyle - Estilo de legenda: 'standard', 'word_by_word', 'karaoke'
 * @returns {Promise<Object>}
 */
async function transcribeAudio(audioPath, subtitleStyle = 'standard') {
  try {
    // Para estilos word_by_word e karaoke, precisamos de timestamps por palavra
    const needsWordTimestamps = subtitleStyle === 'word_by_word' || subtitleStyle === 'karaoke';

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: needsWordTimestamps ? ['word', 'segment'] : ['segment'],
    });

    return transcription;
  } catch (error) {
    throw new Error(`Erro ao transcrever audio: ${error.message}`);
  }
}

/**
 * Salva transcrição como arquivo SRT
 * @param {Array} segments
 * @param {string} srtPath
 */
function saveSRT(segments, srtPath) {
  const srtContent = generateSRT(segments);
  fs.writeFileSync(srtPath, srtContent, 'utf-8');
  return srtContent;
}

/**
 * Salva transcrição no formato apropriado baseado no estilo
 * @param {Object} transcription - Objeto com segments e/ou words
 * @param {string} basePath - Caminho base (sem extensão)
 * @param {string} subtitleStyle - 'standard', 'word_by_word', 'karaoke'
 * @returns {Object} - { path, format } onde format é 'srt' ou 'ass'
 */
function saveSubtitles(transcription, basePath, subtitleStyle = 'standard') {
  let content;
  let format;
  let filePath;

  if (subtitleStyle === 'karaoke' && transcription.words && transcription.words.length > 0) {
    // Formato ASS com efeito karaoke
    content = generateKaraokeASS(transcription.words);
    format = 'ass';
    filePath = `${basePath}.ass`;
  } else if (subtitleStyle === 'word_by_word' && transcription.words && transcription.words.length > 0) {
    // Formato ASS com palavra por palavra destacada
    content = generateWordByWordASS(transcription.words);
    format = 'ass';
    filePath = `${basePath}.ass`;
  } else {
    // Formato SRT padrão (segmentos)
    content = generateSRT(transcription.segments || []);
    format = 'srt';
    filePath = `${basePath}.srt`;
  }

  fs.writeFileSync(filePath, content, 'utf-8');
  return { path: filePath, format, content };
}

/**
 * Analisa mudanças de tópico na transcrição
 * @param {Array} transcriptionSegments
 * @returns {Promise<Array>}
 */
async function analyzeTopicChanges(transcriptionSegments) {
  try {
    if (!transcriptionSegments || transcriptionSegments.length === 0) {
      return [];
    }

    // Agrupar segmentos em blocos de 30 segundos
    const blocks = [];
    const blockDuration = 30;
    let currentBlock = [];
    let blockStart = 0;

    for (const segment of transcriptionSegments) {
      if (segment.start >= blockStart + blockDuration) {
        if (currentBlock.length > 0) {
          blocks.push({
            start: blockStart,
            end: segment.start,
            text: currentBlock.map(s => s.text).join(' ').trim(),
          });
        }
        blockStart = Math.floor(segment.start / blockDuration) * blockDuration;
        currentBlock = [segment];
      } else {
        currentBlock.push(segment);
      }
    }

    // Adicionar último bloco
    if (currentBlock.length > 0) {
      const lastSegment = currentBlock[currentBlock.length - 1];
      blocks.push({
        start: blockStart,
        end: lastSegment.end,
        text: currentBlock.map(s => s.text).join(' ').trim(),
      });
    }

    // Criar pares de blocos para análise
    const blockPairs = [];
    for (let i = 1; i < blocks.length; i++) {
      blockPairs.push({
        prevBlock: blocks[i - 1],
        currBlock: blocks[i],
        index: i,
      });
    }

    // Processar análise de tópicos em paralelo
    const analyzeBlockPair = async (pair) => {
      try {
        const response = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'Voce e um especialista em analise de conteudo. Avalie se ha mudanca significativa de topico entre dois blocos de texto.',
            },
            {
              role: 'user',
              content: `Analise se ha mudanca de topico entre estes dois blocos:

Bloco 1: "${pair.prevBlock.text.substring(0, 200)}"
Bloco 2: "${pair.currBlock.text.substring(0, 200)}"

Responda apenas com JSON:
{
  "hasTopicChange": true ou false,
  "confidence": 0.0 a 1.0
}`,
            },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.3,
          max_tokens: 100,
        });

        const result = JSON.parse(response.choices[0].message.content);

        if (result.hasTopicChange && result.confidence > 0.6) {
          return {
            timestamp: pair.currBlock.start,
            confidence: result.confidence,
          };
        }
        return null;
      } catch (error) {
        console.warn(`Erro ao analisar mudanca de topico:`, error.message);
        return null;
      }
    };

    const topicChanges = await processBatchParallel(blockPairs, analyzeBlockPair, config.OPENAI_PARALLEL_REQUESTS);
    return topicChanges;
  } catch (error) {
    console.error('Erro ao analisar mudancas de topico:', error);
    return [];
  }
}

/**
 * Gera descrições dos clipes usando GPT
 * @param {Array} transcriptionSegments
 * @param {Array} clipRanges
 * @returns {Promise<Array>}
 */
async function generateClipDescriptions(transcriptionSegments, clipRanges) {
  try {
    const clipDataItems = clipRanges.map((range, i) => ({
      index: i,
      startTime: range.start,
      endTime: range.end,
    }));

    const processClip = async (clipData) => {
      const { index, startTime, endTime } = clipData;

      const clipSegments = transcriptionSegments.filter(
        seg => seg.start >= startTime && seg.start < endTime
      );

      const clipText = clipSegments.map(seg => seg.text).join(' ').trim();

      if (!clipText) {
        return {
          clipNumber: index + 1,
          title: `Clipe ${index + 1}`,
          description: 'Sem conteudo de audio neste segmento.',
          keywords: [],
          transcription: '',
        };
      }

      try {
        const response = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'Voce e um especialista em criar titulos e descricoes atraentes para clipes de video. Crie conteudo em portugues do Brasil, conciso e chamativo para redes sociais.',
            },
            {
              role: 'user',
              content: `Com base na seguinte transcricao de um clipe de video de 1 minuto, crie:
1. Um titulo chamativo (maximo 60 caracteres)
2. Uma descricao curta e atraente (maximo 150 caracteres)
3. 3-5 palavras-chave relevantes

Transcricao:
${clipText}

Responda em formato JSON:
{
  "title": "titulo aqui",
  "description": "descricao aqui",
  "keywords": ["palavra1", "palavra2", "palavra3"]
}`,
            },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.7,
        });

        const result = JSON.parse(response.choices[0].message.content);

        return {
          clipNumber: index + 1,
          title: result.title,
          description: result.description,
          keywords: result.keywords,
          transcription: clipText.substring(0, 500),
        };
      } catch (error) {
        console.warn(`Erro ao gerar descricao do clipe ${index + 1}:`, error.message);
        return {
          clipNumber: index + 1,
          title: `Clipe ${index + 1}`,
          description: clipText.substring(0, 150),
          keywords: [],
          transcription: clipText.substring(0, 500),
        };
      }
    };

    const clipDescriptions = await processBatchParallel(clipDataItems, processClip, config.OPENAI_PARALLEL_REQUESTS);
    clipDescriptions.sort((a, b) => a.clipNumber - b.clipNumber);

    return clipDescriptions;
  } catch (error) {
    throw new Error(`Erro ao gerar descricoes: ${error.message}`);
  }
}

module.exports = {
  openai,
  transcribeAudio,
  saveSRT,
  saveSubtitles,
  analyzeTopicChanges,
  generateClipDescriptions,
  processBatchParallel,
};
