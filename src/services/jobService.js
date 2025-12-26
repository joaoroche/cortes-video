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
  const job = updateJob(jobId, {
    status: 'completed',
    progress: 100,
    currentStep: 'Concluído',
    clips,
  });

  // Salvar metadata.json no disco para persistência
  try {
    const fs = require('fs');
    const path = require('path');
    const config = require('../config');

    const jobDir = path.join(config.DOWNLOADS_DIR, jobId);
    const metadataPath = path.join(jobDir, 'metadata.json');

    if (fs.existsSync(jobDir)) {
      const metadata = {
        jobId,
        status: 'completed',
        completedAt: new Date().toISOString(),
        processingType: job.processingType || 'sequential',
        clips: clips.map(clip => ({
          number: clip.number,
          filename: clip.name,
          title: clip.title || `Clipe ${clip.number}`,
          description: clip.description || '',
          tiktokDescription: clip.tiktokDescription || '',
          viralScore: clip.viralScore,
          completenessScore: clip.completenessScore,
          category: clip.category,
          duration: clip.duration,
          startTime: clip.start,
          endTime: clip.end,
        }))
      };

      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
      console.log(`[${jobId}] Metadata salvo em ${metadataPath}`);
    }
  } catch (error) {
    console.error(`[${jobId}] Erro ao salvar metadata:`, error.message);
  }

  return job;
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

/**
 * Lista todos os jobs
 * @returns {Array} - Array de jobs com seus IDs
 */
function listJobs() {
  return Object.entries(jobs).map(([jobId, job]) => ({
    jobId,
    ...job
  }));
}

/**
 * Lista jobs completados
 * @param {number} limit - Limite de jobs a retornar
 * @returns {Array}
 */
function listCompletedJobs(limit = 10) {
  return Object.entries(jobs)
    .filter(([_, job]) => job.status === 'completed')
    .map(([jobId, job]) => ({
      jobId,
      status: job.status,
      clipCount: job.clips ? job.clips.length : 0,
      processingType: job.processingType
    }))
    .slice(0, limit);
}

module.exports = {
  createJob,
  getJob,
  updateJob,
  completeJob,
  failJob,
  deleteJob,
  listJobs,
  listCompletedJobs,
};
