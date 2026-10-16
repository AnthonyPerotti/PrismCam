/**
 * PrismCam — Frontend Controller
 * Controle PTZ, Preview ao Vivo, Varredura de Rede e Integração OBS
 */

// ============================================================
// ESTADO GLOBAL DA APLICAÇÃO
// ============================================================
const state = {
  cameras: [],
  selectedCameraId: null,
  livePreviewInterval: null,
  isLivePreviewActive: false,
  scanInterval: null,
  currentScanId: null,
  activePanel: 'cameras'
};

// ============================================================
// INICIALIZAÇÃO
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupKeyboardShortcuts();
  fetchCameras();
  detectNetworkSubnet();
});

// ============================================================
// NAVEGAÇÃO ENTRE PAINÉIS
// ============================================================
function setupNavigation() {
  const navButtons = document.querySelectorAll('.sidebar-nav .nav-btn');
  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetPanel = btn.getAttribute('data-panel');
      switchPanel(targetPanel);
    });
  });
}

function switchPanel(panelId) {
  state.activePanel = panelId;

  // Atualiza botões da sidebar
  document.querySelectorAll('.sidebar-nav .nav-btn').forEach(btn => {
    if (btn.getAttribute('data-panel') === panelId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Atualiza painéis visíveis
  document.querySelectorAll('.main-content .panel').forEach(panel => {
    if (panel.id === `panel-${panelId}`) {
      panel.classList.add('active');
    } else {
      panel.classList.remove('active');
    }
  });

  if (panelId === 'control' && state.selectedCameraId) {
    refreshPreview();
  } else if (panelId === 'obs') {
    updateObsPanel();
  }
}

// ============================================================
// GERENCIAMENTO DE CÂMERAS
// ============================================================
async function fetchCameras() {
  try {
    const res = await fetch('/api/cameras');
    if (!res.ok) throw new Error('Falha ao obter lista de câmeras');
    const data = await res.json();
    state.cameras = data.cameras || [];
    renderCameraGrid();
    updateCameraSelects();
    updateObsPanel();
  } catch (err) {
    showToast('Erro ao carregar câmeras: ' + err.message, 'error');
  }
}

function renderCameraGrid() {
  const grid = document.getElementById('camera-grid');
  const emptyState = document.getElementById('empty-cameras');

  if (!grid) return;

  if (state.cameras.length === 0) {
    if (emptyState) emptyState.style.display = 'flex';
    grid.innerHTML = '';
    if (emptyState) grid.appendChild(emptyState);
    return;
  }

  grid.innerHTML = '';

  state.cameras.forEach(cam => {
    const card = document.createElement('div');
    card.className = `camera-card ${cam.id === state.selectedCameraId ? 'selected' : ''}`;
    card.id = `card-${cam.id}`;

    const statusClass = cam.status === 'conectado' ? 'online' : (cam.status === 'erro' ? 'error' : 'offline');
    const statusLabel = cam.status === 'conectado' ? 'Online' : (cam.status === 'erro' ? 'Erro' : 'Desconectado');
    const isDatavideo = cam.type === 'datavideo';

    card.innerHTML = `
      <div class="card-header">
        <div class="cam-info">
          <span class="cam-type-badge ${isDatavideo ? 'datavideo' : 'onvif'}">
            ${isDatavideo ? 'Datavideo' : 'ONVIF IP'}
          </span>
          <h3 class="cam-name">${escapeHtml(cam.name)}</h3>
          <span class="cam-ip">${escapeHtml(cam.ip)}</span>
        </div>
        <div class="status-indicator">
          <span class="status-dot ${statusClass}"></span>
          <span class="status-text">${statusLabel}</span>
        </div>
      </div>

      <div class="card-preview">
        <img 
          src="/api/cameras/${cam.id}/snapshot?t=${Date.now()}" 
          alt="${escapeHtml(cam.name)}"
          onerror="this.onerror=null; this.src='/assets/icon.svg'; this.classList.add('fallback-preview');"
          class="card-img"
        />
      </div>

      <div class="card-actions">
        <button class="btn btn-sm btn-primary" onclick="selectAndControl('${cam.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><polygon points="12,8 16,14 8,14"/>
          </svg>
          Controlar PTZ
        </button>
        <button class="btn btn-sm btn-secondary" onclick="testCameraConnection('${cam.id}')" title="Testar Conexão">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
          </svg>
        </button>
        <button class="btn btn-sm btn-danger" onclick="openDeleteCameraModal(event, '${cam.id}')" title="Remover Câmera">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
          </svg>
        </button>
      </div>
    `;

    grid.appendChild(card);
  });
}

function updateCameraSelects() {
  const select = document.getElementById('select-camera-control');
  if (!select) return;

  const currentVal = select.value;
  select.innerHTML = '<option value="">Selecione uma câmera</option>';

  state.cameras.forEach(cam => {
    const opt = document.createElement('option');
    opt.value = cam.id;
    opt.textContent = `${cam.name} (${cam.ip}) [${cam.type}]`;
    select.appendChild(opt);
  });

  if (state.selectedCameraId && state.cameras.some(c => c.id === state.selectedCameraId)) {
    select.value = state.selectedCameraId;
  } else if (currentVal && state.cameras.some(c => c.id === currentVal)) {
    select.value = currentVal;
    state.selectedCameraId = currentVal;
  } else if (state.cameras.length > 0) {
    select.value = state.cameras[0].id;
    state.selectedCameraId = state.cameras[0].id;
  }

  select.onchange = (e) => {
    state.selectedCameraId = e.target.value;
    onCameraSelectionChange();
  };
}

function selectAndControl(cameraId) {
  state.selectedCameraId = cameraId;
  const select = document.getElementById('select-camera-control');
  if (select) select.value = cameraId;
  switchPanel('control');
  onCameraSelectionChange();
}

function onCameraSelectionChange() {
  if (!state.selectedCameraId) {
    const placeholder = document.getElementById('preview-placeholder');
    const img = document.getElementById('preview-image');
    if (placeholder) placeholder.classList.remove('hidden');
    if (img) img.classList.add('hidden');
    addLog('Nenhuma câmera selecionada', 'info');
    return;
  }

  const cam = state.cameras.find(c => c.id === state.selectedCameraId);
  if (cam) {
    addLog(`Câmera selecionada: ${cam.name} (${cam.ip})`, 'info');
    refreshPreview();
  }
}

// ============================================================
// MODAL: ADICIONAR CÂMERA
// ============================================================
function openAddCameraModal(prefillIp = '', prefillType = 'datavideo') {
  const modal = document.getElementById('modal-add-camera');
  if (!modal) return;

  const ipInput = document.getElementById('cam-ip');
  const nameInput = document.getElementById('cam-name');
  const typeSelect = document.getElementById('cam-type');

  if (ipInput) ipInput.value = prefillIp;
  if (nameInput) nameInput.value = prefillIp ? `Datavideo ${prefillIp}` : '';
  if (typeSelect) typeSelect.value = prefillType;

  modal.classList.remove('hidden');
  if (ipInput) ipInput.focus();
}

function closeAddCameraModal() {
  const modal = document.getElementById('modal-add-camera');
  if (modal) modal.classList.add('hidden');
}

async function addCamera() {
  const name = document.getElementById('cam-name')?.value.trim();
  const ip = document.getElementById('cam-ip')?.value.trim();
  const username = document.getElementById('cam-user')?.value.trim() || 'admin';
  const password = document.getElementById('cam-pass')?.value.trim() || 'admin';
  const type = document.getElementById('cam-type')?.value || 'datavideo';

  if (!ip) {
    showToast('Informe o endereço IP da câmera', 'error');
    return;
  }

  const btn = document.getElementById('btn-save-camera');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Adicionando...';
  }

  try {
    const res = await fetch('/api/cameras', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip, name, username, password, type })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao adicionar câmera');

    showToast(`Câmera "${data.camera.name}" adicionada com sucesso!`, 'success');
    closeAddCameraModal();
    await fetchCameras();
    selectAndControl(data.camera.id);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Adicionar';
    }
  }
}

let pendingDeleteCameraId = null;

function openDeleteCameraModal(event, id) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }

  pendingDeleteCameraId = id;
  const cam = state.cameras.find(c => c.id === id);
  const name = cam ? cam.name : 'esta câmera';

  const modal = document.getElementById('modal-delete-camera');
  const msg = document.getElementById('delete-camera-msg');
  if (msg) msg.textContent = `Tem certeza que deseja remover a câmera "${name}"?`;
  if (modal) modal.classList.remove('hidden');
}

function closeDeleteCameraModal() {
  pendingDeleteCameraId = null;
  const modal = document.getElementById('modal-delete-camera');
  if (modal) modal.classList.add('hidden');
}

async function confirmDeleteCamera() {
  const id = pendingDeleteCameraId;
  if (!id) return;

  const btn = document.getElementById('btn-confirm-delete');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Removendo...';
  }

  try {
    const res = await fetch(`/api/cameras/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao remover câmera');

    showToast('Câmera removida com sucesso!', 'success');
    closeDeleteCameraModal();

    if (state.selectedCameraId === id) {
      state.selectedCameraId = null;
      stopLivePreview();
    }
    await fetchCameras();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Sim, Remover';
    }
  }
}

// Fallback direto
async function deleteCamera(id) {
  openDeleteCameraModal(null, id);
}

async function testCameraConnection(id) {
  try {
    showToast('Testando conexão com a câmera...', 'info');
    const res = await fetch(`/api/cameras/${id}/test`, { method: 'POST' });
    const data = await res.json();

    if (data.connected) {
      showToast('Câmera conectada com sucesso!', 'success');
      addLog(`Teste de conexão OK: ${data.message || 'Online'}`, 'success');
    } else {
      showToast('Falha na conexão: ' + (data.message || 'Sem resposta'), 'error');
      addLog(`Falha no teste: ${data.message}`, 'error');
    }
    fetchCameras();
  } catch (err) {
    showToast('Erro no teste: ' + err.message, 'error');
    addLog(`Erro no teste: ${err.message}`, 'error');
  }
}

// ============================================================
// CONTROLE PTZ (PAN, TILT, ZOOM, FOCUS, PRESETS)
// ============================================================
function getActiveCameraId() {
  if (!state.selectedCameraId) {
    showToast('Selecione uma câmera primeiro!', 'warning');
    return null;
  }
  return state.selectedCameraId;
}

function getPanTiltSpeed() {
  const panInput = document.getElementById('pan-speed');
  const tiltInput = document.getElementById('tilt-speed');
  return {
    panSpeed: panInput ? parseInt(panInput.value, 10) : 12,
    tiltSpeed: tiltInput ? parseInt(tiltInput.value, 10) : 10
  };
}

function getZoomSpeed() {
  const zoomInput = document.getElementById('zoom-speed');
  return zoomInput ? parseInt(zoomInput.value, 10) : 4;
}

async function ptzMove(direction) {
  const id = getActiveCameraId();
  if (!id) return;

  const { panSpeed, tiltSpeed } = getPanTiltSpeed();
  addLog(`PTZ Move: ${direction} (Pan: ${panSpeed}, Tilt: ${tiltSpeed})`, 'cmd');

  try {
    const res = await fetch(`/api/ptz/${id}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction, panSpeed, tiltSpeed })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
  } catch (err) {
    addLog(`Erro PTZ Move: ${err.message}`, 'error');
  }
}

async function ptzStop() {
  const id = state.selectedCameraId;
  if (!id) return;

  try {
    await fetch(`/api/ptz/${id}/stop`, { method: 'POST' });
    addLog('PTZ Stop', 'cmd');
  } catch (err) {
    console.error('Erro PTZ Stop:', err);
  }
}

async function ptzZoom(action) {
  const id = getActiveCameraId();
  if (!id) return;

  const speed = getZoomSpeed();
  addLog(`PTZ Zoom: ${action} (Vel: ${speed})`, 'cmd');

  try {
    const res = await fetch(`/api/ptz/${id}/zoom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, speed })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
  } catch (err) {
    addLog(`Erro PTZ Zoom: ${err.message}`, 'error');
  }
}

async function ptzZoomStop() {
  const id = state.selectedCameraId;
  if (!id) return;
  try {
    await fetch(`/api/ptz/${id}/zoom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop' })
    });
    addLog('PTZ Zoom Stop', 'cmd');
  } catch (err) {
    console.error('Erro Zoom Stop:', err);
  }
}

let currentWfs = null;

function stopCurrentWfs() {
  if (currentWfs) {
    try {
      currentWfs.destroy();
    } catch (e) {}
    currentWfs = null;
  }
}

async function ptzFocus(action) {
  const id = getActiveCameraId();
  if (!id) return;

  const badge = document.getElementById('focus-mode-badge');
  const btnAuto = document.getElementById('btn-focus-auto');

  if (action === 'autofocus') {
    if (badge) {
      badge.textContent = 'Auto';
      badge.className = 'cam-type-badge datavideo';
    }
    if (btnAuto) btnAuto.classList.add('active');
    addLog('PTZ Foco: Modo Automático ativado', 'cmd');
    showToast('Foco Automático ativado', 'info');
  } else if (action === 'focusnear' || action === 'focusfar') {
    if (badge) {
      badge.textContent = 'Manual';
      badge.className = 'cam-type-badge onvif';
    }
    if (btnAuto) btnAuto.classList.remove('active');
    const dir = action === 'focusnear' ? 'Foco -' : 'Foco +';
    addLog(`PTZ Foco: Ajustando ${dir} (Manual)`, 'cmd');
  }

  try {
    const res = await fetch(`/api/ptz/${id}/focus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, speed: 4 })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
  } catch (err) {
    addLog(`Erro PTZ Foco: ${err.message}`, 'error');
  }
}

async function ptzFocusStop() {
  const id = state.selectedCameraId;
  if (!id) return;
  try {
    await fetch(`/api/ptz/${id}/focus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop' })
    });
    addLog('PTZ Foco: Parado', 'cmd');
  } catch (err) {
    console.error('Erro Foco Stop:', err);
  }
}

async function ptzHome() {
  const id = getActiveCameraId();
  if (!id) return;

  const btnHome = document.getElementById('btn-ptz-home');
  if (btnHome) {
    btnHome.classList.add('active');
    setTimeout(() => btnHome.classList.remove('active'), 400);
  }

  addLog('PTZ Home (Retornando ao centro)', 'cmd');
  try {
    const res = await fetch(`/api/ptz/${id}/home`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast('Câmera retornando à posição Home', 'info');
  } catch (err) {
    addLog(`Erro PTZ Home: ${err.message}`, 'error');
  }
}

async function ptzGotoPreset(preset) {
  const id = getActiveCameraId();
  if (!id) return;

  const btnPreset = document.getElementById(`btn-preset-${preset}`);
  if (btnPreset) {
    btnPreset.classList.add('active');
    setTimeout(() => btnPreset.classList.remove('active'), 400);
  }

  addLog(`PTZ Preset Goto: #${preset}`, 'cmd');
  try {
    const res = await fetch(`/api/ptz/${id}/preset/goto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast(`Movendo para Preset ${preset}`, 'info');
  } catch (err) {
    addLog(`Erro Preset Goto: ${err.message}`, 'error');
  }
}

async function ptzSetPreset() {
  const id = getActiveCameraId();
  if (!id) return;

  const input = document.getElementById('preset-number');
  const preset = input ? parseInt(input.value, 10) : 1;

  if (isNaN(preset) || preset < 1) {
    showToast('Informe um número válido para o preset', 'error');
    return;
  }

  addLog(`PTZ Salvar Preset: #${preset}`, 'cmd');
  try {
    const res = await fetch(`/api/ptz/${id}/preset/set`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast(`Posição salva no Preset ${preset}!`, 'success');
  } catch (err) {
    addLog(`Erro ao salvar preset: ${err.message}`, 'error');
  }
}

// ============================================================
// PREVIEW DE VÍDEO / STREAM AO VIVO (MJPEG) / SNAPSHOT
// ============================================================
function refreshPreview() {
  const id = state.selectedCameraId;
  const placeholder = document.getElementById('preview-placeholder');
  const img = document.getElementById('preview-image');
  const video = document.getElementById('preview-video');
  const liveBadge = document.getElementById('preview-live-badge');
  const btnLive = document.getElementById('btn-live-preview');

  if (!id) return;
  const cam = state.cameras.find(c => c.id === id);
  if (!cam) return;

  stopCurrentWfs();
  if (video) video.classList.add('hidden');

  if (img) {
    if (placeholder) placeholder.classList.add('hidden');
    img.classList.remove('hidden');

    // Desconecta stream anterior se houver
    img.src = '';

    // Conecta ao stream MJPEG ao vivo em tempo real
    img.src = `/api/cameras/${id}/mjpeg?t=${Date.now()}`;

    img.onload = () => {
      img.classList.remove('hidden');
      if (placeholder) placeholder.classList.add('hidden');
      if (liveBadge) liveBadge.classList.remove('hidden');
      if (btnLive) btnLive.classList.add('active');
    };

    img.onerror = () => {
      console.warn('Stream MJPEG indisponível, tentando snapshot...');
      if (liveBadge) liveBadge.classList.add('hidden');
      // Fallback para snapshot estático
      img.src = `/api/cameras/${id}/snapshot?t=${Date.now()}`;
      img.onerror = () => {
        img.classList.add('hidden');
        if (placeholder) {
          placeholder.classList.remove('hidden');
          placeholder.querySelector('p').textContent = 'Câmera não respondeu ao stream ou snapshot.';
        }
      };
    };
  }
}

function toggleLivePreview() {
  const btn = document.getElementById('btn-live-preview');
  const liveBadge = document.getElementById('preview-live-badge');
  const img = document.getElementById('preview-image');
  const id = state.selectedCameraId;

  if (!id) {
    showToast('Selecione uma câmera primeiro', 'warning');
    return;
  }

  if (state.isLivePreviewActive === false) {
    state.isLivePreviewActive = true;
    refreshPreview();
    showToast('Stream ao vivo reiniciado', 'info');
  } else {
    // Pausa stream ao vivo
    state.isLivePreviewActive = false;
    if (img) {
      img.src = `/api/cameras/${id}/snapshot?t=${Date.now()}`;
    }
    if (btn) btn.classList.remove('active');
    if (liveBadge) liveBadge.classList.add('hidden');
    showToast('Stream pausado (modo snapshot)', 'info');
  }
}

function startLivePreview() {
  state.isLivePreviewActive = true;
  refreshPreview();
}

function stopLivePreview() {
  state.isLivePreviewActive = false;
  const img = document.getElementById('preview-image');
  const btn = document.getElementById('btn-live-preview');
  const liveBadge = document.getElementById('preview-live-badge');
  if (img) img.src = '';
  if (btn) btn.classList.remove('active');
  if (liveBadge) liveBadge.classList.add('hidden');
}

// ============================================================
// VARREDURA DE REDE
// ============================================================
async function detectNetworkSubnet() {
  const subnetInput = document.getElementById('scan-subnet');
  if (!subnetInput) return;

  try {
    const res = await fetch('/api/network-interfaces');
    if (res.ok) {
      const data = await res.json();
      if (data.defaultSubnet) {
        subnetInput.value = data.defaultSubnet;
        const subtext = subnetInput.parentElement.querySelector('small');
        if (subtext) {
          const iface = data.interfaces.find(i => i.subnet === data.defaultSubnet);
          const ifaceName = iface ? `${iface.name} (${iface.ip})` : data.defaultSubnet;
          subtext.innerHTML = `Rede detectada automaticamente: <strong>${escapeHtml(ifaceName)}</strong>. Você pode alterar se desejar.`;
        }
      }
    }
  } catch (err) {
    if (!subnetInput.value) {
      subnetInput.placeholder = 'Ex: 192.168.1 ou 172.16.1';
    }
  }
}

async function startNetworkScan() {
  const subnet = document.getElementById('scan-subnet')?.value.trim();
  const startIp = document.getElementById('scan-start')?.value || 1;
  const endIp = document.getElementById('scan-end')?.value || 254;

  const btn = document.getElementById('btn-start-scan');
  const progressBar = document.getElementById('scan-progress');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');
  const resultsContainer = document.getElementById('scan-results');

  if (btn) btn.disabled = true;
  if (progressBar) progressBar.classList.remove('hidden');
  if (progressFill) progressFill.style.width = '0%';
  if (progressText) progressText.textContent = 'Iniciando varredura...';
  if (resultsContainer) resultsContainer.innerHTML = '<div class="scan-loading">Varrendo rede à procura de câmeras IP...</div>';

  try {
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subnet, startIp, endIp })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    state.currentScanId = data.scanId;
    pollScanProgress(data.scanId);
  } catch (err) {
    showToast('Erro ao iniciar varredura: ' + err.message, 'error');
    if (btn) btn.disabled = false;
    if (progressBar) progressBar.classList.add('hidden');
  }
}

function pollScanProgress(scanId) {
  if (state.scanInterval) clearInterval(state.scanInterval);

  state.scanInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/scan/${scanId}`);
      if (!res.ok) throw new Error('Falha ao obter status do scan');
      const scan = await res.json();

      const progressFill = document.getElementById('progress-fill');
      const progressText = document.getElementById('progress-text');

      if (progressFill) progressFill.style.width = `${scan.progress}%`;
      if (progressText) progressText.textContent = `${scan.progress}% (${scan.scanned}/${scan.total} IPs)`;

      if (scan.status === 'completed' || scan.progress >= 100) {
        clearInterval(state.scanInterval);
        state.scanInterval = null;
        const btn = document.getElementById('btn-start-scan');
        if (btn) btn.disabled = false;
        renderScanResults(scan.found || []);
      }
    } catch (err) {
      clearInterval(state.scanInterval);
      state.scanInterval = null;
      const btn = document.getElementById('btn-start-scan');
      if (btn) btn.disabled = false;
      showToast('Erro na varredura: ' + err.message, 'error');
    }
  }, 1000);
}

function renderScanResults(found) {
  const container = document.getElementById('scan-results');
  if (!container) return;

  if (found.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>Nenhuma câmera encontrada na faixa especificada.</p>
        <small>Verifique se as câmeras estão ligadas e na mesma faixa de rede.</small>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <h3 class="results-title">Câmeras Encontradas (${found.length})</h3>
    <div class="results-list">
      ${found.map(item => `
        <div class="scan-item">
          <div class="scan-item-info">
            <span class="scan-item-badge ${item.isDatavideo ? 'datavideo' : 'generic'}">
              ${item.isDatavideo ? 'Datavideo' : 'Câmera IP'}
            </span>
            <strong>${escapeHtml(item.ip)}</strong>
            <span class="scan-item-details">${item.vendor || item.model || 'Portas: ' + (item.openPorts ? item.openPorts.join(', ') : '80')}</span>
          </div>
          <button class="btn btn-sm btn-primary" onclick="openAddCameraModal('${item.ip}', '${item.isDatavideo ? 'datavideo' : 'generic-onvif'}')">
            Adicionar à Lista
          </button>
        </div>
      `).join('')}
    </div>
  `;
}

// ============================================================
// PAINEL: INTEGRAÇÃO OBS
// ============================================================
function updateObsPanel() {
  const origin = window.location.origin;

  const mjpegContainer = document.getElementById('obs-mjpeg-urls');
  const rtspContainer = document.getElementById('obs-rtsp-urls');
  const snapshotContainer = document.getElementById('obs-snapshot-urls');

  if (!mjpegContainer || !rtspContainer || !snapshotContainer) return;

  if (state.cameras.length === 0) {
    const emptyMsg = '<p class="muted">Adicione câmeras para gerar as URLs do OBS</p>';
    mjpegContainer.innerHTML = emptyMsg;
    rtspContainer.innerHTML = emptyMsg;
    snapshotContainer.innerHTML = emptyMsg;
    return;
  }

  mjpegContainer.innerHTML = state.cameras.map(cam => `
    <div class="url-row">
      <span class="cam-tag">${escapeHtml(cam.name)}:</span>
      <input type="text" readonly value="${origin}/api/cameras/${cam.id}/mjpeg" class="input url-field" id="url-mjpeg-${cam.id}">
      <button class="btn btn-sm btn-secondary" onclick="copyToClipboard('url-mjpeg-${cam.id}')">Copiar</button>
    </div>
  `).join('');

  rtspContainer.innerHTML = state.cameras.map(cam => {
    const user = cam.username || 'admin';
    const pass = cam.password || 'admin';
    const rtspUrl = cam.type === 'datavideo' 
      ? `rtsp://${user}:${pass}@${cam.ip}:554/live/av0` 
      : `rtsp://${user}:${pass}@${cam.ip}:554/stream1`;
    return `
      <div class="url-row">
        <span class="cam-tag">${escapeHtml(cam.name)}:</span>
        <input type="text" readonly value="${rtspUrl}" class="input url-field" id="url-rtsp-${cam.id}">
        <button class="btn btn-sm btn-secondary" onclick="copyToClipboard('url-rtsp-${cam.id}')">Copiar</button>
      </div>
    `;
  }).join('');

  snapshotContainer.innerHTML = state.cameras.map(cam => `
    <div class="url-row">
      <span class="cam-tag">${escapeHtml(cam.name)}:</span>
      <input type="text" readonly value="${origin}/api/cameras/${cam.id}/snapshot" class="input url-field" id="url-snap-${cam.id}">
      <button class="btn btn-sm btn-secondary" onclick="copyToClipboard('url-snap-${cam.id}')">Copiar</button>
    </div>
  `).join('');
}

function copyToClipboard(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;

  el.select();
  el.setSelectionRange(0, 99999);
  navigator.clipboard.writeText(el.value)
    .then(() => showToast('URL copiada para a área de transferência!', 'success'))
    .catch(() => showToast('Falha ao copiar URL', 'error'));
}

// ============================================================
// ATALHOS DE TECLADO
// ============================================================
function setupKeyboardShortcuts() {
  let isMoving = false;

  window.addEventListener('keydown', (e) => {
    // Tecla Escape: remove foco de inputs/selects para liberar os atalhos
    if (e.key === 'Escape') {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        document.activeElement.blur();
        return;
      }
    }

    // Não ativa atalhos se o usuário estiver digitando em um input ou textarea
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
      return;
    }

    // Se estiver em select, permite atalhos se não for tecla de navegação no select
    if (document.activeElement?.tagName === 'SELECT' && e.key.startsWith('Arrow')) {
      return;
    }

    // Garante que uma câmera esteja selecionada
    if (!state.selectedCameraId && state.cameras.length > 0) {
      state.selectedCameraId = state.cameras[0].id;
      const select = document.getElementById('select-camera-control');
      if (select) select.value = state.selectedCameraId;
    }

    if (!state.selectedCameraId) return;
    if (e.repeat) return; // Evita repetição contínua do SO para comandos únicos

    const key = e.key.toLowerCase();
    const code = e.code || '';

    // --- Atalho HOME: Tecla 'H', tecla física 'Home' ou code 'KeyH' ---
    if (key === 'h' || key === 'home' || code === 'KeyH') {
      e.preventDefault();
      if (state.activePanel !== 'control') switchPanel('control');
      ptzHome();
      return;
    }

    // --- Atalho PRESETS 1 a 9: Teclas 1-9 (teclado numérico ou linha superior) ---
    let presetNum = null;
    if (key >= '1' && key <= '9') {
      presetNum = parseInt(key, 10);
    } else if (code.startsWith('Digit') && code !== 'Digit0') {
      presetNum = parseInt(code.replace('Digit', ''), 10);
    } else if (code.startsWith('Numpad') && code !== 'Numpad0') {
      presetNum = parseInt(code.replace('Numpad', ''), 10);
    }

    if (presetNum !== null && presetNum >= 1 && presetNum <= 9) {
      e.preventDefault();
      if (state.activePanel !== 'control') switchPanel('control');
      ptzGotoPreset(presetNum);
      return;
    }

    // Apenas no painel de controle para movimentos contínuos e zoom
    if (state.activePanel !== 'control') return;

    // --- Pan / Tilt ---
    if (key === 'arrowup' || key === 'w' || code === 'KeyW' || code === 'ArrowUp') {
      e.preventDefault();
      ptzMove('up');
      isMoving = true;
    } else if (key === 'arrowdown' || key === 's' || code === 'KeyS' || code === 'ArrowDown') {
      e.preventDefault();
      ptzMove('down');
      isMoving = true;
    } else if (key === 'arrowleft' || key === 'a' || code === 'KeyA' || code === 'ArrowLeft') {
      e.preventDefault();
      ptzMove('left');
      isMoving = true;
    } else if (key === 'arrowright' || key === 'd' || code === 'KeyD' || code === 'ArrowRight') {
      e.preventDefault();
      ptzMove('right');
      isMoving = true;
    } 
    // --- Zoom ---
    else if (key === '+' || key === '=' || key === 'e' || code === 'KeyE' || code === 'NumpadAdd') {
      e.preventDefault();
      ptzZoom('zoomin');
    } else if (key === '-' || key === '_' || key === 'q' || code === 'KeyQ' || code === 'NumpadSubtract') {
      e.preventDefault();
      ptzZoom('zoomout');
    }
  });

  window.addEventListener('keyup', (e) => {
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
      return;
    }

    const key = e.key.toLowerCase();
    const code = e.code || '';
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(key) ||
        ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code)) {
      ptzStop();
      isMoving = false;
    } else if (['+', '=', '-', '_', 'q', 'e'].includes(key) ||
               ['KeyQ', 'KeyE', 'NumpadAdd', 'NumpadSubtract'].includes(code)) {
      ptzZoomStop();
    }
  });
}

// ============================================================
// LOGS E TOASTS
// ============================================================
function addLog(message, type = 'info') {
  const container = document.getElementById('log-entries');
  if (!container) return;

  const entry = document.createElement('div');
  entry.className = `log-entry log-${type}`;
  const time = new Date().toLocaleTimeString();
  entry.textContent = `[${time}] ${message}`;

  container.prepend(entry);

  // Limita a 50 logs para performance
  while (container.children.length > 50) {
    container.removeChild(container.lastChild);
  }
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-message">${escapeHtml(message)}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">×</button>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
