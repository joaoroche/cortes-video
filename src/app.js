const express = require('express');
const { setupMiddlewares } = require('./middlewares');
const videoController = require('./controllers/videoController');
const exportController = require('./controllers/exportController');

/**
 * Cria e configura a aplicação Express
 * @returns {Express.Application}
 */
function createApp() {
  const app = express();

  // Configurar middlewares
  setupMiddlewares(app);

  // Rotas da API - Processamento de Vídeo
  app.post('/api/process-video', videoController.processVideo);
  app.get('/api/job/:jobId', videoController.getJobStatus);
  app.get('/api/jobs/history', videoController.getJobsHistory);

  // Rotas de perfis de canais
  app.get('/api/channels', videoController.listChannels);
  app.get('/api/channels/:channelId', videoController.getChannelProfile);
  app.delete('/api/channels/:channelId', videoController.deleteChannelProfile);

  // Rotas da API - Exportação para TikTok (Upload Manual)
  app.get('/api/export/open-folder/:jobId', exportController.openOutputFolder);
  app.post('/api/export/prepare-tiktok/:jobId', exportController.prepareForTikTok);
  app.get('/api/export/copy-description/:jobId/:clipIndex', exportController.getClipDescription);

  return app;
}

module.exports = { createApp };
