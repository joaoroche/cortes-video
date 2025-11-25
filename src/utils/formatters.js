/**
 * Formata segundos para formato SRT (HH:MM:SS,mmm)
 * @param {number} seconds
 * @returns {string}
 */
function formatSRTTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

/**
 * Formata segundos para formato legível (MM:SS)
 * @param {number} seconds
 * @returns {string}
 */
function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Gera conteúdo SRT a partir de segmentos de transcrição
 * @param {Array} segments - Segmentos com start, end e text
 * @returns {string}
 */
function generateSRT(segments) {
  let srt = '';

  segments.forEach((segment, index) => {
    const startTime = formatSRTTime(segment.start);
    const endTime = formatSRTTime(segment.end);

    srt += `${index + 1}\n`;
    srt += `${startTime} --> ${endTime}\n`;
    srt += `${segment.text.trim()}\n\n`;
  });

  return srt;
}

/**
 * Formata segundos para formato ASS (H:MM:SS.cc - centésimos de segundo)
 * @param {number} seconds
 * @returns {string}
 */
function formatASSTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const centiseconds = Math.floor((seconds % 1) * 100);

  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

/**
 * Gera cabeçalho ASS padrão para legendas
 * @param {string} style - 'word_by_word' ou 'karaoke'
 * @returns {string}
 */
function generateASSHeader(style = 'karaoke') {
  // Cores em formato ASS: &HAABBGGRR (alfa, azul, verde, vermelho)
  const primaryColor = '&H00FFFFFF'; // Branco
  const secondaryColor = '&H0000FFFF'; // Amarelo (para karaoke highlight)
  const outlineColor = '&H00000000'; // Preto
  const backColor = '&H80000000'; // Preto semi-transparente

  return `[Script Info]
Title: Legendas Karaoke
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,48,${primaryColor},${secondaryColor},${outlineColor},${backColor},1,0,0,0,100,100,0,0,1,3,1,2,10,10,60,1
Style: Highlight,Arial,48,${secondaryColor},${primaryColor},${outlineColor},${backColor},1,0,0,0,100,100,0,0,1,3,1,2,10,10,60,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
}

/**
 * Agrupa palavras em linhas de no máximo N palavras
 * @param {Array} words - Array de palavras com start, end, word
 * @param {number} wordsPerLine - Máximo de palavras por linha
 * @returns {Array} - Array de linhas, cada uma com array de palavras
 */
function groupWordsIntoLines(words, wordsPerLine = 4) {
  const lines = [];
  for (let i = 0; i < words.length; i += wordsPerLine) {
    const lineWords = words.slice(i, i + wordsPerLine);
    if (lineWords.length > 0) {
      lines.push({
        words: lineWords,
        start: lineWords[0].start,
        end: lineWords[lineWords.length - 1].end,
        text: lineWords.map(w => w.word).join(' '),
      });
    }
  }
  return lines;
}

/**
 * Gera conteúdo ASS com efeito karaoke (palavra destacada progressivamente)
 * @param {Array} words - Array de palavras com start, end, word
 * @returns {string}
 */
function generateKaraokeASS(words) {
  if (!words || words.length === 0) {
    return generateASSHeader('karaoke');
  }

  let ass = generateASSHeader('karaoke');
  const lines = groupWordsIntoLines(words, 4);

  for (const line of lines) {
    const startTime = formatASSTime(line.start);
    const endTime = formatASSTime(line.end);

    // Construir texto com tags de karaoke
    // {\kf<duração>} onde duração é em centésimos de segundo
    let karaokeText = '';
    for (const word of line.words) {
      const wordDuration = Math.round((word.end - word.start) * 100);
      karaokeText += `{\\kf${wordDuration}}${word.word} `;
    }

    ass += `Dialogue: 0,${startTime},${endTime},Default,,0,0,0,,${karaokeText.trim()}\n`;
  }

  return ass;
}

/**
 * Gera conteúdo ASS com palavra por palavra (uma palavra por vez)
 * @param {Array} words - Array de palavras com start, end, word
 * @returns {string}
 */
function generateWordByWordASS(words) {
  if (!words || words.length === 0) {
    return generateASSHeader('word_by_word');
  }

  let ass = generateASSHeader('word_by_word');
  const lines = groupWordsIntoLines(words, 4);

  for (const line of lines) {
    // Mostrar a linha inteira, mas destacar cada palavra no seu momento
    for (let i = 0; i < line.words.length; i++) {
      const word = line.words[i];
      const startTime = formatASSTime(word.start);
      const endTime = formatASSTime(word.end);

      // Construir texto com palavra atual destacada
      let text = '';
      for (let j = 0; j < line.words.length; j++) {
        if (j === i) {
          // Palavra atual: destacada em amarelo
          text += `{\\c&H00FFFF&\\b1}${line.words[j].word}{\\c&HFFFFFF&\\b1} `;
        } else if (j < i) {
          // Palavras já ditas: cor normal
          text += `${line.words[j].word} `;
        } else {
          // Palavras futuras: mais opacas
          text += `{\\alpha&H80&}${line.words[j].word}{\\alpha&H00&} `;
        }
      }

      ass += `Dialogue: 0,${startTime},${endTime},Default,,0,0,0,,${text.trim()}\n`;
    }
  }

  return ass;
}

/**
 * Gera conteúdo SRT com palavra por palavra
 * @param {Array} words - Array de palavras com start, end, word
 * @returns {string}
 */
function generateWordByWordSRT(words) {
  if (!words || words.length === 0) {
    return '';
  }

  let srt = '';
  const lines = groupWordsIntoLines(words, 4);
  let index = 1;

  for (const line of lines) {
    const startTime = formatSRTTime(line.start);
    const endTime = formatSRTTime(line.end);

    srt += `${index}\n`;
    srt += `${startTime} --> ${endTime}\n`;
    srt += `${line.text}\n\n`;
    index++;
  }

  return srt;
}

/**
 * Adiciona método hashCode para strings (usado na seleção de cor de gradiente)
 */
if (!String.prototype.hashCode) {
  String.prototype.hashCode = function () {
    let hash = 0;
    for (let i = 0; i < this.length; i++) {
      const char = this.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash;
  };
}

module.exports = {
  formatSRTTime,
  formatASSTime,
  formatTime,
  generateSRT,
  generateKaraokeASS,
  generateWordByWordASS,
  generateWordByWordSRT,
  groupWordsIntoLines,
};
