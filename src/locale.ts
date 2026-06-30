import { execFile } from 'child_process';
import net from 'net';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

type HyprKeyboard = {
  name?: string;
  active_keymap?: string;
  main?: boolean;
};

type HyprDevices = {
  keyboards?: HyprKeyboard[];
};

function normalizeLocale(activeKeymap: string): string {
  return activeKeymap.toLowerCase().includes('russian') ? 'ru' : 'en';
}

function getHyprEventSocketPath(): string | null {
  const runtimeDir = process.env.XDG_RUNTIME_DIR;
  const signature = process.env.HYPRLAND_INSTANCE_SIGNATURE;
  if (!runtimeDir || !signature) return null;
  return `${runtimeDir}/hypr/${signature}/.socket2.sock`;
}

async function readHyprLocale(preferredName?: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('hyprctl', ['devices', '-j'], { timeout: 1000 });
    const devices = JSON.parse(stdout) as HyprDevices;
    const keyboards = devices.keyboards || [];
    const keyboard = (preferredName ? keyboards.find(item => item.name === preferredName) : null)
      || keyboards.find(item => item.main)
      || keyboards.find(item => item.active_keymap?.toLowerCase().includes('russian'))
      || keyboards.find(item => item.active_keymap);

    return keyboard?.active_keymap ? normalizeLocale(keyboard.active_keymap) : null;
  } catch {
    return null;
  }
}

export function startLocaleSync(options: {
  enabled: boolean;
  keyboardName?: string;
  pollMs: number;
  onLocale: (locale: string) => void;
}): { stop: () => void } | null {
  if (!options.enabled) return null;

  let running = true;
  let current = '';
  let socket: net.Socket | null = null;
  let buffer = '';

  function emitLocale(locale: string | null) {
    if (!running || !locale || locale === current) return;
    current = locale;
    options.onLocale(locale);
  }

  async function poll() {
    emitLocale(await readHyprLocale(options.keyboardName));
  }

  function handleEvent(line: string) {
    if (!line.startsWith('activelayout>>')) return;

    const payload = line.slice('activelayout>>'.length);
    const separator = payload.lastIndexOf(',');
    if (separator === -1) return;

    const activeKeymap = payload.slice(separator + 1);

    emitLocale(normalizeLocale(activeKeymap));
  }

  function startEventSocket() {
    const socketPath = getHyprEventSocketPath();
    if (!socketPath) return;

    socket = net.createConnection(socketPath);
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) handleEvent(line.trim());
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      socket = null;
      if (running) setTimeout(startEventSocket, 1000);
    });
  }

  poll().catch(() => {});
  startEventSocket();
  const timer = setInterval(() => poll().catch(() => {}), options.pollMs);

  return {
    stop: () => {
      running = false;
      clearInterval(timer);
      socket?.destroy();
    },
  };
}
