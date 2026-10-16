#  PrismCam

<p align="center">
  <img src="public/assets/icon.svg" alt="PrismCam Logo" width="140" height="140" />
</p>

<p align="center">
  <strong>Software moderno de controle PTZ, varredura de rede e captura de câmeras IP para produção de vídeo e OBS Studio.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-v18%2B-green.svg" alt="Node.js" />
  <img src="https://img.shields.io/badge/OBS%20Studio-Compatible-purple.svg" alt="OBS Studio" />
  <img src="https://img.shields.io/badge/Câmeras-Datavideo%20%7C%20ONVIF-blue.svg" alt="Datavideo & ONVIF" />
  <img src="https://img.shields.io/badge/License-MIT-orange.svg" alt="Licença MIT" />
</p>

---

## 💡 Sobre o Projeto

O **PrismCam** foi desenvolvido para simplificar a vida de operadores de streaming e transmissão ao vivo. Ele atua como um hub centralizado:
1. **Identifica câmeras Datavideo** (e outras câmeras IP compatíveis) através de varredura automática na rede local ou configuração manual de IP.
2. **Executa um servidor interno em background** que converte e disponibiliza streams de vídeo (MJPEG, RTSP e Snapshots).
3. **Oferece controle PTZ em tempo real** (Pan, Tilt, Zoom, Foco e Presets) tanto através de uma interface web premium quanto via API REST programável (ideal para automações e atalhos no OBS Studio ou Elgato Stream Deck).

---

## ✨ Funcionalidades Principais

- 🔍 **Varredura Automática de Rede:** Encontra câmeras conectadas na sua sub-rede sem precisar descobrir o IP manualmente.
- ➕ **Adição Manual de Câmeras:** Configure IPs estáticos, portas, usuário e senha em poucos segundos.
- 🔴 **Vídeo Ao Vivo no Navegador:** Streaming em tempo real integrado (RTSP para MJPEG com ultrabaixa latência e badge *AO VIVO*), permitindo monitorar e controlar o enquadramento sem atraso.
- 🕹️ **Controle PTZ Completo:**
  - Pan & Tilt em 8 direções com velocidades ajustáveis.
  - Zoom In/Out e Foco Manual (+ / -) e Automático (Auto).
  - Posição Home e chamada rápida de **Presets de 1 a 9**.
- ⌨️ **Atalhos de Teclado:** Controle PTZ ágil com `WASD` ou `Setas direcionais`, zoom com `+`/`-` ou `Q`/`E`, e números `1` a `9` para presets.
- 📺 **Integração com OBS Studio:**
  - Endpoint **MJPEG Stream** direto para fontes de Navegador (*Browser Source*).
  - URLs **RTSP** prontas para Fontes de Mídia ou Fontes de Vídeo VLC (`/live/av0` e `/live/av1`).
  - **Snapshots HTTP** atualizados continuamente.
- 🔌 **Extensibilidade de Protocolos:** Desenvolvido com padrão modular para suportar câmeras Datavideo (baseado no protocolo CGI/PTZ da Datavideo) e expansível para ONVIF, Sony VISCA over IP, PTZOptics e Panasonic.
- 🚀 **Execução com 1 Clique:** Acompanha o script `start.bat` para que o operador inicie o programa facilmente como um aplicativo.

---

## 🛠️ Tecnologias Utilizadas

- **Backend:** Node.js, Express, CORS, HTTP Proxy nativo.
- **Frontend:** HTML5 semântico, Vanilla CSS com Design System moderno (Dark theme, glassmorphism, gradientes prismáticos, layout responsivo) e JavaScript modular.
- **Protocolos de Câmera:** Datavideo HTTP/CGI API, ONVIF Profile S básico, RTSP e MJPEG multipart streaming.

---

## 🚀 Como Instalar e Rodar

### Pré-requisitos
- [Node.js](https://nodejs.org/) versão 18 ou superior instalado.

### Modo Rápido (Windows)
Basta dar um duplo clique no arquivo:
```cmd
start.bat
```
O script cuidará de instalar as dependências na primeira execução e abrirá o painel no seu navegador padrão.

---

### Modo Manual (Terminal)

1. Clone o repositório:
```bash
git clone https://github.com/AnthonyPerotti/PrismCam.git
cd PrismCam
```

2. Instale as dependências:
```bash
npm install
```

3. Inicie o servidor:
```bash
npm start
```

4. Acesse o painel pelo navegador:
```
http://localhost:4000
```

---

## 🎬 Como Integrar com o OBS Studio

### Método 1: Stream MJPEG (Recomendado para baixa latência em rede local)
1. No OBS Studio, adicione uma nova fonte do tipo **Navegador (Browser)**.
2. Copie a URL do MJPEG gerada no painel do PrismCam na aba **Integração OBS**:
   ```
   http://localhost:4000/api/cameras/{id-da-camera}/mjpeg
   ```
3. Defina a largura e altura desejadas (ex: `1920x1080` ou `1280x720`).
4. Marque a opção de recarregar a fonte quando se tornar ativa.

### Método 2: Fonte de Mídia / VLC (Stream RTSP)
1. No OBS Studio, adicione uma fonte **Fonte de Vídeo VLC** ou **Fonte de Mídia**.
2. Desmarque a opção *"Arquivo local"*.
3. Cole a URL RTSP gerada no painel do PrismCam:
   - Para Datavideo: `rtsp://<USUARIO>:<SENHA>@<IP-DA-CAMERA>:554/live/av0` (Main Stream) ou `/live/av1` (Sub Stream)
   - Para ONVIF/Genérica: `rtsp://<USUARIO>:<SENHA>@<IP-DA-CAMERA>:554/stream1`
4. Defina o buffer de rede para 100ms a 300ms para latência mínima.

---

## 📡 Referência da API REST (Automações & Stream Deck)

O PrismCam expõe uma API REST local que você pode acionar através de scripts no OBS, macros do Stream Deck ou comandos cURL:

| Método | Rota | Descrição | Parâmetros (JSON) |
|---|---|---|---|
| `GET` | `/api/cameras` | Lista todas as câmeras configuradas | - |
| `POST` | `/api/cameras` | Adiciona uma nova câmera | `{ "ip": "192.168.1.100", "name": "Palco", "type": "datavideo" }` |
| `DELETE` | `/api/cameras/:id` | Remove uma câmera | - |
| `POST` | `/api/cameras/:id/test` | Testa a conexão com a câmera | - |
| `POST` | `/api/ptz/:id/move` | Move a câmera | `{ "direction": "up", "panSpeed": 12, "tiltSpeed": 10 }` |
| `POST` | `/api/ptz/:id/stop` | Para o movimento | - |
| `POST` | `/api/ptz/:id/zoom` | Controla o zoom | `{ "action": "zoomin", "speed": 4 }` |
| `POST` | `/api/ptz/:id/focus` | Controla o foco | `{ "action": "focusnear" }` |
| `POST` | `/api/ptz/:id/home` | Retorna à posição central (Home) | - |
| `POST` | `/api/ptz/:id/preset/goto` | Move para um preset | `{ "preset": 1 }` |
| `POST` | `/api/ptz/:id/preset/set` | Salva a posição no preset | `{ "preset": 1 }` |
| `GET` | `/api/cameras/:id/snapshot` | Retorna imagem JPEG instantânea | - |
| `GET` | `/api/cameras/:id/mjpeg` | Stream multipart MJPEG contínuo em tempo real | - |
| `GET` | `/api/cameras/:id/live` | Alias para stream MJPEG ao vivo | - |
| `POST` | `/api/scan` | Dispara varredura na rede | `{ "subnet": "192.168.1", "startIp": 1, "endIp": 254 }` |

### Exemplo com cURL:
```bash
# Mover para cima:
curl -X POST http://localhost:4000/api/ptz/cam-1/move -H "Content-Type: application/json" -d "{\"direction\":\"up\"}"

# Parar movimento:
curl -X POST http://localhost:4000/api/ptz/cam-1/stop

# Ir para o Preset 2:
curl -X POST http://localhost:4000/api/ptz/cam-1/preset/goto -H "Content-Type: application/json" -d "{\"preset\":2}"
```

---

## 📂 Estrutura de Arquivos

```
PrismCam/
├── .gitignore               # Regras do Git (ignora node_modules, config local e testes)
├── README.md                # Documentação oficial
├── LICENSE                  # Licença MIT
├── package.json             # Dependências e scripts do projeto
├── start.bat                # Inicializador de duplo clique para Windows
├── public/                  # Interface Web (Frontend)
│   ├── index.html           # Layout do painel de controle
│   ├── assets/
│   │   └── icon.svg         # Ícone vetorial do PrismCam
│   ├── css/
│   │   └── style.css        # Design System dark/glassmorphic com badge AO VIVO
│   └── js/
│       └── app.js           # Lógica do painel, PTZ, stream ao vivo e varredura
└── src/                     # Backend e Serviços
    ├── server.js            # Servidor Express, rotas da API e endpoints de vídeo
    ├── stream-manager.js    # Pipeline de streaming MJPEG/RTSP em tempo real
    ├── camera-manager.js    # Gerenciador de câmeras e persistência
    ├── network-scanner.js   # Varredura de IPs e sondagem de portas
    └── protocols/           # Drivers de protocolo
        ├── datavideo.js     # Driver para câmeras Datavideo (CGI/PTZ)
        └── generic-onvif.js # Driver para câmeras ONVIF genéricas
```

---

## 🧩 Adicionando Novos Protocolos de Câmera

Para adicionar suporte a novos modelos no futuro (Sony, PTZOptics, Panasonic, etc.):
1. Crie um arquivo em `src/protocols/<nome-do-protocolo>.js` implementando os métodos:
   - `testConnection(camera)`
   - `ptzMove(camera, direction, panSpeed, tiltSpeed)`
   - `ptzStop(camera)`
   - `ptzZoom(camera, action, speed)`
   - `ptzFocus(camera, action, speed)`
   - `ptzHome(camera)`
   - `ptzGotoPreset(camera, preset)`
   - `ptzSetPreset(camera, preset)`
   - `getSnapshot(camera)`
   - `getRtspUrl(camera)`
2. Registre a classe no `src/camera-manager.js` dentro do objeto `this.protocols`.

---

## 📄 Licença

Distribuído sob a licença **MIT**. Veja o arquivo `LICENSE` ou consulte [MIT License](https://opensource.org/licenses/MIT) para mais detalhes.
