import { getLayoutConfig } from './layoutConfig.js';

function resolveGridSize(cols, rows) {
  const cfg = getLayoutConfig();
  const resolvedCols = Number.isFinite(cols) ? cols : cfg.gridCols;
  const resolvedRows = Number.isFinite(rows) ? rows : cfg.gridRows;
  return { cols: resolvedCols, rows: resolvedRows, cfg };
}

// js/grid.js
export function computeGrid(workspaceEl, cols, rows) {
  const resolved = resolveGridSize(cols, rows);
  const rect = workspaceEl.getBoundingClientRect();
  const cs = window.getComputedStyle(workspaceEl);
  const padL = parseFloat(cs.paddingLeft || '0') || 0;
  const padR = parseFloat(cs.paddingRight || '0') || 0;
  const padT = parseFloat(cs.paddingTop || '0') || 0;
  const padB = parseFloat(cs.paddingBottom || '0') || 0;
  const maxGridWidth = resolved.cfg.maxGridWidth;

  const availableWidth = Math.max(1, rect.width - padL - padR);
  const width = Math.max(1, Math.min(availableWidth, maxGridWidth));
  const height = Math.max(1, rect.height - padT - padB);
  const left = rect.left + padL + Math.max(0, (availableWidth - width) / 2);
  const top = rect.top + padT;
  const cellW = width / resolved.cols;
  const cellH = height / resolved.rows;

  const offsetX = left - rect.left;
  const offsetY = top - rect.top;
  return {
    cols: resolved.cols,
    rows: resolved.rows,
    cellW,
    cellH,
    left,
    top,
    width,
    height,
    rect,
    padL,
    padR,
    padT,
    padB,
    offsetX,
    offsetY
  };
}

export function posToCell(x, y, grid) {
  const col = Math.round((x - grid.offsetX) / grid.cellW);
  const row = Math.round((y - grid.offsetY) / grid.cellH);
  return { col: clamp(col, 0, grid.cols - 1), row: clamp(row, 0, grid.rows - 1) };
}

export function cellToPos(col, row, grid, pad = 6) {
  const x = Math.round(grid.offsetX + col * grid.cellW + pad);
  const y = Math.round(grid.offsetY + row * grid.cellH + pad);
  return { x, y };
}

export function sizeToCells(wPx, hPx, grid) {
  const cw = Math.max(1, Math.ceil(wPx / grid.cellW));
  const ch = Math.max(1, Math.ceil(hPx / grid.cellH));
  return { cw, ch };
}

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function findNearestFreeCell(targetCol, targetRow, cwNeeded, chNeeded, existingItems, grid) {
  // occupancy grid
  const occ = Array.from({ length: grid.rows }, () => Array(grid.cols).fill(false));
  for (const k in existingItems) {
    const it = existingItems[k];
    if (!it) continue;
    for (let r = it.row; r < it.row + it.ch; r++) {
      for (let c = it.col; c < it.col + it.cw; c++) {
        if (r >=0 && r < grid.rows && c >=0 && c < grid.cols) occ[r][c] = true;
      }
    }
  }

  const maxDist = Math.max(grid.cols, grid.rows) * 2;
  for (let d = 0; d <= maxDist; d++) {
    for (let dr = -d; dr <= d; dr++) {
      const dc = d - Math.abs(dr);
      for (const sx of [ -1, 1 ]) {
        const c = targetCol + dc * sx;
        const r = targetRow + dr;
        if (tryArea(c, r)) return { col: c, row: r };
      }
    }
  }

  function tryArea(startCol, startRow) {
    if (startCol < 0 || startRow < 0) return false;
    if (startCol + cwNeeded > grid.cols) return false;
    if (startRow + chNeeded > grid.rows) return false;
    for (let rr = startRow; rr < startRow + chNeeded; rr++) {
      for (let cc = startCol; cc < startCol + cwNeeded; cc++) {
        if (occ[rr][cc]) return false;
      }
    }
    return true;
  }

  return null;
}


/* ---------------- GRID OVERLAY ----------------
   showGridOverlay(workspaceEl, cols, rows) — draws an overlay that exactly matches the grid cells.
   hideGridOverlay(workspaceEl)
*/
export function showGridOverlay(workspaceEl, cols, rows) {
  const existing = workspaceEl.querySelector('.grid-overlay');
  const grid = computeGrid(workspaceEl, cols, rows);
  const cellW = grid.cellW;
  const cellH = grid.cellH;
  const offsetLeft = grid.left - grid.rect.left;
  const offsetTop = grid.top - grid.rect.top;

  let overlay = existing;
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'grid-overlay';
    overlay.style.position = 'absolute';
    overlay.style.inset = '0';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '9998';
    workspaceEl.appendChild(overlay);
  }

  overlay.style.left = `${offsetLeft}px`;
  overlay.style.top = `${offsetTop}px`;
  overlay.style.width = `${grid.width}px`;
  overlay.style.height = `${grid.height}px`;
  overlay.style.right = 'auto';
  overlay.style.bottom = 'auto';

  // vertical + horizontal line gradients
  overlay.style.backgroundImage = `
    linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)
  `;
  overlay.style.backgroundSize = `${cellW}px ${cellH}px, ${cellW}px ${cellH}px`;
  overlay.style.opacity = '0.12';
  overlay.style.transition = 'opacity .12s ease';
  overlay.style.display = 'block';
}

export function hideGridOverlay(workspaceEl) {
  const overlay = workspaceEl.querySelector('.grid-overlay');
  if (!overlay) return;
  overlay.style.display = 'none';
}

export function updatePersistentGrid(workspaceEl, cols, rows) {
  const resolved = resolveGridSize(cols, rows);
  const grid = computeGrid(workspaceEl, cols, rows);
  workspaceEl.style.setProperty('--grid-cols', String(resolved.cols));
  workspaceEl.style.setProperty('--grid-rows', String(resolved.rows));
  workspaceEl.style.setProperty('--grid-cell-w', `${grid.cellW}px`);
  workspaceEl.style.setProperty('--grid-cell-h', `${grid.cellH}px`);
  workspaceEl.style.setProperty('--grid-width', `${grid.width}px`);
  workspaceEl.style.setProperty('--grid-height', `${grid.height}px`);
  workspaceEl.style.setProperty('--grid-offset-x', `${grid.left - grid.rect.left}px`);
  workspaceEl.style.setProperty('--grid-offset-y', `${grid.top - grid.rect.top}px`);
  // Do NOT add grid-show here — grid lines should only appear during drag/resize
}
