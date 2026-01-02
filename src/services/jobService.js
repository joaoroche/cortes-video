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
  // Primeiro tenta da memória
  if (jobs[jobId]) {
    return jobs[jobId];
  }

  // Se não estiver em memória, tenta carregar do disco
  return loadJobFromDisk(jobId);
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
 * Carrega um job do disco (metadata.json)
 * @param {string} jobId
 * @returns {Object|null}
 */
function loadJobFromDisk(jobId) {
  try {
    const fs = require('fs');
    const path = require('path');
    const config = require('../config');

    const jobDir = path.join(config.DOWNLOADS_DIR, jobId);
    const metadataPath = path.join(jobDir, 'metadata.json');

    if (!fs.existsSync(metadataPath)) {
      return null;
    }

    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));

    // Converter metadata para formato de job
    const job = {
      status: metadata.status || 'completed',
      progress: 100,
      currentStep: 'Concluído',
      processingType: metadata.processingType || 'sequential',
      clips: metadata.clips.map(clip => ({
        number: clip.number,
        name: clip.filename,
        url: `/downloads/${jobId}/${clip.filename}`,
        start: clip.startTime,
        end: clip.endTime,
        duration: clip.duration,
        title: clip.title,
        description: clip.description,
        tiktokDescription: clip.tiktokDescription,
        viralScore: clip.viralScore,
        completenessScore: clip.completenessScore,
        category: clip.category,
        keywords: []
      })),
      error: null
    };

    return job;
  } catch (error) {
    console.error(`[${jobId}] Erro ao carregar do disco:`, error.message);
    return null;
  }
}

/**
 * Lista todos os jobs completados (memória + disco)
 * @param {number} limit - Limite de jobs a retornar
 * @returns {Array}
 */
function listCompletedJobs(limit = 10) {
  const fs = require('fs');
  const path = require('path');
  const config = require('../config');

  // Jobs em memória
  const memoryJobs = Object.entries(jobs)
    .filter(([_, job]) => job.status === 'completed')
    .map(([jobId, job]) => ({
      jobId,
      status: job.status,
      clipCount: job.clips ? job.clips.length : 0,
      processingType: job.processingType,
      completedAt: new Date().toISOString() // Jobs em memória são recentes
    }));

  // Jobs do disco
  const diskJobs = [];
  try {
    if (fs.existsSync(config.DOWNLOADS_DIR)) {
      const dirs = fs.readdirSync(config.DOWNLOADS_DIR);

      for (const dir of dirs) {
        const metadataPath = path.join(config.DOWNLOADS_DIR, dir, 'metadata.json');

        if (fs.existsSync(metadataPath)) {
          try {
            const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));

            // Só adiciona se não estiver em memória
            if (!jobs[dir]) {
              diskJobs.push({
                jobId: dir,
                status: metadata.status || 'completed',
                clipCount: metadata.clips ? metadata.clips.length : 0,
                processingType: metadata.processingType || 'sequential',
                completedAt: metadata.completedAt
              });
            }
          } catch (error) {
            console.error(`Erro ao ler metadata de ${dir}:`, error.message);
          }
        }
      }
    }
  } catch (error) {
    console.error('Erro ao listar jobs do disco:', error.message);
  }

  // Combinar e ordenar por data (mais recentes primeiro)
  const allJobs = [...memoryJobs, ...diskJobs]
    .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
    .slice(0, limit);

  return allJobs;
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
