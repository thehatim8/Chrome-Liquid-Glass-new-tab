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

function minWidgetCols() { return Math.max(1, getLayoutConfig().minWidgetCols); }
function minWidgetRows() { return Math.max(1, getLayoutConfig().minWidgetRows); }
function minW(grid)      { return Math.max(32, Math.round(grid.cellW * minWidgetCols() - PAD_X)); }
function minH(grid)      { return Math.max(32, Math.round(grid.cellH * minWidgetRows() - PAD_Y)); }

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

function placeFromCell(el, item, grid) {
  const px  = cellToPos(item.col, item.row, grid);
  const width  = Math.max(minW(grid), Math.round(item.cw * grid.cellW - PAD_X));
  const height = Math.max(minH(grid), Math.round(item.ch * grid.cellH - PAD_Y));
  el.style.left   = px.x + 'px';
  el.style.top    = px.y + 'px';
  el.style.width  = width  + 'px';
  el.style.height = height + 'px';
  return { x: px.x, y: px.y, w: width, h: height };
}

function fitGrid(item, grid) {
  const mc = minWidgetCols(), mr = minWidgetRows();
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

function findLargestFit(item, others, grid) {
  const mc = minWidgetCols(), mr = minWidgetRows();
  let best = fitGrid({ ...item, cw: mc, ch: mr }, grid), bestArea = best.cw * best.ch;
  for (let cw = item.cw; cw >= mc; cw--) {
    for (let ch = item.ch; ch >= mr; ch--) {
      const c = fitGrid({ ...item, cw, ch }, grid);
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
  let target  = fitGrid({ col: cell.col, row: cell.row, cw: dSize.cw, ch: dSize.ch }, grid);

  const others  = collectOthers(id, positions, sizes, grid);
  let moved = {};
  if (!canPlace(target, others)) {
    const pushed = tryPush(target, others, grid);
    if (pushed) { moved = pushed; }
    else        { target = findLargestFit(target, others, grid); }
  }

  const px = placeFromCell(widgetEl, target, grid);
  positions[id] = { col: target.col, row: target.row, x: px.x, y: px.y };
  sizes[id]     = { w: px.w, h: px.h, cw: target.cw, ch: target.ch };

  for (const mid of Object.keys(moved)) {
    const mel = document.getElementById(mid);
    if (!mel) continue;
    const mpx = placeFromCell(mel, moved[mid], grid);
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

    const minWpx = minW(grid);
    const minHpx = minH(grid);
    const maxWpx = Math.round(grid.cellW * grid.cols - PAD_X);
    const maxHpx = Math.round(grid.cellH * grid.rows - PAD_Y);

    let newW = start.w, newH = start.h, newLeft = start.left, newTop = start.top;

    if (cfg.anchorRight) {
      newW    = Math.max(minWpx, Math.min(maxWpx, start.w - dx));
      newLeft = start.left + (start.w - newW);
    } else {
      newW = Math.max(minWpx, Math.min(maxWpx, start.w + dx));
    }

    if (cfg.anchorBottom) {
      newH   = Math.max(minHpx, Math.min(maxHpx, start.h - dy));
      newTop = start.top + (start.h - newH);
    } else {
      newH = Math.max(minHpx, Math.min(maxHpx, start.h + dy));
    }

    widgetEl.style.left   = Math.round(newLeft) + 'px';
    widgetEl.style.top    = Math.round(newTop)  + 'px';
    widgetEl.style.width  = Math.round(newW)    + 'px';
    widgetEl.style.height = Math.round(newH)    + 'px';

    syncOverlay(overlay, widgetEl);
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
  for (const ov of Object.values(overlayMap)) {
    ov.classList.toggle('active', visible);
  }
  if (visible) syncAllOverlays();
}
