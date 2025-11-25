/**
 * Serviço de gerenciamento de jobs de processamento
 */

// Armazenamento em memória dos jobs
const jobs = {};

/**
 * Cria um novo job
 * @param {string} jobId - ID único do job
 * @returns {Object} - Job criado
 */
function createJob(jobId) {
  jobs[jobId] = {
    status: 'processing',
    progress: 0,
    currentStep: 'Iniciando processamento',
    clips: [],
    error: null,
  };
  return jobs[jobId];
}

/**
 * Obtém um job pelo ID
 * @param {string} jobId
 * @returns {Object|null}
 */
function getJob(jobId) {
  return jobs[jobId] || null;
}

/**
 * Atualiza um job existente
 * @param {string} jobId
 * @param {Object} updates - Campos a atualizar
 * @returns {Object|null}
 */
function updateJob(jobId, updates) {
  if (!jobs[jobId]) return null;

  Object.assign(jobs[jobId], updates);
  return jobs[jobId];
}

/**
 * Marca job como completo
 * @param {string} jobId
 * @param {Array} clips
 */
function completeJob(jobId, clips) {
  return updateJob(jobId, {
    status: 'completed',
    progress: 100,
    currentStep: 'Concluído',
    clips,
  });
}

/**
 * Marca job como erro
 * @param {string} jobId
 * @param {string} errorMessage
 */
function failJob(jobId, errorMessage) {
  return updateJob(jobId, {
    status: 'error',
    currentStep: 'Erro',
    error: errorMessage,
  });
}

/**
 * Remove um job
 * @param {string} jobId
 */
function deleteJob(jobId) {
  delete jobs[jobId];
}

module.exports = {
  createJob,
  getJob,
  updateJob,
  completeJob,
  failJob,
  deleteJob,
};
