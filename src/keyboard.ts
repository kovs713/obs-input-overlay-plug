import fs from 'fs';
import path from 'path';
import type { Config, KeymapConfig, Layout, ModifierMode, ModifierState } from './types.js';
import { startLinuxInput } from './input-linux.js';
import { startStdinInput } from './input-stdin.js';
import { startVialHid } from './vial-hid.js';

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

const MODIFIER_KEYCODE_MODE: Record<number, ModifierMode> = {
  29: 'ctrl', 97: 'ctrl',
  42: 'shift', 54: 'shift',
  56: 'alt', 100: 'alt',
  125: 'super', 126: 'super',
};

const EMPTY_KEYMAP: KeymapConfig = {
  layers: { 0: { name: 'BASE' } },
  positions: {},
  shiftedPositions: {},
  baseKeycodes: [],
  shiftKeycodes: [],
};

function numericMap(map: Record<string, string> = {}): Record<number, string> {
  const result: Record<number, string> = {};
  for (const [key, value] of Object.entries(map)) result[Number(key)] = value;
  return result;
}

export class KeyboardHandler {
  private config: Config;
  private layout: Layout;
  private keymap: KeymapConfig;
  private layerKeycodePos: Record<string, Record<number, string>> = {};
  private layerShiftedKeycodePos: Record<string, Record<number, string>> = {};
  private keycodeLayer: Record<number, string> = {};
  private baseKeycodes = new Set<number>();
  private shiftKeycodes = new Set<number>();
  private layerNumberToName: Record<number, string> = {};
  private layerNumberToThumbId: Record<number, string> = {};
  private pressedLayoutIds = new Set<string>();
  private pressedRawToLayoutId = new Map<string, string>();
  private stuckKeyTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pressedShiftKeycodes = new Set<number>();
  private activeModifierKeycodes: Record<ModifierMode, Set<number>> = {
    shift: new Set(),
    ctrl: new Set(),
    alt: new Set(),
    super: new Set(),
  };
  private activeLayer: string;
  private activeLayerNumbers = new Set<number>();
  private broadcast: (msg: object) => void;
  private inputCleanup?: () => void;
  private vialCleanup?: () => void;

  constructor(
    configPath: string,
    layoutPath: string,
    broadcast: (msg: object) => void,
  ) {
    this.config = this.loadConfig(configPath);
    this.layout = this.loadLayout(layoutPath);
    this.keymap = this.loadKeymap(this.config.keymapPath || 'keymap.json');
    this.applyKeymap(this.keymap);
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
        stuckKeyTimeoutMs: 10000,
        layerSignals: [], momentaryLayerSignals: [],
      };
    }
  }

  private loadKeymap(keymapPath: string): KeymapConfig {
    try {
      return JSON.parse(fs.readFileSync(path.resolve(keymapPath), 'utf-8')) as KeymapConfig;
    } catch {
      console.warn(`[Keyboard] Failed to load ${keymapPath}, using empty keymap`);
      return EMPTY_KEYMAP;
    }
  }

  private applyKeymap(keymap: KeymapConfig): void {
    this.layerNumberToName = {};
    this.layerNumberToThumbId = {};
    for (const [layerNumber, layer] of Object.entries(keymap.layers)) {
      const numericLayer = Number(layerNumber);
      this.layerNumberToName[numericLayer] = layer.name;
      if (layer.thumbId) this.layerNumberToThumbId[numericLayer] = layer.thumbId;
    }

    this.layerKeycodePos = {};
    for (const [layer, map] of Object.entries(keymap.positions)) {
      this.layerKeycodePos[layer] = numericMap(map);
    }

    this.layerShiftedKeycodePos = {};
    for (const [layer, map] of Object.entries(keymap.shiftedPositions)) {
      this.layerShiftedKeycodePos[layer] = numericMap(map);
    }

    this.baseKeycodes = new Set(keymap.baseKeycodes);
    this.shiftKeycodes = new Set(keymap.shiftKeycodes);
    this.keycodeLayer = {};
    for (const [layer, map] of Object.entries(this.layerKeycodePos)) {
      for (const keycode of Object.keys(map).map(Number)) {
        if (!this.baseKeycodes.has(keycode)) this.keycodeLayer[keycode] = layer;
      }
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
    const vialCleanup = startVialHid({
      device: this.config.vialDevice || undefined,
      debug: this.debugEnabled('hid'),
      callbacks: {
        onLayer: (layer) => this.handleVialLayer(layer),
        onLayerKey: (layer, pressed) => this.handleVialLayerKey(layer, pressed),
      },
    });
    if (vialCleanup) this.vialCleanup = vialCleanup.stop;

    const onKey = (code: string, pressed: boolean) => this.handleKey(code, pressed);
    let cleanup = startLinuxInput(onKey, this.config.inputDevice);
    if (!cleanup) {
      console.log('[Keyboard] Linux input not available, falling back to stdin');
      cleanup = startStdinInput(onKey);
    }
    if (cleanup) this.inputCleanup = cleanup.stop;
  }

  private debugEnabled(kind: 'keys' | 'layers' | 'hid'): boolean {
    if (kind === 'keys') return this.config.debugKeys ?? this.config.debug;
    if (kind === 'layers') return this.config.debugLayers ?? this.config.debug;
    return this.config.debugHid ?? this.config.debug;
  }

  private setActiveLayer(layer: string, reason: string): void {
    if (layer === this.activeLayer) return;
    this.activeLayer = layer;
    this.broadcast({ type: 'layer', layer, timestamp: Date.now() });
    if (this.debugEnabled('layers')) console.log(`[Layer] -> ${layer}${reason ? ` (${reason})` : ''}`);
  }

  private activeLayerFromPressedNumbers(): string {
    const layer = Math.max(0, ...this.activeLayerNumbers);
    return this.layerNumberToName[layer] || this.config.defaultLayer;
  }

  private handleVialLayer(layerNumber: number): void {
    if (this.activeLayerNumbers.size > 0) return;

    const layer = this.layerNumberToName[layerNumber];
    if (layer) this.setActiveLayer(layer, `Vial ${layerNumber}`);
  }

  private handleVialLayerKey(layerNumber: number, pressed: boolean): void {
    const thumbId = this.layerNumberToThumbId[layerNumber];
    if (!thumbId) return;

    if (pressed) this.activeLayerNumbers.add(layerNumber);
    else this.activeLayerNumbers.delete(layerNumber);

    const layer = this.activeLayerFromPressedNumbers();
    this.setActiveLayer(layer, `raw ${layerNumber} ${pressed ? 'DN' : 'UP'}`);

    if (pressed) this.pressedLayoutIds.add(thumbId);
    else this.pressedLayoutIds.delete(thumbId);
    this.broadcast({ type: 'key', code: thumbId, pressed, timestamp: Date.now() });
  }

  private setModifierPressed(mode: ModifierMode, keycode: number, pressed: boolean): void {
    const before = JSON.stringify(this.getModifiers());
    if (pressed) this.activeModifierKeycodes[mode].add(keycode);
    else this.activeModifierKeycodes[mode].delete(keycode);
    const modifiers = this.getModifiers();
    if (JSON.stringify(modifiers) === before) return;
    this.broadcast({ type: 'modifier', shifted: modifiers.shift, modifiers, timestamp: Date.now() });
    if (this.debugEnabled('layers')) console.log(`[Modifier] -> ${JSON.stringify(modifiers)}`);
  }

  private resolvePosition(rawCode: string, keycode: number): string {
    const shiftedLayerMap = this.layerShiftedKeycodePos[this.activeLayer];
    if (this.pressedShiftKeycodes.size > 0 && shiftedLayerMap?.[keycode] !== undefined) {
      return shiftedLayerMap[keycode];
    }

    const layerMap = this.layerKeycodePos[this.activeLayer];
    if (layerMap && layerMap[keycode] !== undefined) return layerMap[keycode];
    return this.layout.inputMap[rawCode] || rawCode;
  }

  private scheduleStuckKeyClear(rawCode: string, layoutId: string): void {
    const timeout = this.config.stuckKeyTimeoutMs ?? 10000;
    if (timeout <= 0) return;

    const existing = this.stuckKeyTimers.get(rawCode);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      if (this.pressedRawToLayoutId.get(rawCode) !== layoutId) return;
      this.pressedRawToLayoutId.delete(rawCode);
      this.pressedLayoutIds.delete(layoutId);
      this.stuckKeyTimers.delete(rawCode);
      this.broadcast({ type: 'key', code: layoutId, pressed: false, timestamp: Date.now() });
      if (this.debugEnabled('keys')) console.log(`[Key] auto-clear ${rawCode} -> ${layoutId}`);
    }, timeout);
    this.stuckKeyTimers.set(rawCode, timer);
  }

  private clearStuckKeyTimer(rawCode: string): void {
    const timer = this.stuckKeyTimers.get(rawCode);
    if (!timer) return;
    clearTimeout(timer);
    this.stuckKeyTimers.delete(rawCode);
  }

  private handleKey(rawCode: string, pressed: boolean): void {
    const keycode = NAME_TO_KEYCODE[rawCode] ?? -1;

    if (this.shiftKeycodes.has(keycode)
      && (this.layerShiftedKeycodePos[this.activeLayer] || this.pressedShiftKeycodes.has(keycode))) {
      if (pressed) this.pressedShiftKeycodes.add(keycode);
      else this.pressedShiftKeycodes.delete(keycode);
      if (this.debugEnabled('keys')) {
        console.log(`[Key] ${pressed ? 'DN' : 'UP'} ${rawCode}(${keycode}) suppressed [${this.activeLayer}]`);
      }
      return;
    }

    const modifierMode = MODIFIER_KEYCODE_MODE[keycode];
    if (modifierMode) {
      this.setModifierPressed(modifierMode, keycode, pressed);
    }

    // F13/F14 detection — MO() sends these as dummy signals
    // Legacy firmware fallback: F13 = MO(1), F14 = MO(2).
    if (keycode === 183) { // KC_F13
      const layer = pressed ? this.layerNumberToName[1] : this.config.defaultLayer;
      const thumbId = this.layerNumberToThumbId[1];
      if (!layer || !thumbId) return;
      if (layer !== this.activeLayer) {
        this.setActiveLayer(layer, `F13 ${pressed ? 'DN' : 'UP'}`);
      }
      if (pressed) this.pressedLayoutIds.add(thumbId);
      else this.pressedLayoutIds.delete(thumbId);
      this.broadcast({ type: 'key', code: thumbId, pressed, timestamp: Date.now() });
      return;
    }
    if (keycode === 184) { // KC_F14
      const layer = pressed ? this.layerNumberToName[2] : this.config.defaultLayer;
      const thumbId = this.layerNumberToThumbId[2];
      if (!layer || !thumbId) return;
      if (layer !== this.activeLayer) {
        this.setActiveLayer(layer, `F14 ${pressed ? 'DN' : 'UP'}`);
      }
      if (pressed) this.pressedLayoutIds.add(thumbId);
      else this.pressedLayoutIds.delete(thumbId);
      this.broadcast({ type: 'key', code: thumbId, pressed, timestamp: Date.now() });
      return;
    }

    // Keycode-based layer detection (fallback when firmware not modified)
    if (pressed && this.activeLayerNumbers.size === 0) {
      const layer = this.keycodeLayer[keycode] || (this.baseKeycodes.has(keycode) ? 'BASE' : null);
      if (layer && layer !== this.activeLayer) {
        this.setActiveLayer(layer, 'keycode');
      }
    }

    const layoutId = pressed
      ? this.resolvePosition(rawCode, keycode)
      : this.pressedRawToLayoutId.get(rawCode) || this.resolvePosition(rawCode, keycode);

    if (this.debugEnabled('keys')) {
      console.log(`[Key] ${pressed ? 'DN' : 'UP'} ${rawCode}(${keycode}) -> ${layoutId} [${this.activeLayer}]`);
    }

    if (pressed) {
      this.pressedRawToLayoutId.set(rawCode, layoutId);
      this.pressedLayoutIds.add(layoutId);
      this.scheduleStuckKeyClear(rawCode, layoutId);
    } else {
      this.clearStuckKeyTimer(rawCode);
      this.pressedRawToLayoutId.delete(rawCode);
      this.pressedLayoutIds.delete(layoutId);
    }

    this.broadcast({
      type: 'key',
      code: layoutId,
      pressed,
      modifier: modifierMode,
      timestamp: Date.now(),
    });
  }

  getActiveLayer(): string { return this.activeLayer; }
  getPressedKeys(): string[] { return Array.from(this.pressedLayoutIds); }
  getModifiers(): ModifierState {
    return {
      shift: this.activeModifierKeycodes.shift.size > 0,
      ctrl: this.activeModifierKeycodes.ctrl.size > 0,
      alt: this.activeModifierKeycodes.alt.size > 0,
      super: this.activeModifierKeycodes.super.size > 0,
    };
  }
  isShifted(): boolean { return this.getModifiers().shift; }
  getConfig(): Config { return this.config; }
  getLayout(): Layout { return this.layout; }
  destroy(): void {
    this.inputCleanup?.();
    this.vialCleanup?.();
    for (const timer of this.stuckKeyTimers.values()) clearTimeout(timer);
  }
}
