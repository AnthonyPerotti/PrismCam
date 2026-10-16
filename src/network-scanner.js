const net = require('net');
const http = require('http');

class NetworkScanner {
  constructor() {
    this.scans = new Map();
  }

  /**
   * Lista todas as interfaces de rede IPv4 disponíveis
   */
  getAvailableInterfaces() {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    const result = [];

    const virtualKeywords = ['tailscale', 'vethernet', 'hyper-v', 'wsl', 'virtualbox', 'vmware', 'zerotier', 'tap', 'vpn'];

    for (const [name, addrs] of Object.entries(interfaces)) {
      for (const addr of addrs) {
        if (addr.family === 'IPv4' && !addr.internal) {
          const parts = addr.address.split('.');
          const subnet = `${parts[0]}.${parts[1]}.${parts[2]}`;
          const isVirtual = virtualKeywords.some(kw => name.toLowerCase().includes(kw)) || addr.address.startsWith('100.');

          result.push({
            name,
            ip: addr.address,
            netmask: addr.netmask,
            subnet,
            isVirtual
          });
        }
      }
    }

    // Ordena colocando interfaces físicas em primeiro lugar
    return result.sort((a, b) => (a.isVirtual ? 1 : 0) - (b.isVirtual ? 1 : 0));
  }

  /**
   * Detecta a sub-rede física padrão do sistema
   */
  getLocalSubnet() {
    const available = this.getAvailableInterfaces();
    if (available.length > 0) {
      return available[0].subnet;
    }
    return '192.168.1';
  }

  /**
   * Inicia uma varredura de rede em background
   */
  startScan(subnet, startIp = 1, endIp = 254) {
    const scanId = `scan-${Date.now()}`;
    subnet = subnet || this.getLocalSubnet();
    startIp = parseInt(startIp) || 1;
    endIp = parseInt(endIp) || 254;

    const scan = {
      id: scanId,
      subnet,
      startIp,
      endIp,
      status: 'scanning',
      progress: 0,
      found: [],
      total: endIp - startIp + 1,
      scanned: 0,
      startedAt: new Date().toISOString()
    };

    this.scans.set(scanId, scan);
    this._runScan(scan);

    return scanId;
  }

  getScanStatus(scanId) {
    return this.scans.get(scanId);
  }

  /**
   * Executa a varredura testando portas comuns de câmeras
   */
  async _runScan(scan) {
    const CONCURRENT_LIMIT = 20;
    const ipsToScan = [];

    for (let i = scan.startIp; i <= scan.endIp; i++) {
      ipsToScan.push(`${scan.subnet}.${i}`);
    }

    // Processa em lotes paralelos
    for (let i = 0; i < ipsToScan.length; i += CONCURRENT_LIMIT) {
      const batch = ipsToScan.slice(i, i + CONCURRENT_LIMIT);
      const promises = batch.map(ip => this._probeCamera(ip));
      const results = await Promise.allSettled(promises);

      for (const result of results) {
        scan.scanned++;
        scan.progress = Math.round((scan.scanned / scan.total) * 100);
        if (result.status === 'fulfilled' && result.value) {
          scan.found.push(result.value);
        }
      }
    }

    scan.status = 'completed';
    scan.completedAt = new Date().toISOString();
  }

  /**
   * Testa se um IP específico é uma câmera Datavideo
   */
  async _probeCamera(ip) {
    // Primeiro testa se a porta 80 está aberta
    const portOpen = await this._testPort(ip, 80, 800);
    if (!portOpen) return null;

    // Tenta identificar como câmera Datavideo
    try {
      const result = await this._httpGet(ip, '/cgi-bin/param.cgi?get_media_view', 2000);
      if (result.statusCode === 200 || result.statusCode === 401) {
        return {
          ip,
          type: 'datavideo',
          name: `Datavideo PTZ (${ip})`,
          authenticated: result.statusCode === 200,
          detectedAt: new Date().toISOString()
        };
      }
    } catch (err) {
      // Não é Datavideo, tenta identificação genérica
    }

    // Tenta snapshot genérico
    try {
      const result = await this._httpGet(ip, '/snapshot.jpg', 2000);
      if (result.statusCode === 200 && result.headers['content-type']?.includes('image')) {
        return {
          ip,
          type: 'datavideo',
          name: `Câmera IP (${ip})`,
          authenticated: true,
          detectedAt: new Date().toISOString()
        };
      }
    } catch (err) {
      // Ignora
    }

    // Testa porta RTSP (554)
    const rtspOpen = await this._testPort(ip, 554, 800);
    if (rtspOpen) {
      return {
        ip,
        type: 'generic-onvif',
        name: `Câmera IP (${ip})`,
        authenticated: false,
        detectedAt: new Date().toISOString()
      };
    }

    return null;
  }

  /**
   * Testa se uma porta TCP está aberta
   */
  _testPort(ip, port, timeout = 1000) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(timeout);

      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });

      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });

      socket.connect(port, ip);
    });
  }

  /**
   * Faz uma requisição HTTP GET simples
   */
  _httpGet(ip, path, timeout = 3000) {
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: ip,
        port: 80,
        path: path,
        method: 'GET',
        timeout: timeout
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks)
          });
        });
      });

      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.on('error', (err) => reject(err));
      req.end();
    });
  }
}

module.exports = { NetworkScanner };
