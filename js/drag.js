// js/drag.js
import { computeGrid, posToCell, cellToPos, sizeToCells, findNearestFreeCell, showGridOverlay, hideGridOverlay } from './grid.js';
import { storage } from './storage.js';
import { getLayoutConfig } from './layoutConfig.js';

const HOLD_MS = 170;
const MOVE_THRESHOLD = 8;

export function makeLongPressDraggable(widgetEl, workspaceEl, id, defaultPos) {
  if ((!widgetEl.style.left || !widgetEl.style.top) && defaultPos) {
    widgetEl.style.left = defaultPos.x + 'px';
    widgetEl.style.top = defaultPos.y + 'px';
  }
  widgetEl.style.position = 'absolute';
  widgetEl.style.touchAction = 'none';

  const handle = widgetEl.querySelector('.widget-handle') || widgetEl;
  handle.style.touchAction = 'none';

  let holdTimer = null;
  let dragging = false;
  let startClient = { x: 0, y: 0 };
  let pointerOffset = { x: 0, y: 0 };
  let gridNow = null;

  function normalizeStoredItem(itemId, positions, sizes, grid) {
    const el = document.getElementById(itemId);
    if (!el) return null;
    const p = positions[itemId] || {};
    const s = sizes[itemId] || {};
    const left = Number.isFinite(p.x) ? p.x : parseFloat(el.style.left || 0);
    const top = Number.isFinite(p.y) ? p.y : parseFloat(el.style.top || 0);
    const cell = (Number.isFinite(p.col) && Number.isFinite(p.row))
      ? { col: p.col, row: p.row }
      : posToCell(left, top, grid);
    const w = Number.isFinite(s.w) ? s.w : el.offsetWidth;
    const h = Number.isFinite(s.h) ? s.h : el.offsetHeight;
    const cellSize = (Number.isFinite(s.cw) && Number.isFinite(s.ch))
      ? { cw: s.cw, ch: s.ch }
      : sizeToCells(w, h, grid);
    return { col: cell.col, row: cell.row, cw: cellSize.cw, ch: cellSize.ch };
  }

  function onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = e.target;
    const isInteractive = target instanceof Element
      && !!target.closest('button,input,textarea,select,a,[data-no-drag]');
    if (isInteractive) return;
    e.preventDefault();
    startClient.x = e.clientX;
    startClient.y = e.clientY;

    const rect = widgetEl.getBoundingClientRect();
    pointerOffset.x = startClient.x - rect.left;
    pointerOffset.y = startClient.y - rect.top;

    widgetEl.classList.add('hold-ready');

    function onMoveWhileHolding(ev) {
      const dx = Math.abs(ev.clientX - startClient.x);
      const dy = Math.abs(ev.clientY - startClient.y);
      if (dx > MOVE_THRESHOLD || dy > MOVE_THRESHOLD) {
        cancelHold();
      }
    }

    function cancelHoldOnce(ev) {
      cancelHold();
      try { handle.releasePointerCapture(ev.pointerId); } catch (err) {}
    }

    function cancelHold() {
      widgetEl.classList.remove('hold-ready');
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
      handle.removeEventListener('pointermove', onMoveWhileHolding);
      handle.removeEventListener('pointerup', cancelHoldOnce);
      handle.removeEventListener('pointercancel', cancelHoldOnce);
    }

    holdTimer = setTimeout(() => startDrag(), HOLD_MS);

    handle.addEventListener('pointermove', onMoveWhileHolding);
    handle.addEventListener('pointerup', cancelHoldOnce);
    handle.addEventListener('pointercancel', cancelHoldOnce);

    try { handle.setPointerCapture(e.pointerId); } catch (err) {}
  }

  function startDrag() {
    if (dragging) return;
    dragging = true;
    widgetEl.classList.remove('hold-ready');
    widgetEl.classList.add('dragging');

    const layout = getLayoutConfig();
    gridNow = computeGrid(workspaceEl, layout.gridCols, layout.gridRows);
    showGridOverlay(workspaceEl, layout.gridCols, layout.gridRows);

    console.debug('drag:start', { id, left: widgetEl.style.left, top: widgetEl.style.top,
      w: widgetEl.offsetWidth, h: widgetEl.offsetHeight, grid: { cols: gridNow.cols, rows: gridNow.rows } });

    window.addEventListener('pointermove', onGlobalPointerMove, { passive: false });
    window.addEventListener('pointerup', onGlobalPointerUp, { once: true });
    window.addEventListener('pointercancel', onGlobalPointerUp, { once: true });

    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
  }

  function onGlobalPointerMove(e) {
    if (!dragging) return;
    if (e.pointerType === 'touch') e.preventDefault();

    const wsRect = gridNow;
    const baseLeft = wsRect.rect.left;
    const baseTop = wsRect.rect.top;
    const widgetW = widgetEl.offsetWidth;
    const widgetH = widgetEl.offsetHeight;

    let x = e.clientX - baseLeft - pointerOffset.x;
    let y = e.clientY - baseTop - pointerOffset.y;

    const pad = 6;
    const minX = wsRect.offsetX + pad;
    const minY = wsRect.offsetY + pad;
    const maxX = Math.max(minX, wsRect.offsetX + wsRect.width - widgetW - pad);
    const maxY = Math.max(minY, wsRect.offsetY + wsRect.height - widgetH - pad);

    x = Math.round(Math.max(minX, Math.min(x, maxX)));
    y = Math.round(Math.max(minY, Math.min(y, maxY)));

    widgetEl.style.left = x + 'px';
    widgetEl.style.top = y + 'px';

    const approxCell = posToCell(x, y, gridNow);
    console.debug('drag:move', { id, clientX: e.clientX, clientY: e.clientY, left: x, top: y, approxCell });
  }

  async function onGlobalPointerUp(e) {
    window.removeEventListener('pointermove', onGlobalPointerMove);
    hideGridOverlay(workspaceEl);

    if (!dragging) {
      widgetEl.classList.remove('hold-ready');
      try { handle.releasePointerCapture(e.pointerId); } catch (err) {}
      return;
    }

    dragging = false;
    widgetEl.classList.remove('dragging');

    const left = parseFloat(widgetEl.style.left || 0);
    const top = parseFloat(widgetEl.style.top || 0);
    const target = posToCell(left, top, gridNow);
    const size = sizeToCells(widgetEl.offsetWidth, widgetEl.offsetHeight, gridNow);

    // load existing positions excluding self
    const res = await storage.get(['positions','sizes']);
    const positions = res.positions || {};
    const sizes = res.sizes || {};
    const existing = {};
    for (const el of Array.from(document.querySelectorAll('.widget'))) {
      if (el.classList.contains('hidden')) continue;
      const k = el.id;
      if (k === id) continue;
      const normalized = normalizeStoredItem(k, positions, sizes, gridNow);
      if (normalized) existing[k] = normalized;
    }

    const found = findNearestFreeCell(target.col, target.row, size.cw, size.ch, existing, gridNow);
    if (found) {
      const pp = cellToPos(found.col, found.row, gridNow);
      widgetEl.style.left = pp.x + 'px';
      widgetEl.style.top = pp.y + 'px';
      positions[id] = { col: found.col, row: found.row, x: pp.x, y: pp.y };
      sizes[id] = { w: widgetEl.offsetWidth, h: widgetEl.offsetHeight, cw: size.cw, ch: size.ch };
      await storage.set({ positions, sizes });
      console.debug('drag:end', { id, snappedTo: found, px: pp, size });
    } else {
      const fallback = cellToPos(target.col, target.row, gridNow);
      widgetEl.style.left = fallback.x + 'px';
      widgetEl.style.top = fallback.y + 'px';
      positions[id] = { col: target.col, row: target.row, x: fallback.x, y: fallback.y };
      sizes[id] = { w: widgetEl.offsetWidth, h: widgetEl.offsetHeight, cw: size.cw, ch: size.ch };
      await storage.set({ positions, sizes });
      console.debug('drag:end', { id, snappedTo: 'fallback', fallback, size });
    }

    try { handle.releasePointerCapture(e.pointerId); } catch (err) {}
  }

  handle.addEventListener('pointerdown', onPointerDown);
}
