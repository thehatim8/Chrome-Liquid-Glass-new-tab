// newtab.js (module)
const DEFAULT_POSITIONS = {
  "widget-search": { x: 40, y: 40 },
  "widget-clock": { x: 360, y: 40 },
  "widget-todo": { x: 40, y: 220 }
};

const state = {
  dragging: null,
  offsetX: 0,
  offsetY: 0,
  positions: {},
  settings: { glass: true, showAnalog: false },
  todos: []
};

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

async function loadState(){
  const stored = await new Promise(resolve => chrome.storage.local.get(['positions','settings','todos'], resolve));
  state.positions = stored.positions || DEFAULT_POSITIONS;
  state.settings = stored.settings || state.settings;
  state.todos = stored.todos || [];
}

function savePositions(){
  chrome.storage.local.set({ positions: state.positions });
}

function saveSettings(){
  chrome.storage.local.set({ settings: state.settings });
}

function saveTodos(){
  chrome.storage.local.set({ todos: state.todos });
}

function placeWidgets(){
  $$('.widget').forEach(w => {
    const id = w.id;
    const pos = state.positions[id] || DEFAULT_POSITIONS[id] || { x: 40, y: 40 };
    w.style.left = pos.x + 'px';
    w.style.top = pos.y + 'px';
  });
}

function makeDraggable(el){
  el.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    state.dragging = el;
    el.classList.add('dragging');
    const rect = el.getBoundingClientRect();
    state.offsetX = e.clientX - rect.left;
    state.offsetY = e.clientY - rect.top;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}

function onMouseMove(e){
  if (!state.dragging) return;
  const el = state.dragging;
  const workspace = document.getElementById('workspace');
  const wsRect = workspace.getBoundingClientRect();
  // clamp inside workspace with some margin
  let x = e.clientX - wsRect.left - state.offsetX;
  let y = e.clientY - wsRect.top - state.offsetY;
  if (x < -20) x = -20;
  if (y < -20) y = -20;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
}

function onMouseUp(e){
  if (!state.dragging) return;
  const el = state.dragging;
  el.classList.remove('dragging');
  const left = parseFloat(el.style.left || 0);
  const top = parseFloat(el.style.top || 0);
  state.positions[el.id] = { x: left, y: top };
  savePositions();
  state.dragging = null;
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);
}

/* SEARCH logic */
function initSearch(){
  const form = $('#searchForm');
  const input = $('#searchInput');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    const url = 'https://www.google.com/search?q=' + encodeURIComponent(q);
    window.open(url, '_blank');
    input.value = '';
  });
  $$('.search-shortcuts button').forEach(btn=>{
    btn.addEventListener('click', () => {
      const engine = btn.dataset.engine;
      const q = $('#searchInput').value.trim();
      const url = engine + encodeURIComponent(q || '');
      window.open(url, '_blank');
    });
  });
}

/* CLOCK logic */
function initClock(){
  const digital = $('#clockDigital');
  const analog = $('#clockAnalog');

  function tick(){
    const now = new Date();
    const hh = now.getHours().toString().padStart(2,'0');
    const mm = now.getMinutes().toString().padStart(2,'0');
    const ss = now.getSeconds().toString().padStart(2,'0');
    digital.textContent = `${hh}:${mm}:${ss}`;
    if (state.settings.showAnalog){
      analog.style.display = 'block';
      analog.innerHTML = analogClockSVG(now);
    } else {
      analog.style.display = 'none';
    }
  }
  tick();
  setInterval(tick, 1000);
}

function analogClockSVG(date){
  const w = 140, h = 80, cx = 70, cy = 40, r = 32;
  const s = date.getSeconds(), m = date.getMinutes(), hr = date.getHours() % 12;
  const secAng = (s/60) * 360 - 90;
  const minAng = (m/60) * 360 - 90;
  const hrAng = ((hr + m/60)/12) * 360 - 90;
  function lineFromAngle(len, ang){
    const rad = ang * Math.PI/180;
    const x = cx + Math.cos(rad) * len;
    const y = cy + Math.sin(rad) * len;
    return `${cx},${cy} ${x},${y}`;
  }
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    <defs><filter id="g" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity="0.2"/></filter></defs>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.06)" />
    <polyline points="${lineFromAngle(r*0.6, hrAng)}" stroke="rgba(255,255,255,0.9)" stroke-width="3" stroke-linecap="round"/>
    <polyline points="${lineFromAngle(r*0.85, minAng)}" stroke="rgba(255,255,255,0.95)" stroke-width="2" stroke-linecap="round"/>
    <polyline points="${lineFromAngle(r*0.95, secAng)}" stroke="var(--accent)" stroke-width="1" stroke-linecap="round"/>
  </svg>`;
}

/* TODO logic */
function initTodo(){
  const input = $('#todoInput');
  const list = $('#todoList');

  function render(){
    list.innerHTML = '';
    state.todos.forEach((t, idx) => {
      const li = document.createElement('li');
      li.className = t.done ? 'completed' : '';
      li.innerHTML = `<input type="checkbox" data-idx="${idx}" ${t.done?'checked':''}> 
                      <div class="task-text">${escapeHtml(t.text)}</div>
                      <button class="del" data-idx="${idx}">✖</button>`;
      list.appendChild(li);
    });
  }

  list.addEventListener('change', e => {
    if (e.target.matches('input[type="checkbox"]')){
      const idx = parseInt(e.target.dataset.idx,10);
      state.todos[idx].done = e.target.checked;
      saveTodos();
      render();
    }
  });

  list.addEventListener('click', e => {
    if (e.target.matches('.del')){
      const idx = parseInt(e.target.dataset.idx,10);
      state.todos.splice(idx,1);
      saveTodos();
      render();
    }
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter'){
      const v = input.value.trim();
      if (!v) return;
      state.todos.unshift({ text: v, done: false });
      input.value = '';
      saveTodos();
      render();
    }
  });

  render();
}

/* UTIL */
function escapeHtml(s){ return (s+'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c])); }

/* SETTINGS modal */
function initSettings(){
  const modal = $('#settings');
  const open = $('#openSettings');
  const close = $('#closeSettings');
  const toggleGlass = $('#toggleGlass');
  const toggleAnalog = $('#toggleAnalog');
  const resetPositions = $('#resetPositions');

  open.addEventListener('click', ()=> modal.classList.remove('hidden'));
  close.addEventListener('click', ()=> {
    modal.classList.add('hidden');
  });

  toggleGlass.checked = state.settings.glass;
  toggleAnalog.checked = state.settings.showAnalog;

  toggleGlass.addEventListener('change', e => {
    state.settings.glass = !!e.target.checked;
    applySettings();
    saveSettings();
  });
  toggleAnalog.addEventListener('change', e => {
    state.settings.showAnalog = !!e.target.checked;
    applySettings();
    saveSettings();
  });

  resetPositions.addEventListener('click', () => {
    state.positions = {...DEFAULT_POSITIONS};
    savePositions();
    placeWidgets();
  });
}

function applySettings(){
  if (state.settings.glass) document.body.classList.add('glass');
  else document.body.classList.remove('glass');
}

/* Dock behavior */
function initDock(){
  $$('.dock-item').forEach(btn=>{
    btn.addEventListener('click', ()=> {
      const url = btn.dataset.url;
      if (!url) return;
      window.open(url, '_blank');
    });
  });
}

/* init everything */
(async function init(){
  await loadState();
  applySettings();
  placeWidgets();

  // make widgets draggable via handle + whole element
  $$('.widget').forEach(w => {
    makeDraggable(w);
    // if widget has handle, allow dragging when clicked on handle
    const handle = w.querySelector('.widget-handle');
    if (handle){
      handle.style.cursor = 'grab';
      handle.addEventListener('mousedown', e => {
        // forward down to parent
        const event = new MouseEvent('mousedown', { clientX: e.clientX, clientY: e.clientY, button: 0 });
        w.dispatchEvent(event);
      });
    }
  });

  initSearch();
  initClock();
  initTodo();
  initSettings();
  initDock();

  // load todos & settings
  // render todo stored
  // if stored todos/settings were loaded earlier, render updated UI
  applySettings();
})();
