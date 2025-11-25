const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { exec } = require('child_process');
const config = require('../config');

const execPromise = promisify(exec);

// Caminho para o arquivo de perfis
const PROFILES_FILE = path.join(config.ROOT_DIR, 'data', 'channel-profiles.json');

/**
 * Estrutura de um perfil de canal:
 * {
 *   channelId: string,
 *   channelName: string,
 *   videosAnalyzed: number,
 *   patterns: {
 *     avgViralScore: number,
 *     preferredCategories: string[],
 *     typicalViralTimeRanges: [{ start: number, end: number }],
 *     avgClipDuration: number,
 *     contentStyle: string,
 *     bestPerformingTopics: string[]
 *   },
 *   lastUpdated: Date
 * }
 */

/**
 * Garante que o diretório de dados existe
 */
function ensureDataDir() {
  const dataDir = path.dirname(PROFILES_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

/**
 * Carrega todos os perfis de canais
 * @returns {Object} - Mapa de channelId -> profile
 */
function loadProfiles() {
  ensureDataDir();
  if (!fs.existsSync(PROFILES_FILE)) {
    return {};
  }
  try {
    const data = fs.readFileSync(PROFILES_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.warn('[ChannelProfiles] Erro ao carregar perfis:', error.message);
    return {};
  }
}

/**
 * Salva os perfis de canais
 * @param {Object} profiles
 */
function saveProfiles(profiles) {
  ensureDataDir();
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2), 'utf-8');
}

/**
 * Obtém o caminho do yt-dlp
 */
function getYtDlpPath() {
  const localPath = path.join(config.ROOT_DIR, 'yt-dlp.exe');
  return fs.existsSync(localPath) ? localPath : 'yt-dlp';
}

/**
 * Extrai informações do canal a partir da URL do vídeo
 * @param {string} videoUrl
 * @returns {Promise<Object|null>}
 */
async function getChannelInfo(videoUrl) {
  const ytDlpPath = getYtDlpPath();

  try {
    const command = `"${ytDlpPath}" --skip-download --print "%(channel_id)s|||%(channel)s|||%(uploader_id)s" "${videoUrl}"`;
    const { stdout } = await execPromise(command, { maxBuffer: 10 * 1024 * 1024 });

    const parts = stdout.trim().split('|||');
    if (parts.length >= 2) {
      return {
        channelId: parts[0] || parts[2] || 'unknown',
        channelName: parts[1] || 'Desconhecido',
      };
    }
  } catch (error) {
    console.warn('[ChannelProfiles] Erro ao obter info do canal:', error.message);
  }

  return null;
}

/**
 * Obtém o perfil de um canal
 * @param {string} channelId
 * @returns {Object|null}
 */
function getProfile(channelId) {
  const profiles = loadProfiles();
  return profiles[channelId] || null;
}

/**
 * Atualiza ou cria um perfil de canal com base na análise
 * @param {string} channelId
 * @param {string} channelName
 * @param {Object} analysisResult - Resultado da análise viral
 */
function updateProfile(channelId, channelName, analysisResult) {
  const profiles = loadProfiles();

  const existingProfile = profiles[channelId] || {
    channelId,
    channelName,
    videosAnalyzed: 0,
    patterns: {
      avgViralScore: 0,
      preferredCategories: [],
      typicalViralTimeRanges: [],
      avgClipDuration: 0,
      contentStyle: '',
      bestPerformingTopics: [],
    },
    lastUpdated: new Date().toISOString(),
  };

  // Extrair dados da análise
  const clips = analysisResult.clips || [];
  if (clips.length === 0) {
    return existingProfile;
  }

  // Calcular novas médias
  const newAvgScore = clips.reduce((sum, c) => sum + (c.viral_score || c.viralScore || 0), 0) / clips.length;
  const categories = clips.map(c => c.category).filter(Boolean);
  const durations = clips.map(c => c.duration || (c.end_time - c.start_time) || 60);
  const timeRanges = clips.map(c => ({
    start: c.start_time || c.start,
    end: c.end_time || c.end,
  }));

  // Atualizar com média ponderada (dar mais peso a dados novos)
  const weight = existingProfile.videosAnalyzed > 0 ? 0.7 : 0;
  const newWeight = 1 - weight;

  existingProfile.patterns.avgViralScore =
    weight * existingProfile.patterns.avgViralScore + newWeight * newAvgScore;

  existingProfile.patterns.avgClipDuration =
    weight * existingProfile.patterns.avgClipDuration +
    newWeight * (durations.reduce((a, b) => a + b, 0) / durations.length);

  // Acumular categorias preferidas
  const categoryCount = {};
  [...existingProfile.patterns.preferredCategories, ...categories].forEach(cat => {
    categoryCount[cat] = (categoryCount[cat] || 0) + 1;
  });
  existingProfile.patterns.preferredCategories = Object.entries(categoryCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([cat]) => cat);

  // Acumular time ranges (limitar a últimos 20)
  existingProfile.patterns.typicalViralTimeRanges = [
    ...existingProfile.patterns.typicalViralTimeRanges,
    ...timeRanges,
  ].slice(-20);

  existingProfile.videosAnalyzed++;
  existingProfile.lastUpdated = new Date().toISOString();

  profiles[channelId] = existingProfile;
  saveProfiles(profiles);

  console.log(`[ChannelProfiles] Perfil atualizado: ${channelName} (${existingProfile.videosAnalyzed} vídeos)`);

  return existingProfile;
}

/**
 * Gera recomendações de análise baseadas no perfil do canal
 * @param {Object} profile
 * @returns {Object}
 */
function getAnalysisRecommendations(profile) {
  if (!profile || profile.videosAnalyzed < 2) {
    return null; // Precisa de pelo menos 2 vídeos para recomendar
  }

  const recommendations = {
    suggestedCategories: profile.patterns.preferredCategories.slice(0, 3),
    suggestedDuration: Math.round(profile.patterns.avgClipDuration),
    priorityTimeRanges: [],
    minViralScore: Math.max(6, Math.floor(profile.patterns.avgViralScore - 1)),
  };

  // Calcular ranges de tempo mais comuns
  if (profile.patterns.typicalViralTimeRanges.length >= 5) {
    const ranges = profile.patterns.typicalViralTimeRanges;

    // Agrupar por minuto de início
    const startBuckets = {};
    ranges.forEach(r => {
      const bucket = Math.floor(r.start / 60);
      startBuckets[bucket] = (startBuckets[bucket] || 0) + 1;
    });

    // Top 3 buckets
    const topBuckets = Object.entries(startBuckets)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([bucket]) => ({
        startMinute: parseInt(bucket),
        endMinute: parseInt(bucket) + 2,
        description: `Entre ${bucket}:00 e ${parseInt(bucket) + 2}:00`,
      }));

    recommendations.priorityTimeRanges = topBuckets;
  }

  return recommendations;
}

/**
 * Lista todos os canais conhecidos
 * @returns {Array}
 */
function listKnownChannels() {
  const profiles = loadProfiles();
  return Object.values(profiles).map(p => ({
    channelId: p.channelId,
    channelName: p.channelName,
    videosAnalyzed: p.videosAnalyzed,
    avgViralScore: Math.round(p.patterns.avgViralScore * 10) / 10,
    preferredCategories: p.patterns.preferredCategories,
    lastUpdated: p.lastUpdated,
  }));
}

/**
 * Remove perfil de um canal
 * @param {string} channelId
 */
function deleteProfile(channelId) {
  const profiles = loadProfiles();
  if (profiles[channelId]) {
    delete profiles[channelId];
    saveProfiles(profiles);
    return true;
  }
  return false;
}

module.exports = {
  getChannelInfo,
  getProfile,
  updateProfile,
  getAnalysisRecommendations,
  listKnownChannels,
  deleteProfile,
};
