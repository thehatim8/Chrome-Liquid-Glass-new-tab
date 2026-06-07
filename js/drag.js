// js/drag.js
import { computeGrid, posToCell, cellToPos, sizeToCells, findNearestFreeCell, showGridOverlay, hideGridOverlay } from './grid.js';
import { storage } from './storage.js';
import { getLayoutConfig } from './layoutConfig.js';
import { syncResizeOverlays } from './resize.js';

const HOLD_MS        = 170;
const MOVE_THRESHOLD = 8;

function isEditMode() {
  return document.body.classList.contains('edit-layout-mode');
}

export function makeLongPressDraggable(widgetEl, workspaceEl, id, defaultPos) {
  if ((!widgetEl.style.left || !widgetEl.style.top) && defaultPos) {
    widgetEl.style.left = defaultPos.x + 'px';
    widgetEl.style.top  = defaultPos.y + 'px';
  }
  widgetEl.style.position  = 'absolute';
  widgetEl.style.touchAction = 'none';

  const handle = widgetEl.querySelector('.widget-handle') || widgetEl;
  handle.style.touchAction = 'none';

  let holdTimer    = null;
  let dragging     = false;
  let startClient  = { x: 0, y: 0 };
  let pointerOffset = { x: 0, y: 0 };
  let gridNow      = null;
  let capturedId   = null;

  function normalizeStoredItem(itemId, positions, sizes, grid) {
    const el = document.getElementById(itemId);
    if (!el) return null;
    const p = positions[itemId] || {}, s = sizes[itemId] || {};
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

  function onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    // Ignore clicks on resize overlay handles
    if (e.target instanceof Element && e.target.closest('.resize-overlay')) return;

    const tgt = e.target;
    const isInteractive = tgt instanceof Element
      && !!tgt.closest('button,input,textarea,select,a,[data-no-drag]');
    if (isInteractive) return;

    // In normal mode (not edit), block ALL drag — long-press is disabled outside edit mode
    if (!isEditMode()) return;

    e.preventDefault();
    capturedId = e.pointerId;
    startClient.x = e.clientX;
    startClient.y = e.clientY;

    const rect = widgetEl.getBoundingClientRect();
    pointerOffset.x = startClient.x - rect.left;
    pointerOffset.y = startClient.y - rect.top;

    // In edit mode: start drag after short hold (so taps still register as taps)
    widgetEl.classList.add('hold-ready');

    function onMoveWhileHolding(ev) {
      const dx = Math.abs(ev.clientX - startClient.x);
      const dy = Math.abs(ev.clientY - startClient.y);
      if (dx > MOVE_THRESHOLD || dy > MOVE_THRESHOLD) cancelHold();
    }

    function cancelHoldOnce(ev) {
      cancelHold();
      try { handle.releasePointerCapture(ev.pointerId); } catch (_) {}
    }

    function cancelHold() {
      widgetEl.classList.remove('hold-ready');
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
      handle.removeEventListener('pointermove', onMoveWhileHolding);
      handle.removeEventListener('pointerup',   cancelHoldOnce);
      handle.removeEventListener('pointercancel', cancelHoldOnce);
    }

    holdTimer = setTimeout(() => {
      cancelHold();
      startDrag();
    }, HOLD_MS);

    handle.addEventListener('pointermove',   onMoveWhileHolding);
    handle.addEventListener('pointerup',     cancelHoldOnce);
    handle.addEventListener('pointercancel', cancelHoldOnce);

    try { handle.setPointerCapture(e.pointerId); } catch (_) {}
  }

  function startDrag() {
    // Double-check — only drag in edit mode
    if (!isEditMode()) return;
    if (dragging) return;
    dragging = true;
    widgetEl.classList.add('dragging');
    // Stop all jiggle the moment any widget starts moving — exactly like iOS
    document.body.classList.add('widget-moving');

    const layout = getLayoutConfig();
    gridNow = computeGrid(workspaceEl, layout.gridCols, layout.gridRows);
    showGridOverlay(workspaceEl, layout.gridCols, layout.gridRows);

    window.addEventListener('pointermove',   onGlobalPointerMove, { passive: false });
    window.addEventListener('pointerup',     onGlobalPointerUp,   { once: true });
    window.addEventListener('pointercancel', onGlobalPointerUp,   { once: true });
  }

  function onGlobalPointerMove(e) {
    if (!dragging) return;
    if (e.pointerType === 'touch') e.preventDefault();

    const wsRect  = gridNow;
    const baseLeft = wsRect.rect.left;
    const baseTop  = wsRect.rect.top;
    const widgetW  = widgetEl.offsetWidth;
    const widgetH  = widgetEl.offsetHeight;

    let x = e.clientX - baseLeft - pointerOffset.x;
    let y = e.clientY - baseTop  - pointerOffset.y;

    const pad  = 6;
    const minX = wsRect.offsetX + pad;
    const minY = wsRect.offsetY + pad;
    const maxX = Math.max(minX, wsRect.offsetX + wsRect.width  - widgetW - pad);
    const maxY = Math.max(minY, wsRect.offsetY + wsRect.height - widgetH - pad);

    x = Math.round(Math.max(minX, Math.min(x, maxX)));
    y = Math.round(Math.max(minY, Math.min(y, maxY)));

    widgetEl.style.left = x + 'px';
    widgetEl.style.top  = y + 'px';

    // Keep resize overlay in sync while dragging
    syncResizeOverlays();
  }

  async function onGlobalPointerUp(e) {
    window.removeEventListener('pointermove', onGlobalPointerMove);
    hideGridOverlay(workspaceEl);

    if (!dragging) {
      widgetEl.classList.remove('hold-ready');
      try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
      return;
    }

    dragging = false;
    widgetEl.classList.remove('dragging');
    // Restore jiggle now that movement is done
    document.body.classList.remove('widget-moving');

    const left = parseFloat(widgetEl.style.left || 0);
    const top  = parseFloat(widgetEl.style.top  || 0);
    const target = posToCell(left, top, gridNow);
    const size   = sizeToCells(widgetEl.offsetWidth, widgetEl.offsetHeight, gridNow);

    const res = await storage.get(['positions', 'sizes']);
    const positions = res.positions || {};
    const sizes     = res.sizes     || {};
    const existing  = {};

    for (const el of document.querySelectorAll('.widget')) {
      if (el.classList.contains('hidden') || el.id === id) continue;
      const n = normalizeStoredItem(el.id, positions, sizes, gridNow);
      if (n) existing[el.id] = n;
    }

    const found = findNearestFreeCell(target.col, target.row, size.cw, size.ch, existing, gridNow);
    const dest  = found || target;
    const pp    = cellToPos(dest.col, dest.row, gridNow);

    widgetEl.style.left = pp.x + 'px';
    widgetEl.style.top  = pp.y + 'px';
    positions[id] = { col: dest.col, row: dest.row, x: pp.x, y: pp.y };
    sizes[id]     = { w: widgetEl.offsetWidth, h: widgetEl.offsetHeight, cw: size.cw, ch: size.ch };
    await storage.set({ positions, sizes });

    syncResizeOverlays();
    try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
  }

  handle.addEventListener('pointerdown', onPointerDown);
}
