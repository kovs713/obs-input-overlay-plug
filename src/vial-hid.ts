import fs from 'fs';

const HID_REPORT_SIZE = 32;

const CMD = {
  GET_PROTOCOL_VERSION: 0x01,
  GET_KEYBOARD_VALUE: 0x02,
};

const VALUE_ID = {
  GET_CURRENT_LAYER: 0x04,
};

async function tryVialHandshake(dev: string): Promise<boolean> {
  try {
    const h = await fs.promises.open(dev, 'r+');
    try {
      const cmd = Buffer.alloc(HID_REPORT_SIZE);
      cmd[0] = CMD.GET_PROTOCOL_VERSION;
      await h.write(cmd);
      const resp = Buffer.alloc(HID_REPORT_SIZE);
      const { bytesRead } = await Promise.race([
        h.read(resp, 0, HID_REPORT_SIZE),
        new Promise<{bytesRead: number}>((_, rej) => setTimeout(() => rej(new Error('timeout')), 1500)),
      ]);
      return bytesRead >= 3 && resp[0] === CMD.GET_PROTOCOL_VERSION;
    } catch {
      return false;
    } finally {
      await h.close();
    }
  } catch {
    return false;
  }
}

async function findVialDevice(preferred?: string): Promise<string | null> {
  if (preferred) {
    if (await tryVialHandshake(preferred)) return preferred;
    console.warn(`[Vial] Preferred device ${preferred} did not respond to handshake`);
    return null;
  }
  for (let i = 0; i < 16; i++) {
    const dev = `/dev/hidraw${i}`;
    try {
      await fs.promises.access(dev, fs.constants.R_OK | fs.constants.W_OK);
      if (await tryVialHandshake(dev)) return dev;
    } catch {}
  }
  return null;
}

export type VialHidCallbacks = {
  onLayer: (layer: number) => void;
};

export function startVialHid(options: {
  device?: string;
  callbacks: VialHidCallbacks;
}): { stop: () => void } | null {
  const { callbacks } = options;
  let running = true;
  let handle: any = null;

  async function run() {
    const devicePath = await findVialDevice(options.device);
    if (!devicePath) {
      console.warn('[Vial] No Vial device found');
      return;
    }

    console.log('[Vial] Using:', devicePath);
    try {
      handle = await fs.promises.open(devicePath, 'r+');
    } catch (err: any) {
      console.warn(`[Vial] Cannot open ${devicePath}: ${err.message}`);
      return;
    }

    let pollCount = 0;
    while (running) {
      try {
        const cmd = Buffer.alloc(HID_REPORT_SIZE);
        cmd[0] = CMD.GET_KEYBOARD_VALUE;
        cmd[1] = VALUE_ID.GET_CURRENT_LAYER;
        await handle.write(cmd);

        const resp = Buffer.alloc(HID_REPORT_SIZE);
        const { bytesRead } = await handle.read(resp, 0, HID_REPORT_SIZE);

        if (pollCount < 3 || pollCount % 20 === 0) {
          console.log(`[Vial] poll#${pollCount}: ${bytesRead}b [${resp[0]},${resp[1]},${resp[2]}]`);
        }
        pollCount++;

        if (bytesRead >= 3) {
          callbacks.onLayer(resp[2]);
        }
      } catch (err: any) {
        if (running) console.error('[Vial] Poll error:', err.message);
      }
      await new Promise(r => setTimeout(r, 250));
    }
  }

  run().catch(err => console.error('[Vial] Fatal:', err));

  return {
    stop: () => {
      running = false;
      handle?.close().catch(() => {});
    },
  };
}
