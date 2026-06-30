import fs from 'fs';
import path from 'path';

const EV_KEY = 1;

const KEY: Record<number, string> = {
  1: 'Escape', 2: 'Digit1', 3: 'Digit2', 4: 'Digit3',
  5: 'Digit4', 6: 'Digit5', 7: 'Digit6', 8: 'Digit7',
  9: 'Digit8', 10: 'Digit9', 11: 'Digit0', 12: 'Minus',
  13: 'Equal', 14: 'Backspace', 15: 'Tab', 16: 'KeyQ',
  17: 'KeyW', 18: 'KeyE', 19: 'KeyR', 20: 'KeyT',
  21: 'KeyY', 22: 'KeyU', 23: 'KeyI', 24: 'KeyO',
  25: 'KeyP', 26: 'BracketLeft', 27: 'BracketRight',
  28: 'Enter', 29: 'ControlLeft', 30: 'KeyA', 31: 'KeyS',
  32: 'KeyD', 33: 'KeyF', 34: 'KeyG', 35: 'KeyH', 36: 'KeyJ',
  37: 'KeyK', 38: 'KeyL', 39: 'Semicolon', 40: 'Quote',
  41: 'Backquote', 42: 'ShiftLeft', 43: 'Backslash', 44: 'KeyZ',
  45: 'KeyX', 46: 'KeyC', 47: 'KeyV', 48: 'KeyB', 49: 'KeyN',
  50: 'KeyM', 51: 'Comma', 52: 'Period', 53: 'Slash',
  54: 'ShiftRight', 56: 'AltLeft', 57: 'Space', 58: 'CapsLock',
  59: 'F1', 60: 'F2', 61: 'F3', 62: 'F4', 63: 'F5', 64: 'F6',
  65: 'F7', 66: 'F8', 67: 'F9', 68: 'F10', 87: 'F11',
  88: 'F12', 97: 'ControlRight', 100: 'AltRight', 111: 'Delete',
  113: 'Mute', 114: 'VolumeDown', 115: 'VolumeUp',
  119: 'Pause', 125: 'MetaLeft', 126: 'MetaRight',
  104: 'PageUp', 109: 'PageDown', 102: 'Home', 107: 'End',
  105: 'ArrowLeft', 106: 'ArrowRight', 103: 'ArrowUp', 108: 'ArrowDown',
  163: 'NextSong', 164: 'PlayPause', 165: 'PreviousSong',
  210: 'PrintScreen', 224: 'BrightnessDown', 225: 'BrightnessUp',
  272: 'Mouse1', 273: 'Mouse2', 274: 'Mouse3',
  183: 'F13', 184: 'F14', 185: 'F15', 186: 'F16', 187: 'F17',
  188: 'F18', 189: 'F19', 190: 'F20', 191: 'F21', 192: 'F22',
  193: 'F23', 194: 'F24',
};

export function startLinuxInput(
  onKey: (code: string, pressed: boolean) => void,
  preferredDevice?: string,
): { stop: () => void } | null {
  let running = true;
  const handles: any[] = [];

  async function readLoop(device: string) {
    try {
      console.log('[Input] Opening device:', device);
      const handle = await fs.promises.open(device, 'r');
      handles.push(handle);
      const buf = Buffer.alloc(24);

      while (running) {
        try {
          const { bytesRead } = await handle.read(buf, 0, 24, null);
          if (bytesRead < 24) {
            await new Promise(r => setTimeout(r, 1));
            continue;
          }

          const type = buf.readUInt16LE(16);
          const code = buf.readUInt16LE(18);
          const value = buf.readInt32LE(20);

          if (type === EV_KEY && (value === 0 || value === 1)) {
            const keyName = KEY[code];
            if (keyName) {
              onKey(keyName, value === 1);
            }
          }
        } catch (err: any) {
          if (err.code !== 'EAGAIN') {
            console.error('[Input] Read error:', err.message);
            await new Promise(r => setTimeout(r, 10));
          }
        }
      }
    } catch (err) {
      console.error('[Input] Failed to open device:', device, err);
    }
  }

  async function run() {
    let devices: string[] = [];
    if (preferredDevice) {
      devices = [preferredDevice];
    } else {
      try {
        const byPath = await fs.promises.readdir('/dev/input/by-path/');
        devices = byPath
          .filter(e => e.includes('-event-kbd') && !e.includes('mouse'))
          .map(e => `/dev/input/by-path/${e}`);
      } catch {}
      if (devices.length === 0) {
        try {
          const byId = await fs.promises.readdir('/dev/input/by-id/');
          devices = byId
            .filter(e => e.includes('-event-kbd'))
            .map(e => `/dev/input/by-id/${e}`);
        } catch {}
      }
    }

    if (!devices.length) {
      console.log('[Input] No keyboard devices found');
      return;
    }

    console.log('[Input] Found devices:', devices.join(', '));
    await Promise.all(devices.map(d => readLoop(d)));
  }

  run().catch(err => {
    console.error('[Input] Fatal error:', err);
  });

  return {
    stop: () => {
      running = false;
      for (const h of handles) {
        h.close().catch(() => {});
      }
    },
  };
}
