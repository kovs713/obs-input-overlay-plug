import http from 'http';
import path from 'path';
import fs from 'fs';
import { WebSocketServer, WebSocket } from 'ws';
import { KeyboardHandler } from './keyboard.js';
import type { Config } from './types.js';

const CONFIG_PATH = path.resolve('config.json');
const LAYOUT_PATH = path.resolve('public/layout.json');
const HTML_PATH = path.resolve('public/overlay.html');
const WS_PATH = '/ws';

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
};

function serveFile(res: http.ServerResponse, filePath: string, mime: string): void {
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

let config: Config;
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
} catch {
  console.warn('[Server] Failed to load config, using defaults');
  config = {
    port: 7777,
    webSocketPath: '/ws',
    defaultLayer: 'BASE',
    hideSignalKeys: true,
    debug: true,
    layerSignals: [],
    momentaryLayerSignals: [],
  };
}

const server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
  const url = req.url || '/';

  if (url === '/') {
    serveFile(res, HTML_PATH, 'text/html');
    return;
  }

  if (url === '/layout.json') {
    serveFile(res, LAYOUT_PATH, 'application/json');
    return;
  }

  if (url === '/config.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ defaultLayer: config.defaultLayer }));
    return;
  }

  const publicFile = path.join('public', url);
  const ext = path.extname(publicFile);
  if (ext && MIME[ext]) {
    serveFile(res, path.resolve(publicFile), MIME[ext]);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

const wss = new WebSocketServer({ server, path: WS_PATH });

const keyboard = new KeyboardHandler(CONFIG_PATH, LAYOUT_PATH, (msg: object) => {
  wss.clients.forEach((client: WebSocket) => {
    if (client.readyState === 1) {
      client.send(JSON.stringify(msg));
    }
  });
});

wss.on('connection', (ws: WebSocket) => {
  console.log('[Server] WebSocket connected');

  ws.send(JSON.stringify({
    type: 'state',
    layer: keyboard.getActiveLayer(),
    pressedCodes: keyboard.getPressedKeys(),
  }));

  ws.on('close', () => console.log('[Server] WebSocket disconnected'));
  ws.on('error', (err: Error) => console.error('[Server] WS error:', err.message));
});

server.listen(config.port, () => {
  console.log(`[Server] http://localhost:${config.port}`);
  console.log(`[Server] ws://localhost:${config.port}${WS_PATH}`);
  keyboard.start();
});

process.on('SIGINT', () => {
  console.log('[Server] Shutting down...');
  keyboard.destroy();
  wss.close();
  server.close();
  process.exit(0);
});
