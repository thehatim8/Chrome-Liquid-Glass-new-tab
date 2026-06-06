// js/resize.js
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

function minWidgetCols() {
  return Math.max(1, getLayoutConfig().minWidgetCols);
}

function minWidgetRows() {
  return Math.max(1, getLayoutConfig().minWidgetRows);
}

function minWidgetWidthForGrid(grid) {
  return Math.max(32, Math.round(grid.cellW * minWidgetCols() - PAD_X));
}

function minWidgetHeightForGrid(grid) {
  return Math.max(32, Math.round(grid.cellH * minWidgetRows() - PAD_Y));
}

function overlaps(a, b) {
  return (
    a.col < b.col + b.cw &&
    a.col + a.cw > b.col &&
    a.row < b.row + b.ch &&
    a.row + a.ch > b.row
  );
}

function canPlace(item, others) {
  return !Object.values(others).some(other => overlaps(item, other));
}

function normalizeWidgetState(widgetEl, itemId, positions, sizes, grid) {
  const p = positions[itemId] || {};
  const s = sizes[itemId] || {};
  const left = Number.isFinite(p.x) ? p.x : parseFloat(widgetEl.style.left || 0);
  const top = Number.isFinite(p.y) ? p.y : parseFloat(widgetEl.style.top || 0);
  const cell = (Number.isFinite(p.col) && Number.isFinite(p.row))
    ? { col: p.col, row: p.row }
    : posToCell(left, top, grid);
  const w = Number.isFinite(s.w) ? s.w : widgetEl.offsetWidth;
  const h = Number.isFinite(s.h) ? s.h : widgetEl.offsetHeight;
  const cellSize = (Number.isFinite(s.cw) && Number.isFinite(s.ch))
    ? { cw: s.cw, ch: s.ch }
    : sizeToCells(w, h, grid);
  return { col: cell.col, row: cell.row, cw: cellSize.cw, ch: cellSize.ch };
}

function collectOtherWidgets(currentId, positions, sizes, grid) {
  const map = {};
  Array.from(document.querySelectorAll('.widget')).forEach(el => {
    if (!el.id || el.id === currentId || el.classList.contains('hidden')) return;
    map[el.id] = normalizeWidgetState(el, el.id, positions, sizes, grid);
  });
  return map;
}

function placeWidgetFromCell(el, item, grid) {
  const px = cellToPos(item.col, item.row, grid);
  const width = Math.max(minWidgetWidthForGrid(grid), Math.round(item.cw * grid.cellW - PAD_X));
  const height = Math.max(minWidgetHeightForGrid(grid), Math.round(item.ch * grid.cellH - PAD_Y));
  el.style.left = px.x + 'px';
  el.style.top = px.y + 'px';
  el.style.width = width + 'px';
  el.style.height = height + 'px';
  return { x: px.x, y: px.y, w: width, h: height };
}

function fitWithinGrid(item, grid) {
  const minCw = minWidgetCols();
  const minCh = minWidgetRows();
  return {
    col: Math.max(0, Math.min(item.col, grid.cols - 1)),
    row: Math.max(0, Math.min(item.row, grid.rows - 1)),
    cw: Math.max(minCw, Math.min(item.cw, grid.cols, grid.cols - item.col)),
    ch: Math.max(minCh, Math.min(item.ch, grid.rows, grid.rows - item.row))
  };
}

function tryPushConflicts(target, others, grid) {
  const moved = {};
  const layout = { ...others };
  const conflicts = Object.keys(layout).filter(key => overlaps(target, layout[key]));
  if (!conflicts.length) return moved;

  for (const conflictId of conflicts) {
    const conflict = layout[conflictId];
    const occupancy = { ...layout, __target__: target };
    delete occupancy[conflictId];
    const free = findNearestFreeCell(
      conflict.col,
      conflict.row,
      conflict.cw,
      conflict.ch,
      occupancy,
      grid
    );
    if (!free) return null;
    layout[conflictId] = { ...conflict, col: free.col, row: free.row };
    moved[conflictId] = { ...conflict, col: free.col, row: free.row };
  }

  return moved;
}

function findLargestNonOverlapping(item, others, grid) {
  const minCw = minWidgetCols();
  const minCh = minWidgetRows();
  let best = fitWithinGrid({ ...item, cw: minCw, ch: minCh }, grid);
  let bestArea = best.cw * best.ch;
  for (let cw = item.cw; cw >= minCw; cw--) {
    for (let ch = item.ch; ch >= minCh; ch--) {
      const candidate = fitWithinGrid({ ...item, cw, ch }, grid);
      const area = candidate.cw * candidate.ch;
      if (area < bestArea) continue;
      if (canPlace(candidate, others)) {
        best = candidate;
        bestArea = area;
      }
    }
  }
  return best;
}

export function makeResizable(widgetEl, workspaceEl, id) {
  let resizer = widgetEl.querySelector('.resizer');
  if (!resizer) {
    resizer = document.createElement('div');
    resizer.className = 'resizer';
    widgetEl.appendChild(resizer);
  }

  resizer.style.position = 'absolute';
  resizer.style.width = '14px';
  resizer.style.height = '14px';
  resizer.style.right = '8px';
  resizer.style.bottom = '8px';
  resizer.style.cursor = 'nwse-resize';
  resizer.style.zIndex = 999;
  resizer.style.background = 'transparent';

  let resizing = false;
  let start = { x: 0, y: 0, w: 0, h: 0 };
  let gridNow = null;

  function onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    resizing = true;
    start.x = e.clientX;
    start.y = e.clientY;
    start.w = widgetEl.offsetWidth;
    start.h = widgetEl.offsetHeight;
    const layout = getLayoutConfig();
    gridNow = computeGrid(workspaceEl, layout.gridCols, layout.gridRows);
    showGridOverlay(workspaceEl, gridNow.cols, gridNow.rows);

    console.debug('resize:start', { id, startW: start.w, startH: start.h, grid: { cw: gridNow.cellW, ch: gridNow.cellH } });

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp, { once: true });
  }

  function onPointerMove(e) {
    if (!resizing) return;
    e.preventDefault();
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;

    const minW = gridNow ? minWidgetWidthForGrid(gridNow) : 32;
    const minH = gridNow ? minWidgetHeightForGrid(gridNow) : 32;
    let newW = Math.max(minW, Math.round(start.w + dx));
    let newH = Math.max(minH, Math.round(start.h + dy));

    // enforce max cells
    if (gridNow) {
      const maxWpx = Math.round(gridNow.cellW * gridNow.cols - PAD_X);
      const maxHpx = Math.round(gridNow.cellH * gridNow.rows - PAD_Y);
      newW = Math.min(newW, maxWpx);
      newH = Math.min(newH, maxHpx);
    }

    widgetEl.style.width = newW + 'px';
    widgetEl.style.height = newH + 'px';

    const layout = getLayoutConfig();
    const cells = sizeToCells(newW, newH, gridNow || computeGrid(workspaceEl, layout.gridCols, layout.gridRows));
    console.debug('resize:move', { id, newW, newH, cells });
  }

  async function onPointerUp(e) {
    void e;
    resizing = false;
    window.removeEventListener('pointermove', onPointerMove);
    hideGridOverlay(workspaceEl);

    const res = await storage.get(['sizes', 'positions']);
    const sizes = res.sizes || {};
    const positions = res.positions || {};
    const layout = getLayoutConfig();
    const grid = gridNow || computeGrid(workspaceEl, layout.gridCols, layout.gridRows);

    const left = parseFloat(widgetEl.style.left || 0);
    const top = parseFloat(widgetEl.style.top || 0);
    const posCell = posToCell(left, top, grid);
    const desiredSize = sizeToCells(widgetEl.offsetWidth, widgetEl.offsetHeight, grid);
    let target = fitWithinGrid({
      col: posCell.col,
      row: posCell.row,
      cw: desiredSize.cw,
      ch: desiredSize.ch
    }, grid);

    const others = collectOtherWidgets(id, positions, sizes, grid);
    let movedWidgets = {};

    if (!canPlace(target, others)) {
      const pushed = tryPushConflicts(target, others, grid);
      if (pushed) {
        movedWidgets = pushed;
      } else {
        target = findLargestNonOverlapping(target, others, grid);
      }
    }

    const currentPx = placeWidgetFromCell(widgetEl, target, grid);
    positions[id] = { col: target.col, row: target.row, x: currentPx.x, y: currentPx.y };
    sizes[id] = { w: currentPx.w, h: currentPx.h, cw: target.cw, ch: target.ch };

    for (const movedId of Object.keys(movedWidgets)) {
      const movedEl = document.getElementById(movedId);
      const moved = movedWidgets[movedId];
      if (!movedEl) continue;
      const movedPx = placeWidgetFromCell(movedEl, moved, grid);
      positions[movedId] = { col: moved.col, row: moved.row, x: movedPx.x, y: movedPx.y };
      sizes[movedId] = { w: movedPx.w, h: movedPx.h, cw: moved.cw, ch: moved.ch };
    }

    await storage.set({ sizes, positions });
    console.debug('resize:end', { id, savedSize: sizes[id] });
  }

  resizer.addEventListener('pointerdown', onPointerDown);
}
