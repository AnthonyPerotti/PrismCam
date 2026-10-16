const http = require('http');

/**
 * Protocolo Genérico ONVIF - Para câmeras IP genéricas
 * 
 * Placeholder para expansão futura.
 * Implementação simplificada usando CGI padrão comum em câmeras IP genéricas.
 */
class GenericONVIFProtocol {
  constructor() {
    this.name = 'generic-onvif';
    this.displayName = 'Câmera IP Genérica (ONVIF)';
  }

  _makeRequest(camera, path, options = {}) {
    return new Promise((resolve, reject) => {
      const timeout = options.timeout || 5000;

      const reqOptions = {
        hostname: camera.ip,
        port: 80,
        path: path,
        method: 'GET',
        timeout: timeout,
        headers: {}
      };

      if (camera.username && camera.password) {
        const auth = Buffer.from(`${camera.username}:${camera.password}`).toString('base64');
        reqOptions.headers['Authorization'] = `Basic ${auth}`;
      }

      const req = http.request(reqOptions, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: buffer,
            text: buffer.toString('utf-8')
          });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Timeout ao conectar com ${camera.ip}`));
      });

      req.on('error', (err) => {
        reject(new Error(`Erro de conexão com ${camera.ip}: ${err.message}`));
      });

      req.end();
    });
  }

  async testConnection(camera) {
    try {
      const response = await this._makeRequest(camera, '/', { timeout: 5000 });
      return {
        connected: response.statusCode === 200,
        message: response.statusCode === 200 ? 'Conectado' : `HTTP ${response.statusCode}`
      };
    } catch (err) {
      return { connected: false, message: err.message };
    }
  }

  // Os métodos PTZ retornam erro amigável informando que suporte completo será implementado
  async ptzMove(camera, direction, panSpeed, tiltSpeed) {
    return { success: false, message: 'Controle PTZ genérico ONVIF será implementado em versão futura' };
  }

  async ptzStop(camera) {
    return { success: false, message: 'Controle PTZ genérico ONVIF será implementado em versão futura' };
  }

  async ptzZoom(camera, action, speed) {
    return { success: false, message: 'Controle PTZ genérico ONVIF será implementado em versão futura' };
  }

  async ptzFocus(camera, action, speed) {
    return { success: false, message: 'Controle PTZ genérico ONVIF será implementado em versão futura' };
  }

  async ptzHome(camera) {
    return { success: false, message: 'Controle PTZ genérico ONVIF será implementado em versão futura' };
  }

  async ptzSetPreset(camera, preset) {
    return { success: false, message: 'Controle PTZ genérico ONVIF será implementado em versão futura' };
  }

  async ptzGotoPreset(camera, preset) {
    return { success: false, message: 'Controle PTZ genérico ONVIF será implementado em versão futura' };
  }

  async getSnapshot(camera) {
    // Tenta URLs comuns de snapshot
    const paths = ['/snapshot.jpg', '/snap.jpg', '/capture.jpg', '/cgi-bin/snapshot.cgi'];
    for (const p of paths) {
      try {
        const response = await this._makeRequest(camera, p, { timeout: 5000 });
        if (response.statusCode === 200) {
          return response.body;
        }
      } catch (err) {
        continue;
      }
    }
    throw new Error('Não foi possível capturar snapshot desta câmera');
  }

  getRtspUrl(camera) {
    if (camera.username && camera.password) {
      return `rtsp://${camera.username}:${camera.password}@${camera.ip}:554/stream1`;
    }
    return `rtsp://${camera.ip}:554/stream1`;
  }
}

module.exports = { GenericONVIFProtocol };
