/**
 * Valida se a URL é do YouTube
 * @param {string} url - URL a ser validada
 * @returns {boolean}
 */
function isValidYouTubeUrl(url) {
  const pattern = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/;
  return pattern.test(url);
}

module.exports = {
  isValidYouTubeUrl,
};
