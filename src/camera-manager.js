const { v4: uuidv4 } = require('crypto');
const { DatavideoProtocol } = require('./protocols/datavideo');
const { GenericONVIFProtocol } = require('./protocols/generic-onvif');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

class CameraManager {
  constructor() {
    this.cameras = new Map();
    this.protocols = {
      datavideo: new DatavideoProtocol(),
      'generic-onvif': new GenericONVIFProtocol()
    };
    this.loadConfig();
  }

  loadConfig() {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
        if (data.cameras) {
          for (const cam of data.cameras) {
            this.cameras.set(cam.id, cam);
          }
        }
      }
    } catch (err) {
      console.log('Nenhuma configuração anterior encontrada, iniciando limpo.');
    }
  }

  saveConfig() {
    try {
      const data = {
        cameras: Array.from(this.cameras.values())
      };
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('Erro ao salvar configuração:', err.message);
    }
  }

  generateId() {
    return `cam-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  }

  getProtocol(type) {
    return this.protocols[type] || this.protocols['datavideo'];
  }

  getAll() {
    return Array.from(this.cameras.values()).map(cam => ({
      ...cam,
      password: '***' // Não expor senha na listagem
    }));
  }

  get(id) {
    return this.cameras.get(id);
  }

  async add({ ip, name, username, password, type }) {
    const id = this.generateId();
    const camera = {
      id,
      ip,
      name,
      username,
      password,
      type: type || 'datavideo',
      status: 'desconectado',
      addedAt: new Date().toISOString()
    };

    this.cameras.set(id, camera);
    this.saveConfig();

    // Testa conexão ao adicionar
    try {
      await this.testConnection(id);
    } catch (err) {
      camera.status = 'erro';
    }

    return {
      ...camera,
      password: '***'
    };
  }

  remove(id) {
    const success = this.cameras.delete(id);
    if (success) {
      this.saveConfig();
    }
    return success;
  }

  async testConnection(id) {
    const camera = this.cameras.get(id);
    if (!camera) {
      throw new Error('Câmera não encontrada');
    }

    const protocol = this.getProtocol(camera.type);
    try {
      const result = await protocol.testConnection(camera);
      camera.status = result.connected ? 'conectado' : 'erro';
      this.saveConfig();
      return { connected: result.connected, message: result.message };
    } catch (err) {
      camera.status = 'erro';
      this.saveConfig();
      throw err;
    }
  }

  async ptzMove(id, direction, panSpeed = 12, tiltSpeed = 10) {
    const camera = this.cameras.get(id);
    if (!camera) throw new Error('Câmera não encontrada');
    const protocol = this.getProtocol(camera.type);
    return await protocol.ptzMove(camera, direction, panSpeed, tiltSpeed);
  }

  async ptzStop(id) {
    const camera = this.cameras.get(id);
    if (!camera) throw new Error('Câmera não encontrada');
    const protocol = this.getProtocol(camera.type);
    return await protocol.ptzStop(camera);
  }

  async ptzZoom(id, action, speed = 4) {
    const camera = this.cameras.get(id);
    if (!camera) throw new Error('Câmera não encontrada');
    const protocol = this.getProtocol(camera.type);
    return await protocol.ptzZoom(camera, action, speed);
  }

  async ptzFocus(id, action, speed = 4) {
    const camera = this.cameras.get(id);
    if (!camera) throw new Error('Câmera não encontrada');
    const protocol = this.getProtocol(camera.type);
    return await protocol.ptzFocus(camera, action, speed);
  }

  async ptzHome(id) {
    const camera = this.cameras.get(id);
    if (!camera) throw new Error('Câmera não encontrada');
    const protocol = this.getProtocol(camera.type);
    return await protocol.ptzHome(camera);
  }

  async ptzSetPreset(id, preset) {
    const camera = this.cameras.get(id);
    if (!camera) throw new Error('Câmera não encontrada');
    const protocol = this.getProtocol(camera.type);
    return await protocol.ptzSetPreset(camera, preset);
  }

  async ptzGotoPreset(id, preset) {
    const camera = this.cameras.get(id);
    if (!camera) throw new Error('Câmera não encontrada');
    const protocol = this.getProtocol(camera.type);
    return await protocol.ptzGotoPreset(camera, preset);
  }

  async getSnapshot(id) {
    const camera = this.cameras.get(id);
    if (!camera) throw new Error('Câmera não encontrada');
    const protocol = this.getProtocol(camera.type);
    return await protocol.getSnapshot(camera);
  }
}

module.exports = { CameraManager };
