const cors = require('cors');
const express = require('express');
const path = require('path');
const config = require('../config');

/**
 * Configura middlewares no app Express
 * @param {Express.Application} app
 */
function setupMiddlewares(app) {
  // CORS
  app.use(cors());

  // JSON body parser
  app.use(express.json());

  // Arquivos estáticos - frontend
  app.use(express.static(path.join(config.ROOT_DIR, 'public')));

  // Arquivos de download
  app.use('/downloads', express.static(config.DOWNLOADS_DIR));
}

module.exports = {
  setupMiddlewares,
};
