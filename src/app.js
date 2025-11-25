const express = require('express');
const { setupMiddlewares } = require('./middlewares');
const videoController = require('./controllers/videoController');

/**
 * Cria e configura a aplicação Express
 * @returns {Express.Application}
 */
function createApp() {
  const app = express();

  // Configurar middlewares
  setupMiddlewares(app);

  // Rotas da API
  app.post('/api/process-video', videoController.processVideo);
  app.get('/api/job/:jobId', videoController.getJobStatus);

  // Rotas de perfis de canais
  app.get('/api/channels', videoController.listChannels);
  app.get('/api/channels/:channelId', videoController.getChannelProfile);
  app.delete('/api/channels/:channelId', videoController.deleteChannelProfile);

  return app;
}

module.exports = { createApp };
