import type { WebSocket } from 'ws';

export type KeyEvent = {
  type: 'key';
  code: string;
  pressed: boolean;
  timestamp: number;
  modifier?: ModifierMode;
};

export type ModifierMode = 'shift' | 'ctrl' | 'alt' | 'super';

export type ModifierState = Record<ModifierMode, boolean>;

export type LayerEvent = {
  type: 'layer';
  layer: string;
  timestamp: number;
};

export type StateEvent = {
  type: 'state';
  layer: string;
  pressedCodes: string[];
  shifted: boolean;
  modifiers: ModifierState;
  locale: string;
};

export type ModifierEvent = {
  type: 'modifier';
  shifted: boolean;
  modifiers: ModifierState;
  timestamp: number;
};

export type LocaleEvent = {
  type: 'locale';
  locale: string;
  timestamp: number;
};

export type ClientMessage = KeyEvent | LayerEvent | StateEvent | ModifierEvent | LocaleEvent;

export type LayerSignal = {
  name: string;
  key: string;
  modifiers: string[];
};

export type Config = {
  port: number;
  webSocketPath: string;
  defaultLayer: string;
  hideSignalKeys: boolean;
  debug: boolean;
  debugKeys?: boolean;
  debugLayers?: boolean;
  debugHid?: boolean;
  stuckKeyTimeoutMs?: number;
  keymapPath?: string;
  localeSync?: boolean;
  localePollMs?: number;
  localeKeyboardName?: string;
  layerSignals: LayerSignal[];
  momentaryLayerSignals: LayerSignal[];
  inputDevice?: string;
  vialDevice?: string;
};

export type KeymapLayer = {
  name: string;
  thumbId?: string;
};

export type KeymapConfig = {
  layers: Record<string, KeymapLayer>;
  positions: Record<string, Record<string, string>>;
  shiftedPositions: Record<string, Record<string, string>>;
  baseKeycodes: number[];
  shiftKeycodes: number[];
};

export type PhysicalKey = {
  id: string;
  side: 'left' | 'right';
  row: number;
  col: number;
  width: number;
};

export type Layout = {
  layers: Record<string, Record<string, string>>;
  shiftedLayers?: Record<string, Record<string, string>>;
  locales?: Record<string, {
    layers?: Record<string, Record<string, string>>;
    shiftedLayers?: Record<string, Record<string, string>>;
  }>;
  physicalLayout: PhysicalKey[];
  inputMap: Record<string, string>;
};
