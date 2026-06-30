import fs from 'fs';
import type { Config, Layout } from './types.js';
import { startLinuxInput } from './input-linux.js';
import { startStdinInput } from './input-stdin.js';

const KEYCODE_TO_NAME: Record<number, string> = {
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
  119: 'Pause', 125: 'MetaLeft', 126: 'MetaRight',
  104: 'PageUp', 109: 'PageDown', 102: 'Home', 107: 'End',
  105: 'ArrowLeft', 106: 'ArrowRight', 103: 'ArrowUp', 108: 'ArrowDown',
  113: 'Mute', 114: 'VolumeDown', 115: 'VolumeUp',
  163: 'NextSong', 164: 'PlayPause', 165: 'PreviousSong',
  210: 'PrintScreen', 224: 'BrightnessDown', 225: 'BrightnessUp',
  272: 'Mouse1', 273: 'Mouse2', 274: 'Mouse3',
  70: 'ScrollLock',
  183: 'F13', 184: 'F14',
};
const NAME_TO_KEYCODE: Record<string, number> = {};
for (const [k, v] of Object.entries(KEYCODE_TO_NAME)) NAME_TO_KEYCODE[v] = Number(k);

// Per-layer: linuxKeycode → physical position ID
// Built from Vial layout raw keycodes
const LAYER_KEYCODE_POS: Record<string, Record<number, string>> = {
  ALPHA: {
    2: 'L11', 3: 'L12', 4: 'L13', 5: 'L14', 6: 'L15',   // 1-5
    7: 'R15', 8: 'R14', 9: 'R13', 10: 'R12', 11: 'R11',  // 6-0
    12: 'L23', 13: 'L24',                                  // - =
  },
  FN: {
    59: 'L00', 60: 'L01', 61: 'L02', 62: 'L03', 63: 'L04', 64: 'L05',
    65: 'R05', 66: 'R04', 67: 'R03', 68: 'R02', 87: 'R01', 88: 'R00',
    225: 'L10', 210: 'L11', 274: 'L12', 273: 'L13', 272: 'L14',
    224: 'L20', 113: 'L21', 165: 'L22', 164: 'L23', 163: 'L24',
    104: 'R10', 115: 'R11', 106: 'R12', 103: 'R13', 108: 'R14', 105: 'R15',
    109: 'R20', 114: 'R21',
  },
};

// Keycodes that uniquely identify a layer
const KEYCODE_LAYER: Record<number, string> = {};
for (const [layer, map] of Object.entries(LAYER_KEYCODE_POS)) {
  for (const kc of Object.keys(map)) KEYCODE_LAYER[Number(kc)] = layer;
}
// BASE-only keycodes (keys that don't change between layers)
const BASE_KEYCODES = new Set<number>([
  16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
  30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
  41, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53,
  40, 43, 26, 27, 57, 15, 1, 14, 28, 111,
]);

export class KeyboardHandler {
  private config: Config;
  private layout: Layout;
  private pressedLayoutIds = new Set<string>();
  private activeLayer: string;
  private broadcast: (msg: object) => void;
  private inputCleanup?: () => void;

  constructor(
    configPath: string,
    layoutPath: string,
    broadcast: (msg: object) => void,
  ) {
    this.config = this.loadConfig(configPath);
    this.layout = this.loadLayout(layoutPath);
    this.activeLayer = this.config.defaultLayer;
    this.broadcast = broadcast;
  }

  private loadConfig(path: string): Config {
    try {
      return JSON.parse(fs.readFileSync(path, 'utf-8')) as Config;
    } catch {
      return {
        port: 7777, webSocketPath: '/ws', defaultLayer: 'BASE',
        hideSignalKeys: true, debug: true,
        layerSignals: [], momentaryLayerSignals: [],
      };
    }
  }

  private loadLayout(path: string): Layout {
    try {
      return JSON.parse(fs.readFileSync(path, 'utf-8')) as Layout;
    } catch {
      return { layers: {}, physicalLayout: [], inputMap: {} };
    }
  }

  start(): void {
    const onKey = (code: string, pressed: boolean) => this.handleKey(code, pressed);
    let cleanup = startLinuxInput(onKey, this.config.inputDevice);
    if (!cleanup) {
      console.log('[Keyboard] Linux input not available, falling back to stdin');
      cleanup = startStdinInput(onKey);
    }
    if (cleanup) this.inputCleanup = cleanup.stop;
  }

  private resolvePosition(rawCode: string, keycode: number): string {
    const layerMap = LAYER_KEYCODE_POS[this.activeLayer];
    if (layerMap && layerMap[keycode] !== undefined) return layerMap[keycode];
    return this.layout.inputMap[rawCode] || rawCode;
  }

  private handleKey(rawCode: string, pressed: boolean): void {
    const keycode = NAME_TO_KEYCODE[rawCode] ?? -1;

    // F13/F14 detection — MO() sends these as dummy signals
    // F13 = MO(1) = ALPHA (LT2), F14 = MO(2) = FN (LT1)
    if (keycode === 183) { // KC_F13
      const layer = pressed ? 'ALPHA' : 'BASE';
      if (layer !== this.activeLayer) {
        this.activeLayer = layer;
        this.broadcast({ type: 'layer', layer, timestamp: Date.now() });
        if (this.config.debug) console.log(`[Layer] -> ${layer} (F13 ${pressed ? 'DN' : 'UP'})`);
      }
      const thumbId = 'LT2';
      if (pressed) this.pressedLayoutIds.add(thumbId);
      else this.pressedLayoutIds.delete(thumbId);
      this.broadcast({ type: 'key', code: thumbId, pressed, timestamp: Date.now() });
      return;
    }
    if (keycode === 184) { // KC_F14
      const layer = pressed ? 'FN' : 'BASE';
      if (layer !== this.activeLayer) {
        this.activeLayer = layer;
        this.broadcast({ type: 'layer', layer, timestamp: Date.now() });
        if (this.config.debug) console.log(`[Layer] -> ${layer} (F14 ${pressed ? 'DN' : 'UP'})`);
      }
      const thumbId = 'LT1';
      if (pressed) this.pressedLayoutIds.add(thumbId);
      else this.pressedLayoutIds.delete(thumbId);
      this.broadcast({ type: 'key', code: thumbId, pressed, timestamp: Date.now() });
      return;
    }

    // Keycode-based layer detection (fallback when firmware not modified)
    if (pressed) {
      const layer = KEYCODE_LAYER[keycode] || (BASE_KEYCODES.has(keycode) ? 'BASE' : null);
      if (layer && layer !== this.activeLayer) {
        this.activeLayer = layer;
        this.broadcast({ type: 'layer', layer, timestamp: Date.now() });
        if (this.config.debug) console.log(`[Layer] -> ${layer}`);
      }
    }

    const layoutId = this.resolvePosition(rawCode, keycode);

    if (this.config.debug) {
      console.log(`[Key] ${pressed ? 'DN' : 'UP'} ${rawCode}(${keycode}) -> ${layoutId} [${this.activeLayer}]`);
    }

    if (pressed) this.pressedLayoutIds.add(layoutId);
    else this.pressedLayoutIds.delete(layoutId);

    this.broadcast({
      type: 'key',
      code: layoutId,
      pressed,
      timestamp: Date.now(),
    });
  }

  getActiveLayer(): string { return this.activeLayer; }
  getPressedKeys(): string[] { return Array.from(this.pressedLayoutIds); }
  getConfig(): Config { return this.config; }
  getLayout(): Layout { return this.layout; }
  destroy(): void { this.inputCleanup?.(); }
}
