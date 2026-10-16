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
 * com suporte a múltiplos clientes conectados simultâneos por câmera.
 */
class StreamManager extends EventEmitter {
  constructor(cameraManager) {
    super();
    this.cameraManager = cameraManager;
    // Map de cameraId -> { proc, clients: Set<res>, lastFrame: Buffer, stopTimer: Timer }
    this.streams = new Map();
  }

  /**
   * Conecta um cliente HTTP ao stream MJPEG ao vivo da câmera
   */
  pipeMjpeg(cameraId, req, res) {
    const camera = this.cameraManager.get(cameraId);
    if (!camera) {
      return res.status(404).json({ error: 'Câmera não encontrada' });
    }

    // Configura headers para MJPEG multipart
    res.writeHead(200, {
      'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'close',
      'Pragma': 'no-cache',
      'Expires': '0'
    });

    let stream = this.streams.get(cameraId);

    // Se já temos um frame recente em cache, envia imediatamente para o cliente ver na hora
    if (stream && stream.lastFrame) {
      try {
        res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${stream.lastFrame.length}\r\n\r\n`);
        res.write(stream.lastFrame);
        res.write('\r\n');
      } catch (e) {}
    }

    // Inicia stream se não estiver ativo
    if (!stream) {
      stream = this._startCameraStream(camera);
      this.streams.set(cameraId, stream);
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
        // Se não houver mais clientes, agenda o encerramento do stream após 5 segundos
        if (stream.clients.size === 0) {
          if (!stream.stopTimer) {
            stream.stopTimer = setTimeout(() => {
              this._stopCameraStream(cameraId);
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
  async getSnapshot(cameraId) {
    const stream = this.streams.get(cameraId);
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
        // Se não for SVG (é uma imagem real), retorna
        const isSvg = snap && snap.toString('utf-8', 0, 50).includes('<svg');
        if (!isSvg) return snap;
      } catch (e) {}
    }

    // Captura um frame pontual via FFmpeg da URL RTSP
    return this._captureSingleFrame(camera);
  }

  /**
   * Inicia processo FFmpeg para captura contínua de frames RTSP -> MJPEG
   */
  _startCameraStream(camera) {
    const protocol = this.cameraManager.getProtocol(camera.type);
    // Usa live/av1 (sub-stream mais rápido e leve para preview) ou a URL padrão
    let rtspUrl = protocol ? protocol.getRtspUrl(camera) : `rtsp://${camera.ip}:554/live/av0`;
    
    // Tenta sub-stream se for Datavideo para ter latência ultrabaixa
    if (camera.type === 'datavideo' && rtspUrl.includes('/live/av0')) {
      rtspUrl = rtspUrl.replace('/live/av0', '/live/av1');
    }

    console.log(`[StreamManager] Iniciando stream ao vivo para câmera ${camera.id} (${camera.ip})...`);

    const args = [
      '-rtsp_transport', 'tcp',
      '-stimeout', '5000000',
      '-i', rtspUrl,
      '-an',
      '-c:v', 'mjpeg',
      '-q:v', '4',
      '-r', '15',
      '-f', 'image2pipe',
      '-'
    ];

    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    const streamData = {
      proc,
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
      console.log(`[StreamManager] Stream da câmera ${camera.id} encerrado (código: ${code})`);
      if (this.streams.get(camera.id) === streamData) {
        this.streams.delete(camera.id);
      }
    });

    proc.on('error', (err) => {
      console.error(`[StreamManager] Erro no processo FFmpeg da câmera ${camera.id}:`, err.message);
    });

    return streamData;
  }

  /**
   * Encerra processo de stream de uma câmera
   */
  _stopCameraStream(cameraId) {
    const stream = this.streams.get(cameraId);
    if (!stream) return;

    console.log(`[StreamManager] Encerrando stream ocioso da câmera ${cameraId}...`);
    try {
      if (stream.proc && !stream.proc.killed) {
        stream.proc.kill('SIGTERM');
      }
    } catch (e) {}

    this.streams.delete(cameraId);
  }

  /**
   * Captura 1 frame rápido de uma câmera via RTSP
   */
  _captureSingleFrame(camera) {
    return new Promise((resolve) => {
      const protocol = this.cameraManager.getProtocol(camera.type);
      const rtspUrl = protocol ? protocol.getRtspUrl(camera) : `rtsp://${camera.ip}:554/live/av0`;

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
          // Fallback final: SVG banner
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
