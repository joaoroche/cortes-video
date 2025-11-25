const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { exec } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const config = require('./index');

const execPromise = promisify(exec);

// Caminhos do FFmpeg
const ffmpegPath = path.join(config.ROOT_DIR, 'ffmpeg-bin', 'bin', 'ffmpeg.exe');
const ffprobePath = path.join(config.ROOT_DIR, 'ffmpeg-bin', 'bin', 'ffprobe.exe');

// Configurar FFmpeg se disponível localmente
function setupFFmpeg() {
  if (fs.existsSync(ffmpegPath)) {
    ffmpeg.setFfmpegPath(ffmpegPath);
    ffmpeg.setFfprobePath(ffprobePath);
    console.log('Usando FFmpeg local');
    return true;
  }
  return false;
}

// Detectar aceleração por GPU disponível e testar se funciona
async function detectGPUAcceleration() {
  try {
    const ffmpegBinary = fs.existsSync(ffmpegPath) ? ffmpegPath : 'ffmpeg';
    const { stdout } = await execPromise(`"${ffmpegBinary}" -hide_banner -encoders`);

    const encodersToTest = [];

    if (stdout.includes('h264_nvenc')) {
      encodersToTest.push({ name: 'h264_nvenc', label: 'NVIDIA NVENC' });
    }
    if (stdout.includes('h264_qsv')) {
      encodersToTest.push({ name: 'h264_qsv', label: 'Intel QuickSync' });
    }
    if (stdout.includes('h264_amf')) {
      encodersToTest.push({ name: 'h264_amf', label: 'AMD AMF' });
    }
    if (stdout.includes('h264_videotoolbox')) {
      encodersToTest.push({ name: 'h264_videotoolbox', label: 'Apple VideoToolbox' });
    }

    for (const encoder of encodersToTest) {
      try {
        console.log(`Testando encoder ${encoder.label}...`);
        const testCommand = `"${ffmpegBinary}" -f lavfi -i color=c=black:s=320x240:d=1 -c:v ${encoder.name} -f null - -hide_banner -loglevel error`;
        await execPromise(testCommand, { timeout: 10000 });
        console.log(`Aceleracao GPU detectada: ${encoder.label}`);
        return encoder.name;
      } catch {
        console.log(`Encoder ${encoder.label} nao funcional`);
      }
    }

    console.log('Nenhuma aceleracao GPU, usando CPU (libx264)');
    return 'libx264';
  } catch (error) {
    console.warn('Erro ao detectar GPU, usando CPU:', error.message);
    return 'libx264';
  }
}

// Variável para armazenar codec detectado
let gpuCodec = null;

async function initializeFFmpeg() {
  setupFFmpeg();
  gpuCodec = await detectGPUAcceleration();
  return gpuCodec;
}

function getGPUCodec() {
  return gpuCodec;
}

function setGPUCodec(codec) {
  gpuCodec = codec;
}

module.exports = {
  ffmpegPath,
  ffprobePath,
  setupFFmpeg,
  detectGPUAcceleration,
  initializeFFmpeg,
  getGPUCodec,
  setGPUCodec,
};
