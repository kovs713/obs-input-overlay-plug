class Overlay {
  constructor() {
    this.ws = null;
    this.layout = null;
    this.activeLayer = 'BASE';
    this.pressedKeys = new Set();
    this.reconnectAttempts = 0;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.wsUrl = `${proto}//${location.host}/ws`;
  }

  async init() {
    await this.loadLayout();
    this.renderKeyboard();
    this.connect();
  }

  async loadLayout() {
    try {
      const res = await fetch('/layout.json');
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
    switch (msg.type) {
      case 'state':
        this.activeLayer = msg.layer;
        this.pressedKeys = new Set(msg.pressedCodes);
        this.updateUI();
        break;
      case 'key':
        if (msg.pressed) this.pressedKeys.add(msg.code);
        else this.pressedKeys.delete(msg.code);
        this.updateKeyHighlights();
        break;
      case 'layer':
        this.activeLayer = msg.layer;
        this.updateLayerName();
        this.updateKeyLabels();
        this.animateLayerChange();
        break;
    }
  }

  updateUI() {
    this.updateLayerName();
    this.renderKeyboard();
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

        for (const key of groups[side][r]) {
          const el = document.createElement('div');
          el.className = 'key';
          el.id = `key-${key.id}`;
          if (key.width !== 1) {
            el.style.width = `calc(48px * ${key.width} + 8px * ${key.width - 1})`;
          }
          el.textContent = this.getKeyLabel(key.id);
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
    const layer = this.layout.layers[this.activeLayer];
    return layer ? layer[id] || '' : '';
  }

  updateKeyHighlights() {
    document.querySelectorAll('.key').forEach((el) => {
      const id = el.id.replace('key-', '');
      el.classList.toggle('key-pressed', this.pressedKeys.has(id));
    });
  }

  updateKeyLabels() {
    document.querySelectorAll('.key').forEach((el) => {
      const id = el.id.replace('key-', '');
      el.textContent = this.getKeyLabel(id);
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
