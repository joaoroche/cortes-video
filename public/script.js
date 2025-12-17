// ==========================================
// STATE MANAGEMENT
// ==========================================
const state = {
  currentJobId: null,
  isProcessing: false,
  history: []
};

const API_URL = 'http://localhost:3000';

// ==========================================
// DOM ELEMENTS
// ==========================================
const elements = {
  // Inputs
  videoUrl: document.getElementById('videoUrl'),
  processBtn: document.getElementById('processBtn'),

  // Processing type radio buttons
  processingTypeInputs: document.querySelectorAll('input[name="processingType"]'),

  // Settings sections
  intelligentSettings: document.getElementById('intelligentSettings'),
  curiositySettings: document.getElementById('curiositySettings'),

  // Status and results
  statusSection: document.getElementById('statusSection'),
  statusText: document.getElementById('statusText'),
  errorSection: document.getElementById('errorSection'),
  errorText: document.getElementById('errorText'),
  resultsSection: document.getElementById('resultsSection'),
  clipsList: document.getElementById('clipsList'),

  // History
  historyPanel: document.getElementById('historyPanel'),
  historyList: document.getElementById('historyList'),

  // Toast
  toastContainer: document.getElementById('toastContainer')
};

// ==========================================
// INITIALIZATION
// ==========================================
function init() {
  setupEventListeners();
  loadHistoryFromStorage();
}

function setupEventListeners() {
  // Process button
  elements.processBtn.addEventListener('click', handleProcessVideo);

  // Enter key on URL input
  elements.videoUrl.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleProcessVideo();
  });

  // Processing type change
  elements.processingTypeInputs.forEach(input => {
    input.addEventListener('change', handleProcessingTypeChange);
  });
}

// ==========================================
// PROCESSING TYPE HANDLING
// ==========================================
function handleProcessingTypeChange(e) {
  const selectedType = e.target.value;

  // Hide all settings
  elements.intelligentSettings.classList.add('hidden');
  elements.curiositySettings.classList.add('hidden');

  // Show relevant settings
  if (selectedType === 'intelligent') {
    elements.intelligentSettings.classList.remove('hidden');
  } else if (selectedType === 'curiosity') {
    elements.curiositySettings.classList.remove('hidden');
  }
}

function getSelectedProcessingType() {
  const selected = document.querySelector('input[name="processingType"]:checked');
  return selected ? selected.value : 'sequential';
}

function getSelectedCategories() {
  const checkboxes = document.querySelectorAll('#intelligentSettings input[type="checkbox"]:checked');
  return Array.from(checkboxes).map(cb => cb.value);
}

function getIntelligentSettings() {
  return {
    clipDuration: parseInt(document.getElementById('clipDuration').value),
    maxClips: parseInt(document.getElementById('maxClips').value),
    categories: getSelectedCategories()
  };
}

function getCuriositySettings() {
  return {
    minDuration: parseInt(document.getElementById('minDuration').value),
    maxDuration: parseInt(document.getElementById('maxDuration').value),
    idealDuration: parseInt(document.getElementById('idealDuration').value),
    priority: document.getElementById('priority').value,
    maxBlocks: parseInt(document.getElementById('maxBlocks').value)
  };
}

function getSubtitleStyle() {
  const selected = document.querySelector('input[name="subtitleStyle"]:checked');
  return selected ? selected.value : 'standard';
}

// ==========================================
// VIDEO PROCESSING
// ==========================================
async function handleProcessVideo() {
  const videoUrl = elements.videoUrl.value.trim();
  const processingType = getSelectedProcessingType();

  // Validation
  if (!videoUrl) {
    showToast('Por favor, insira um link do YouTube', 'error');
    return;
  }

  if (processingType === 'intelligent') {
    const categories = getSelectedCategories();
    if (categories.length === 0) {
      showToast('Selecione pelo menos uma categoria', 'error');
      return;
    }
  }

  // Reset UI
  hideAllSections();
  elements.statusSection.classList.remove('hidden');
  elements.processBtn.disabled = true;
  state.isProcessing = true;

  try {
    // Build payload
    const payload = {
      videoUrl,
      processingType,
      subtitleStyle: getSubtitleStyle()
    };

    if (processingType === 'intelligent') {
      payload.intelligentSettings = getIntelligentSettings();
    } else if (processingType === 'curiosity') {
      payload.curiositySettings = getCuriositySettings();
    }

    // Send request
    const response = await fetch(`${API_URL}/api/process-video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Erro ao processar vídeo');
    }

    state.currentJobId = data.jobId;
    showToast('Processamento iniciado!', 'success');

    // Monitor job progress
    monitorJob(data.jobId);

  } catch (error) {
    console.error('Erro:', error);
    showError(error.message);
    elements.processBtn.disabled = false;
    state.isProcessing = false;
  }
}

async function monitorJob(jobId) {
  const checkInterval = setInterval(async () => {
    try {
      const response = await fetch(`${API_URL}/api/job/${jobId}`);
      const job = await response.json();

      if (job.status === 'completed') {
        clearInterval(checkInterval);
        elements.processBtn.disabled = false;
        state.isProcessing = false;

        showResults(job.clips, job.jobId);
        addToHistory(job);
        showToast('Processamento concluído!', 'success');

      } else if (job.status === 'error') {
        clearInterval(checkInterval);
        elements.processBtn.disabled = false;
        state.isProcessing = false;

        showError(job.error || 'Erro desconhecido ao processar vídeo');

      } else {
        // Still processing
        const progress = job.progress || 0;
        const currentStep = job.currentStep || 'Processando';
        elements.statusText.textContent = `${currentStep}... (${progress}%)`;
      }
    } catch (error) {
      clearInterval(checkInterval);
      elements.processBtn.disabled = false;
      state.isProcessing = false;
      showError('Erro ao verificar status do processamento');
    }
  }, 2000);
}

// ==========================================
// RESULTS DISPLAY
// ==========================================
function showResults(clips, jobId) {
  hideAllSections();
  elements.resultsSection.classList.remove('hidden');
  elements.clipsList.innerHTML = '';

  // Action buttons
  const actionsBar = createActionsBar(jobId);
  elements.clipsList.appendChild(actionsBar);

  // Check for empty results
  if (!clips || clips.length === 0) {
    elements.clipsList.appendChild(createNoClipsMessage());
    return;
  }

  // Create clips grid
  const clipsGrid = document.createElement('div');
  clipsGrid.className = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-6';

  clips.forEach(clip => {
    const clipCard = createClipCard(clip, jobId);
    clipsGrid.appendChild(clipCard);
  });

  elements.clipsList.appendChild(clipsGrid);
}

function createActionsBar(jobId) {
  const bar = document.createElement('div');
  bar.className = 'flex gap-4 flex-wrap justify-center p-6 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-xl';
  bar.innerHTML = `
    <button onclick="openOutputFolder('${jobId}')" class="flex items-center space-x-2 px-6 py-3 bg-white text-indigo-600 font-semibold rounded-lg hover:bg-gray-100 transition-colors shadow-lg">
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
      </svg>
      <span>Abrir Pasta</span>
    </button>
    <button onclick="prepareForTikTok('${jobId}')" class="flex items-center space-x-2 px-6 py-3 bg-gray-900 text-white font-semibold rounded-lg hover:bg-gray-800 transition-colors shadow-lg">
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/>
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>
      <span>Preparar para TikTok</span>
    </button>
  `;
  return bar;
}

function createNoClipsMessage() {
  const div = document.createElement('div');
  div.className = 'text-center py-16 px-8 bg-gray-50 rounded-xl border-2 border-dashed border-gray-300 mt-6';
  div.innerHTML = `
    <svg class="w-16 h-16 mx-auto text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
    </svg>
    <h3 class="text-xl font-semibold text-gray-700 mb-2">Nenhum clipe encontrado</h3>
    <p class="text-gray-500 mb-1">Não foram encontrados momentos virais com as categorias selecionadas.</p>
    <p class="text-gray-500">Tente com outras categorias ou use o modo sequencial.</p>
  `;
  return div;
}

function createClipCard(clip, jobId) {
  const card = document.createElement('div');
  card.className = 'bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden hover:shadow-xl transition-shadow';

  const coverImage = clip.coverUrl
    ? `<img src="${API_URL}${clip.coverUrl}" alt="Capa ${clip.number}" class="w-full h-48 object-cover">`
    : '<div class="w-full h-48 bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center text-4xl">🎬</div>';

  // Viral info badge
  const viralBadge = clip.viralScore !== undefined
    ? `<div class="absolute top-3 right-3 px-3 py-1 bg-gradient-to-r from-orange-500 to-red-500 text-white text-sm font-bold rounded-full shadow-lg">
         🔥 ${clip.viralScore}/10
       </div>`
    : '';

  card.innerHTML = `
    <div class="relative">
      ${coverImage}
      ${viralBadge}
    </div>

    <div class="p-5">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-lg font-bold text-gray-900">Clipe ${clip.number}</h3>
        ${clip.category ? `<span class="px-3 py-1 bg-indigo-100 text-indigo-700 text-xs font-medium rounded-full">${getCategoryIcon(clip.category)} ${clip.category}</span>` : ''}
      </div>

      ${clip.title ? `<p class="text-sm font-medium text-gray-900 mb-2">${clip.title}</p>` : ''}
      ${clip.description ? `<p class="text-sm text-gray-600 mb-3">${clip.description}</p>` : ''}

      ${clip.hookSuggestion ? `
        <div class="bg-amber-50 border-l-4 border-amber-400 p-3 mb-3 rounded">
          <p class="text-xs font-semibold text-amber-800 mb-1">💡 Gancho sugerido:</p>
          <p class="text-xs text-amber-700 italic">"${clip.hookSuggestion}"</p>
        </div>
      ` : ''}

      ${clip.whyViral ? `
        <div class="bg-green-50 border-l-4 border-green-400 p-3 mb-3 rounded">
          <p class="text-xs font-semibold text-green-800 mb-1">📈 Potencial viral:</p>
          <p class="text-xs text-green-700">${clip.whyViral}</p>
        </div>
      ` : ''}

      ${clip.tiktokDescription ? `
        <div class="mb-3">
          <label class="block text-xs font-semibold text-gray-700 mb-2">📱 Descrição TikTok:</label>
          <textarea readonly class="w-full text-xs p-3 bg-gray-50 border border-gray-200 rounded-lg resize-none" rows="4">${clip.tiktokDescription}</textarea>
          <button onclick="copyDescription(${clip.number}, '${jobId}')" class="mt-2 w-full px-4 py-2 bg-green-500 text-white text-sm font-medium rounded-lg hover:bg-green-600 transition-colors">
            Copiar Descrição
          </button>
        </div>
      ` : ''}

      ${clip.schedulingRecommendation ? generateSchedulingCard(clip.schedulingRecommendation) : ''}

      <div class="flex gap-2 mt-4">
        <a href="${API_URL}${clip.url}" download="${clip.name}" class="flex-1 flex items-center justify-center space-x-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm font-semibold rounded-lg hover:from-indigo-700 hover:to-purple-700 transition-all">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
          </svg>
          <span>Vídeo</span>
        </a>
        ${clip.coverUrl ? `
          <a href="${API_URL}${clip.coverUrl}" download="clip_${clip.number}_cover.png" class="flex items-center justify-center px-4 py-2 bg-gray-700 text-white text-sm font-semibold rounded-lg hover:bg-gray-800 transition-colors">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
            </svg>
          </a>
        ` : ''}
      </div>
    </div>
  `;

  card.dataset.clipNumber = clip.number;
  card.dataset.description = clip.tiktokDescription || '';

  return card;
}

function generateSchedulingCard(scheduling) {
  if (!scheduling || !scheduling.recommendations) return '';

  const { contentAnalysis, recommendations } = scheduling;
  const topTime = recommendations.top[0];

  return `
    <div class="mt-4 p-4 bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-lg">
      <div class="flex items-center justify-between mb-3">
        <h4 class="text-xs font-bold text-gray-900">📅 Melhor horário</h4>
        <span class="px-2 py-1 bg-blue-600 text-white text-xs font-medium rounded-full">${contentAnalysis.category}</span>
      </div>
      <div class="flex items-center space-x-2 mb-2">
        <svg class="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        <span class="text-sm font-bold text-gray-900">${topTime.time}</span>
        <span class="px-2 py-0.5 bg-amber-100 text-amber-800 text-xs font-medium rounded">Alto engajamento</span>
      </div>
      <p class="text-xs text-gray-600">${topTime.reason}</p>
    </div>
  `;
}

// ==========================================
// HELPER FUNCTIONS
// ==========================================
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

async function copyDescription(clipNumber, jobId) {
  const card = document.querySelector(`[data-clip-number="${clipNumber}"]`);
  const description = card.dataset.description;

  try {
    await navigator.clipboard.writeText(description);
    showToast('Descrição copiada!', 'success');
  } catch (err) {
    console.error('Erro ao copiar:', err);
    showToast('Erro ao copiar descrição', 'error');
  }
}

// ==========================================
// EXPORT FUNCTIONS
// ==========================================
async function openOutputFolder(jobId) {
  try {
    const response = await fetch(`${API_URL}/api/export/open-folder/${jobId}`);
    const result = await response.json();

    if (result.success) {
      showToast('Pasta aberta!', 'success');
    } else {
      showToast(result.error || 'Erro ao abrir pasta', 'error');
    }
  } catch (error) {
    console.error('Erro ao abrir pasta:', error);
    showToast('Erro ao abrir pasta', 'error');
  }
}

async function prepareForTikTok(jobId) {
  try {
    showToast('Preparando arquivos para TikTok...', 'info');

    const response = await fetch(`${API_URL}/api/export/prepare-tiktok/${jobId}`, {
      method: 'POST'
    });
    const result = await response.json();

    if (result.success) {
      showToast(`✅ ${result.clipsCount} clipes preparados!`, 'success');

      setTimeout(() => openOutputFolder(jobId), 1000);
      setTimeout(() => showTikTokInstructions(result.clipsCount), 2000);
    } else {
      showToast(result.error || 'Erro ao preparar arquivos', 'error');
    }
  } catch (error) {
    console.error('Erro ao preparar para TikTok:', error);
    showToast('Erro ao preparar arquivos', 'error');
  }
}

function showTikTokInstructions(clipsCount) {
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
  modal.onclick = (e) => {
    if (e.target === modal) modal.remove();
  };

  modal.innerHTML = `
    <div class="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
      <div class="bg-gradient-to-r from-gray-900 to-gray-800 px-8 py-6 flex items-center justify-between rounded-t-2xl">
        <h2 class="text-2xl font-bold text-white">📱 Como Publicar no TikTok</h2>
        <button onclick="this.closest('.fixed').remove()" class="text-white hover:text-gray-300">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>

      <div class="p-8">
        <div class="bg-indigo-50 border border-indigo-200 rounded-lg p-4 mb-6">
          <p class="text-center text-indigo-800">
            <strong>${clipsCount} clipes</strong> foram preparados na pasta <code class="bg-indigo-100 px-2 py-1 rounded">tiktok-ready</code>
          </p>
        </div>

        <div class="space-y-6">
          <div class="border-l-4 border-blue-500 pl-4">
            <h3 class="font-bold text-lg mb-3">💻 Desktop (TikTok Web)</h3>
            <ol class="list-decimal list-inside space-y-2 text-gray-700">
              <li>Acesse: <a href="https://www.tiktok.com/upload" target="_blank" class="text-blue-600 hover:underline">tiktok.com/upload</a></li>
              <li>Arraste o vídeo para a área de upload</li>
              <li>Abra o arquivo <code class="bg-gray-100 px-2 py-1 rounded text-sm">DESCRICOES.txt</code></li>
              <li>Copie e cole a descrição correspondente</li>
              <li>Adicione a capa (opcional)</li>
              <li>Publique!</li>
            </ol>
          </div>

          <div class="border-l-4 border-green-500 pl-4">
            <h3 class="font-bold text-lg mb-3">📱 Mobile (Recomendado)</h3>
            <ol class="list-decimal list-inside space-y-2 text-gray-700">
              <li>Transfira os vídeos para seu celular</li>
              <li>Abra TikTok → Toque no <strong>"+"</strong></li>
              <li>Selecione <strong>"Upload"</strong></li>
              <li>Escolha o vídeo</li>
              <li>Cole a descrição do arquivo <code class="bg-gray-100 px-2 py-1 rounded text-sm">DESCRICOES.txt</code></li>
              <li>Adicione a capa correspondente</li>
              <li>Publique!</li>
            </ol>
          </div>

          <div class="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <h4 class="font-semibold text-amber-900 mb-2">💡 Dicas:</h4>
            <ul class="list-disc list-inside space-y-1 text-amber-800 text-sm">
              <li>Publique em horários de pico (confira as recomendações em cada clipe)</li>
              <li>Use as hashtags sugeridas</li>
              <li>Interaja com comentários nas primeiras horas</li>
              <li>Publique 1-3 vídeos por dia para melhor desempenho</li>
            </ul>
          </div>
        </div>

        <div class="mt-6 text-center">
          <button onclick="this.closest('.fixed').remove()" class="px-8 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-semibold rounded-lg hover:from-indigo-700 hover:to-purple-700 transition-all">
            Entendi!
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
}

// ==========================================
// HISTORY MANAGEMENT
// ==========================================
function toggleHistory() {
  const panel = elements.historyPanel;

  if (panel.classList.contains('hidden')) {
    panel.classList.remove('hidden');
    loadHistory();
  } else {
    panel.classList.add('hidden');
  }
}

function addToHistory(job) {
  const historyItem = {
    jobId: job.jobId,
    timestamp: new Date().toISOString(),
    clipCount: job.clips ? job.clips.length : 0,
    processingType: job.processingType || 'sequential'
  };

  state.history.unshift(historyItem);
  state.history = state.history.slice(0, 10); // Keep last 10

  saveHistoryToStorage();
}

function loadHistoryFromStorage() {
  const saved = localStorage.getItem('clipmaker_history');
  if (saved) {
    try {
      state.history = JSON.parse(saved);
    } catch (e) {
      console.error('Error loading history:', e);
    }
  }
}

function saveHistoryToStorage() {
  localStorage.setItem('clipmaker_history', JSON.stringify(state.history));
}

function loadHistory() {
  elements.historyList.innerHTML = '';

  if (state.history.length === 0) {
    elements.historyList.innerHTML = `
      <div class="text-center py-12 text-gray-500">
        <svg class="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        <p>Nenhum histórico ainda</p>
      </div>
    `;
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'grid grid-cols-1 md:grid-cols-2 gap-4';

  state.history.forEach(item => {
    const card = document.createElement('div');
    card.className = 'bg-gradient-to-br from-gray-50 to-white border border-gray-200 rounded-lg p-4 hover:shadow-lg transition-shadow cursor-pointer';
    card.onclick = () => loadHistoryJob(item.jobId);

    const date = new Date(item.timestamp);
    const formattedDate = date.toLocaleDateString('pt-BR');
    const formattedTime = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    const typeIcons = {
      sequential: '📹',
      intelligent: '🧠',
      curiosity: '💡'
    };

    card.innerHTML = `
      <div class="flex items-start justify-between mb-2">
        <div class="text-2xl">${typeIcons[item.processingType] || '📹'}</div>
        <span class="text-xs text-gray-500">${formattedDate} ${formattedTime}</span>
      </div>
      <div class="text-sm font-semibold text-gray-900 mb-1">Job ${item.jobId.slice(0, 8)}</div>
      <div class="text-xs text-gray-600">${item.clipCount} clipes gerados</div>
    `;

    grid.appendChild(card);
  });

  elements.historyList.appendChild(grid);
}

async function loadHistoryJob(jobId) {
  try {
    const response = await fetch(`${API_URL}/api/job/${jobId}`);
    const job = await response.json();

    if (job.status === 'completed' && job.clips) {
      toggleHistory();
      showResults(job.clips, job.jobId);
      showToast('Histórico carregado!', 'success');
    } else {
      showToast('Este job não está mais disponível', 'error');
    }
  } catch (error) {
    console.error('Error loading history job:', error);
    showToast('Erro ao carregar histórico', 'error');
  }
}

// ==========================================
// UI HELPERS
// ==========================================
function hideAllSections() {
  elements.statusSection.classList.add('hidden');
  elements.resultsSection.classList.add('hidden');
  elements.errorSection.classList.add('hidden');
}

function showError(message) {
  hideAllSections();
  elements.errorSection.classList.remove('hidden');
  elements.errorText.textContent = message;
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `px-6 py-4 rounded-lg shadow-xl text-white font-medium transform transition-all duration-300 translate-x-0`;

  const colors = {
    success: 'bg-gradient-to-r from-green-500 to-emerald-600',
    error: 'bg-gradient-to-r from-red-500 to-rose-600',
    warning: 'bg-gradient-to-r from-amber-500 to-orange-600',
    info: 'bg-gradient-to-r from-blue-500 to-indigo-600'
  };

  const icons = {
    success: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>`,
    error: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>`,
    warning: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>`,
    info: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`
  };

  toast.classList.add(colors[type] || colors.info);
  toast.innerHTML = `
    <div class="flex items-center space-x-3">
      ${icons[type] || icons.info}
      <span>${message}</span>
    </div>
  `;

  elements.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ==========================================
// START
// ==========================================
document.addEventListener('DOMContentLoaded', init);
