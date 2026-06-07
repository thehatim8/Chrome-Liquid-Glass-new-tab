// js/resize.js  — iOS-style 4-corner resize via workspace overlay handles
import { storage } from './storage.js';
import {
  computeGrid,
  sizeToCells,
  showGridOverlay,
  hideGridOverlay,
  posToCell,
  cellToPos,
  findNearestFreeCell
} from './grid.js';
import { getLayoutConfig } from './layoutConfig.js';

const PAD_X = 12;
const PAD_Y = 12;

// ─── helpers ──────────────────────────────────────────────────────────────────

// Per-widget minimum cell sizes (override the global layout minimum).
const WIDGET_MIN_OVERRIDES = {
  'widget-aichat': { cols: 3, rows: 3 }
};

function minWidgetCols(id) {
  const base = Math.max(1, getLayoutConfig().minWidgetCols);
  const o = id && WIDGET_MIN_OVERRIDES[id];
  return o ? Math.max(base, o.cols) : base;
}
function minWidgetRows(id) {
  const base = Math.max(1, getLayoutConfig().minWidgetRows);
  const o = id && WIDGET_MIN_OVERRIDES[id];
  return o ? Math.max(base, o.rows) : base;
}
function minW(grid, id) { return Math.max(32, Math.round(grid.cellW * minWidgetCols(id) - PAD_X)); }
function minH(grid, id) { return Math.max(32, Math.round(grid.cellH * minWidgetRows(id) - PAD_Y)); }

function overlaps(a, b) {
  return a.col < b.col + b.cw && a.col + a.cw > b.col &&
         a.row < b.row + b.ch && a.row + a.ch > b.row;
}
function canPlace(item, others) {
  return !Object.values(others).some(o => overlaps(item, o));
}

function normalizeWidget(el, id, positions, sizes, grid) {
  const p = positions[id] || {}, s = sizes[id] || {};
  const left = Number.isFinite(p.x) ? p.x : parseFloat(el.style.left || 0);
  const top  = Number.isFinite(p.y) ? p.y : parseFloat(el.style.top  || 0);
  const cell = (Number.isFinite(p.col) && Number.isFinite(p.row))
    ? { col: p.col, row: p.row } : posToCell(left, top, grid);
  const w  = Number.isFinite(s.w)  ? s.w  : el.offsetWidth;
  const h  = Number.isFinite(s.h)  ? s.h  : el.offsetHeight;
  const cs = (Number.isFinite(s.cw) && Number.isFinite(s.ch))
    ? { cw: s.cw, ch: s.ch } : sizeToCells(w, h, grid);
  return { col: cell.col, row: cell.row, cw: cs.cw, ch: cs.ch };
}

function collectOthers(currentId, positions, sizes, grid) {
  const map = {};
  document.querySelectorAll('.widget').forEach(el => {
    if (!el.id || el.id === currentId || el.classList.contains('hidden')) return;
    map[el.id] = normalizeWidget(el, el.id, positions, sizes, grid);
  });
  return map;
}

function placeFromCell(el, item, grid, id) {
  const px  = cellToPos(item.col, item.row, grid);
  const width  = Math.max(minW(grid, id), Math.round(item.cw * grid.cellW - PAD_X));
  const height = Math.max(minH(grid, id), Math.round(item.ch * grid.cellH - PAD_Y));
  el.style.left   = px.x + 'px';
  el.style.top    = px.y + 'px';
  el.style.width  = width  + 'px';
  el.style.height = height + 'px';
  return { x: px.x, y: px.y, w: width, h: height };
}

function fitGrid(item, grid, id) {
  const mc = minWidgetCols(id), mr = minWidgetRows(id);
  return {
    col: Math.max(0, Math.min(item.col, grid.cols - 1)),
    row: Math.max(0, Math.min(item.row, grid.rows - 1)),
    cw:  Math.max(mc, Math.min(item.cw, grid.cols, grid.cols - item.col)),
    ch:  Math.max(mr, Math.min(item.ch, grid.rows, grid.rows - item.row)),
  };
}

function tryPush(target, others, grid) {
  const moved = {}, layout = { ...others };
  const conflicts = Object.keys(layout).filter(k => overlaps(target, layout[k]));
  if (!conflicts.length) return moved;
  for (const cid of conflicts) {
    const c = layout[cid];
    const occ = { ...layout, __t__: target };
    delete occ[cid];
    const free = findNearestFreeCell(c.col, c.row, c.cw, c.ch, occ, grid);
    if (!free) return null;
    layout[cid] = { ...c, col: free.col, row: free.row };
    moved[cid]  = { ...c, col: free.col, row: free.row };
  }
  return moved;
}

function findLargestFit(item, others, grid, id) {
  const mc = minWidgetCols(id), mr = minWidgetRows(id);
  let best = fitGrid({ ...item, cw: mc, ch: mr }, grid, id), bestArea = best.cw * best.ch;
  for (let cw = item.cw; cw >= mc; cw--) {
    for (let ch = item.ch; ch >= mr; ch--) {
      const c = fitGrid({ ...item, cw, ch }, grid, id);
      if (c.cw * c.ch >= bestArea && canPlace(c, others)) { best = c; bestArea = c.cw * c.ch; }
    }
  }
  return best;
}

// ─── Save helper (snap + persist widget + any pushed widgets) ─────────────────

async function snapAndSave(widgetEl, workspaceEl, id, grid) {
  const res = await storage.get(['sizes', 'positions']);
  const sizes     = res.sizes     || {};
  const positions = res.positions || {};

  const left  = parseFloat(widgetEl.style.left  || 0);
  const top   = parseFloat(widgetEl.style.top   || 0);
  const cell  = posToCell(left, top, grid);
  const dSize = sizeToCells(widgetEl.offsetWidth, widgetEl.offsetHeight, grid);
  let target  = fitGrid({ col: cell.col, row: cell.row, cw: dSize.cw, ch: dSize.ch }, grid, id);

  const others  = collectOthers(id, positions, sizes, grid);
  let moved = {};
  if (!canPlace(target, others)) {
    const pushed = tryPush(target, others, grid);
    if (pushed) { moved = pushed; }
    else        { target = findLargestFit(target, others, grid, id); }
  }

  const px = placeFromCell(widgetEl, target, grid, id);
  positions[id] = { col: target.col, row: target.row, x: px.x, y: px.y };
  sizes[id]     = { w: px.w, h: px.h, cw: target.cw, ch: target.ch };

  for (const mid of Object.keys(moved)) {
    const mel = document.getElementById(mid);
    if (!mel) continue;
    const mpx = placeFromCell(mel, moved[mid], grid, mid);
    positions[mid] = { col: moved[mid].col, row: moved[mid].row, x: mpx.x, y: mpx.y };
    sizes[mid]     = { w: mpx.w, h: mpx.h, cw: moved[mid].cw, ch: moved[mid].ch };
  }
  await storage.set({ sizes, positions });
}

// ─── Overlay handle system ─────────────────────────────────────────────────────
// One `.resize-overlay` div per widget lives directly in #workspace.
// It's a transparent full-widget-sized box with 4 corner children.
// In edit mode it becomes visible and tracks the widget exactly.

const DIRS = ['nw', 'ne', 'sw', 'se'];

// dir → which edges move
// anchorRight:  true = right edge is fixed, left edge moves   (nw/sw)
// anchorBottom: true = bottom edge is fixed, top edge moves   (nw/ne)
const DIR_CFG = {
  nw: { anchorRight: true,  anchorBottom: true  },
  ne: { anchorRight: false, anchorBottom: true  },
  sw: { anchorRight: true,  anchorBottom: false },
  se: { anchorRight: false, anchorBottom: false },
};

let overlayMap = {};   // widgetId → overlayEl
let rafSync = 0;

function syncOverlay(overlayEl, widgetEl) {
  overlayEl.style.left   = widgetEl.style.left;
  overlayEl.style.top    = widgetEl.style.top;
  overlayEl.style.width  = widgetEl.offsetWidth  + 'px';
  overlayEl.style.height = widgetEl.offsetHeight + 'px';
  // Keep overlay z-index just above its widget so it never covers other widgets' handles
  const wz = parseInt(widgetEl.style.zIndex || '5', 10);
  overlayEl.style.zIndex = (wz + 1) + '';
}

function syncAllOverlays() {
  for (const [id, ov] of Object.entries(overlayMap)) {
    const w = document.getElementById(id);
    if (w) syncOverlay(ov, w);
  }
}

function scheduleSync() {
  if (rafSync) return;
  rafSync = requestAnimationFrame(() => { rafSync = 0; syncAllOverlays(); });
}

export function makeResizable(widgetEl, workspaceEl, id) {
  // Remove any old in-widget resizers from previous version
  widgetEl.querySelectorAll('.resizer').forEach(r => r.remove());

  // Create the workspace-level overlay
  const overlay = document.createElement('div');
  overlay.className = 'resize-overlay';
  overlay.dataset.for = id;
  workspaceEl.appendChild(overlay);
  overlayMap[id] = overlay;

  // Sync overlay position whenever widget moves/resizes
  syncOverlay(overlay, widgetEl);

  // 4 corner handles inside the overlay
  DIRS.forEach(dir => {
    const handle = document.createElement('div');
    handle.className = `resize-handle resize-handle-${dir}`;
    handle.dataset.dir = dir;
    overlay.appendChild(handle);
    attachHandle(handle, dir, widgetEl, workspaceEl, id, overlay);
  });
}

function attachHandle(handle, dir, widgetEl, workspaceEl, id, overlay) {
  const cfg = DIR_CFG[dir];
  let active = false;
  let start = {};
  let gridNow = null;

  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Only in edit mode
    if (!document.body.classList.contains('edit-layout-mode')) return;
    e.preventDefault();
    e.stopPropagation();

    active = true;
    start = {
      clientX: e.clientX,
      clientY: e.clientY,
      w:    widgetEl.offsetWidth,
      h:    widgetEl.offsetHeight,
      left: parseFloat(widgetEl.style.left || 0),
      top:  parseFloat(widgetEl.style.top  || 0),
    };

    const layout = getLayoutConfig();
    gridNow = computeGrid(workspaceEl, layout.gridCols, layout.gridRows);
    showGridOverlay(workspaceEl, gridNow.cols, gridNow.rows);
    widgetEl.classList.add('resizing-active');
    overlay.classList.add('resizing-active');
    document.body.classList.add('widget-moving');

    try { handle.setPointerCapture(e.pointerId); } catch (_) {}
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup',   onUp,   { once: true });
    window.addEventListener('pointercancel', onUp, { once: true });
  }

  function onMove(e) {
    if (!active) return;
    e.preventDefault();

    const dx = e.clientX - start.clientX;
    const dy = e.clientY - start.clientY;
    const grid = gridNow;

    const minCols = minWidgetCols(id);
    const minRows = minWidgetRows(id);
    const cellW = grid.cellW;
    const cellH = grid.cellH;

    // Raw pixel target based on the drag delta…
    const rawW = cfg.anchorRight ? (start.w - dx) : (start.w + dx);
    const rawH = cfg.anchorBottom ? (start.h - dy) : (start.h + dy);

    // …then SNAP to whole grid cells live (iOS-style discrete sizing).
    let cw = Math.round((rawW + PAD_X) / cellW);
    let ch = Math.round((rawH + PAD_Y) / cellH);
    cw = Math.max(minCols, Math.min(cw, grid.cols));
    ch = Math.max(minRows, Math.min(ch, grid.rows));

    let newW = Math.round(cw * cellW - PAD_X);
    let newH = Math.round(ch * cellH - PAD_Y);
    let newLeft = start.left;
    let newTop  = start.top;

    if (cfg.anchorRight) newLeft = start.left + start.w - newW;
    if (cfg.anchorBottom) newTop = start.top + start.h - newH;

    // Keep the snapped box inside the grid bounds; snapAndSave corrects on release.
    const minX = grid.offsetX, maxX = grid.offsetX + grid.width;
    const minY = grid.offsetY, maxY = grid.offsetY + grid.height;
    if (cfg.anchorRight) {
      if (newLeft < minX) { newW = Math.round(start.left + start.w - minX); newLeft = minX; }
    } else if (newLeft + newW > maxX) {
      newW = Math.round(maxX - newLeft);
    }
    if (cfg.anchorBottom) {
      if (newTop < minY) { newH = Math.round(start.top + start.h - minY); newTop = minY; }
    } else if (newTop + newH > maxY) {
      newH = Math.round(maxY - newTop);
    }

    const L = Math.round(newLeft), T = Math.round(newTop);
    const W = Math.round(newW), H = Math.round(newH);
    widgetEl.style.left   = L + 'px';
    widgetEl.style.top    = T + 'px';
    widgetEl.style.width  = W + 'px';
    widgetEl.style.height = H + 'px';

    // Drive the overlay to the same target box so its handles spring in lockstep
    // with the widget instead of lagging behind the CSS transition.
    overlay.style.left   = L + 'px';
    overlay.style.top    = T + 'px';
    overlay.style.width  = W + 'px';
    overlay.style.height = H + 'px';
    const wz = parseInt(widgetEl.style.zIndex || '5', 10);
    overlay.style.zIndex = (wz + 1) + '';
  }

  async function onUp() {
    if (!active) return;
    active = false;
    window.removeEventListener('pointermove', onMove);
    hideGridOverlay(workspaceEl);
    widgetEl.classList.remove('resizing-active');
    overlay.classList.remove('resizing-active');
    document.body.classList.remove('widget-moving');
    await snapAndSave(widgetEl, workspaceEl, id, gridNow);
    syncOverlay(overlay, widgetEl);
  }

  handle.addEventListener('pointerdown', onDown);
}

// Call this after widgets are placed/re-laid-out so overlays stay in sync
export function syncResizeOverlays() {
  scheduleSync();
}

// Show/hide all overlays when edit mode toggles
export function setResizeOverlaysVisible(visible) {
  for (const [id, ov] of Object.entries(overlayMap)) {
    const widgetEl = document.getElementById(id);
    const isHidden = !widgetEl || widgetEl.classList.contains('hidden');
    ov.classList.toggle('active', visible && !isHidden);
  }
  if (visible) syncAllOverlays();
}

// Sync a single overlay's visibility to match its widget's current hidden state
export function updateOverlayForWidget(id) {
  const ov = overlayMap[id];
  if (!ov) return;
  const widgetEl = document.getElementById(id);
  const isHidden = !widgetEl || widgetEl.classList.contains('hidden');
  const editMode = document.body.classList.contains('edit-layout-mode');
  ov.classList.toggle('active', editMode && !isHidden);
}
