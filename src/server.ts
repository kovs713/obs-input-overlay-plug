import http from 'http';
import path from 'path';
import fs from 'fs';
import { WebSocketServer, WebSocket } from 'ws';
import { KeyboardHandler } from './keyboard.js';
import { startLocaleSync } from './locale.js';
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
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
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
  const url = new URL(req.url || '/', 'http://localhost');
  const pathname = url.pathname;

  if (pathname === '/') {
    serveFile(res, HTML_PATH, 'text/html');
    return;
  }

  if (pathname === '/layout.json') {
    serveFile(res, LAYOUT_PATH, 'application/json');
    return;
  }

  if (pathname === '/config.json') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    res.end(JSON.stringify({ defaultLayer: config.defaultLayer }));
    return;
  }

  const publicFile = path.join('public', pathname);
  const ext = path.extname(publicFile);
  if (ext && MIME[ext]) {
    serveFile(res, path.resolve(publicFile), MIME[ext]);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

const wss = new WebSocketServer({ server, path: WS_PATH });

let activeLocale = 'en';

function broadcast(msg: object): void {
  const payload = 'type' in msg ? { locale: activeLocale, ...msg } : msg;
  wss.clients.forEach((client: WebSocket) => {
    if (client.readyState === 1) {
      client.send(JSON.stringify(payload));
    }
  });
}

const keyboard = new KeyboardHandler(CONFIG_PATH, LAYOUT_PATH, broadcast);

const localeSync = startLocaleSync({
  enabled: config.localeSync ?? false,
  keyboardName: config.localeKeyboardName || undefined,
  pollMs: config.localePollMs ?? 500,
  onLocale: (locale) => {
    activeLocale = locale;
    broadcast({ type: 'locale', locale, timestamp: Date.now() });
    if (config.debugLayers ?? config.debug) console.log(`[Locale] -> ${locale}`);
  },
});

wss.on('connection', (ws: WebSocket) => {
  console.log('[Server] WebSocket connected');

  ws.send(JSON.stringify({
    type: 'state',
    layer: keyboard.getActiveLayer(),
    pressedCodes: keyboard.getPressedKeys(),
    shifted: keyboard.isShifted(),
    modifiers: keyboard.getModifiers(),
    locale: activeLocale,
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
  localeSync?.stop();
  wss.close();
  server.close();
  process.exit(0);
});
