const videoUrlInput = document.getElementById('videoUrl');
const processBtn = document.getElementById('processBtn');
const statusSection = document.getElementById('statusSection');
const statusText = document.getElementById('statusText');
const resultsSection = document.getElementById('resultsSection');
const clipsList = document.getElementById('clipsList');
const errorSection = document.getElementById('errorSection');
const errorText = document.getElementById('errorText');
const categoriesSection = document.getElementById('categoriesSection');
const curiositySection = document.getElementById('curiositySection');
const typeOptions = document.querySelectorAll('.type-option');

const API_URL = 'http://localhost:3000';

// Gerenciar seleção de tipo de processamento
typeOptions.forEach(option => {
  option.addEventListener('click', () => {
    // Remover seleção anterior
    typeOptions.forEach(opt => opt.classList.remove('selected'));
    // Adicionar seleção atual
    option.classList.add('selected');

    // Mostrar/ocultar seções baseado no tipo
    const type = option.dataset.type;
    if (type === 'intelligent') {
      categoriesSection.classList.remove('hidden');
      curiositySection.classList.add('hidden');
    } else if (type === 'curiosity') {
      categoriesSection.classList.add('hidden');
      curiositySection.classList.remove('hidden');
    } else {
      categoriesSection.classList.add('hidden');
      curiositySection.classList.add('hidden');
    }
  });
});

processBtn.addEventListener('click', processVideo);

videoUrlInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    processVideo();
  }
});

// Obter o tipo de processamento selecionado
function getProcessingType() {
  const selectedOption = document.querySelector('.type-option.selected');
  return selectedOption ? selectedOption.dataset.type : 'sequential';
}

// Obter categorias selecionadas
function getSelectedCategories() {
  const checkboxes = document.querySelectorAll('.category-option input:checked');
  return Array.from(checkboxes).map(cb => cb.value);
}

// Obter configurações de clipes inteligentes
function getIntelligentSettings() {
  return {
    clipDuration: parseInt(document.getElementById('clipDuration').value),
    maxClips: parseInt(document.getElementById('maxClips').value),
    categories: getSelectedCategories()
  };
}

// Obter configurações de curiosidades
function getCuriositySettings() {
  return {
    minDuration: parseInt(document.getElementById('minDuration').value),
    maxDuration: parseInt(document.getElementById('maxDuration').value),
    idealDuration: parseInt(document.getElementById('idealDuration').value),
    priority: document.getElementById('priority').value,
    maxBlocks: parseInt(document.getElementById('maxBlocks').value)
  };
}

// Obter estilo de legenda selecionado
function getSubtitleStyle() {
  const selected = document.querySelector('input[name="subtitleStyle"]:checked');
  return selected ? selected.value : 'standard';
}

async function processVideo() {
  const videoUrl = videoUrlInput.value.trim();
  const processingType = getProcessingType();

  if (!videoUrl) {
    showError('Por favor, insira um link do YouTube');
    return;
  }

  // Validar categorias para modo inteligente
  if (processingType === 'intelligent') {
    const categories = getSelectedCategories();
    if (categories.length === 0) {
      showError('Selecione pelo menos uma categoria para cortes inteligentes');
      return;
    }
  }

  // Resetar UI
  hideAllSections();
  statusSection.classList.remove('hidden');
  processBtn.disabled = true;

  try {
    // Montar payload baseado no tipo
    const subtitleStyle = getSubtitleStyle();
    const payload = { videoUrl, processingType, subtitleStyle };

    if (processingType === 'intelligent') {
      const settings = getIntelligentSettings();
      payload.intelligentSettings = settings;
    } else if (processingType === 'curiosity') {
      const settings = getCuriositySettings();
      payload.curiositySettings = settings;
    }

    // Enviar requisição para processar vídeo
    const response = await fetch(`${API_URL}/api/process-video`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Erro ao processar vídeo');
    }

    // Monitorar progresso
    monitorJob(data.jobId);

  } catch (error) {
    console.error('Erro:', error);
    showError(error.message);
    processBtn.disabled = false;
  }
}

async function monitorJob(jobId) {
  const checkInterval = setInterval(async () => {
    try {
      const response = await fetch(`${API_URL}/api/job/${jobId}`);
      const job = await response.json();

      if (job.status === 'completed') {
        clearInterval(checkInterval);
        showResults(job.clips, job.jobId);
        processBtn.disabled = false;
      } else if (job.status === 'error') {
        clearInterval(checkInterval);
        showError(job.error || 'Erro desconhecido ao processar vídeo');
        processBtn.disabled = false;
      } else {
        // Ainda processando - mostrar progresso real
        const progress = job.progress || 0;
        const currentStep = job.currentStep || 'Processando';
        statusText.textContent = `${currentStep}... (${progress}%)`;
      }
    } catch (error) {
      clearInterval(checkInterval);
      showError('Erro ao verificar status do processamento');
      processBtn.disabled = false;
    }
  }, 2000); // Verificar a cada 2 segundos
}

function showResults(clips, jobId) {
  hideAllSections();
  resultsSection.classList.remove('hidden');

  clipsList.innerHTML = '';

  // Adicionar botões de ações globais
  const actionsBar = document.createElement('div');
  actionsBar.className = 'global-actions-bar';
  actionsBar.innerHTML = `
    <button onclick="openOutputFolder('${jobId}')" class="action-btn open-folder-btn">
      📂 Abrir Pasta de Clipes
    </button>
    <button onclick="prepareForTikTok('${jobId}')" class="action-btn prepare-tiktok-btn">
      🎵 Preparar para TikTok
    </button>
  `;
  clipsList.appendChild(actionsBar);

  // Verificar se não há clipes
  if (!clips || clips.length === 0) {
    clipsList.innerHTML += `
      <div class="no-clips-message">
        <p>Nenhum momento viral foi encontrado neste vídeo com as categorias selecionadas.</p>
        <p>Tente com outras categorias ou use o modo de cortes sequenciais.</p>
      </div>
    `;
    return;
  }

  clips.forEach((clip) => {
    const clipItem = document.createElement('div');
    clipItem.className = 'clip-item';

    const coverImage = clip.coverUrl
      ? `<img src="${API_URL}${clip.coverUrl}" alt="Capa do clipe ${clip.number}" class="clip-cover">`
      : '';

    const tiktokDescription = clip.tiktokDescription
      ? `<div class="tiktok-description">
           <h4>Descrição TikTok:</h4>
           <textarea readonly class="description-text">${clip.tiktokDescription}</textarea>
           <button class="copy-btn" onclick="copyToClipboard('${clip.number}')">Copiar Descrição</button>
         </div>`
      : '';

    // Informações de viralização (para cortes inteligentes)
    const viralInfo = clip.viralScore !== undefined
      ? `<div class="viral-info">
           <span class="viral-score" title="Score Viral">🔥 ${clip.viralScore}/10</span>
           ${clip.category ? `<span class="clip-category">${getCategoryIcon(clip.category)} ${clip.category}</span>` : ''}
           ${clip.confidenceLevel ? `<span class="confidence-level confidence-${clip.confidenceLevel}">${clip.confidenceLevel}</span>` : ''}
         </div>`
      : '';

    const hookSuggestion = clip.hookSuggestion
      ? `<div class="hook-suggestion">
           <h4>💡 Gancho sugerido:</h4>
           <p>"${clip.hookSuggestion}"</p>
         </div>`
      : '';

    const whyViral = clip.whyViral
      ? `<div class="why-viral">
           <h4>📈 Por que vai viralizar:</h4>
           <p>${clip.whyViral}</p>
         </div>`
      : '';

    const clipInfo = clip.title || clip.description
      ? `<div class="clip-info">
           ${clip.title ? `<p class="clip-title"><strong>${clip.title}</strong></p>` : ''}
           ${clip.description ? `<p class="clip-desc">${clip.description}</p>` : ''}
           ${clip.keywords ? `<p class="clip-keywords"><em>Tags: ${clip.keywords.join(', ')}</em></p>` : ''}
           ${clip.estimatedViews ? `<p class="estimated-views">👁️ Visualizações estimadas: ${clip.estimatedViews}</p>` : ''}
         </div>`
      : '';

    clipItem.innerHTML = `
      <div class="clip-header">
        <h3>Clipe ${clip.number}</h3>
        ${viralInfo}
      </div>
      ${coverImage}
      ${clipInfo}
      ${hookSuggestion}
      ${whyViral}
      ${tiktokDescription}
      <div class="clip-actions">
        <a href="${API_URL}${clip.url}" download="${clip.name}" class="download-btn">
          Download Vídeo
        </a>
        ${clip.coverUrl ? `<a href="${API_URL}${clip.coverUrl}" download="clip_${clip.number}_cover.png" class="download-btn cover-btn">Download Capa</a>` : ''}
      </div>
    `;

    // Armazenar descrição para cópia
    clipItem.dataset.description = clip.tiktokDescription || '';
    clipItem.dataset.clipNumber = clip.number;

    clipsList.appendChild(clipItem);
  });
}

// Retorna o ícone da categoria
function getCategoryIcon(category) {
  const icons = {
    'curiosidades': '🔍',
    'historia': '📚',
    'filmes': '🎬',
    'misterios': '👻',
    'mistérios': '👻'
  };
  return icons[category.toLowerCase()] || '📌';
}

// Função para copiar descrição para área de transferência
function copyToClipboard(clipNumber) {
  const clipItem = document.querySelector(`[data-clip-number="${clipNumber}"]`);
  const description = clipItem.dataset.description;

  navigator.clipboard.writeText(description).then(() => {
    const btn = clipItem.querySelector('.copy-btn');
    const originalText = btn.textContent;
    btn.textContent = 'Copiado!';
    btn.classList.add('copied');

    setTimeout(() => {
      btn.textContent = originalText;
      btn.classList.remove('copied');
    }, 2000);
  }).catch(err => {
    console.error('Erro ao copiar:', err);
    alert('Erro ao copiar descrição');
  });
}

function showError(message) {
  hideAllSections();
  errorSection.classList.remove('hidden');
  errorText.textContent = message;
}

function hideAllSections() {
  statusSection.classList.add('hidden');
  resultsSection.classList.add('hidden');
  errorSection.classList.add('hidden');
}

// ==========================================
// FUNÇÕES DE EXPORTAÇÃO E UPLOAD MANUAL
// ==========================================

/**
 * Abre a pasta de outputs no explorador de arquivos
 */
async function openOutputFolder(jobId) {
  try {
    const response = await fetch(`${API_URL}/api/export/open-folder/${jobId}`);
    const result = await response.json();

    if (result.success) {
      showNotification('Pasta aberta no explorador de arquivos!', 'success');
    } else {
      showNotification(result.error || 'Erro ao abrir pasta', 'error');
    }
  } catch (error) {
    console.error('Erro ao abrir pasta:', error);
    showNotification('Erro ao abrir pasta', 'error');
  }
}

/**
 * Prepara clipes para upload manual no TikTok
 * Organiza arquivos e cria arquivo de descrições
 */
async function prepareForTikTok(jobId) {
  try {
    showNotification('Preparando arquivos para TikTok...', 'info');

    const response = await fetch(`${API_URL}/api/export/prepare-tiktok/${jobId}`, {
      method: 'POST'
    });
    const result = await response.json();

    if (result.success) {
      showNotification(
        `✅ ${result.clipsCount} clipes preparados! Abrindo pasta...`,
        'success'
      );

      // Abrir pasta automaticamente após preparar
      setTimeout(() => {
        openOutputFolder(jobId);
      }, 1000);

      // Mostrar instruções
      setTimeout(() => {
        showTikTokInstructions(result.clipsCount);
      }, 2000);
    } else {
      showNotification(result.error || 'Erro ao preparar arquivos', 'error');
    }
  } catch (error) {
    console.error('Erro ao preparar para TikTok:', error);
    showNotification('Erro ao preparar arquivos', 'error');
  }
}

/**
 * Mostra instruções de como fazer upload no TikTok
 */
function showTikTokInstructions(clipsCount) {
  const modal = document.createElement('div');
  modal.className = 'instructions-modal';
  modal.innerHTML = `
    <div class="instructions-content">
      <span class="instructions-close" onclick="this.parentElement.parentElement.remove()">&times;</span>
      <h2>📱 Como Publicar no TikTok</h2>

      <div class="instructions-body">
        <p class="instructions-intro">
          <strong>${clipsCount} clipes</strong> foram preparados na pasta <code>tiktok-ready</code>
        </p>

        <div class="method">
          <h3>💻 Método 1: Desktop (TikTok Web)</h3>
          <ol>
            <li>Acesse: <a href="https://www.tiktok.com/upload" target="_blank">tiktok.com/upload</a></li>
            <li>Arraste o vídeo para a área de upload</li>
            <li>Abra o arquivo <code>DESCRICOES.txt</code></li>
            <li>Copie e cole a descrição correspondente</li>
            <li>Adicione a capa (opcional)</li>
            <li>Publique!</li>
          </ol>
        </div>

        <div class="method">
          <h3>📱 Método 2: Mobile (Recomendado)</h3>
          <ol>
            <li>Transfira os vídeos para seu celular via:
              <ul>
                <li>Cabo USB</li>
                <li>Google Drive / OneDrive</li>
                <li>AirDrop (iOS)</li>
              </ul>
            </li>
            <li>Abra TikTok → Toque no <strong>"+"</strong></li>
            <li>Selecione <strong>"Upload"</strong></li>
            <li>Escolha o vídeo</li>
            <li>Cole a descrição do arquivo <code>DESCRICOES.txt</code></li>
            <li>Adicione a capa correspondente</li>
            <li>Publique!</li>
          </ol>
        </div>

        <div class="tips">
          <h4>💡 Dicas:</h4>
          <ul>
            <li>Publique em horários de pico (18h-22h)</li>
            <li>Use as hashtags sugeridas</li>
            <li>Interaja com comentários nas primeiras horas</li>
            <li>Publique 1-3 vídeos por dia para melhor algoritmo</li>
          </ul>
        </div>
      </div>

      <div class="instructions-footer">
        <button onclick="this.parentElement.parentElement.parentElement.remove()" class="btn-primary">
          Entendi!
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
}

/**
 * Mostra notificação temporária
 */
function showNotification(message, type = 'info') {
  // Remover notificações antigas
  const oldNotification = document.querySelector('.notification-toast');
  if (oldNotification) {
    oldNotification.remove();
  }

  const notification = document.createElement('div');
  notification.className = `notification-toast notification-${type}`;
  notification.textContent = message;

  document.body.appendChild(notification);

  // Remover após 5 segundos
  setTimeout(() => {
    notification.style.opacity = '0';
    setTimeout(() => notification.remove(), 300);
  }, 5000);
}
