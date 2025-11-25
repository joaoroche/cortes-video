const OpenAI = require('openai');
const config = require('../config');

const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

/**
 * Compacta os segmentos para reduzir tokens
 */
function compactSegments(segments) {
  return segments.map(s => [
    Math.round(s.start * 100) / 100,
    Math.round(s.end * 100) / 100,
    s.text.trim()
  ]);
}

/**
 * Trunca a transcrição se for muito longa
 */
function truncateTranscription(text, maxChars = 20000) {
  if (text.length <= maxChars) return text;
  return text.substring(0, maxChars) + '... [TRUNCADO]';
}

/**
 * Gera o prompt para análise de curiosidades completas
 * @param {string} transcription - Texto completo da transcrição
 * @param {Array} segments - Segmentos com start, end, text
 * @param {Object} settings - Configurações (minDuration, maxDuration, idealDuration, priority)
 * @param {number} maxBlocks - Número máximo de blocos a retornar
 */
function generateCuriosityAnalysisPrompt(transcription, segments, settings, maxBlocks) {
  const { minDuration, maxDuration, idealDuration, priority } = settings;
  const compactedSegments = compactSegments(segments);
  const truncatedTranscription = truncateTranscription(transcription);

  const priorityInstructions = {
    completeness: 'Priorize COMPLETUDE: histórias que têm começo, meio e fim claro',
    viral: 'Priorize VIRALIDADE: informações mais chocantes e surpreendentes',
    balanced: 'Balanceie COMPLETUDE e VIRALIDADE: histórias completas E impactantes'
  };

  return `Você é especialista em identificar CURIOSIDADES COMPLETAS em vídeos para TikTok/Reels.

# MISSÃO
Encontre os ${maxBlocks} MELHORES blocos de curiosidades/histórias COMPLETAS nesta transcrição.

IMPORTANTE: Cada bloco deve contar uma história/curiosidade DO INÍCIO AO FIM.
NÃO corte no meio de uma explicação.

# TRANSCRIÇÃO
${truncatedTranscription}

# SEGMENTOS [início, fim, "texto"]
${JSON.stringify(compactedSegments)}

# REGRAS DE DURAÇÃO
- Mínimo: ${minDuration}s (só se for uma curiosidade muito curta mas completa)
- Máximo: ${maxDuration}s (pode ser longo se necessário para completar a história)
- Ideal: ${idealDuration}s
- ${priorityInstructions[priority] || priorityInstructions.balanced}

# CRITÉRIOS DE SELEÇÃO

✅ CADA BLOCO DEVE TER:
1. **GANCHO** (primeiros 3s) - "Você sabia que...", "O que aconteceria se...", "A verdade sobre..."
2. **DESENVOLVIMENTO** - Explicação, contexto, detalhes interessantes
3. **CONCLUSÃO** - Finalização satisfatória, revelação, punchline

✅ INCLUIR BLOCOS QUE:
- Contam uma história completa e autocontida
- Revelam informação que 95%+ das pessoas não sabem
- Contradizem crenças populares
- Têm elementos de mistério/surpresa/choque
- São compreensíveis sem contexto anterior

❌ EXCLUIR BLOCOS QUE:
- Cortam no meio de uma explicação
- Precisam de contexto de partes anteriores do vídeo
- São apenas introduções/despedidas
- Ficam incompletos ou sem conclusão
- Informação óbvia ou senso comum

# COMPLETUDE (score 0-10)
10 = História perfeita (gancho forte + desenvolvimento completo + conclusão satisfatória)
8-9 = História muito boa (tem início/meio/fim, mas poderia ser melhor)
6-7 = História razoável (completa mas falta impacto)
< 6 = NÃO INCLUIR (incompleta ou fraca)

# RESPONDA APENAS JSON:
{
  "blocks_found": N,
  "blocks": [{
    "title": "Título da curiosidade (max 60 chars)",
    "description": "Resumo da curiosidade em 2-3 frases",
    "start_time": 45.2,
    "end_time": 138.7,
    "duration": 93.5,
    "completeness_score": 9,
    "viral_score": 8,
    "has_hook": true,
    "has_development": true,
    "has_conclusion": true,
    "hook_text": "Texto do gancho nos primeiros 3s",
    "conclusion_text": "Texto da conclusão",
    "why_complete": "Explica por que está completa",
    "why_viral": "Explica por que é viral",
    "category": "curiosidades" | "historia" | "filmes" | "misterios",
    "caption_suggestion": "Legenda TikTok com emojis e hashtags",
    "hashtags": ["#curiosidades", "#viral"],
    "estimated_views": "10k-50k",
    "confidence_level": "alta" | "media" | "baixa"
  }],
  "total_duration_analyzed": 900.5,
  "warnings": []
}

IMPORTANTE:
- Ordene por (completeness_score × 0.6 + viral_score × 0.4) - maior primeiro
- Só inclua blocos com completeness_score >= 6
- Se uma curiosidade precisa de 3 minutos para ficar completa, use 3 minutos
- Se uma curiosidade fica completa em 30s, use apenas 30s
- Máximo ${maxBlocks} blocos`;
}

/**
 * Analisa a transcrição para identificar blocos de curiosidades completas
 * @param {Array} segments - Segmentos da transcrição com start, end, text
 * @param {Object} settings - Configurações (minDuration, maxDuration, idealDuration, priority, maxBlocks)
 */
async function analyzeCuriosityBlocks(segments, settings) {
  const {
    minDuration = config.CURIOSITY_MODE.MIN_DURATION,
    maxDuration = config.CURIOSITY_MODE.MAX_DURATION,
    idealDuration = config.CURIOSITY_MODE.IDEAL_DURATION,
    priority = 'balanced',
    maxBlocks = 10
  } = settings;

  // Validar duração do vídeo
  if (!segments || segments.length === 0) {
    return {
      blocks_found: 0,
      blocks: [],
      warnings: ['Nenhum segmento fornecido']
    };
  }

  const videoDuration = segments[segments.length - 1].end;
  console.log(`[CuriositiesAnalysis] Duração do vídeo: ${videoDuration.toFixed(1)}s`);

  // Se o vídeo for muito curto, ajustar maxBlocks
  const estimatedMaxBlocks = Math.floor(videoDuration / minDuration);
  const actualMaxBlocks = Math.min(maxBlocks, estimatedMaxBlocks);

  console.log(`[CuriositiesAnalysis] Solicitando até ${actualMaxBlocks} blocos (${minDuration}s-${maxDuration}s)`);

  const transcriptionText = segments.map(s => s.text).join(' ');

  const prompt = generateCuriosityAnalysisPrompt(
    transcriptionText,
    segments,
    { minDuration, maxDuration, idealDuration, priority },
    actualMaxBlocks
  );

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'Você é um especialista em identificar curiosidades completas e autocontidas em vídeos. Responda APENAS com JSON válido, sem markdown ou explicações.'
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

    // Filtrar blocos com completeness_score baixo
    if (analysis.blocks && Array.isArray(analysis.blocks)) {
      const originalCount = analysis.blocks.length;
      analysis.blocks = analysis.blocks.filter(
        block => block.completeness_score >= config.CURIOSITY_MODE.MIN_COMPLETENESS_SCORE
      );

      if (analysis.blocks.length < originalCount) {
        const filtered = originalCount - analysis.blocks.length;
        console.log(`[CuriositiesAnalysis] ${filtered} blocos filtrados por completeness_score < ${config.CURIOSITY_MODE.MIN_COMPLETENESS_SCORE}`);
      }

      // Validar e ajustar limites de duração
      analysis.blocks = analysis.blocks.map(block => {
        const duration = block.end_time - block.start_time;

        // Avisar se duração está fora dos limites
        if (duration < minDuration) {
          console.warn(`[CuriositiesAnalysis] Bloco "${block.title}" com duração ${duration.toFixed(1)}s < ${minDuration}s`);
        }
        if (duration > maxDuration) {
          console.warn(`[CuriositiesAnalysis] Bloco "${block.title}" com duração ${duration.toFixed(1)}s > ${maxDuration}s`);
        }

        return block;
      });
    }

    console.log(`[CuriositiesAnalysis] ${analysis.blocks?.length || 0} blocos completos encontrados`);

    return {
      blocks_found: analysis.blocks?.length || 0,
      blocks: analysis.blocks || [],
      warnings: analysis.warnings || [],
      total_duration_analyzed: videoDuration
    };

  } catch (error) {
    console.error('[CuriositiesAnalysis] Erro na análise:', error);
    return {
      blocks_found: 0,
      blocks: [],
      warnings: [`Erro na análise: ${error.message}`],
      total_duration_analyzed: videoDuration
    };
  }
}

/**
 * Ajusta os limites de um bloco para coincidir com pausas naturais de fala
 * @param {number} startTime - Tempo de início do bloco
 * @param {number} endTime - Tempo de fim do bloco
 * @param {Array} segments - Segmentos da transcrição
 * @returns {Object} - { start, end } ajustados
 */
function adjustBoundariesToNaturalPauses(startTime, endTime, segments) {
  const TOLERANCE = 2.0; // 2 segundos de tolerância

  let adjustedStart = startTime;
  let adjustedEnd = endTime;

  // Ajustar início para o começo de uma frase
  for (const segment of segments) {
    if (Math.abs(segment.start - startTime) <= TOLERANCE) {
      adjustedStart = segment.start;
      break;
    }
  }

  // Ajustar fim para o final de uma frase (com pontuação)
  const sentenceEnders = /[.!?]$/;
  for (const segment of segments) {
    if (Math.abs(segment.end - endTime) <= TOLERANCE && sentenceEnders.test(segment.text.trim())) {
      adjustedEnd = segment.end;
      break;
    }
  }

  return {
    start: adjustedStart,
    end: adjustedEnd
  };
}

/**
 * Converte análise de curiosidades em pontos de corte para o clipService
 */
function convertAnalysisToCutPoints(analysis, segments) {
  if (!analysis.blocks || analysis.blocks.length === 0) {
    return [];
  }

  return analysis.blocks.map(block => {
    // Ajustar limites para pausas naturais
    const adjusted = adjustBoundariesToNaturalPauses(
      block.start_time,
      block.end_time,
      segments
    );

    return {
      start: adjusted.start,
      end: adjusted.end,
      title: block.title,
      description: block.description,
      completenessScore: block.completeness_score,
      viralScore: block.viral_score,
      hasHook: block.has_hook,
      hasDevelopment: block.has_development,
      hasConclusion: block.has_conclusion,
      hookText: block.hook_text,
      conclusionText: block.conclusion_text,
      whyComplete: block.why_complete,
      whyViral: block.why_viral,
      category: block.category,
      captionSuggestion: block.caption_suggestion,
      hashtags: block.hashtags,
      estimatedViews: block.estimated_views,
      confidenceLevel: block.confidence_level
    };
  });
}

module.exports = {
  analyzeCuriosityBlocks,
  convertAnalysisToCutPoints,
  adjustBoundariesToNaturalPauses,
  generateCuriosityAnalysisPrompt
};
