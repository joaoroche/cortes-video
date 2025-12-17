const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const { isValidYouTubeUrl } = require('../utils/validators');
const { formatTime } = require('../utils/formatters');
const jobService = require('../services/jobService');
const videoService = require('../services/videoService');
const transcriptionService = require('../services/transcriptionService');
const clipService = require('../services/clipService');
const coverService = require('../services/coverService');
const intelligentAnalysisService = require('../services/intelligentAnalysisService');
const youtubeSubtitlesService = require('../services/youtubeSubtitlesService');
const channelProfileService = require('../services/channelProfileService');
const curiositiesAnalysisService = require('../services/curiositiesAnalysisService');

/**
 * POST /api/process-video
 * Inicia o processamento de um vídeo do YouTube
 */
async function processVideo(req, res) {
  const {
    videoUrl,
    processingType = 'sequential',
    intelligentSettings,
    curiositySettings,
    subtitleStyle = config.DEFAULT_SUBTITLE_STYLE
  } = req.body;

  if (!videoUrl) {
    return res.status(400).json({ error: 'URL do video e obrigatoria' });
  }

  if (!isValidYouTubeUrl(videoUrl)) {
    return res.status(400).json({ error: 'URL do YouTube invalida' });
  }

  // Validar estilo de legenda
  const validStyles = Object.keys(config.SUBTITLE_STYLES);
  if (!validStyles.includes(subtitleStyle)) {
    return res.status(400).json({
      error: `Estilo de legenda invalido. Opcoes: ${validStyles.join(', ')}`
    });
  }

  // Validar configurações para modo inteligente
  if (processingType === 'intelligent') {
    if (!intelligentSettings || !intelligentSettings.categories || intelligentSettings.categories.length === 0) {
      return res.status(400).json({ error: 'Selecione pelo menos uma categoria para cortes inteligentes' });
    }
  }

  // Validar configurações para modo curiosidades
  if (processingType === 'curiosity') {
    if (!curiositySettings) {
      return res.status(400).json({ error: 'Configurações do modo curiosidades são obrigatórias' });
    }
    // Aplicar valores padrão se não fornecidos
    curiositySettings.minDuration = curiositySettings.minDuration || config.CURIOSITY_MODE.MIN_DURATION;
    curiositySettings.maxDuration = curiositySettings.maxDuration || config.CURIOSITY_MODE.MAX_DURATION;
    curiositySettings.idealDuration = curiositySettings.idealDuration || config.CURIOSITY_MODE.IDEAL_DURATION;
    curiositySettings.priority = curiositySettings.priority || 'balanced';
    curiositySettings.maxBlocks = curiositySettings.maxBlocks || config.CURIOSITY_MODE.DEFAULT_MAX_BLOCKS;
  }

  const jobId = uuidv4();
  jobService.createJob(jobId);

  // Processar em background baseado no tipo
  if (processingType === 'intelligent') {
    processVideoIntelligent(videoUrl, jobId, intelligentSettings, subtitleStyle);
  } else if (processingType === 'curiosity') {
    processVideoCuriosities(videoUrl, jobId, curiositySettings, subtitleStyle);
  } else {
    processVideoInBackground(videoUrl, jobId, subtitleStyle);
  }

  res.json({ jobId, message: 'Processamento iniciado' });
}

/**
 * GET /api/job/:jobId
 * Retorna o status de um job
 */
function getJobStatus(req, res) {
  const { jobId } = req.params;
  const job = jobService.getJob(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job nao encontrado' });
  }

  res.json(job);
}

/**
 * Processa o vídeo em background
 * @param {string} videoUrl
 * @param {string} jobId
 * @param {string} subtitleStyle - 'standard', 'word_by_word', 'karaoke'
 */
async function processVideoInBackground(videoUrl, jobId, subtitleStyle = 'standard') {
  let videoPath, audioPath, subtitlePath;

  try {
    videoPath = path.join(config.TEMP_DIR, `${jobId}.mp4`);
    audioPath = path.join(config.TEMP_DIR, `${jobId}.mp3`);
    const subtitleBasePath = path.join(config.TEMP_DIR, jobId);
    const jobDir = path.join(config.DOWNLOADS_DIR, jobId);

    // Para estilos especiais (karaoke/word_by_word), sempre usamos Whisper
    const needsWhisper = subtitleStyle !== 'standard';

    if (!fs.existsSync(jobDir)) {
      fs.mkdirSync(jobDir);
    }

    // 1. Download do vídeo
    console.log(`[${jobId}] Iniciando download...`);
    jobService.updateJob(jobId, { currentStep: 'Baixando video', progress: 5 });
    await videoService.downloadVideo(videoUrl, videoPath);

    // 2. Obter duração
    console.log(`[${jobId}] Obtendo duracao...`);
    jobService.updateJob(jobId, { currentStep: 'Analisando video', progress: 20 });
    const duration = await videoService.getVideoDuration(videoPath);

    // 3. Tentar buscar legendas do YouTube (só se não precisar de word-level)
    console.log(`[${jobId}] Buscando legendas...`);
    jobService.updateJob(jobId, { currentStep: 'Buscando legendas', progress: 30 });

    const videoId = youtubeSubtitlesService.extractVideoId(videoUrl);
    let transcription = null;
    let usedYouTubeSubs = false;

    // Só usa legendas do YouTube se for estilo padrão
    if (videoId && !needsWhisper) {
      const ytSubs = await youtubeSubtitlesService.fetchYouTubeSubtitles(videoUrl, config.TEMP_DIR, videoId);

      if (ytSubs) {
        const quality = youtubeSubtitlesService.assessSubtitleQuality(ytSubs.segments);
        console.log(`[${jobId}] Qualidade legendas YouTube: ${quality.score}/100 (${quality.recommendation})`);

        if (quality.recommendation === 'usar') {
          transcription = { segments: ytSubs.segments };
          usedYouTubeSubs = true;
          console.log(`[${jobId}] Usando legendas do YouTube (economia: ~$0.06)`);
        } else {
          console.log(`[${jobId}] Legendas YouTube baixa qualidade, usando Whisper...`);
        }
      }
    } else if (needsWhisper) {
      console.log(`[${jobId}] Estilo ${subtitleStyle} requer Whisper para timestamps por palavra`);
    }

    // 4. Extrair áudio e transcrever com Whisper (se necessário)
    if (!usedYouTubeSubs) {
      console.log(`[${jobId}] Extraindo audio...`);
      jobService.updateJob(jobId, { currentStep: 'Extraindo audio', progress: 35 });
      await videoService.extractAudio(videoPath, audioPath);

      // Transcrever com Whisper (com word-level se necessário)
      console.log(`[${jobId}] Transcrevendo com Whisper...`);
      jobService.updateJob(jobId, { currentStep: 'Transcrevendo audio (Whisper)', progress: 40 });
      transcription = await transcriptionService.transcribeAudio(audioPath, subtitleStyle);
    } else {
      jobService.updateJob(jobId, { currentStep: 'Legendas YouTube obtidas', progress: 40 });
    }

    // 5. Gerar legendas no formato apropriado
    console.log(`[${jobId}] Gerando legendas (${subtitleStyle})...`);
    jobService.updateJob(jobId, { currentStep: 'Gerando legendas', progress: 45 });
    const subtitleResult = transcriptionService.saveSubtitles(transcription, subtitleBasePath, subtitleStyle);
    subtitlePath = subtitleResult.path;
    console.log(`[${jobId}] Legendas salvas: ${subtitlePath} (formato: ${subtitleResult.format})`)

    // 6. Detectar silêncios (precisa do áudio)
    console.log(`[${jobId}] Detectando silencios...`);
    jobService.updateJob(jobId, { currentStep: 'Detectando silencios', progress: 47 });
    let silences = [];
    try {
      // Se usou YouTube subs, ainda precisa extrair áudio para silêncios
      if (usedYouTubeSubs && !fs.existsSync(audioPath)) {
        await videoService.extractAudio(videoPath, audioPath);
      }
      silences = await videoService.detectSilences(audioPath);
      console.log(`[${jobId}] ${silences.length} silencios detectados`);
    } catch (error) {
      console.warn(`[${jobId}] Erro ao detectar silencios:`, error.message);
    }

    // 7. Analisar mudanças de tópico
    console.log(`[${jobId}] Analisando topicos...`);
    jobService.updateJob(jobId, { currentStep: 'Analisando topicos', progress: 49 });
    let topicChanges = [];
    try {
      topicChanges = await transcriptionService.analyzeTopicChanges(transcription.segments);
      console.log(`[${jobId}] ${topicChanges.length} mudancas de topico`);
    } catch (error) {
      console.warn(`[${jobId}] Erro ao analisar topicos:`, error.message);
    }

    // 8. Calcular pontos de corte
    console.log(`[${jobId}] Calculando pontos de corte...`);
    jobService.updateJob(jobId, { currentStep: 'Calculando cortes', progress: 52 });
    const cutPoints = clipService.calculateSmartCutPoints(
      duration,
      transcription.segments,
      silences,
      topicChanges
    );
    console.log(`[${jobId}] ${cutPoints.length - 1} clipes serao criados`);

    // Log dos clipes planejados
    for (let i = 0; i < cutPoints.length - 1; i++) {
      const clipDuration = cutPoints[i + 1] - cutPoints[i];
      console.log(`[${jobId}] Clipe ${i + 1}: ${formatTime(cutPoints[i])} - ${formatTime(cutPoints[i + 1])} (${Math.round(clipDuration)}s)`);
    }

    // 9. Gerar descrições dos clipes
    console.log(`[${jobId}] Gerando descricoes...`);
    jobService.updateJob(jobId, { currentStep: 'Gerando descricoes', progress: 55 });
    const clipRanges = [];
    for (let i = 0; i < cutPoints.length - 1; i++) {
      clipRanges.push({ start: cutPoints[i], end: cutPoints[i + 1] });
    }
    const clipDescriptions = await transcriptionService.generateClipDescriptions(
      transcription.segments,
      clipRanges
    );

    // 10. Criar clipes
    console.log(`[${jobId}] Criando clipes...`);
    jobService.updateJob(jobId, { currentStep: 'Criando clipes', progress: 60 });
    const clips = await clipService.createClips(
      videoPath,
      cutPoints,
      jobDir,
      jobId,
      subtitlePath,
      config.BATCH_SIZE
    );

    // 11. Adicionar descrições aos clipes
    for (const clip of clips) {
      const description = clipDescriptions.find(desc => desc.clipNumber === clip.number);
      if (description) {
        clip.title = description.title;
        clip.description = description.description;
        clip.keywords = description.keywords;
        clip.transcription = description.transcription;
      }
    }

    // 12. Gerar capas e descrições TikTok
    console.log(`[${jobId}] Gerando capas e descricoes TikTok...`);
    jobService.updateJob(jobId, { currentStep: 'Gerando capas TikTok', progress: 90 });
    await coverService.generateCoversAndTikTokDescriptions(clips, jobId, jobDir);

    // 13. Finalizar
    jobService.completeJob(jobId, clips);

    // Limpar temporários
    if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
    if (subtitlePath && fs.existsSync(subtitlePath)) fs.unlinkSync(subtitlePath);

    console.log(`[${jobId}] Processamento concluido! ${clips.length} clipes criados.`);

  } catch (error) {
    console.error(`[${jobId}] Erro:`, error);
    jobService.failJob(jobId, error.message);

    // Limpar temporários em caso de erro
    try {
      if (videoPath && fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
      if (audioPath && fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
      if (subtitlePath && fs.existsSync(subtitlePath)) fs.unlinkSync(subtitlePath);
    } catch (cleanupError) {
      console.error(`[${jobId}] Erro ao limpar:`, cleanupError);
    }
  }
}

/**
 * Processa o vídeo usando análise inteligente de IA
 * @param {string} videoUrl
 * @param {string} jobId
 * @param {Object} settings
 * @param {string} subtitleStyle - 'standard', 'word_by_word', 'karaoke'
 */
async function processVideoIntelligent(videoUrl, jobId, settings, subtitleStyle = 'standard') {
  let videoPath, audioPath, subtitlePath;
  let channelInfo = null;
  let channelProfile = null;

  try {
    videoPath = path.join(config.TEMP_DIR, `${jobId}.mp4`);
    audioPath = path.join(config.TEMP_DIR, `${jobId}.mp3`);
    const subtitleBasePath = path.join(config.TEMP_DIR, jobId);
    const jobDir = path.join(config.DOWNLOADS_DIR, jobId);

    // Para estilos especiais (karaoke/word_by_word), sempre usamos Whisper
    const needsWhisper = subtitleStyle !== 'standard';

    if (!fs.existsSync(jobDir)) {
      fs.mkdirSync(jobDir);
    }

    // 0. Obter info do canal e verificar perfil existente
    console.log(`[${jobId}] [INTELIGENTE] Verificando canal...`);
    jobService.updateJob(jobId, { currentStep: 'Analisando canal', progress: 2 });

    channelInfo = await channelProfileService.getChannelInfo(videoUrl);
    if (channelInfo) {
      console.log(`[${jobId}] [INTELIGENTE] Canal: ${channelInfo.channelName}`);
      channelProfile = channelProfileService.getProfile(channelInfo.channelId);

      if (channelProfile) {
        const recommendations = channelProfileService.getAnalysisRecommendations(channelProfile);
        if (recommendations) {
          console.log(`[${jobId}] [INTELIGENTE] Perfil encontrado (${channelProfile.videosAnalyzed} vídeos analisados)`);
          console.log(`[${jobId}] [INTELIGENTE] Recomendações: categorias=${recommendations.suggestedCategories.join(',')} duração=${recommendations.suggestedDuration}s`);

          // Aplicar recomendações se o usuário não especificou
          if (recommendations.priorityTimeRanges.length > 0) {
            console.log(`[${jobId}] [INTELIGENTE] Momentos típicos: ${recommendations.priorityTimeRanges.map(r => r.description).join(', ')}`);
          }
        }
      } else {
        console.log(`[${jobId}] [INTELIGENTE] Novo canal - criando perfil após análise`);
      }
    }

    // 1. Download do vídeo
    console.log(`[${jobId}] [INTELIGENTE] Iniciando download...`);
    jobService.updateJob(jobId, { currentStep: 'Baixando video', progress: 5 });
    await videoService.downloadVideo(videoUrl, videoPath);

    // 2. Verificar vídeo
    console.log(`[${jobId}] [INTELIGENTE] Verificando video...`);
    jobService.updateJob(jobId, { currentStep: 'Analisando video', progress: 15 });
    await videoService.getVideoDuration(videoPath); // Validar que o vídeo é processável

    // 3. Tentar buscar legendas do YouTube (só se não precisar de word-level)
    console.log(`[${jobId}] [INTELIGENTE] Buscando legendas...`);
    jobService.updateJob(jobId, { currentStep: 'Buscando legendas', progress: 25 });

    const videoId = youtubeSubtitlesService.extractVideoId(videoUrl);
    let transcription = null;
    let usedYouTubeSubs = false;

    // Só usa legendas do YouTube se for estilo padrão
    if (videoId && !needsWhisper) {
      const ytSubs = await youtubeSubtitlesService.fetchYouTubeSubtitles(videoUrl, config.TEMP_DIR, videoId);

      if (ytSubs) {
        const quality = youtubeSubtitlesService.assessSubtitleQuality(ytSubs.segments);
        console.log(`[${jobId}] [INTELIGENTE] Qualidade legendas YouTube: ${quality.score}/100`);

        if (quality.recommendation === 'usar') {
          transcription = { segments: ytSubs.segments };
          usedYouTubeSubs = true;
          console.log(`[${jobId}] [INTELIGENTE] Usando legendas do YouTube (economia: ~$0.06)`);
        }
      }
    } else if (needsWhisper) {
      console.log(`[${jobId}] [INTELIGENTE] Estilo ${subtitleStyle} requer Whisper para timestamps por palavra`);
    }

    // 4. Extrair áudio e transcrever (só se não tiver legendas YouTube)
    if (!usedYouTubeSubs) {
      console.log(`[${jobId}] [INTELIGENTE] Extraindo audio...`);
      jobService.updateJob(jobId, { currentStep: 'Extraindo audio', progress: 30 });
      await videoService.extractAudio(videoPath, audioPath);

      console.log(`[${jobId}] [INTELIGENTE] Transcrevendo com Whisper...`);
      jobService.updateJob(jobId, { currentStep: 'Transcrevendo audio (Whisper)', progress: 35 });
      transcription = await transcriptionService.transcribeAudio(audioPath, subtitleStyle);
    } else {
      jobService.updateJob(jobId, { currentStep: 'Legendas YouTube obtidas', progress: 35 });
    }

    // 5. Gerar legendas no formato apropriado
    console.log(`[${jobId}] [INTELIGENTE] Gerando legendas (${subtitleStyle})...`);
    jobService.updateJob(jobId, { currentStep: 'Gerando legendas', progress: 45 });
    const subtitleResult = transcriptionService.saveSubtitles(transcription, subtitleBasePath, subtitleStyle);
    subtitlePath = subtitleResult.path;
    console.log(`[${jobId}] [INTELIGENTE] Legendas salvas: ${subtitlePath} (formato: ${subtitleResult.format})`)

    // 6. Analisar conteúdo viral com IA
    console.log(`[${jobId}] [INTELIGENTE] Analisando conteudo viral...`);
    jobService.updateJob(jobId, { currentStep: 'Detectando momentos virais (IA)', progress: 55 });
    const viralAnalysis = await intelligentAnalysisService.analyzeForViralContent(
      transcription.segments,
      settings
    );

    console.log(`[${jobId}] [INTELIGENTE] ${viralAnalysis.clips?.length || 0} momentos virais encontrados`);

    // Atualizar perfil do canal com os resultados
    if (channelInfo && viralAnalysis.clips && viralAnalysis.clips.length > 0) {
      channelProfileService.updateProfile(channelInfo.channelId, channelInfo.channelName, viralAnalysis);
    }

    // Verificar se encontrou clipes
    if (!viralAnalysis.clips || viralAnalysis.clips.length === 0) {
      console.log(`[${jobId}] [INTELIGENTE] Nenhum momento viral encontrado com score >= 6`);
      jobService.completeJob(jobId, []);

      // Limpar temporários
      if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
      if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
      if (subtitlePath && fs.existsSync(subtitlePath)) fs.unlinkSync(subtitlePath);

      return;
    }

    // 7. Converter análise em pontos de corte
    const viralClips = intelligentAnalysisService.convertAnalysisToCutPoints(viralAnalysis);

    // Log dos clipes detectados
    viralClips.forEach((clip, i) => {
      console.log(`[${jobId}] [INTELIGENTE] Clipe ${i + 1}: ${formatTime(clip.start)} - ${formatTime(clip.end)} (Score: ${clip.viralScore}) - ${clip.title}`);
    });

    // 8. Criar clipes
    console.log(`[${jobId}] [INTELIGENTE] Criando clipes...`);
    jobService.updateJob(jobId, { currentStep: 'Criando clipes virais', progress: 65 });

    const clips = [];
    const totalClips = viralClips.length;

    for (let i = 0; i < totalClips; i++) {
      const viralClip = viralClips[i];
      const clipNumber = i + 1;
      const clipName = `clip_${clipNumber}.mp4`;
      const outputPath = path.join(jobDir, clipName);

      const progressPercent = 65 + Math.round((i / totalClips) * 25);
      jobService.updateJob(jobId, {
        currentStep: `Criando clipe ${clipNumber}/${totalClips}`,
        progress: progressPercent
      });

      try {
        await clipService.createClipSimple(
          videoPath,
          viralClip.start,
          viralClip.end,
          outputPath,
          subtitlePath
        );

        clips.push({
          number: clipNumber,
          name: clipName,
          url: `/downloads/${jobId}/${clipName}`,
          start: viralClip.start,
          end: viralClip.end,
          duration: viralClip.end - viralClip.start,
          title: viralClip.title,
          description: viralClip.description,
          viralScore: viralClip.viralScore,
          category: viralClip.category,
          hookSuggestion: viralClip.hookSuggestion,
          whyViral: viralClip.whyViral,
          hashtags: viralClip.hashtags,
          estimatedViews: viralClip.estimatedViews,
          confidenceLevel: viralClip.confidenceLevel,
          keywords: viralClip.hashtags?.map(h => h.replace('#', '')) || []
        });

        console.log(`[${jobId}] [INTELIGENTE] Clipe ${clipNumber} criado com sucesso`);
      } catch (error) {
        console.error(`[${jobId}] [INTELIGENTE] Erro ao criar clipe ${clipNumber}:`, error.message);
      }
    }

    // 9. Gerar capas e descrições TikTok
    console.log(`[${jobId}] [INTELIGENTE] Gerando capas e descricoes TikTok...`);
    jobService.updateJob(jobId, { currentStep: 'Gerando capas TikTok', progress: 92 });

    // Usar caption_suggestion da análise viral para TikTok
    for (const clip of clips) {
      const viralClip = viralClips[clip.number - 1];
      if (viralClip && viralClip.captionSuggestion) {
        clip.tiktokDescription = viralClip.captionSuggestion;
      }
    }

    await coverService.generateCoversAndTikTokDescriptions(clips, jobId, jobDir);

    // 10. Finalizar
    jobService.completeJob(jobId, clips);

    // Limpar temporários
    if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
    if (subtitlePath && fs.existsSync(subtitlePath)) fs.unlinkSync(subtitlePath);

    console.log(`[${jobId}] [INTELIGENTE] Processamento concluido! ${clips.length} clipes virais criados.`);

  } catch (error) {
    console.error(`[${jobId}] [INTELIGENTE] Erro:`, error);
    jobService.failJob(jobId, error.message);

    // Limpar temporários em caso de erro
    try {
      if (videoPath && fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
      if (audioPath && fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
      if (subtitlePath && fs.existsSync(subtitlePath)) fs.unlinkSync(subtitlePath);
    } catch (cleanupError) {
      console.error(`[${jobId}] [INTELIGENTE] Erro ao limpar:`, cleanupError);
    }
  }
}

/**
 * Processa o vídeo usando análise de curiosidades completas (duração variável)
 * @param {string} videoUrl
 * @param {string} jobId
 * @param {Object} settings - { minDuration, maxDuration, idealDuration, priority, maxBlocks }
 * @param {string} subtitleStyle
 */
async function processVideoCuriosities(videoUrl, jobId, settings, subtitleStyle = 'standard') {
  let videoPath, audioPath, subtitlePath;

  try {
    videoPath = path.join(config.TEMP_DIR, `${jobId}.mp4`);
    audioPath = path.join(config.TEMP_DIR, `${jobId}.mp3`);
    const subtitleBasePath = path.join(config.TEMP_DIR, jobId);
    const jobDir = path.join(config.DOWNLOADS_DIR, jobId);

    // Para estilos especiais (karaoke/word_by_word), sempre usamos Whisper
    const needsWhisper = subtitleStyle !== 'standard';

    if (!fs.existsSync(jobDir)) {
      fs.mkdirSync(jobDir);
    }

    // 1. Download do vídeo
    console.log(`[${jobId}] [CURIOSITY] Iniciando download...`);
    jobService.updateJob(jobId, { currentStep: 'Baixando video', progress: 5 });
    await videoService.downloadVideo(videoUrl, videoPath);

    // 2. Verificar vídeo
    console.log(`[${jobId}] [CURIOSITY] Analisando video...`);
    jobService.updateJob(jobId, { currentStep: 'Analisando video', progress: 15 });
    await videoService.getVideoDuration(videoPath);

    // 3. Tentar buscar legendas do YouTube (só se não precisar de word-level)
    console.log(`[${jobId}] [CURIOSITY] Buscando legendas...`);
    jobService.updateJob(jobId, { currentStep: 'Buscando legendas', progress: 25 });

    const videoId = youtubeSubtitlesService.extractVideoId(videoUrl);
    let transcription = null;
    let usedYouTubeSubs = false;

    // Só usa legendas do YouTube se for estilo padrão
    if (videoId && !needsWhisper) {
      const ytSubs = await youtubeSubtitlesService.fetchYouTubeSubtitles(videoUrl, config.TEMP_DIR, videoId);

      if (ytSubs) {
        const quality = youtubeSubtitlesService.assessSubtitleQuality(ytSubs.segments);
        console.log(`[${jobId}] [CURIOSITY] Qualidade legendas YouTube: ${quality.score}/100`);

        if (quality.recommendation === 'usar') {
          transcription = { segments: ytSubs.segments };
          usedYouTubeSubs = true;
          console.log(`[${jobId}] [CURIOSITY] Usando legendas do YouTube (economia: ~$0.06)`);
        }
      }
    } else if (needsWhisper) {
      console.log(`[${jobId}] [CURIOSITY] Estilo ${subtitleStyle} requer Whisper para timestamps por palavra`);
    }

    // 4. Extrair áudio e transcrever (só se não tiver legendas YouTube)
    if (!usedYouTubeSubs) {
      console.log(`[${jobId}] [CURIOSITY] Extraindo audio...`);
      jobService.updateJob(jobId, { currentStep: 'Extraindo audio', progress: 30 });
      await videoService.extractAudio(videoPath, audioPath);

      console.log(`[${jobId}] [CURIOSITY] Transcrevendo com Whisper...`);
      jobService.updateJob(jobId, { currentStep: 'Transcrevendo audio (Whisper)', progress: 35 });
      transcription = await transcriptionService.transcribeAudio(audioPath, subtitleStyle);
    } else {
      jobService.updateJob(jobId, { currentStep: 'Legendas YouTube obtidas', progress: 35 });
    }

    // 5. Gerar legendas no formato apropriado
    console.log(`[${jobId}] [CURIOSITY] Gerando legendas (${subtitleStyle})...`);
    jobService.updateJob(jobId, { currentStep: 'Gerando legendas', progress: 45 });
    const subtitleResult = transcriptionService.saveSubtitles(transcription, subtitleBasePath, subtitleStyle);
    subtitlePath = subtitleResult.path;
    console.log(`[${jobId}] [CURIOSITY] Legendas salvas: ${subtitlePath} (formato: ${subtitleResult.format})`);

    // 6. Analisar blocos de curiosidades com IA
    console.log(`[${jobId}] [CURIOSITY] Detectando curiosidades completas (${settings.minDuration}s-${settings.maxDuration}s)...`);
    jobService.updateJob(jobId, { currentStep: 'Detectando curiosidades completas (IA)', progress: 55 });
    const curiosityAnalysis = await curiositiesAnalysisService.analyzeCuriosityBlocks(
      transcription.segments,
      settings
    );

    console.log(`[${jobId}] [CURIOSITY] ${curiosityAnalysis.blocks?.length || 0} curiosidades completas encontradas`);

    // Verificar se encontrou blocos
    if (!curiosityAnalysis.blocks || curiosityAnalysis.blocks.length === 0) {
      console.log(`[${jobId}] [CURIOSITY] Nenhuma curiosidade completa encontrada com completeness_score >= ${config.CURIOSITY_MODE.MIN_COMPLETENESS_SCORE}`);
      jobService.completeJob(jobId, []);

      // Limpar temporários
      if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
      if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
      if (subtitlePath && fs.existsSync(subtitlePath)) fs.unlinkSync(subtitlePath);

      return;
    }

    // 7. Converter análise em pontos de corte
    const curiosityBlocks = curiositiesAnalysisService.convertAnalysisToCutPoints(
      curiosityAnalysis,
      transcription.segments
    );

    // Log dos blocos detectados
    curiosityBlocks.forEach((block, i) => {
      const duration = block.end - block.start;
      console.log(`[${jobId}] [CURIOSITY] Bloco ${i + 1}: ${formatTime(block.start)} - ${formatTime(block.end)} (${duration.toFixed(1)}s) - "${block.title}" (Completude: ${block.completenessScore}, Viral: ${block.viralScore})`);
    });

    // 8. Criar clipes
    console.log(`[${jobId}] [CURIOSITY] Criando clipes com duração variável...`);
    jobService.updateJob(jobId, { currentStep: 'Criando clipes de curiosidades', progress: 65 });

    const clips = [];
    const totalClips = curiosityBlocks.length;

    for (let i = 0; i < totalClips; i++) {
      const block = curiosityBlocks[i];
      const clipNumber = i + 1;
      const clipName = `clip_${clipNumber}.mp4`;
      const outputPath = path.join(jobDir, clipName);

      const progressPercent = 65 + Math.round((i / totalClips) * 25);
      jobService.updateJob(jobId, {
        currentStep: `Criando clipe ${clipNumber}/${totalClips} (${(block.end - block.start).toFixed(0)}s)`,
        progress: progressPercent
      });

      try {
        await clipService.createClipSimple(
          videoPath,
          block.start,
          block.end,
          outputPath,
          subtitlePath
        );

        clips.push({
          number: clipNumber,
          name: clipName,
          url: `/downloads/${jobId}/${clipName}`,
          start: block.start,
          end: block.end,
          duration: block.end - block.start,
          title: block.title,
          description: block.description,
          completenessScore: block.completenessScore,
          viralScore: block.viralScore,
          hasHook: block.hasHook,
          hasDevelopment: block.hasDevelopment,
          hasConclusion: block.hasConclusion,
          hookText: block.hookText,
          conclusionText: block.conclusionText,
          whyComplete: block.whyComplete,
          whyViral: block.whyViral,
          category: block.category,
          hashtags: block.hashtags,
          estimatedViews: block.estimatedViews,
          confidenceLevel: block.confidenceLevel,
          keywords: block.hashtags?.map(h => h.replace('#', '')) || []
        });

        console.log(`[${jobId}] [CURIOSITY] Clipe ${clipNumber} criado com sucesso (${(block.end - block.start).toFixed(1)}s)`);
      } catch (error) {
        console.error(`[${jobId}] [CURIOSITY] Erro ao criar clipe ${clipNumber}:`, error.message);
      }
    }

    // 9. Gerar capas e descrições TikTok
    console.log(`[${jobId}] [CURIOSITY] Gerando capas e descricoes TikTok...`);
    jobService.updateJob(jobId, { currentStep: 'Gerando capas TikTok', progress: 92 });

    // Usar caption_suggestion da análise de curiosidades para TikTok
    for (const clip of clips) {
      const block = curiosityBlocks[clip.number - 1];
      if (block && block.captionSuggestion) {
        clip.tiktokDescription = block.captionSuggestion;
      }
    }

    await coverService.generateCoversAndTikTokDescriptions(clips, jobId, jobDir);

    // 10. Finalizar
    jobService.completeJob(jobId, clips);

    // Limpar temporários
    if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
    if (subtitlePath && fs.existsSync(subtitlePath)) fs.unlinkSync(subtitlePath);

    console.log(`[${jobId}] [CURIOSITY] Processamento concluido! ${clips.length} curiosidades completas criadas.`);

  } catch (error) {
    console.error(`[${jobId}] [CURIOSITY] Erro:`, error);
    jobService.failJob(jobId, error.message);

    // Limpar temporários em caso de erro
    try {
      if (videoPath && fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
      if (audioPath && fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
      if (subtitlePath && fs.existsSync(subtitlePath)) fs.unlinkSync(subtitlePath);
    } catch (cleanupError) {
      console.error(`[${jobId}] [CURIOSITY] Erro ao limpar:`, cleanupError);
    }
  }
}

/**
 * GET /api/channels
 * Lista todos os canais com perfis conhecidos
 */
function listChannels(req, res) {
  const channels = channelProfileService.listKnownChannels();
  res.json({
    total: channels.length,
    channels,
  });
}

/**
 * GET /api/channels/:channelId
 * Obtém detalhes do perfil de um canal
 */
function getChannelProfile(req, res) {
  const { channelId } = req.params;
  const profile = channelProfileService.getProfile(channelId);

  if (!profile) {
    return res.status(404).json({ error: 'Perfil de canal nao encontrado' });
  }

  const recommendations = channelProfileService.getAnalysisRecommendations(profile);
  res.json({
    profile,
    recommendations,
  });
}

/**
 * DELETE /api/channels/:channelId
 * Remove o perfil de um canal
 */
function deleteChannelProfile(req, res) {
  const { channelId } = req.params;
  const deleted = channelProfileService.deleteProfile(channelId);

  if (!deleted) {
    return res.status(404).json({ error: 'Perfil de canal nao encontrado' });
  }

  res.json({ message: 'Perfil removido com sucesso' });
}

/**
 * GET /api/jobs/history
 * Lista jobs completados para histórico
 */
function getJobsHistory(req, res) {
  const limit = parseInt(req.query.limit) || 10;
  const jobs = jobService.listCompletedJobs(limit);
  res.json({ jobs });
}

module.exports = {
  processVideo,
  getJobStatus,
  listChannels,
  getChannelProfile,
  deleteChannelProfile,
  getJobsHistory,
};
