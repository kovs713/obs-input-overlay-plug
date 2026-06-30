import type { WebSocket } from 'ws';

export type KeyEvent = {
  type: 'key';
  code: string;
  pressed: boolean;
  timestamp: number;
};

export type LayerEvent = {
  type: 'layer';
  layer: string;
  timestamp: number;
};

export type StateEvent = {
  type: 'state';
  layer: string;
  pressedCodes: string[];
};

export type ClientMessage = KeyEvent | LayerEvent | StateEvent;

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
  layerSignals: LayerSignal[];
  momentaryLayerSignals: LayerSignal[];
  inputDevice?: string;
  vialDevice?: string;
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
  physicalLayout: PhysicalKey[];
  inputMap: Record<string, string>;
};
