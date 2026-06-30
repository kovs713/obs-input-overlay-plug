import fs from 'fs';
import os from 'os';
import path from 'path';
import { KeyboardHandler } from '../src/keyboard.js';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-overlay-mapping-'));
const configPath = path.join(tmp, 'config.json');
const layoutPath = path.join(tmp, 'layout.json');

fs.writeFileSync(configPath, JSON.stringify({
  port: 7777,
  webSocketPath: '/ws',
  defaultLayer: 'BASE',
  hideSignalKeys: true,
  debug: false,
  stuckKeyTimeoutMs: 0,
  keymapPath: path.resolve('keymap.json'),
  layerSignals: [],
  momentaryLayerSignals: [],
}));

fs.writeFileSync(layoutPath, JSON.stringify({
  layers: {},
  physicalLayout: [],
  inputMap: {
    BracketLeft: 'R00',
    Digit1: 'L11',
    Semicolon: 'R11',
    MetaLeft: 'L11',
    AltLeft: 'L12',
    ShiftLeft: 'L13',
    ControlLeft: 'L14',
  },
}));

const events: any[] = [];
const keyboard = new KeyboardHandler(configPath, layoutPath, (msg) => events.push(msg));
const handleKey = (keyboard as any).handleKey.bind(keyboard);
const handleLayerKey = (keyboard as any).handleVialLayerKey.bind(keyboard);

handleLayerKey(1, true);
handleKey('ShiftLeft', true);
handleKey('BracketLeft', true);
handleKey('BracketLeft', false);
handleKey('ShiftLeft', false);
handleLayerKey(1, false);

const braceEvents = events.filter(event => event.type === 'key' && event.code === 'R24');
assert(braceEvents.length === 2, 'expected { to press/release R24');
assert(braceEvents[0].pressed === true, 'expected R24 press');
assert(braceEvents[1].pressed === false, 'expected R24 release');
assert(!events.some(event => event.type === 'key' && event.code === 'L20'), 'expected synthetic shift suppressed');

events.length = 0;
handleLayerKey(1, true);
handleKey('Digit1', true);
handleLayerKey(1, false);
handleKey('Digit1', false);

const digitEvents = events.filter(event => event.type === 'key' && event.code === 'L11');
assert(digitEvents.length === 2, 'expected layer-mapped key to release original id');
assert(digitEvents[0].pressed === true, 'expected L11 press');
assert(digitEvents[1].pressed === false, 'expected L11 release');

events.length = 0;
handleKey('Semicolon', true);
handleKey('Semicolon', false);
const semicolonEvents = events.filter(event => event.type === 'key' && event.code === 'R11');
assert(semicolonEvents.length === 2, 'expected semicolon to press/release R11');

events.length = 0;
handleKey('MetaLeft', true);
handleKey('MetaLeft', false);
const guiEvents = events.filter(event => event.type === 'key' && event.code === 'L11');
assert(guiEvents.length === 2, 'expected left GUI home-row hold to press/release L11');
assert(guiEvents[0].modifier === 'super', 'expected left GUI modifier tag');

events.length = 0;
handleKey('ShiftLeft', true);
handleKey('ShiftLeft', false);
const modifierEvents = events.filter(event => event.type === 'modifier');
assert(modifierEvents.length === 2, 'expected shift modifier on/off events');
assert(modifierEvents[0].shifted === true, 'expected shifted true');
assert(modifierEvents[0].modifiers.shift === true, 'expected shift mode true');
assert(modifierEvents[1].shifted === false, 'expected shifted false');

events.length = 0;
handleKey('ControlLeft', true);
handleKey('AltLeft', true);
handleKey('AltLeft', false);
handleKey('ControlLeft', false);
const ctrlEvent = events.find(event => event.type === 'key' && event.code === 'L14' && event.pressed);
const altEvent = events.find(event => event.type === 'key' && event.code === 'L12' && event.pressed);
const comboModifierEvents = events.filter(event => event.type === 'modifier');
assert(ctrlEvent?.modifier === 'ctrl', 'expected ctrl modifier tag');
assert(altEvent?.modifier === 'alt', 'expected alt modifier tag');
assert(comboModifierEvents.some(event => event.modifiers.ctrl && event.modifiers.alt), 'expected ctrl+alt modes active');

keyboard.destroy();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('mapping tests passed');
