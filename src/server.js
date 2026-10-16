const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { CameraManager } = require('./camera-manager');
const { NetworkScanner } = require('./network-scanner');
const StreamManager = require('./stream-manager');

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Instâncias globais
const cameraManager = new CameraManager();
const networkScanner = new NetworkScanner();
const streamManager = new StreamManager(cameraManager);

// ============================================================
// ROTAS DA API
// ============================================================

// --- Câmeras ---

// Listar todas as câmeras configuradas
app.get('/api/cameras', (req, res) => {
  res.json({ cameras: cameraManager.getAll() });
});

// Adicionar câmera manualmente
app.post('/api/cameras', async (req, res) => {
  try {
    const { ip, name, username, password, type } = req.body;
    if (!ip) {
      return res.status(400).json({ error: 'IP é obrigatório' });
    }
    const camera = await cameraManager.add({
      ip,
      name: name || `Câmera ${ip}`,
      username: username || 'admin',
      password: password || 'admin',
      type: type || 'datavideo'
    });
    res.json({ camera });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remover câmera
app.delete('/api/cameras/:id', (req, res) => {
  const success = cameraManager.remove(req.params.id);
  if (success) {
    res.json({ message: 'Câmera removida' });
  } else {
    res.status(404).json({ error: 'Câmera não encontrada' });
  }
});

// Testar conexão com câmera
app.post('/api/cameras/:id/test', async (req, res) => {
  try {
    const result = await cameraManager.testConnection(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Controle PTZ ---

// Mover câmera (pan/tilt)
app.post('/api/ptz/:id/move', async (req, res) => {
  try {
    const { direction, panSpeed, tiltSpeed } = req.body;
    const result = await cameraManager.ptzMove(req.params.id, direction, panSpeed, tiltSpeed);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Parar movimento
app.post('/api/ptz/:id/stop', async (req, res) => {
  try {
    const result = await cameraManager.ptzStop(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Zoom
app.post('/api/ptz/:id/zoom', async (req, res) => {
  try {
    const { action, speed } = req.body;
    const result = await cameraManager.ptzZoom(req.params.id, action, speed);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Focus
app.post('/api/ptz/:id/focus', async (req, res) => {
  try {
    const { action, speed } = req.body;
    const result = await cameraManager.ptzFocus(req.params.id, action, speed);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Home
app.post('/api/ptz/:id/home', async (req, res) => {
  try {
    const result = await cameraManager.ptzHome(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Presets
app.post('/api/ptz/:id/preset/set', async (req, res) => {
  try {
    const { preset } = req.body;
    const result = await cameraManager.ptzSetPreset(req.params.id, preset);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ptz/:id/preset/goto', async (req, res) => {
  try {
    const { preset } = req.body;
    const result = await cameraManager.ptzGotoPreset(req.params.id, preset);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Snapshot / Stream ---

// Proxy de snapshot da câmera (para exibir no browser e usar no OBS)
app.get('/api/cameras/:id/snapshot', async (req, res) => {
  try {
    const imageBuffer = await streamManager.getSnapshot(req.params.id);
    const isSvg = imageBuffer.toString('utf-8', 0, 50).includes('<svg');
    res.set('Content-Type', isSvg ? 'image/svg+xml' : 'image/jpeg');
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(imageBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// MJPEG stream em tempo real de ultrabaixa latência (Browser e OBS)
app.get('/api/cameras/:id/mjpeg', (req, res) => {
  try {
    streamManager.pipeMjpeg(req.params.id, req, res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Alias amigável para stream ao vivo
app.get('/api/cameras/:id/live', (req, res) => {
  try {
    streamManager.pipeMjpeg(req.params.id, req, res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Retorna informações de stream RTSP
app.get('/api/cameras/:id/stream-info', (req, res) => {
  const camera = cameraManager.get(req.params.id);
  if (!camera) {
    return res.status(404).json({ error: 'Câmera não encontrada' });
  }
  const protocol = cameraManager.getProtocol(camera.type);
  res.json({
    rtsp: protocol.getRtspUrl(camera),
    mjpeg: `http://localhost:${PORT}/api/cameras/${req.params.id}/mjpeg`,
    snapshot: `http://localhost:${PORT}/api/cameras/${req.params.id}/snapshot`
  });
});

// --- Varredura de Rede ---

app.post('/api/scan', async (req, res) => {
  try {
    const { subnet, startIp, endIp } = req.body;
    res.json({ message: 'Varredura iniciada', scanId: networkScanner.startScan(subnet, startIp, endIp) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/scan/:scanId', (req, res) => {
  const status = networkScanner.getScanStatus(req.params.scanId);
  if (!status) {
    return res.status(404).json({ error: 'Scan não encontrado' });
  }
  res.json(status);
});

// Informações de interfaces de rede locais
app.get('/api/network-interfaces', (req, res) => {
  const interfaces = networkScanner.getAvailableInterfaces();
  const defaultSubnet = networkScanner.getLocalSubnet();
  res.json({ interfaces, defaultSubnet });
});

// --- Servir o frontend (compatível com Express 4 e 5) ---
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ============================================================
// INICIAR SERVIDOR
// ============================================================

app.listen(PORT, () => {
  console.log('');
  console.log('  ╔═══════════════════════════════════════════╗');
  console.log('  ║          🎥 PrismCam v1.0.0               ║');
  console.log('  ║   Controle PTZ & Captura de Câmeras IP    ║');
  console.log('  ╠═══════════════════════════════════════════╣');
  console.log(`  ║  🌐 Painel:  http://localhost:${PORT}        ║`);
  console.log(`  ║  📡 API:     http://localhost:${PORT}/api    ║`);
  console.log('  ╚═══════════════════════════════════════════╝');
  console.log('');

  // Abrir no navegador automaticamente
  (async () => {
    try {
      const open = (await import('open')).default;
      open(`http://localhost:${PORT}`);
    } catch (err) {
      console.log(`  Abra o navegador em: http://localhost:${PORT}`);
    }
  })();
});
