const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { exec } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const config = require('../config');
const { ffmpegPath } = require('../config/ffmpeg');

const execPromise = promisify(exec);

/**
 * Faz download do vídeo usando yt-dlp
 * @param {string} videoUrl - URL do YouTube
 * @param {string} outputPath - Caminho de saída
 * @returns {Promise<string>}
 */
async function downloadVideo(videoUrl, outputPath) {
  try {
    const ytDlpPath = fs.existsSync(path.join(config.ROOT_DIR, 'yt-dlp.exe'))
      ? path.join(config.ROOT_DIR, 'yt-dlp.exe')
      : 'yt-dlp';

    let command = `"${ytDlpPath}" -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --merge-output-format mp4`;

    if (fs.existsSync(ffmpegPath)) {
      command += ` --ffmpeg-location "${path.join(config.ROOT_DIR, 'ffmpeg-bin', 'bin')}"`;
    }

    command += ` -o "${outputPath}" "${videoUrl}"`;

    const { stderr } = await execPromise(command, { maxBuffer: 10 * 1024 * 1024 });

    if (stderr && !stderr.includes('Deleting original file')) {
      console.log('yt-dlp stderr:', stderr);
    }

    return outputPath;
  } catch (error) {
    throw new Error(`Erro ao baixar video: ${error.message}`);
  }
}

/**
 * Obtém duração do vídeo
 * @param {string} videoPath
 * @returns {Promise<number>}
 */
function getVideoDuration(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(err);
      } else {
        resolve(metadata.format.duration);
      }
    });
  });
}

/**
 * Extrai áudio do vídeo (otimizado para transcrição)
 * @param {string} videoPath
 * @param {string} audioPath
 * @returns {Promise<string>}
 */
function extractAudio(videoPath, audioPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .output(audioPath)
      .audioCodec('libmp3lame')
      .audioBitrate(config.AUDIO_QUALITY)
      .audioChannels(1)
      .audioFrequency(16000)
      .noVideo()
      .on('end', () => {
        console.log('Audio extraido com sucesso');
        resolve(audioPath);
      })
      .on('error', (err) => {
        reject(err);
      })
      .run();
  });
}

/**
 * Detecta silêncios no áudio
 * @param {string} audioPath
 * @returns {Promise<Array>}
 */
function detectSilences(audioPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, (err) => {
      if (err) {
        reject(err);
        return;
      }

      const command = ffmpeg(audioPath)
        .audioFilters(`silencedetect=n=-30dB:d=${config.SILENCE_THRESHOLD}`)
        .outputOptions('-f null')
        .output('-');

      let stderrOutput = '';

      command.on('stderr', (stderrLine) => {
        stderrOutput += stderrLine + '\n';
      });

      command.on('end', () => {
        const silences = [];
        const silenceStartRegex = /silence_start: ([\d.]+)/g;
        const silenceEndRegex = /silence_end: ([\d.]+)/g;

        const starts = [...stderrOutput.matchAll(silenceStartRegex)].map(m => parseFloat(m[1]));
        const ends = [...stderrOutput.matchAll(silenceEndRegex)].map(m => parseFloat(m[1]));

        for (let i = 0; i < Math.min(starts.length, ends.length); i++) {
          silences.push({
            start: starts[i],
            end: ends[i],
            duration: ends[i] - starts[i],
          });
        }

        resolve(silences);
      });

      command.on('error', (err) => {
        console.warn('Erro ao detectar silencios:', err.message);
        resolve([]);
      });

      command.run();
    });
  });
}

module.exports = {
  downloadVideo,
  getVideoDuration,
  extractAudio,
  detectSilences,
};
