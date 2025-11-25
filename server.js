const fs = require('fs');
const config = require('./src/config');
const { initializeFFmpeg } = require('./src/config/ffmpeg');
const { createApp } = require('./src/app');

/**
 * Inicializa os diretórios necessários
 */
function initializeDirectories() {
  if (!fs.existsSync(config.DOWNLOADS_DIR)) {
    fs.mkdirSync(config.DOWNLOADS_DIR, { recursive: true });
  }

  if (!fs.existsSync(config.TEMP_DIR)) {
    fs.mkdirSync(config.TEMP_DIR, { recursive: true });
  }
}

/**
 * Inicializa e inicia o servidor
 */
async function startServer() {
  try {
    // Criar diretórios
    initializeDirectories();

    // Inicializar FFmpeg e detectar GPU
    await initializeFFmpeg();

    // Criar app Express
    const app = createApp();

    // Iniciar servidor
    app.listen(config.PORT, () => {
      console.log(`Servidor rodando em http://localhost:${config.PORT}`);
    });
  } catch (error) {
    console.error('Erro ao iniciar servidor:', error);
    process.exit(1);
  }
}

// Iniciar
startServer();
