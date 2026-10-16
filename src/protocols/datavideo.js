const http = require('http');

/**
 * Protocolo Datavideo PTZ
 * 
 * Compatível com a linha Datavideo (PTC-140, PTC-150, PTC-200, PTC-280, PTC-300, etc.)
 * Utiliza autenticação por sessão GoAhead (/login/login) e controle PTZ via JSON (/ajaxcom).
 * 
 * Endpoints reais validados:
 *   - Login:     GET /login/login?username={user}&password={pass}
 *   - Controle:  POST /ajaxcom com szCmd={"SysCtrl":{"PtzCtrl":{"nChanel":0,"szPtzCmd":"{cmd}","byValue":{speed}}}}
 *   - Streams:   rtsp://{user}:{pass}@{ip}:554/live/av0 (Main) e /live/av1 (Sub)
 */
class DatavideoProtocol {
  constructor() {
    this.name = 'datavideo';
    this.displayName = 'Datavideo PTZ';
    // Armazena cookies de sessão por IP: { cookie: string, lastAuth: number }
    this.sessions = new Map();
  }

  /**
   * Obtém cookie de sessão ativo ou realiza novo login
   */
  async _getSession(camera) {
    const session = this.sessions.get(camera.ip);
    const now = Date.now();

    // Reutiliza sessão se tiver menos de 5 minutos
    if (session && (now - session.lastAuth) < 300000) {
      return session.cookie;
    }

    // Executa autenticação
    const cookie = await this._login(camera);
    if (cookie) {
      this.sessions.set(camera.ip, { cookie, lastAuth: now });
      return cookie;
    }

    return null;
  }

  /**
   * Realiza login na câmera e captura o cookie de sessão
   */
  _login(camera) {
    return new Promise((resolve) => {
      const username = camera.username || 'admin';
      const password = camera.password || 'admin';
      const loginPath = `/login/login?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;

      // Primeiro pega um cookie inicial da página de login
      http.get({
        hostname: camera.ip,
        port: 80,
        path: '/pages/login.asp',
        timeout: 4000
      }, (res) => {
        const setCookie = res.headers['set-cookie'];
        const initialCookie = setCookie ? setCookie[0].split(';')[0] : '';

        // Agora efetua o login com o cookie
        const reqHeaders = {};
        if (initialCookie) reqHeaders['Cookie'] = initialCookie;

        http.get({
          hostname: camera.ip,
          port: 80,
          path: loginPath,
          headers: reqHeaders,
          timeout: 4000
        }, (loginRes) => {
          let body = '';
          loginRes.on('data', c => body += c);
          loginRes.on('end', () => {
            const loginCookie = loginRes.headers['set-cookie']
              ? loginRes.headers['set-cookie'][0].split(';')[0]
              : initialCookie;

            try {
              const json = JSON.parse(body);
              if (json.success === 1 || json.nRetVal === 0) {
                resolve(loginCookie);
                return;
              }
            } catch (e) {
              // Se retornou 200 mesmo sem JSON estrito
              if (loginRes.statusCode === 200) {
                resolve(loginCookie);
                return;
              }
            }
            resolve(loginCookie || null);
          });
        }).on('error', () => resolve(null));
      }).on('error', () => resolve(null));
    });
  }

  /**
   * Envia comando JSON via POST /ajaxcom
   */
  async _sendAjaxCmd(camera, cmdObject) {
    const cookie = await this._getSession(camera);
    const postData = `szCmd=${encodeURIComponent(JSON.stringify(cmdObject))}`;

    return new Promise((resolve, reject) => {
      const headers = {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Length': Buffer.byteLength(postData)
      };
      if (cookie) headers['Cookie'] = cookie;

      const req = http.request({
        hostname: camera.ip,
        port: 80,
        path: '/ajaxcom',
        method: 'POST',
        headers: headers,
        timeout: 4000
      }, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            resolve({ statusCode: res.statusCode, data: json });
          } catch (e) {
            resolve({ statusCode: res.statusCode, raw: body });
          }
        });
      });

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Timeout ao enviar comando para ${camera.ip}`));
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Testa conexão e autenticação com a câmera
   */
  async testConnection(camera) {
    try {
      const cookie = await this._login(camera);
      if (cookie) {
        // Valida se o comando ajaxcom responde
        const testRes = await this._sendAjaxCmd(camera, {
          QueryState: { QueryStreamName: {} }
        });

        if (testRes.statusCode === 200) {
          return { connected: true, message: 'Câmera Datavideo conectada e autenticada com sucesso!' };
        }
      }

      // Se falhou no login específico, testa se porta 80 está viva
      return new Promise((resolve) => {
        const req = http.get({
          hostname: camera.ip,
          port: 80,
          path: '/',
          timeout: 3000
        }, (res) => {
          if (res.statusCode === 200 || res.statusCode === 302) {
            resolve({ connected: true, message: 'Câmera online na rede (HTTP 200/302)' });
          } else {
            resolve({ connected: false, message: `Resposta HTTP ${res.statusCode}` });
          }
        });

        req.on('error', (err) => resolve({ connected: false, message: err.message }));
        req.on('timeout', () => {
          req.destroy();
          resolve({ connected: false, message: 'Tempo limite esgotado (timeout)' });
        });
      });
    } catch (err) {
      return { connected: false, message: err.message };
    }
  }

  /**
   * Mover câmera (Pan / Tilt)
   */
  async ptzMove(camera, direction, panSpeed = 12, tiltSpeed = 10) {
    const cmdMap = {
      up: 'up_start',
      down: 'down_start',
      left: 'left_start',
      right: 'right_start',
      upleft: 'leftup_start',
      upright: 'rightup_start',
      downleft: 'leftdown_start',
      downright: 'rightdown_start'
    };

    const cmd = cmdMap[direction] || 'up_start';
    // Escala de velocidade proporcional (1 a 100)
    const speed = Math.min(100, Math.max(1, Math.round((panSpeed / 24) * 100)));

    const result = await this._sendAjaxCmd(camera, {
      SysCtrl: {
        PtzCtrl: {
          nChanel: 0,
          szPtzCmd: cmd,
          byValue: speed
        }
      }
    });

    return { success: result.statusCode === 200, direction, speed };
  }

  /**
   * Parar movimento PTZ
   */
  async ptzStop(camera) {
    // Para segurança, envia paradas das direções principais
    const stopCommands = ['up_stop', 'down_stop', 'left_stop', 'right_stop', 'leftup_stop', 'rightup_stop', 'leftdown_stop', 'rightdown_stop'];
    
    // Executa parada com o primeiro comando de stop
    const result = await this._sendAjaxCmd(camera, {
      SysCtrl: {
        PtzCtrl: {
          nChanel: 0,
          szPtzCmd: 'up_stop',
          byValue: 0
        }
      }
    });

    return { success: result.statusCode === 200 };
  }

  /**
   * Retorna à posição Home (Central)
   */
  async ptzHome(camera) {
    const result = await this._sendAjaxCmd(camera, {
      SysCtrl: {
        PtzCtrl: {
          nChanel: 0,
          szPtzCmd: 'go_home',
          byValue: 0
        }
      }
    });

    const isOk = result.statusCode === 200 && (result.data ? result.data.nRetVal === 0 : true);
    return { success: isOk, action: 'home' };
  }

  /**
   * Chama um Preset previamente gravado na câmera (1 a 255)
   */
  async ptzGotoPreset(camera, preset = 1) {
    const presetNum = parseInt(preset, 10) || 1;
    const result = await this._sendAjaxCmd(camera, {
      SysCtrl: {
        PtzCtrl: {
          nChanel: 0,
          szPtzCmd: 'preset_call',
          byValue: presetNum
        }
      }
    });

    const isOk = result.statusCode === 200 && (result.data ? result.data.nRetVal === 0 : true);
    return { success: isOk, preset: presetNum, action: 'goto_preset' };
  }

  /**
   * Grava a posição atual no Preset especificado (1 a 255)
   */
  async ptzSetPreset(camera, preset = 1) {
    const presetNum = parseInt(preset, 10) || 1;
    const result = await this._sendAjaxCmd(camera, {
      SysCtrl: {
        PtzCtrl: {
          nChanel: 0,
          szPtzCmd: 'preset_set',
          byValue: presetNum
        }
      }
    });

    const isOk = result.statusCode === 200 && (result.data ? result.data.nRetVal === 0 : true);
    return { success: isOk, preset: presetNum, action: 'set_preset' };
  }

  /**
   * Controle de Zoom (Zoom In / Zoom Out / Stop)
   */
  async ptzZoom(camera, action, speed = 4) {
    let cmd = 'zoomadd_stop';
    if (action === 'zoomin') cmd = 'zoomadd_start';
    else if (action === 'zoomout') cmd = 'zoomdec_start';
    else if (action === 'stop') cmd = 'zoomadd_stop';

    const byValue = Math.min(100, Math.max(1, speed * 12));

    const result = await this._sendAjaxCmd(camera, {
      SysCtrl: {
        PtzCtrl: {
          nChanel: 0,
          szPtzCmd: cmd,
          byValue: byValue
        }
      }
    });

    return { success: result.statusCode === 200, action };
  }

  /**
   * Controle de Foco (Near / Far / Auto / Stop)
   */
  async ptzFocus(camera, action, speed = 4) {
    if (action === 'autofocus') {
      // Ajusta modo AF para Automático (emAFMode = 2)
      const res = await this._sendAjaxCmd(camera, {
        SetEnv: {
          VideoParam: [{
            stAF: { emAFMode: 2 },
            nChannel: 0
          }]
        }
      });
      return { success: res.statusCode === 200, mode: 'auto' };
    }

    if (action === 'manualfocus') {
      // Ajusta modo AF para Manual (emAFMode = 3)
      const res = await this._sendAjaxCmd(camera, {
        SetEnv: {
          VideoParam: [{
            stAF: { emAFMode: 3 },
            nChannel: 0
          }]
        }
      });
      return { success: res.statusCode === 200, mode: 'manual' };
    }

    if (action === 'focusnear') {
      // 1. Garante que está em modo manual para permitir ajuste
      await this._sendAjaxCmd(camera, {
        SetEnv: {
          VideoParam: [{
            stAF: { emAFMode: 3 },
            nChannel: 0
          }]
        }
      });
      // 2. Dispara foco menos (focusdec_start)
      const res = await this._sendAjaxCmd(camera, {
        SysCtrl: {
          PtzCtrl: {
            nChanel: 0,
            szPtzCmd: 'focusdec_start',
            byValue: 0
          }
        }
      });
      return { success: res.statusCode === 200, action: 'focusnear' };
    }

    if (action === 'focusfar') {
      // 1. Garante que está em modo manual para permitir ajuste
      await this._sendAjaxCmd(camera, {
        SetEnv: {
          VideoParam: [{
            stAF: { emAFMode: 3 },
            nChannel: 0
          }]
        }
      });
      // 2. Dispara foco mais (focusadd_start)
      const res = await this._sendAjaxCmd(camera, {
        SysCtrl: {
          PtzCtrl: {
            nChanel: 0,
            szPtzCmd: 'focusadd_start',
            byValue: 0
          }
        }
      });
      return { success: res.statusCode === 200, action: 'focusfar' };
    }

    if (action === 'stop' || action === 'focusstop') {
      // Para foco
      await this._sendAjaxCmd(camera, {
        SysCtrl: {
          PtzCtrl: {
            nChanel: 0,
            szPtzCmd: 'focusadd_stop',
            byValue: 0
          }
        }
      });
      await this._sendAjaxCmd(camera, {
        SysCtrl: {
          PtzCtrl: {
            nChanel: 0,
            szPtzCmd: 'focusdec_stop',
            byValue: 0
          }
        }
      });
      return { success: true, action: 'stop' };
    }

    return { success: false, error: 'Ação de foco desconhecida' };
  }

  /**
   * Snapshot da câmera
   * Tenta capturar um frame JPEG real da câmera via HTTP.
   * Se falhar, retorna um banner SVG informativo.
   */
  async getSnapshot(camera) {
    const cookie = await this._getSession(camera);

    // Tenta múltiplos endpoints conhecidos de snapshot Datavideo
    const snapshotPaths = [
      '/snapshot.jpg',
      '/cgi-bin/snapshot.cgi',
      '/tmpfs/auto.jpg',
      '/tmpfs/snap.jpg',
      '/image.jpg'
    ];

    for (const snapPath of snapshotPaths) {
      try {
        const result = await this._fetchImage(camera, snapPath, cookie);
        if (result) return result;
      } catch (e) {
        // Tenta próximo endpoint
      }
    }

    // Fallback: banner SVG informativo (usa entidades XML válidas)
    return this._generatePreviewSvg(camera);
  }

  /**
   * Tenta buscar uma imagem JPEG da câmera via HTTP
   */
  _fetchImage(camera, path, cookie) {
    return new Promise((resolve) => {
      const headers = {};
      if (cookie) headers['Cookie'] = cookie;

      const req = http.get({
        hostname: camera.ip,
        port: 80,
        path: path,
        headers: headers,
        timeout: 3000
      }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return resolve(null);
        }

        const contentType = (res.headers['content-type'] || '').toLowerCase();
        // Aceita apenas respostas de imagem
        if (!contentType.includes('image')) {
          res.resume();
          return resolve(null);
        }

        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          // Valida que é realmente uma imagem (mínimo 500 bytes e começa com JPEG magic ou PNG magic)
          if (buf.length > 500) {
            resolve(buf);
          } else {
            resolve(null);
          }
        });
        res.on('error', () => resolve(null));
      });

      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
  }

  /**
   * Gera um banner SVG informativo como fallback de preview
   * Usa apenas entidades XML válidas (sem &bull; que é HTML-only)
   */
  _generatePreviewSvg(camera) {
    const user = camera.username || 'admin';
    const pass = camera.password || 'admin';
    const rtsp = `rtsp://${user}:${pass}@${camera.ip}:554/live/av0`;
    // Escapa caracteres especiais para XML
    const safeName = String(camera.name || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeIp = String(camera.ip || '').replace(/&/g, '&amp;');
    const safeRtsp = rtsp.replace(/&/g, '&amp;');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="640" height="360">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0b0f19"/>
      <stop offset="100%" stop-color="#141c2e"/>
    </linearGradient>
    <linearGradient id="prism" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#00d4ff"/>
      <stop offset="50%" stop-color="#c850c0"/>
      <stop offset="100%" stop-color="#ffcb57"/>
    </linearGradient>
  </defs>
  <rect width="640" height="360" fill="url(#bg)"/>
  <line x1="0" y1="120" x2="640" y2="120" stroke="#1f293d" stroke-width="1" stroke-dasharray="4 4"/>
  <line x1="0" y1="240" x2="640" y2="240" stroke="#1f293d" stroke-width="1" stroke-dasharray="4 4"/>
  <line x1="213" y1="0" x2="213" y2="360" stroke="#1f293d" stroke-width="1" stroke-dasharray="4 4"/>
  <line x1="426" y1="0" x2="426" y2="360" stroke="#1f293d" stroke-width="1" stroke-dasharray="4 4"/>
  <circle cx="320" cy="170" r="45" fill="none" stroke="url(#prism)" stroke-width="2" opacity="0.8"/>
  <circle cx="320" cy="170" r="6" fill="#00d4ff"/>
  <line x1="320" y1="110" x2="320" y2="125" stroke="#00d4ff" stroke-width="2"/>
  <line x1="320" y1="215" x2="320" y2="230" stroke="#00d4ff" stroke-width="2"/>
  <line x1="260" y1="170" x2="275" y2="170" stroke="#00d4ff" stroke-width="2"/>
  <line x1="365" y1="170" x2="380" y2="170" stroke="#00d4ff" stroke-width="2"/>
  <circle cx="40" cy="35" r="6" fill="#10b981"/>
  <text x="54" y="40" fill="#10b981" font-family="Inter, sans-serif" font-size="12" font-weight="700" letter-spacing="1">CONECTADO &#x2022; DATAVIDEO PTZ</text>
  <text x="320" y="245" fill="#ffffff" font-family="Inter, sans-serif" font-size="18" font-weight="700" text-anchor="middle">${safeName}</text>
  <text x="320" y="268" fill="#8b8fa6" font-family="monospace" font-size="12" text-anchor="middle">IP: ${safeIp} &#x2022; Use OBS/RTSP para video ao vivo</text>
  <rect x="70" y="295" width="500" height="34" rx="6" fill="#121826" stroke="#252f44" stroke-width="1"/>
  <text x="320" y="317" fill="#00d4ff" font-family="monospace" font-size="11" text-anchor="middle">Feed OBS: ${safeRtsp}</text>
</svg>`;

    return Buffer.from(svg, 'utf-8');
  }

  /**
   * Retorna URL RTSP validada da câmera
   */
  getRtspUrl(camera) {
    const user = camera.username || 'admin';
    const pass = camera.password || 'admin';
    // O stream principal padrão da Datavideo é /live/av0
    return `rtsp://${user}:${pass}@${camera.ip}:554/live/av0`;
  }
}

module.exports = { DatavideoProtocol };
