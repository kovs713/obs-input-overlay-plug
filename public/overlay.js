class Overlay {
  constructor() {
    this.ws = null;
    this.layout = null;
    this.activeLayer = 'BASE';
    this.shifted = false;
    this.modifiers = { shift: false, ctrl: false, alt: false, super: false };
    this.modifierLabels = { shift: 'Shift', ctrl: 'Ctrl', alt: 'Alt', super: 'Super' };
    this.locale = 'en';
    this.pressedKeys = new Set();
    this.pressedKeyModifiers = new Map();
    this.reconnectAttempts = 0;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.wsUrl = `${proto}//${location.host}/ws`;
    this.hrmMods = {
      L11: { mode: 'super', glyph: '⌘' },
      L12: { mode: 'alt', glyph: '⌥' },
      L13: { mode: 'shift', glyph: '⇧' },
      L14: { mode: 'ctrl', glyph: '⌃' },
      R14: { mode: 'ctrl', glyph: '⌃' },
      R13: { mode: 'shift', glyph: '⇧' },
      R12: { mode: 'alt', glyph: '⌥' },
      R11: { mode: 'super', glyph: '⌘' },
    };
  }

  async init() {
    await this.loadLayout();
    this.renderKeyboard();
    this.connect();
  }

  async loadLayout() {
    try {
      const res = await fetch(`/layout.json?t=${Date.now()}`, { cache: 'no-store' });
      this.layout = await res.json();
    } catch (err) {
      console.error('[Overlay] Failed to load layout:', err);
    }
  }

  connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    this.ws = new WebSocket(this.wsUrl);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setConnected(true);
    };

    this.ws.onmessage = (e) => {
      try {
        this.handleMessage(JSON.parse(e.data));
      } catch (err) {
        console.error('[Overlay] Parse error:', err);
      }
    };

    this.ws.onclose = () => {
      this.setConnected(false);
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {};
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= 10) return;
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);
    setTimeout(() => this.connect(), delay);
  }

  handleMessage(msg) {
    if (msg.locale && msg.type !== 'locale') {
      const nextLocale = this.normalizeLocale(msg.locale);
      if (nextLocale !== this.locale) {
        this.locale = nextLocale;
        document.documentElement.lang = this.locale;
        this.updateLocaleChip();
        this.updateKeyLabels();
        this.forceRepaint();
      }
    }

    switch (msg.type) {
      case 'state':
        this.activeLayer = msg.layer;
        this.pressedKeys = new Set(msg.pressedCodes);
        this.shifted = Boolean(msg.shifted);
        this.modifiers = this.normalizeModifiers(msg.modifiers, this.shifted);
        this.syncPressedKeyModifiers();
        this.locale = this.normalizeLocale(msg.locale);
        this.updateUI();
        break;
      case 'key':
        if (msg.pressed) {
          this.pressedKeys.add(msg.code);
          if (msg.modifier) this.pressedKeyModifiers.set(msg.code, msg.modifier);
        } else {
          this.pressedKeys.delete(msg.code);
          this.pressedKeyModifiers.delete(msg.code);
        }
        this.updateKeyHighlights();
        break;
      case 'layer':
        this.activeLayer = msg.layer;
        this.updateLayerName();
        this.updateKeyLabels();
        this.animateLayerChange();
        break;
      case 'modifier':
        this.shifted = Boolean(msg.shifted);
        this.modifiers = this.normalizeModifiers(msg.modifiers, this.shifted);
        this.updateKeyLabels();
        this.updateModifierModes();
        break;
      case 'locale':
        this.locale = this.normalizeLocale(msg.locale);
        document.documentElement.lang = this.locale;
        this.updateLocaleChip();
        this.updateKeyLabels();
        this.forceRepaint();
        break;
    }
  }

  normalizeLocale(locale) {
    if (!this.layout || !this.layout.locales) return 'en';
    return this.layout.locales[locale] ? locale : 'en';
  }

  normalizeModifiers(modifiers, shifted) {
    return {
      shift: Boolean(modifiers?.shift ?? shifted),
      ctrl: Boolean(modifiers?.ctrl),
      alt: Boolean(modifiers?.alt),
      super: Boolean(modifiers?.super),
    };
  }

  syncPressedKeyModifiers() {
    this.pressedKeyModifiers.clear();
    for (const code of this.pressedKeys) {
      const hrm = this.hrmMods[code];
      if (hrm && this.modifiers[hrm.mode]) this.pressedKeyModifiers.set(code, hrm.mode);
    }
  }

  updateUI() {
    this.updateLayerName();
    this.renderKeyboard();
    this.updateModifierModes();
    this.updateLocaleChip();
  }

  renderKeyboard() {
    const container = document.getElementById('keyboard-layout');
    if (!container || !this.layout) return;

    const groups = { left: {}, right: {} };

    for (const key of this.layout.physicalLayout) {
      if (!groups[key.side][key.row]) groups[key.side][key.row] = [];
      groups[key.side][key.row].push(key);
    }

    for (const s of ['left', 'right']) {
      for (const r in groups[s]) {
        if (s === 'right') {
          groups[s][r].sort((a, b) => b.col - a.col);
        } else {
          groups[s][r].sort((a, b) => a.col - b.col);
        }
      }
    }

    container.innerHTML = '';

    for (const side of ['left', 'right']) {
      const sideEl = document.createElement('div');
      sideEl.className = 'keyboard-side';

      const rows = Object.keys(groups[side]).sort((a, b) => Number(a) - Number(b));

      for (const r of rows) {
        const isThumb = Number(r) >= 3;
        const rowEl = document.createElement('div');
        rowEl.className = isThumb ? 'thumb-row' : 'row';
        if (isThumb) rowEl.classList.add(side === 'left' ? 'thumb-left' : 'thumb-right');

        for (const key of groups[side][r]) {
          const el = document.createElement('div');
          el.className = 'key';
          el.id = `key-${key.id}`;
          if (key.width !== 1) {
            el.style.width = `calc(48px * ${key.width} + 8px * ${key.width - 1})`;
          }
          const labelEl = document.createElement('span');
          labelEl.className = 'key-label';
          labelEl.textContent = this.getKeyLabel(key.id);
          const hrm = this.hrmMods[key.id];
          if (hrm) {
            el.classList.add('key-hrm', `key-hrm-${hrm.mode}`);
            el.dataset.modGlyph = hrm.glyph;
            const statusEl = document.createElement('span');
            statusEl.className = `mode-chip hrm-status mode-${hrm.mode}`;
            statusEl.dataset.keyId = key.id;
            statusEl.dataset.mode = hrm.mode;
            statusEl.textContent = this.modifierLabels[hrm.mode];
            statusEl.setAttribute('aria-hidden', 'true');
            el.appendChild(statusEl);
          }
          el.appendChild(labelEl);
          rowEl.appendChild(el);
        }

        sideEl.appendChild(rowEl);
      }

      container.appendChild(sideEl);
    }

    this.updateKeyHighlights();
    this.scaleToFit();
  }

  scaleToFit() {
    const wrapper = document.getElementById('keyboard-wrapper');
    const container = document.getElementById('keyboard-container');
    if (!wrapper || !container) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const naturalW = container.scrollWidth;
    const naturalH = container.scrollHeight;

    if (naturalW === 0 || naturalH === 0) return;

    const scaleX = vw / naturalW;
    const scaleY = vh / naturalH;
    const scale = Math.min(scaleX, scaleY) * 0.92;

    container.style.transform = `scale(${scale})`;
  }

  getKeyLabel(id) {
    if (!this.layout) return '';
    if (this.shifted) {
      const locale = this.layout.locales && this.layout.locales[this.locale];
      const localeShiftedLayer = locale && locale.shiftedLayers && locale.shiftedLayers[this.activeLayer];
      if (localeShiftedLayer && localeShiftedLayer[id] !== undefined) return localeShiftedLayer[id];

      const shiftedLayer = this.layout.shiftedLayers && this.layout.shiftedLayers[this.activeLayer];
      if (shiftedLayer && shiftedLayer[id] !== undefined) return shiftedLayer[id];
    }

    const locale = this.layout.locales && this.layout.locales[this.locale];
    const localeLayer = locale && locale.layers && locale.layers[this.activeLayer];
    if (localeLayer && localeLayer[id] !== undefined) return localeLayer[id];

    const layer = this.layout.layers[this.activeLayer];
    return layer ? layer[id] || '' : '';
  }

  updateKeyHighlights() {
    document.querySelectorAll('.key').forEach((el) => {
      const id = el.id.replace('key-', '');
      const modifier = this.pressedKeyModifiers.get(id);
      el.classList.toggle('key-pressed', this.pressedKeys.has(id));
      el.classList.toggle('key-mod-shift', modifier === 'shift');
      el.classList.toggle('key-mod-ctrl', modifier === 'ctrl');
      el.classList.toggle('key-mod-alt', modifier === 'alt');
      el.classList.toggle('key-mod-super', modifier === 'super');
      el.classList.toggle('key-mode-active', Boolean(modifier));
    });
    this.updateModifierModes();
  }

  updateModifierModes() {
    document.querySelectorAll('.hrm-status').forEach((el) => {
      const keyId = el.dataset.keyId;
      const mode = el.dataset.mode;
      el.classList.toggle('mode-active', this.pressedKeyModifiers.get(keyId) === mode);
    });
  }

  updateLocaleChip() {
    const el = document.getElementById('locale-chip');
    if (!el) return;
    el.textContent = this.locale.toUpperCase();
    el.classList.toggle('locale-ru', this.locale === 'ru');
  }

  updateKeyLabels() {
    document.querySelectorAll('.key').forEach((el) => {
      const id = el.id.replace('key-', '');
      const label = el.querySelector('.key-label');
      if (label) label.textContent = this.getKeyLabel(id);
    });
  }

  forceRepaint() {
    const container = document.getElementById('keyboard-container');
    if (!container) return;
    container.classList.remove('force-repaint');
    void container.offsetHeight;
    container.classList.add('force-repaint');
    requestAnimationFrame(() => {
      container.classList.remove('force-repaint');
    });
  }

  updateLayerName() {
    const el = document.getElementById('layer-name');
    if (el) el.textContent = this.activeLayer;
  }

  animateLayerChange() {
    const layerEl = document.getElementById('layer-name');
    if (layerEl) {
      layerEl.classList.remove('flash');
      void layerEl.offsetWidth;
      layerEl.classList.add('flash');
      setTimeout(() => layerEl.classList.remove('flash'), 400);
    }



    document.querySelectorAll('.thumb-row .key').forEach((el) => {
      el.classList.remove('key-active');
      void el.offsetWidth;
      el.classList.add('key-active');
      setTimeout(() => el.classList.remove('key-active'), 500);
    });
  }

  setConnected(connected) {
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    const indicator = document.getElementById('connection-indicator');
    if (!dot || !text || !indicator) return;
    dot.textContent = connected ? '●' : '○';
    text.textContent = connected ? 'Connected' : 'Disconnected';
    indicator.className = connected ? 'connected' : 'disconnected';
  }
}

const overlay = new Overlay();
overlay.init();
window.addEventListener('resize', () => overlay.scaleToFit());
