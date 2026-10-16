const { spawn } = require('child_process');
const EventEmitter = require('events');

let ffmpegPath = 'ffmpeg';
try {
  const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
  if (ffmpegInstaller && ffmpegInstaller.path) {
    ffmpegPath = ffmpegInstaller.path;
  }
} catch (e) {
  // Fallback para ffmpeg do sistema
}

/**
 * StreamManager
 * Gerencia pipelines de transcodificação RTSP -> MJPEG em tempo real
 * com suporte a múltiplos clientes conectados simultâneos por câmera
 * e modos de qualidade selecionáveis (HD 1080p e SD ultraleve).
 */
class StreamManager extends EventEmitter {
  constructor(cameraManager) {
    super();
    this.cameraManager = cameraManager;
    // Map de streamKey (`${cameraId}:${quality}`) -> { proc, clients: Set<res>, lastFrame: Buffer, stopTimer: Timer }
    this.streams = new Map();
  }

  /**
   * Conecta um cliente HTTP ao stream MJPEG ao vivo da câmera
   * @param {string} cameraId
   * @param {'hd'|'sd'} quality
   */
  pipeMjpeg(cameraId, quality = 'hd', req, res) {
    const q = (quality || 'hd').toLowerCase() === 'sd' ? 'sd' : 'hd';
    const camera = this.cameraManager.get(cameraId);
    if (!camera) {
      return res.status(404).json({ error: 'Câmera não encontrada' });
    }

    const streamKey = `${cameraId}:${q}`;

    // Configura headers para MJPEG multipart
    res.writeHead(200, {
      'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'close',
      'Pragma': 'no-cache',
      'Expires': '0'
    });

    let stream = this.streams.get(streamKey);

    // Se já temos um frame recente em cache desse stream, envia imediatamente
    if (stream && stream.lastFrame) {
      try {
        res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${stream.lastFrame.length}\r\n\r\n`);
        res.write(stream.lastFrame);
        res.write('\r\n');
      } catch (e) {}
    }

    // Inicia stream se não estiver ativo
    if (!stream) {
      stream = this._startCameraStream(camera, q, streamKey);
      this.streams.set(streamKey, stream);
    } else if (stream.stopTimer) {
      // Cancela encerramento agendado se novo cliente chegou
      clearTimeout(stream.stopTimer);
      stream.stopTimer = null;
    }

    // Adiciona cliente à lista
    stream.clients.add(res);

    // Remove cliente quando a conexão fechar
    const cleanup = () => {
      if (stream && stream.clients) {
        stream.clients.delete(res);
        // Se não houver mais clientes, agenda o encerramento após 5 segundos
        if (stream.clients.size === 0) {
          if (!stream.stopTimer) {
            stream.stopTimer = setTimeout(() => {
              this._stopCameraStream(streamKey);
            }, 5000);
          }
        }
      }
    };

    req.on('close', cleanup);
    res.on('finish', cleanup);
    res.on('error', cleanup);
  }

  /**
   * Obtém o frame mais recente em cache ou realiza captura rápida de 1 frame
   */
  async getSnapshot(cameraId, quality = 'hd') {
    const q = (quality || 'hd').toLowerCase() === 'sd' ? 'sd' : 'hd';
    const streamKey = `${cameraId}:${q}`;
    const stream = this.streams.get(streamKey);

    if (stream && stream.lastFrame && (Date.now() - stream.lastFrameTime) < 3000) {
      return stream.lastFrame;
    }

    const camera = this.cameraManager.get(cameraId);
    if (!camera) {
      throw new Error('Câmera não encontrada');
    }

    // Se o protocolo tiver método snapshot próprio, tenta ele primeiro
    const protocol = this.cameraManager.getProtocol(camera.type);
    if (protocol && protocol.getSnapshot) {
      try {
        const snap = await protocol.getSnapshot(camera);
        const isSvg = snap && snap.toString('utf-8', 0, 50).includes('<svg');
        if (!isSvg) return snap;
      } catch (e) {}
    }

    // Captura um frame pontual via FFmpeg da URL RTSP
    return this._captureSingleFrame(camera, q);
  }

  /**
   * Inicia processo FFmpeg para captura contínua de frames RTSP -> MJPEG
   */
  _startCameraStream(camera, quality, streamKey) {
    const protocol = this.cameraManager.getProtocol(camera.type);
    let rtspUrl = protocol ? protocol.getRtspUrl(camera) : `rtsp://${camera.ip}:554/live/av0`;

    // Datavideo: live/av0 é Main Stream (Full HD 1080p), live/av1 é Sub Stream (SD)
    if (camera.type === 'datavideo') {
      if (quality === 'sd') {
        rtspUrl = rtspUrl.replace('/live/av0', '/live/av1');
      } else {
        rtspUrl = rtspUrl.replace('/live/av1', '/live/av0');
      }
    }

    const fps = quality === 'hd' ? '20' : '15';
    const qscale = quality === 'hd' ? '3' : '4';

    console.log(`[StreamManager] Iniciando stream ${quality.toUpperCase()} para câmera ${camera.id} (${camera.ip})...`);

    const args = [
      '-rtsp_transport', 'tcp',
      '-stimeout', '5000000',
      '-i', rtspUrl,
      '-an',
      '-c:v', 'mjpeg',
      '-q:v', qscale,
      '-r', fps,
      '-f', 'image2pipe',
      '-'
    ];

    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    const streamData = {
      proc,
      quality,
      clients: new Set(),
      lastFrame: null,
      lastFrameTime: 0,
      stopTimer: null
    };

    let buffer = Buffer.alloc(0);

    proc.stdout.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      while (true) {
        const startIndex = buffer.indexOf(Buffer.from([0xFF, 0xD8]));
        if (startIndex === -1) {
          buffer = Buffer.alloc(0);
          break;
        }

        const endIndex = buffer.indexOf(Buffer.from([0xFF, 0xD9]), startIndex + 2);
        if (endIndex === -1) {
          if (startIndex > 0) {
            buffer = buffer.slice(startIndex);
          }
          break;
        }

        const frame = buffer.slice(startIndex, endIndex + 2);
        buffer = buffer.slice(endIndex + 2);

        streamData.lastFrame = frame;
        streamData.lastFrameTime = Date.now();

        // Envia para todos os clientes conectados
        const header = `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`;
        for (const client of streamData.clients) {
          try {
            client.write(header);
            client.write(frame);
            client.write('\r\n');
          } catch (err) {
            streamData.clients.delete(client);
          }
        }
      }
    });

    proc.on('close', (code) => {
      console.log(`[StreamManager] Stream ${streamKey} encerrado (código: ${code})`);
      if (this.streams.get(streamKey) === streamData) {
        this.streams.delete(streamKey);
      }
    });

    proc.on('error', (err) => {
      console.error(`[StreamManager] Erro no FFmpeg (${streamKey}):`, err.message);
    });

    return streamData;
  }

  /**
   * Encerra processo de stream de uma câmera
   */
  _stopCameraStream(streamKey) {
    const stream = this.streams.get(streamKey);
    if (!stream) return;

    console.log(`[StreamManager] Encerrando stream ocioso (${streamKey})...`);
    try {
      if (stream.proc && !stream.proc.killed) {
        stream.proc.kill('SIGTERM');
      }
    } catch (e) {}

    this.streams.delete(streamKey);
  }

  /**
   * Captura 1 frame rápido de uma câmera via RTSP
   */
  _captureSingleFrame(camera, quality = 'hd') {
    return new Promise((resolve) => {
      const protocol = this.cameraManager.getProtocol(camera.type);
      let rtspUrl = protocol ? protocol.getRtspUrl(camera) : `rtsp://${camera.ip}:554/live/av0`;

      if (camera.type === 'datavideo') {
        if (quality === 'sd') {
          rtspUrl = rtspUrl.replace('/live/av0', '/live/av1');
        } else {
          rtspUrl = rtspUrl.replace('/live/av1', '/live/av0');
        }
      }

      const args = [
        '-rtsp_transport', 'tcp',
        '-stimeout', '4000000',
        '-i', rtspUrl,
        '-an',
        '-frames:v', '1',
        '-q:v', '3',
        '-f', 'image2pipe',
        '-'
      ];

      const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'ignore'] });
      const chunks = [];

      proc.stdout.on('data', chunk => chunks.push(chunk));
      proc.on('close', (code) => {
        if (code === 0 && chunks.length > 0) {
          resolve(Buffer.concat(chunks));
        } else {
          const fallbackProtocol = this.cameraManager.getProtocol('datavideo');
          resolve(fallbackProtocol ? fallbackProtocol._generatePreviewSvg(camera) : Buffer.from(''));
        }
      });
      proc.on('error', () => {
        const fallbackProtocol = this.cameraManager.getProtocol('datavideo');
        resolve(fallbackProtocol ? fallbackProtocol._generatePreviewSvg(camera) : Buffer.from(''));
      });
    });
  }
}

module.exports = StreamManager;
