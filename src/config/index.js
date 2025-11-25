require('dotenv').config();
const path = require('path');

// Diretórios
const ROOT_DIR = path.join(__dirname, '..', '..');
const DOWNLOADS_DIR = path.join(ROOT_DIR, 'downloads');
const TEMP_DIR = path.join(ROOT_DIR, 'temp');

// Configurações de processamento
const config = {
  // Servidor
  PORT: parseInt(process.env.PORT) || 3000,

  // Diretórios
  ROOT_DIR,
  DOWNLOADS_DIR,
  TEMP_DIR,

  // OpenAI
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_PARALLEL_REQUESTS: parseInt(process.env.OPENAI_PARALLEL_REQUESTS) || 5,

  // FFmpeg
  FFMPEG_PRESET: process.env.FFMPEG_PRESET || 'faster',
  BATCH_SIZE: parseInt(process.env.BATCH_SIZE) || 2,
  AUDIO_QUALITY: parseInt(process.env.AUDIO_QUALITY) || 64,

  // Clipes
  MIN_CLIP_DURATION: 60,
  MAX_CLIP_DURATION: 80,
  SILENCE_THRESHOLD: 0.5,
  CUT_MARGIN: 1.5,

  // Capas e TikTok
  USE_DALLE_COVERS: process.env.USE_DALLE_COVERS !== 'false',
  COVER_GENERATION_BATCH: parseInt(process.env.COVER_GENERATION_BATCH) || 3,

  // Estilos de legenda disponíveis
  SUBTITLE_STYLES: {
    standard: 'Padrão (frase inteira)',
    word_by_word: 'Palavra por palavra',
    karaoke: 'Karaoke (destaque progressivo)',
  },
  DEFAULT_SUBTITLE_STYLE: process.env.DEFAULT_SUBTITLE_STYLE || 'standard',

  // Modo curiosidades (duração variável)
  CURIOSITY_MODE: {
    MIN_DURATION: parseInt(process.env.CURIOSITY_MIN_DURATION) || 20,
    MAX_DURATION: parseInt(process.env.CURIOSITY_MAX_DURATION) || 240,
    IDEAL_DURATION: parseInt(process.env.CURIOSITY_IDEAL_DURATION) || 90,
    MIN_COMPLETENESS_SCORE: parseInt(process.env.CURIOSITY_MIN_COMPLETENESS_SCORE) || 7,
    DEFAULT_MAX_BLOCKS: parseInt(process.env.CURIOSITY_DEFAULT_MAX_BLOCKS) || 10,
  },
};

module.exports = config;
