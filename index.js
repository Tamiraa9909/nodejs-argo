#!/usr/bin/env node

const http = require('http');
const WebSocket = require('ws');
const net = require('net');
const dgram = require('dgram');
const url = require('url');
const axios = require('axios');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);

// ==================== ENVIRONMENT VARIABLES ====================
const UPLOAD_URL = process.env.UPLOAD_URL || '';
const PROJECT_URL = process.env.PROJECT_URL || '';
const FILE_PATH = process.env.FILE_PATH || '.tmp';
const SUB_PATH = process.env.SUB_PATH || 'sub';
const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;
const UUID = process.env.UUID || '9afd1229-b893-40c1-84dd-51e7ce204913';
const ARGO_DOMAIN = process.env.ARGO_DOMAIN || '';
const ARGO_AUTH = process.env.ARGO_AUTH || '';
const ARGO_PORT = process.env.ARGO_PORT || 8001;
const CFIP = process.env.CFIP || 'saas.sin.fan';
const CFPORT = process.env.CFPORT || 443;
const NAME = process.env.NAME || '';

// ==================== GLOBAL CONSTANTS ====================
const horse = Buffer.from("dHJvamFu", 'base64').toString(); 
const flash = Buffer.from("dm1lc3M=", 'base64').toString(); 
const WS_READY_STATE_OPEN = 1;

let subContent = null;
const generateRandomName = () => Math.random().toString(36).substring(2, 8);
const webName = generateRandomName();
const botName = generateRandomName();
const webPath = path.join(FILE_PATH, webName);
const botPath = path.join(FILE_PATH, botName);
const subFilePath = path.join(FILE_PATH, 'sub.txt');
const bootLogPath = path.join(FILE_PATH, 'boot.log');

// ==================== BACKGROUND SERVICES (XRAY & ARGO) ====================
if (!fs.existsSync(FILE_PATH)) fs.mkdirSync(FILE_PATH, { recursive: true });

async function generateXrayConfig() {
  const config = {
    log: { access: '/dev/null', error: '/dev/null', loglevel: 'none' },
    inbounds: [
      { port: ARGO_PORT, protocol: 'vless', settings: { clients: [{ id: UUID, flow: 'xtls-rprx-vision' }], decryption: 'none', fallbacks: [{ dest: 3001 }, { path: "/vless-argo", dest: 3002 }, { path: "/vmess-argo", dest: 3003 }, { path: "/trojan-argo", dest: 3004 }] }, streamSettings: { network: 'tcp' } },
      { port: 3001, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID }], decryption: "none" }, streamSettings: { network: "tcp", security: "none" } },
      { port: 3002, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID, level: 0 }], decryption: "none" }, streamSettings: { network: "ws", security: "none", wsSettings: { path: "/vless-argo" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
      { port: 3003, listen: "127.0.0.1", protocol: "vmess", settings: { clients: [{ id: UUID, alterId: 0 }] }, streamSettings: { network: "ws", wsSettings: { path: "/vmess-argo" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
      { port: 3004, listen: "127.0.0.1", protocol: "trojan", settings: { clients: [{ password: UUID }] }, streamSettings: { network: "ws", security: "none", wsSettings: { path: "/trojan-argo" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
    ],
    dns: { servers: ["https+local://8.8.8.8/dns-query"] },
    outbounds: [{ protocol: "freedom", tag: "direct" }, { protocol: "blackhole", tag: "block" }]
  };
  fs.writeFileSync(path.join(FILE_PATH, 'config.json'), JSON.stringify(config, null, 2));
}

function downloadFile(fileUrl, filePath) {
  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(filePath);
    axios({ method: 'get', url: fileUrl, responseType: 'stream' })
      .then(response => {
        response.data.pipe(writer);
        writer.on('finish', () => resolve(filePath));
        writer.on('error', reject);
      }).catch(reject);
  });
}

async function startBackgroundServices() {
  const arch = os.arch() === 'arm' || os.arch() === 'arm64' || os.arch() === 'aarch64' ? 'arm64' : 'amd64';
  const baseUrl = `https://${arch}.ssss.nyc.mn`;
  
  await generateXrayConfig();
  
  try {
    await Promise.all([
      downloadFile(`${baseUrl}/web`, webPath),
      downloadFile(`${baseUrl}/bot`, botPath)
    ]);
    
    fs.chmodSync(webPath, 0o775);
    fs.chmodSync(botPath, 0o775);

    exec(`nohup ${webPath} -c ${FILE_PATH}/config.json >/dev/null 2>&1 &`);
    console.log('[SYSTEM] Xray Engine Started');

    let tunnelArgs = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile ${bootLogPath} --loglevel info --url http://localhost:${ARGO_PORT}`;
    if (ARGO_AUTH && ARGO_AUTH.match(/^[A-Z0-9a-z=]{120,250}$/)) {
        tunnelArgs = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 run --token ${ARGO_AUTH}`;
    }
    
    exec(`nohup ${botPath} ${tunnelArgs} >/dev/null 2>&1 &`);
    console.log('[SYSTEM] Tunnel Bot Started');
    
    setTimeout(extractDomains, 5000);
  } catch (err) {
    console.error('[SYSTEM] Background service error:', err.message);
  }
}

async function extractDomains() {
  if (ARGO_AUTH && ARGO_DOMAIN) {
    await generateLinks(ARGO_DOMAIN);
    return;
  }
  try {
    const logData = fs.readFileSync(bootLogPath, 'utf-8');
    const match = logData.match(/https?:\/\/([^ ]*trycloudflare\.com)\/?/);
    if (match) {
      console.log('[SYSTEM] Argo Tunnel Extracted:', match[1]);
      await generateLinks(match[1]);
    } else {
      setTimeout(extractDomains, 3000); 
    }
  } catch (e) {
    setTimeout(extractDomains, 3000);
  }
}

async function generateLinks(domain) {
  const nodeName = NAME ? `${NAME}-ARGO` : 'ARGO-NODE';
  const vmess = { v: '2', ps: nodeName, add: CFIP, port: CFPORT, id: UUID, aid: '0', scy: 'auto', net: 'ws', type: 'none', host: domain, path: '/vmess-argo?ed=2560', tls: 'tls', sni: domain, alpn: '', fp: 'firefox' };
  
  const subTxt = `
vless://${UUID}@${CFIP}:${CFPORT}?encryption=none&security=tls&sni=${domain}&fp=firefox&type=ws&host=${domain}&path=%2Fvless-argo%3Fed%3D2560#${nodeName}-VLESS
vmess://${Buffer.from(JSON.stringify(vmess)).toString('base64')}
trojan://${UUID}@${CFIP}:${CFPORT}?security=tls&sni=${domain}&fp=firefox&type=ws&host=${domain}&path=%2Ftrojan-argo%3Fed%3D2560#${nodeName}-TROJAN
  `.trim();
  
  subContent = Buffer.from(subTxt).toString('base64');
  fs.writeFileSync(subFilePath, subContent);
  console.log('[SYSTEM] Subscriptions generated successfully.');
}

// ==================== HYBRID GATEWAY SERVER ====================
class HybridServer {
  constructor() {
    this.wss = null;
    this.httpServer = null;
    this.activeUDPConnections = new Map();
    this.stats = { rx: 0, tx: 0 };
  }

  async handleHttpRequest(req, res) {
    const parsedUrl = url.parse(req.url, true);
    
    if (parsedUrl.pathname === '/api/stats') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        uptime: Math.floor(process.uptime()),
        rx: this.stats.rx,
        tx: this.stats.tx
      }));
      return;
    }

    if (parsedUrl.pathname === `/${SUB_PATH}`) {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(subContent || 'Subscription generating... please refresh in a moment.');
    }

    if (parsedUrl.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>GATEWAY CORE // SYSTEM STATUS</title>
          <style>
            :root {
              --bg-black: #000000;
              --panel-bg: #0a0a0a;
              --card-bg: #000000;
              --border-color: #1f1f1f;
              --border-hover: #333333;
              --text-main: #ffffff;
              --text-muted: #888888;
              --accent-blue: #0088FF;
              --status-green: #00df89;
            }

            * { box-sizing: border-box; margin: 0; padding: 0; }

            body {
              background-color: var(--bg-black);
              color: var(--text-main);
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Geist Sans", "Inter", sans-serif;
              min-height: 100vh;
              display: flex;
              flex-direction: column;
              justify-content: flex-start;
              align-items: center;
              padding: 6vh 24px 24px 24px;
              -webkit-font-smoothing: antialiased;
            }

            .window-container {
              width: 100%;
              max-width: 640px;
              background-color: var(--panel-bg);
              border: 1px solid var(--border-color);
              border-radius: 12px;
              box-shadow: 0 30px 60px rgba(0, 0, 0, 0.8);
              overflow: hidden;
            }

            .window-header {
              background-color: #050505;
              border-bottom: 1px solid var(--border-color);
              padding: 14px 20px;
              display: flex;
              align-items: center;
              justify-content: space-between;
            }

            .mac-dots { display: flex; gap: 8px; }
            .dot { width: 12px; height: 12px; border-radius: 50%; opacity: 0.75; }
            .dot.close { background-color: #ff5f56; }
            .dot.minimize { background-color: #ffbd2e; }
            .dot.zoom { background-color: #27c93f; }

            .brand-title {
              font-size: 0.8rem;
              font-weight: 700;
              letter-spacing: 3px;
              text-transform: uppercase;
            }
            .brand-media { color: #ffffff; }
            .brand-fairy { color: var(--accent-blue); }

            .status-badge {
              display: flex;
              align-items: center;
              gap: 6px;
              font-size: 0.75rem;
              font-weight: 600;
              color: var(--status-green);
              letter-spacing: 0.5px;
            }

            .pulse-dot {
              width: 6px;
              height: 6px;
              background-color: var(--status-green);
              border-radius: 50%;
              box-shadow: 0 0 8px var(--status-green);
              animation: ambientPulse 2.5s infinite ease-in-out;
            }

            .window-content { padding: 32px; }

            .welcome-container {
              text-align: center;
              margin-bottom: 32px;
            }

            .welcome-text {
              font-size: 2.5rem;
              font-weight: 800;
              letter-spacing: 3px;
              background: linear-gradient(90deg, #00ffff, #ffffff, #00ffff);
              background-size: 200% auto;
              color: transparent;
              -webkit-background-clip: text;
              animation: gradientScroll 2s linear infinite;
            }

            .uptime-section {
              text-align: center;
              padding-bottom: 32px;
              border-bottom: 1px solid var(--border-color);
              margin-bottom: 24px;
            }

            .section-label {
              font-size: 0.7rem;
              text-transform: uppercase;
              color: var(--text-muted);
              letter-spacing: 2px;
              margin-bottom: 8px;
            }

            .uptime-display {
              font-size: 3rem;
              font-weight: 800;
              letter-spacing: -1px;
              color: var(--text-main);
              font-variant-numeric: tabular-nums;
            }

            .stats-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 20px;
              margin-bottom: 32px;
            }

            .card {
              background-color: var(--card-bg);
              border: 1px solid var(--border-color);
              border-radius: 8px;
              padding: 20px;
              transition: border-color 0.2s ease;
            }
            .card:hover { border-color: var(--border-hover); }

            .card-value {
              font-size: 1.5rem;
              font-weight: 700;
              margin-top: 4px;
              color: var(--text-main);
              font-variant-numeric: tabular-nums;
            }

            .generator-section {
              background-color: var(--card-bg);
              border: 1px solid var(--border-color);
              border-radius: 8px;
              padding: 20px;
            }

            .btn-group {
              display: grid;
              grid-template-columns: 1fr 1fr 1fr;
              gap: 12px;
              margin-bottom: 16px;
            }

            button {
              background-color: #111;
              color: #fff;
              border: 1px solid var(--border-color);
              padding: 12px;
              border-radius: 6px;
              font-size: 0.85rem;
              font-weight: 600;
              letter-spacing: 1px;
              cursor: pointer;
              transition: all 0.2s ease;
            }

            button:hover { background-color: #222; border-color: #444; }
            button:active { transform: scale(0.98); }

            .btn-vless:hover { border-color: var(--accent-blue); color: var(--accent-blue); }
            .btn-trojan:hover { border-color: #ff0080; color: #ff0080; }
            .btn-sub { background-color: var(--text-main); color: var(--bg-black); }
            .btn-sub:hover { background-color: #e0e0e0; }

            .output-wrapper { display: flex; gap: 8px; }

            input[type="text"] {
              flex: 1;
              background-color: #050505;
              border: 1px solid var(--border-color);
              color: var(--text-muted);
              padding: 12px 16px;
              border-radius: 6px;
              font-family: monospace;
              font-size: 0.8rem;
              outline: none;
            }
            input[type="text"]:focus { border-color: var(--border-hover); color: var(--text-main); }

            .btn-copy { background-color: var(--text-main); color: var(--bg-black); padding: 0 20px; border: none; }
            .btn-copy:hover { background-color: #e0e0e0; }

            @media (max-width: 540px) {
              body { padding: 4vh 16px 16px 16px; }
              .window-content { padding: 24px; }
              .stats-grid { grid-template-columns: 1fr; gap: 16px; }
              .uptime-display { font-size: 2.25rem; }
              .btn-group { grid-template-columns: 1fr; }
              .output-wrapper { flex-direction: column; }
              .btn-copy { padding: 12px; }
            }

            @keyframes ambientPulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
            @keyframes gradientScroll { 0% { background-position: 0% center; } 100% { background-position: 200% center; } }
          </style>
        </head>
        <body>

          <div class="window-container">
            <div class="window-header">
              <div class="mac-dots">
                <div class="dot close"></div>
                <div class="dot minimize"></div>
                <div class="dot zoom"></div>
              </div>
              <div class="brand-title">
                <span class="brand-media">MEDIA</span><span class="brand-fairy">FAIRY</span>
              </div>
              <div class="status-badge">
                <div class="pulse-dot"></div>
                RUNNING
              </div>
            </div>

            <div class="window-content">
              <div class="welcome-container">
                <div class="welcome-text">WELCOME</div>
              </div>

              <div class="uptime-section">
                <div class="section-label">System Uptime</div>
                <div class="uptime-display" id="uptime-field">00:00:00</div>
              </div>

              <div class="stats-grid">
                <div class="card">
                  <div class="section-label">Download (TX)</div>
                  <div class="card-value" id="download-field">0 B</div>
                </div>
                <div class="card">
                  <div class="section-label">Upload (RX)</div>
                  <div class="card-value" id="upload-field">0 B</div>
                </div>
              </div>

              <div class="generator-section">
                <div class="section-label">Quick Generator</div>
                <div class="btn-group">
                  <button class="btn-vless" onclick="generateConfig('vless')">VLESS</button>
                  <button class="btn-trojan" onclick="generateConfig('trojan')">TROJAN</button>
                  <button class="btn-sub" onclick="window.open('/${SUB_PATH}', '_blank')">GET SUB</button>
                </div>
                <div class="output-wrapper">
                  <input type="text" id="config-output" readonly placeholder="Select a protocol to generate..." />
                  <button class="btn-copy" id="copy-btn" onclick="copyConfig()">Copy</button>
                </div>
              </div>
            </div>
          </div>

          <script>
            function formatBytes(bytes) {
              if (bytes === 0) return '0 B';
              const k = 1024;
              const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
              const i = Math.floor(Math.log(bytes) / Math.log(k));
              return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
            }

            function formatTime(totalSeconds) {
              const days = Math.floor(totalSeconds / 86400);
              const hours = Math.floor((totalSeconds % 86400) / 3600);
              const minutes = Math.floor((totalSeconds % 3600) / 60);
              const seconds = totalSeconds % 60;
              
              let timeString = '';
              if (days > 0) timeString += days + 'd ';
              timeString += String(hours).padStart(2, '0') + ':';
              timeString += String(minutes).padStart(2, '0') + ':';
              timeString += String(seconds).padStart(2, '0');
              return timeString;
            }

            async function refreshDashboardStats() {
              try {
                const response = await fetch('/api/stats');
                const statsData = await response.json();
                
                document.getElementById('uptime-field').innerText = formatTime(statsData.uptime);
                document.getElementById('download-field').innerText = formatBytes(statsData.tx);
                document.getElementById('upload-field').innerText = formatBytes(statsData.rx);
              } catch (error) {}
            }

            refreshDashboardStats();
            setInterval(refreshDashboardStats, 1000);

            function generateConfig(type) {
              const host = window.location.hostname;
              const uuid = '${UUID}';
              let uri = '';

              if (type === 'vless') {
                uri = \`vless://\${uuid}@\${host}:443?encryption=none&security=tls&sni=\${host}&type=ws&host=\${host}&path=%2Fvless-mediafairy#MEDIAFAIRY-VLESS\`;
              } else if (type === 'trojan') {
                uri = \`trojan://\${uuid}@\${host}:443?security=tls&sni=\${host}&type=ws&host=\${host}&path=%2Ftrojan-mediafairy#MEDIAFAIRY-TROJAN\`;
              }

              const outputBox = document.getElementById('config-output');
              outputBox.value = uri;
              document.getElementById('copy-btn').innerText = 'Copy';
            }

            function copyConfig() {
              const copyText = document.getElementById('config-output');
              if (!copyText.value) return;

              copyText.select();
              copyText.setSelectionRange(0, 99999); 

              navigator.clipboard.writeText(copyText.value).then(() => {
                const btn = document.getElementById('copy-btn');
                btn.innerText = 'Copied!';
                setTimeout(() => {
                  if (btn.innerText === 'Copied!') btn.innerText = 'Copy';
                }, 2000);
              }).catch(err => console.error('Failed to copy text: ', err));
            }
          </script>
        </body>
        </html>
      `);
      return;
    }
    
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }

  // ==================== WEBSOCKET HANDLERS ====================

  async handleWebSocketConnection(ws, request) {
    try {
      const parsedUrl = url.parse(request.url, true);
      const path = parsedUrl.pathname;

      if (path === '/vless-mediafairy' || path === '/trojan-mediafairy') {
        await this.websocketHandler(ws);
        return;
      }
      ws.close(1000, "Invalid WebSocket path");
    } catch (err) { ws.close(1011, 'Internal server error'); }
  }

  async websocketHandler(ws) {
    let remoteSocketWrapper = { value: null };

    ws.on('message', async (message) => {
      try {
        const chunk = Buffer.from(message);
        this.stats.rx += chunk.length;

        if (remoteSocketWrapper.value) {
          remoteSocketWrapper.value.write(chunk);
          return;
        }

        const protocol = await this.protocolSniffer(chunk);
        const protocolHeader = protocol === horse ? this.readHorseHeader(chunk) : this.readFlashHeader(chunk); 

        if (protocolHeader.hasError) throw new Error(protocolHeader.message);

        if (protocolHeader.isUDP) {
          return await this.handleUDPOutbound(protocolHeader.addressRemote, protocolHeader.portRemote, chunk.slice(protocolHeader.rawDataIndex), ws, protocolHeader.version);
        }

        this.handleTCPOutBound(remoteSocketWrapper, protocolHeader.addressRemote, protocolHeader.portRemote, protocolHeader.rawClientData, ws, protocolHeader.version);
      } catch (err) { ws.close(1011, err.message); }
    });

    ws.on('close', () => {
      if (remoteSocketWrapper.value) remoteSocketWrapper.value.end();
      this.cleanupUDPConnections(ws);
    });

    ws.on('error', () => this.cleanupUDPConnections(ws));
  }

  // ==================== PROTOCOL SNIFFERS ====================

  async protocolSniffer(buffer) {
    if (buffer.length >= 62) {
      const hd = buffer.slice(56, 60);
      if (hd[0] === 0x0d && hd[1] === 0x0a && [0x01, 0x03, 0x7f].includes(hd[2]) && [0x01, 0x03, 0x04].includes(hd[3])) return horse;
    }
    return flash; 
  }

  async handleTCPOutBound(remoteSocket, addressRemote, portRemote, rawClientData, webSocket, responseHeader) {
    try {
      const tcpSocket = net.createConnection({ host: addressRemote, port: portRemote }, () => tcpSocket.write(rawClientData));
      remoteSocket.value = tcpSocket;
      tcpSocket.on('close', () => webSocket.close());
      tcpSocket.on('error', () => webSocket.close());
      
      let header = responseHeader;
      tcpSocket.on('data', (chunk) => {
        this.stats.tx += chunk.length;
        if (webSocket.readyState !== WS_READY_STATE_OPEN) return tcpSocket.destroy();
        if (header) { webSocket.send(Buffer.concat([Buffer.from(header), chunk])); header = null; } 
        else { webSocket.send(chunk); }
      });
    } catch (error) { webSocket.close(); }
  }

  // ==================== UDP NATIVE HANDLER ====================

  async handleUDPOutbound(targetAddress, targetPort, dataChunk, webSocket, responseHeader) {
    return new Promise((resolve) => {
      try {
        let header = responseHeader;
        const key = `${targetAddress}:${targetPort}:${Date.now()}`;
        const udpSocket = dgram.createSocket('udp4');
        
        this.activeUDPConnections.set(key, { socket: udpSocket, webSocket: webSocket });
        
        udpSocket.on('error', () => { try { udpSocket.close(); } catch (_) {} this.activeUDPConnections.delete(key); });
        udpSocket.send(dataChunk, targetPort, targetAddress);
        
        udpSocket.on('message', (message) => {
          this.stats.tx += message.length;
          if (webSocket.readyState === WS_READY_STATE_OPEN) {
            if (header) { webSocket.send(Buffer.concat([Buffer.from(header), message])); header = null; } 
            else { webSocket.send(message); }
          }
        });
        
        let timeout = setTimeout(() => { try { udpSocket.close(); } catch (_) {} this.activeUDPConnections.delete(key); }, 30000);
        udpSocket.on('message', () => { clearTimeout(timeout); timeout = setTimeout(() => { try { udpSocket.close(); } catch (_) {} this.activeUDPConnections.delete(key); }, 30000); });
      } catch (e) {}
    });
  }

  cleanupUDPConnections(webSocket) {
    for (const [key, conn] of this.activeUDPConnections.entries()) {
      if (conn.webSocket === webSocket) { try { conn.socket.close(); } catch (_) {} this.activeUDPConnections.delete(key); }
    }
  }

  readFlashHeader(buffer) {
    const v = buffer[0], optLen = buffer[17], cmd = buffer[18 + optLen], portIdx = 18 + optLen + 1;
    if (cmd !== 1 && cmd !== 2) return { hasError: true, message: "cmd unsupported" };
    const port = buffer.readUInt16BE(portIdx), addrType = buffer[portIdx + 2];
    let addrLen = 0, addrIdx = portIdx + 3, addr = "";
    
    if (addrType === 1) { addrLen = 4; addr = Array.from(buffer.slice(addrIdx, addrIdx + addrLen)).join("."); }
    else if (addrType === 2) { addrLen = buffer[addrIdx]; addrIdx++; addr = buffer.slice(addrIdx, addrIdx + addrLen).toString(); }
    else if (addrType === 3) { addrLen = 16; addr = Array.from({length: 8}, (_, i) => buffer.readUInt16BE(addrIdx + i*2).toString(16)).join(":"); }
    else return { hasError: true };

    return { hasError: false, addressRemote: addr, portRemote: port, rawDataIndex: addrIdx + addrLen, rawClientData: buffer.slice(addrIdx + addrLen), version: Buffer.from([v, 0]), isUDP: cmd === 2 };
  }

  readHorseHeader(buffer) {
    const data = buffer.slice(58);
    if (data.length < 6 || (data[0] !== 1 && data[0] !== 3)) return { hasError: true };
    const addrType = data[1];
    let addrLen = 0, addrIdx = 2, addr = "";
    
    if (addrType === 1) { addrLen = 4; addr = Array.from(data.slice(addrIdx, addrIdx + addrLen)).join("."); }
    else if (addrType === 3) { addrLen = data[addrIdx]; addrIdx++; addr = data.slice(addrIdx, addrIdx + addrLen).toString(); }
    else if (addrType === 4) { addrLen = 16; addr = Array.from({length: 8}, (_, i) => data.readUInt16BE(addrIdx + i*2).toString(16)).join(":"); }
    else return { hasError: true };

    const portIdx = addrIdx + addrLen;
    return { hasError: false, addressRemote: addr, portRemote: data.readUInt16BE(portIdx), rawDataIndex: portIdx + 4, rawClientData: data.slice(portIdx + 4), version: null, isUDP: data[0] === 3 };
  }

  start(port) {
    this.httpServer = http.createServer((req, res) => this.handleHttpRequest(req, res));
    this.wss = new WebSocket.Server({ server: this.httpServer, perMessageDeflate: false });
    this.wss.on('connection', (ws, req) => this.handleWebSocketConnection(ws, req));
    this.httpServer.listen(port, '0.0.0.0', () => console.log(`[SYSTEM] Hybrid Gateway Active on Port ${port}`));
  }
}

// ==================== BOOT SEQUENCE ====================
(async () => {
  console.log('[SYSTEM] Initializing Hybrid Core...');
  await startBackgroundServices();
  const server = new HybridServer();
  server.start(PORT);
})();
