import fs from 'fs';

const html = fs.readFileSync('newtab.html', 'utf8');

// extract element IDs from html
const idRegex = /id="([^"]+)"/g;
const ids = new Set();
let m;
while ((m = idRegex.exec(html)) !== null) {
  ids.add(m[1]);
}

const elements = {};
ids.forEach(id => {
  elements[id] = {
    id,
    textContent: '',
    value: '',
    style: {
      setProperty: () => {},
      removeProperty: () => {}
    },
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      toggle(c, force) { if (force !== undefined) { force ? this.add(c) : this.remove(c); } else { this._classes.has(c) ? this.remove(c) : this.add(c); } },
      contains(c) { return this._classes.has(c); }
    },
    getBoundingClientRect() { return { left: 0, top: 0, width: 1200, height: 800, right: 1200, bottom: 800 }; },
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    appendChild() {},
    insertBefore() {},
    dataset: {},
    focus() {}
  };
});

global.window = {
  innerWidth: 1280,
  innerHeight: 800,
  addEventListener: () => {},
  removeEventListener: () => {},
  requestAnimationFrame: (cb) => setTimeout(cb, 0),
  cancelAnimationFrame: (id) => clearTimeout(id),
  getComputedStyle: () => ({
    paddingLeft: '8px',
    paddingRight: '8px',
    paddingTop: '14px',
    paddingBottom: '16px'
  })
};
global.requestAnimationFrame = global.window.requestAnimationFrame;
global.cancelAnimationFrame = global.window.cancelAnimationFrame;
global.document = {
  addEventListener: () => {},
  removeEventListener: () => {},
  querySelector: (sel) => {
    if (sel.startsWith('#')) return elements[sel.slice(1)] || null;
    return null;
  },
  querySelectorAll: () => [],
  getElementById: (id) => elements[id] || null,
  createElement: (tag) => ({
    tagName: tag,
    style: { setProperty: () => {}, removeProperty: () => {} },
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild() {},
    addEventListener() {},
    dataset: {},
    setAttribute: () => {},
    getAttribute: () => null,
    removeAttribute: () => {},
    querySelector: () => ({ addEventListener: () => {}, style: {} }),
    querySelectorAll: () => []
  }),
  documentElement: { style: { setProperty() {} } },
  body: {
    classList: {
      _classes: new Set(['app-booting']),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      toggle(c, force) { if (force !== undefined) { force ? this.add(c) : this.remove(c); } else { this._classes.has(c) ? this.remove(c) : this.add(c); } },
      contains(c) { return this._classes.has(c); }
    },
    appendChild: () => {},
    style: {
      setProperty: () => {},
      removeProperty: () => {}
    },
    dataset: {}
  },
  dispatchEvent: () => {}
};
const origFetch = global.fetch;
global.fetch = async (url, ...args) => {
  if (String(url).includes('default-settings.json')) {
    const raw = fs.readFileSync('default Settings/default-settings.json', 'utf8');
    return {
      ok: true,
      status: 200,
      json: async () => JSON.parse(raw)
    };
  }
  return origFetch ? origFetch(url, ...args) : { ok: false, status: 404 };
};

global.chrome = {
  runtime: {
    onMessage: { addListener: () => {} },
    getURL: (p) => new URL(p, 'http://localhost/').href,
    sendMessage: () => {}
  },
  storage: {
    local: {
      get: (keys, cb) => {
        const res = {};
        if (cb) cb(res);
        return Promise.resolve(res);
      },
      set: (items, cb) => {
        if (cb) cb();
        return Promise.resolve();
      },
      remove: (keys, cb) => {
        if (cb) cb();
        return Promise.resolve();
      },
      onChanged: { addListener: () => {} }
    },
    onChanged: { addListener: () => {} }
  }
};

process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION:', err);
  process.exit(1);
});

try {
  await import('../js/main.js');
  console.log('main.js loaded!');
  // Wait up to 2 seconds for bootstrap to finish
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 100));
    if (!document.body.classList.contains('app-booting')) {
      console.log('BOOTSTRAP COMPLETED! app-booting removed!');
      console.log('Final body classes:', Array.from(document.body.classList._classes));
      const widgetIds = [
        'widget-search',
        'widget-clock',
        'widget-todo',
        'widget-image',
        'widget-notes',
        'widget-aichat',
        'widget-calendar',
        'widget-dayprogress',
        'widget-pomodoro',
        'widget-sports',
        'widget-weather',
        'widget-currency'
      ];
      for (const wid of widgetIds) {
        const el = elements[wid];
        console.log(wid, {
          left: el.style.left,
          top: el.style.top,
          width: el.style.width,
          height: el.style.height,
          hidden: el.classList.contains('hidden')
        });
      }
      process.exit(0);
    }
  }
  console.error('TIMED OUT WAITING FOR app-booting TO BE REMOVED!');
  console.log('Body classes still:', Array.from(document.body.classList._classes));
  process.exit(1);
} catch (err) {
  console.error('CRASH in main.js:', err);
  process.exit(1);
}
