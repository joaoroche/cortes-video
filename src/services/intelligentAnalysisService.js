const OpenAI = require('openai');
const config = require('../config');

const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

// Configurações de chunking para vídeos longos
const CHUNK_DURATION_SECONDS = 300; // 5 minutos por chunk
const CHUNK_OVERLAP_SECONDS = 30;   // 30s de overlap entre chunks
const MAX_PARALLEL_CHUNKS = 3;      // Máximo de chunks processados em paralelo
const LONG_VIDEO_THRESHOLD = 1200;  // 20 minutos - ativa chunking

/**
 * Compacta os segmentos para reduzir tokens
 * Agrupa segmentos próximos e remove informações desnecessárias
 */
function compactSegments(segments) {
  // Formato compacto: [start, end, "texto"]
  return segments.map(s => [
    Math.round(s.start * 100) / 100,
    Math.round(s.end * 100) / 100,
    s.text.trim()
  ]);
}

/**
 * Trunca a transcrição se for muito longa
 */
function truncateTranscription(text, maxChars = 15000) {
  if (text.length <= maxChars) return text;
  return text.substring(0, maxChars) + '... [TRUNCADO]';
}

/**
 * Divide segmentos em chunks de ~5 minutos com overlap
 * @param {Array} segments - Segmentos com start, end, text
 * @returns {Array} Array de chunks, cada um com seus segmentos e metadados
 */
function splitIntoChunks(segments) {
  if (!segments || segments.length === 0) return [];

  const videoDuration = segments[segments.length - 1].end;

  // Se vídeo curto, retorna chunk único
  if (videoDuration <= LONG_VIDEO_THRESHOLD) {
    return [{
      index: 0,
      startTime: 0,
      endTime: videoDuration,
      segments: segments,
      isOnly: true
    }];
  }

  const chunks = [];
  let chunkStart = 0;
  let chunkIndex = 0;

  while (chunkStart < videoDuration) {
    const chunkEnd = Math.min(chunkStart + CHUNK_DURATION_SECONDS, videoDuration);

    // Filtrar segmentos que pertencem a este chunk
    const chunkSegments = segments.filter(s =>
      s.start >= chunkStart && s.start < chunkEnd
    );

    if (chunkSegments.length > 0) {
      chunks.push({
        index: chunkIndex,
        startTime: chunkStart,
        endTime: chunkEnd,
        segments: chunkSegments,
        isOnly: false
      });
      chunkIndex++;
    }

    // Próximo chunk com overlap
    chunkStart = chunkEnd - CHUNK_OVERLAP_SECONDS;

    // Evitar loop infinito no final
    if (chunkEnd >= videoDuration) break;
  }

  return chunks;
}

/**
 * Remove clips duplicados baseado em proximidade temporal
 * Clips com menos de 10s de diferença no start são considerados duplicados
 */
function deduplicateClips(clips) {
  if (!clips || clips.length === 0) return [];

  // Ordenar por viral_score (maior primeiro)
  const sorted = [...clips].sort((a, b) => b.viral_score - a.viral_score);
  const deduplicated = [];

  for (const clip of sorted) {
    // Verificar se já existe clip similar (dentro de 10s)
    const isDuplicate = deduplicated.some(existing =>
      Math.abs(existing.start_time - clip.start_time) < 10
    );

    if (!isDuplicate) {
      deduplicated.push(clip);
    }
  }

  return deduplicated;
}

/**
 * Processa chunks em paralelo com limite de concorrência
 */
async function processChunksInParallel(chunks, settings, processFunc) {
  const results = [];

  // Processar em batches de MAX_PARALLEL_CHUNKS
  for (let i = 0; i < chunks.length; i += MAX_PARALLEL_CHUNKS) {
    const batch = chunks.slice(i, i + MAX_PARALLEL_CHUNKS);
    console.log(`Processando chunks ${i + 1}-${i + batch.length} de ${chunks.length}...`);

    const batchResults = await Promise.all(
      batch.map(chunk => processFunc(chunk, settings))
    );

    results.push(...batchResults);
  }

  return results;
}

/**
 * Gera o prompt para análise de conteúdo viral (versão otimizada)
 */
function generateViralAnalysisPrompt(transcription, segments, categories, clipDuration, maxClips) {
  const categoryNames = {
    curiosidades: 'Curiosidades',
    historia: 'História',
    filmes: 'Filmes/Séries',
    misterios: 'Mistérios'
  };

  const selectedCategories = categories.map(c => categoryNames[c] || c).join(', ');
  const minDuration = Math.max(30, clipDuration - 15);
  const maxDuration = clipDuration + 15;

  // Compactar segmentos e truncar transcrição
  const compactedSegments = compactSegments(segments);
  const truncatedTranscription = truncateTranscription(transcription);

  return `Você é especialista em detectar conteúdo viral para TikTok/Reels.

# MISSÃO
Encontre os ${maxClips} momentos MAIS VIRAIS desta transcrição para público brasileiro 16-35 anos.

# CATEGORIAS: ${selectedCategories}

# TRANSCRIÇÃO
${truncatedTranscription}

# SEGMENTOS [início, fim, "texto"]
${JSON.stringify(compactedSegments)}

# CRITÉRIOS DE SELEÇÃO
✅ INCLUIR:
- Revela algo que 95%+ não sabem
- Contradiz crença popular
- Mistério/morte/conspiração
- Estatísticas chocantes
- Gancho forte nos primeiros 2s

❌ EXCLUIR:
- Introduções/despedidas
- Informação óbvia
- Precisa de contexto anterior

# DURAÇÃO: ${minDuration}-${maxDuration}s (ideal: ${clipDuration}s)

# RESPONDA APENAS JSON:
{
  "clips_found": N,
  "clips": [{
    "title": "Título max 60 chars",
    "description": "2-3 frases",
    "start_time": 123.45,
    "end_time": 183.45,
    "duration": 60,
    "viral_score": 8,
    "category": "mistérios",
    "hook_suggestion": "Gancho 2s",
    "why_viral": "Razão curta",
    "caption_suggestion": "Legenda TikTok com emojis e hashtags",
    "hashtags": ["#viral"],
    "estimated_views": "10k-50k",
    "confidence_level": "alta"
  }],
  "warnings": []
}

SCORE: 10=viral garantido, 8-9=alto potencial, 6-7=bom, <6=não incluir
Ordene por viral_score (maior primeiro). Máximo ${maxClips} clips.`;
}

/**
 * Analisa um único chunk para identificar momentos virais
 */
async function analyzeChunk(chunk, settings) {
  const { categories, clipDuration, maxClips } = settings;

  // Para chunks, solicitar mais clips para ter margem na deduplicação
  const clipsPerChunk = chunk.isOnly ? maxClips : Math.ceil(maxClips / 2) + 2;

  const transcriptionText = chunk.segments.map(s => s.text).join(' ');

  const prompt = generateViralAnalysisPrompt(
    transcriptionText,
    chunk.segments,
    categories,
    clipDuration,
    clipsPerChunk
  );

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'Você é um especialista em conteúdo viral para TikTok e Reels. Responda APENAS com JSON válido, sem markdown ou explicações.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 4000
    });

    const content = response.choices[0].message.content;

    // Tentar extrair JSON da resposta
    let jsonContent = content;

    // Remover markdown se presente
    if (content.includes('```json')) {
      jsonContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    } else if (content.includes('```')) {
      jsonContent = content.replace(/```\n?/g, '');
    }

    const analysis = JSON.parse(jsonContent.trim());

    // Filtrar clips com score baixo
    if (analysis.clips && Array.isArray(analysis.clips)) {
      analysis.clips = analysis.clips.filter(clip => clip.viral_score >= 6);
    }

    return {
      chunkIndex: chunk.index,
      clips: analysis.clips || [],
      warnings: analysis.warnings || []
    };
  } catch (error) {
    console.error(`Erro na análise do chunk ${chunk.index}:`, error);
    return {
      chunkIndex: chunk.index,
      clips: [],
      warnings: [`Falha no chunk ${chunk.index}: ${error.message}`]
    };
  }
}

/**
 * Analisa a transcrição para identificar momentos virais
 * Para vídeos longos (>20min), divide em chunks e processa em paralelo
 * @param {Array} segments - Segmentos da transcrição com start, end, text
 * @param {Object} settings - Configurações (categories, clipDuration, maxClips)
 */
async function analyzeForViralContent(segments, settings) {
  const { maxClips } = settings;

  // Dividir em chunks
  const chunks = splitIntoChunks(segments);

  // Se for chunk único (vídeo curto), processar normalmente
  if (chunks.length === 1 && chunks[0].isOnly) {
    console.log('Vídeo curto detectado, processamento direto...');
    const result = await analyzeChunk(chunks[0], settings);
    return {
      clips_found: result.clips.length,
      clips: result.clips.slice(0, maxClips),
      warnings: result.warnings,
      chunking_used: false
    };
  }

  // Vídeo longo: processar chunks em paralelo
  console.log(`Vídeo longo detectado! Dividindo em ${chunks.length} chunks de 5 minutos...`);

  const chunkResults = await processChunksInParallel(chunks, settings, analyzeChunk);

  // Agregar todos os clips
  const allClips = chunkResults.flatMap(r => r.clips);
  const allWarnings = chunkResults.flatMap(r => r.warnings);

  console.log(`Total de clips encontrados antes da deduplicação: ${allClips.length}`);

  // Deduplicar clips similares (baseado em proximidade temporal)
  const uniqueClips = deduplicateClips(allClips);

  console.log(`Clips após deduplicação: ${uniqueClips.length}`);

  // Ordenar por viral_score e limitar
  const finalClips = uniqueClips
    .sort((a, b) => b.viral_score - a.viral_score)
    .slice(0, maxClips);

  return {
    clips_found: finalClips.length,
    clips: finalClips,
    warnings: allWarnings,
    chunking_used: true,
    chunks_processed: chunks.length
  };
}

/**
 * Converte análise viral em pontos de corte para o clipService
 */
function convertAnalysisToCutPoints(analysis) {
  if (!analysis.clips || analysis.clips.length === 0) {
    return [];
  }

  return analysis.clips.map(clip => ({
    start: clip.start_time,
    end: clip.end_time,
    title: clip.title,
    description: clip.description,
    viralScore: clip.viral_score,
    category: clip.category,
    hookSuggestion: clip.hook_suggestion,
    whyViral: clip.why_viral,
    captionSuggestion: clip.caption_suggestion,
    hashtags: clip.hashtags,
    estimatedViews: clip.estimated_views,
    confidenceLevel: clip.confidence_level
  }));
}

module.exports = {
  analyzeForViralContent,
  convertAnalysisToCutPoints,
  generateViralAnalysisPrompt
};
