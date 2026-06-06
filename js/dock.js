import { storage } from './storage.js';
import { resolveCachedIconUrl } from './iconCache.js';

const DEFAULT_ITEMS = [
  {
    url: 'https://github.com',
    iconUrl: 'https://www.google.com/s2/favicons?domain=github.com&sz=64',
    label: 'GitHub',
    side: 'left'
  },
  {
    url: 'https://mail.google.com',
    iconUrl: 'https://www.google.com/s2/favicons?domain=mail.google.com&sz=64',
    label: 'Mail',
    side: 'left'
  },
  {
    url: 'https://calendar.google.com',
    iconUrl: 'https://www.google.com/s2/favicons?domain=calendar.com&sz=64',
    label: 'Calendar',
    side: 'left'
  },
  {
    url: 'https://youtube.com',
    iconUrl: 'https://www.google.com/s2/favicons?domain=youtube.com&sz=64',
    label: 'youtube',
    side: 'right'
  },
  {
    url: 'https://web.whatsapp.com',
    iconUrl: 'https://www.google.com/s2/favicons?domain=whatsapp.com&sz=64',
    label: 'Whatsapp',
    side: 'right'
  }
];

const ICON_CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

function normalizeUrl(raw) {
  const v = (raw || '').trim();
  if (!v) return '';
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(v)) return v;
  return `https://${v}`;
}

function hostnameFromUrl(url) {
  try {
    return new URL(normalizeUrl(url)).hostname.replace(/^www\./, '');
  } catch (err) {
    return (url || '').replace(/^https?:\/\//, '').replace(/^www\./, '');
  }
}

function fallbackIconForUrl(url) {
  const host = hostnameFromUrl(url);
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}

function normalizeItem(it) {
  const url = normalizeUrl(it.url || '');
  return {
    url,
    iconUrl: (it.iconUrl || '').trim() || fallbackIconForUrl(url),
    label: (it.label || '').trim() || hostnameFromUrl(url),
    side: it.side === 'left' ? 'left' : 'right'
  };
}

function applyCachedIcon(img, src) {
  const raw = String(src || '').trim();
  if (!img || !raw) return;
  img.dataset.iconSrc = raw;
  img.src = raw;
  resolveCachedIconUrl(raw, { maxAgeMs: ICON_CACHE_MAX_AGE_MS })
    .then((resolved) => {
      if (!img.isConnected) return;
      if (img.dataset.iconSrc !== raw) return;
      if (resolved && resolved !== img.src) img.src = resolved;
    })
    .catch(() => {});
}

export async function initDock() {
  const DOCK_DRAG_HOLD_MS = 100;
  const res = await storage.get(['dockItems', 'dockOpenMode']);
  const items = (res.dockItems || DEFAULT_ITEMS.slice()).map(normalizeItem);
  let dockOpenMode = res.dockOpenMode === 'same-tab' ? 'same-tab' : 'new-tab';

  const dockRight = document.getElementById('dockRight');
  const dockInner = document.getElementById('dockInner');
  const separator = document.getElementById('dockSeparator');
  const openEditorBtn = document.getElementById('openDockEditor');
  const dockEditor = document.getElementById('dockEditor');
  const closeDockEditor = document.getElementById('closeDockEditor');
  const addDockItemBtn = document.getElementById('addDockItem');
  const cancelDockEdit = document.getElementById('cancelDockEdit');
  const dockItemName = document.getElementById('dockItemName');
  const dockItemUrl = document.getElementById('dockItemUrl');
  const dockItemIconUrl = document.getElementById('dockItemIconUrl');
  const dockItemsList = document.getElementById('dockItemsList');
  const dockOpenModeBtn = document.getElementById('dockOpenModeBtn');

  let editingIndex = null;
  let dragIndex = null;
  let suppressClick = false;
  let suppressClickUntil = 0;
  let placeholder = null;
  let pointerDrag = null;
  let hoverTipEl = null;

  function ensureHoverTip() {
    if (hoverTipEl && document.body.contains(hoverTipEl)) return hoverTipEl;
    hoverTipEl = document.createElement('div');
    hoverTipEl.className = 'dock-hover-tip';
    document.body.appendChild(hoverTipEl);
    return hoverTipEl;
  }

  function hideHoverTip() {
    if (!hoverTipEl) return;
    hoverTipEl.classList.remove('visible');
  }

  function showHoverTip(label, x, y) {
    const tip = ensureHoverTip();
    const text = String(label || '').trim();
    if (!text) return;
    tip.textContent = text;
    tip.style.left = `${Math.round(x)}px`;
    tip.style.top = `${Math.round(y)}px`;
    tip.classList.add('visible');
  }

  function suppressClicksBriefly(ms = 420) {
    suppressClick = true;
    suppressClickUntil = Date.now() + Math.max(120, ms);
    setTimeout(() => {
      if (Date.now() >= suppressClickUntil) suppressClick = false;
    }, Math.max(140, ms + 40));
  }

  async function save() {
    await storage.set({ dockItems: items.map(normalizeItem) });
  }

  function updateDockOpenModeBtn() {
    if (!dockOpenModeBtn) return;
    const isSameTab = dockOpenMode === 'same-tab';
    dockOpenModeBtn.textContent = isSameTab ? 'Open: Same Tab' : 'Open: New Tab';
    dockOpenModeBtn.title = isSameTab
      ? 'Dock links open in the current tab'
      : 'Dock links open in a new tab';
  }

  function splitBySide(arr = items) {
    return {
      left: arr.filter((it) => it.side !== 'right'),
      right: arr.filter((it) => it.side === 'right')
    };
  }

  function moveItemTo(draggedIdx, toSide, toPos) {
    if (!Number.isFinite(draggedIdx) || draggedIdx < 0 || draggedIdx >= items.length) return false;
    const next = items.slice();
    const [dragged] = next.splice(draggedIdx, 1);
    dragged.side = toSide === 'left' ? 'left' : 'right';

    const parts = splitBySide(next);
    const target = dragged.side === 'left' ? parts.left : parts.right;
    const pos = Math.max(0, Math.min(Number.isFinite(toPos) ? toPos : target.length, target.length));
    target.splice(pos, 0, dragged);

    const merged = [...parts.left, ...parts.right];
    items.splice(0, items.length, ...merged);
    return true;
  }

  function indexInSideFromElement(el) {
    if (!(el instanceof HTMLElement)) return null;
    const v = Number(el.dataset.sidePos);
    return Number.isFinite(v) ? v : null;
  }

  function ensurePlaceholder() {
    if (placeholder) return placeholder;
    const p = document.createElement('div');
    p.className = 'dock-item dock-placeholder';
    p.setAttribute('aria-hidden', 'true');
    placeholder = p;
    return p;
  }

  function clearPlaceholder() {
    if (placeholder && placeholder.parentElement) placeholder.parentElement.removeChild(placeholder);
  }

  function getLeftDockItemsWithPlaceholder() {
    return Array.from(dockInner.children).filter((n) =>
      n === placeholder || (n instanceof HTMLElement && n.classList.contains('dock-item') && n.id !== 'dockSeparator')
    );
  }

  function getRightDockItemsWithPlaceholder() {
    return Array.from(dockRight.children).filter((n) =>
      n === placeholder || (n instanceof HTMLElement && n.classList.contains('dock-item'))
    );
  }

  function insertPlaceholder(side, pos) {
    const p = ensurePlaceholder();
    clearPlaceholder();
    if (side === 'right') {
      const itemsNow = getRightDockItemsWithPlaceholder().filter((n) => n !== p);
      const at = Math.max(0, Math.min(pos, itemsNow.length));
      if (at >= itemsNow.length) dockRight.appendChild(p);
      else dockRight.insertBefore(p, itemsNow[at]);
      return;
    }

    const itemsNow = getLeftDockItemsWithPlaceholder().filter((n) => n !== p);
    const at = Math.max(0, Math.min(pos, itemsNow.length));
    if (at >= itemsNow.length) dockInner.insertBefore(p, separator);
    else dockInner.insertBefore(p, itemsNow[at]);
  }

  function getDropFromPlaceholder() {
    if (!placeholder || !placeholder.parentElement) return null;
    if (placeholder.parentElement === dockRight) {
      const list = getRightDockItemsWithPlaceholder();
      const pos = list.indexOf(placeholder);
      return { side: 'right', pos: Math.max(0, pos) };
    }
    const list = getLeftDockItemsWithPlaceholder();
    const pos = list.indexOf(placeholder);
    return { side: 'left', pos: Math.max(0, pos) };
  }

  function currentPlaceholderSide() {
    if (!placeholder || !placeholder.parentElement) return null;
    return placeholder.parentElement === dockRight ? 'right' : 'left';
  }

  function sidePosForIndex(idx) {
    if (!Number.isFinite(idx) || idx < 0 || idx >= items.length) return null;
    const side = items[idx].side === 'right' ? 'right' : 'left';
    let pos = 0;
    for (let i = 0; i < idx; i++) {
      const prevSide = items[i].side === 'right' ? 'right' : 'left';
      if (prevSide === side) pos += 1;
    }
    return { side, pos };
  }

  function cleanElementsForInsert(elements) {
    return elements.filter((n) =>
      n !== placeholder &&
      !(n instanceof HTMLElement && n.classList.contains('dragging'))
    );
  }

  function computeInsertPosByX(elements, clientX) {
    const list = cleanElementsForInsert(elements);
    if (!list.length) return 0;
    for (let i = 0; i < list.length; i++) {
      const rect = list[i].getBoundingClientRect();
      const mid = rect.left + rect.width / 2;
      if (clientX < mid) return i;
    }
    return list.length;
  }

  function updatePlaceholderFromClientX(clientX) {
    const sepRect = separator.getBoundingClientRect();
    const deadzone = 26;
    const leftBoundary = sepRect.left - deadzone;
    const rightBoundary = sepRect.right + deadzone;
    let side = currentPlaceholderSide();
    if (clientX <= leftBoundary) side = 'left';
    else if (clientX >= rightBoundary) side = 'right';
    else if (!side) side = clientX < (sepRect.left + sepRect.width / 2) ? 'left' : 'right';

    if (side === 'left') {
      const pos = computeInsertPosByX(getLeftDockItemsWithPlaceholder(), clientX);
      insertPlaceholder('left', pos);
    } else {
      const pos = computeInsertPosByX(getRightDockItemsWithPlaceholder(), clientX);
      insertPlaceholder('right', pos);
    }
  }

  function resetForm() {
    editingIndex = null;
    if (dockItemName) dockItemName.value = '';
    if (dockItemUrl) dockItemUrl.value = '';
    if (dockItemIconUrl) dockItemIconUrl.value = '';
    if (addDockItemBtn) addDockItemBtn.textContent = 'Add';
    if (cancelDockEdit) cancelDockEdit.classList.add('hidden');
  }

  function fillFormForEdit(it, idx) {
    editingIndex = idx;
    if (dockItemName) dockItemName.value = it.label || '';
    if (dockItemUrl) dockItemUrl.value = it.url || '';
    if (dockItemIconUrl) dockItemIconUrl.value = it.iconUrl || '';
    if (addDockItemBtn) addDockItemBtn.textContent = 'Update';
    if (cancelDockEdit) cancelDockEdit.classList.remove('hidden');
  }

  function makeBtn(it, idx, sidePos) {
    const btn = document.createElement('button');
    btn.className = 'dock-item';
    btn.title = it.label || it.url;
    btn.setAttribute('data-label', (it.label || hostnameFromUrl(it.url)));
    btn.dataset.idx = String(idx);
    btn.dataset.side = it.side === 'right' ? 'right' : 'left';
    btn.dataset.sidePos = String(sidePos);
    btn.draggable = false;
    const img = document.createElement('img');
    img.className = 'dock-item-icon';
    applyCachedIcon(img, it.iconUrl || fallbackIconForUrl(it.url));
    img.alt = it.label || 'Dock item';
    btn.appendChild(img);
    btn.addEventListener('mouseenter', (e) => {
      const label = btn.getAttribute('data-label') || it.label || hostnameFromUrl(it.url);
      showHoverTip(label, e.clientX, e.clientY);
    });
    btn.addEventListener('mousemove', (e) => {
      if (!hoverTipEl || !hoverTipEl.classList.contains('visible')) return;
      hoverTipEl.style.left = `${Math.round(e.clientX)}px`;
      hoverTipEl.style.top = `${Math.round(e.clientY)}px`;
    });
    btn.addEventListener('mouseleave', () => hideHoverTip());
    btn.addEventListener('focus', () => {
      const label = btn.getAttribute('data-label') || it.label || hostnameFromUrl(it.url);
      const rect = btn.getBoundingClientRect();
      showHoverTip(label, rect.left + rect.width / 2, rect.top);
    });
    btn.addEventListener('blur', () => hideHoverTip());
    btn.addEventListener('click', () => {
      if (suppressClick || Date.now() < suppressClickUntil) return;
      const target = normalizeUrl(it.url);
      if (!target) return;
      if (dockOpenMode === 'same-tab') {
        window.location.href = target;
      } else {
        window.open(target, '_blank', 'noopener');
      }
    });
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      hideHoverTip();
      pointerDrag = {
        pointerId: e.pointerId,
        idx: Number(btn.dataset.idx),
        startX: e.clientX,
        startY: e.clientY,
        downAt: performance.now(),
        started: false,
        element: btn
      };
      btn.setPointerCapture(e.pointerId);
    });
    btn.addEventListener('pointermove', (e) => {
      if (!pointerDrag || pointerDrag.pointerId !== e.pointerId || pointerDrag.idx !== Number(btn.dataset.idx)) return;
      const dx = e.clientX - pointerDrag.startX;
      const dy = e.clientY - pointerDrag.startY;
      const heldFor = performance.now() - pointerDrag.downAt;
      if (!pointerDrag.started && heldFor < DOCK_DRAG_HOLD_MS) return;
      if (!pointerDrag.started && (Math.abs(dx) + Math.abs(dy) < 5)) return;
      if (!pointerDrag.started) {
        pointerDrag.started = true;
        dragIndex = pointerDrag.idx;
        suppressClick = true;
        dockInner.classList.add('dock-drag-active');
        btn.classList.add('dragging');
        const side = btn.dataset.side === 'right' ? 'right' : 'left';
        const pos = indexInSideFromElement(btn) ?? 0;
        insertPlaceholder(side, pos);
      }
      e.preventDefault();
      updatePlaceholderFromClientX(e.clientX);
    });
    btn.addEventListener('pointerup', async (e) => {
      if (!pointerDrag || pointerDrag.pointerId !== e.pointerId || pointerDrag.idx !== Number(btn.dataset.idx)) return;
      const wasDragging = pointerDrag.started;
      pointerDrag = null;
      if (btn.hasPointerCapture(e.pointerId)) btn.releasePointerCapture(e.pointerId);
      if (!wasDragging) return;
      const drop = getDropFromPlaceholder();
      const draggedIdx = dragIndex;
      btn.classList.remove('dragging');
      dragIndex = null;
      dockInner.classList.remove('dock-drag-active');
      clearPlaceholder();
      suppressClicksBriefly(520);
      if (!Number.isFinite(draggedIdx) || !drop) return;
      const changed = moveItemTo(draggedIdx, drop.side, drop.pos);
      if (!changed) return;
      await save();
      render();
    });
    btn.addEventListener('pointercancel', (e) => {
      if (!pointerDrag || pointerDrag.pointerId !== e.pointerId || pointerDrag.idx !== Number(btn.dataset.idx)) return;
      pointerDrag = null;
      if (btn.hasPointerCapture(e.pointerId)) btn.releasePointerCapture(e.pointerId);
      btn.classList.remove('dragging');
      dragIndex = null;
      dockInner.classList.remove('dock-drag-active');
      clearPlaceholder();
      suppressClicksBriefly(420);
      hideHoverTip();
    });
    btn.addEventListener('dragstart', (e) => {
      dragIndex = Number(btn.dataset.idx);
      suppressClick = true;
      dockInner.classList.add('dock-drag-active');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', btn.dataset.idx || '');
      }
      btn.classList.add('dragging');
      const side = btn.dataset.side === 'right' ? 'right' : 'left';
      const sidePos = indexInSideFromElement(btn) ?? 0;
      insertPlaceholder(side, sidePos);
    });
    btn.addEventListener('dragend', () => {
      btn.classList.remove('dragging');
      dragIndex = null;
      dockInner.classList.remove('dock-drag-active');
      clearPlaceholder();
      suppressClicksBriefly(420);
    });
    btn.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      const targetSide = btn.dataset.side === 'right' ? 'right' : 'left';
      const sidePos = indexInSideFromElement(btn);
      if (sidePos === null) return;
      const rect = btn.getBoundingClientRect();
      const insertPos = e.clientX > (rect.left + rect.width / 2) ? sidePos + 1 : sidePos;
      insertPlaceholder(targetSide, insertPos);
    });
    btn.addEventListener('drop', async (e) => {
      e.preventDefault();
      const draggedIdx = dragIndex;
      if (!Number.isFinite(draggedIdx)) return;
      const drop = getDropFromPlaceholder();
      if (!drop) return;
      const changed = moveItemTo(draggedIdx, drop.side, drop.pos);
      if (!changed) return;
      await save();
      render();
    });
    return btn;
  }

  function renderEditorRow(it, idx) {
    const row = document.createElement('div');
    row.className = 'dock-row';

    const left = document.createElement('div');
    left.className = 'dock-row-left';
    const img = document.createElement('img');
    img.className = 'dock-item-icon dock-row-icon';
    applyCachedIcon(img, it.iconUrl || fallbackIconForUrl(it.url));
    img.alt = it.label || 'Dock item';

    const meta = document.createElement('div');
    const name = document.createElement('div');
    name.textContent = it.label || hostnameFromUrl(it.url);
    name.style.fontWeight = '600';
    const url = document.createElement('div');
    url.textContent = hostnameFromUrl(it.url);
    url.style.opacity = '0.7';
    url.style.fontSize = '12px';
    meta.appendChild(name);
    meta.appendChild(url);

    left.appendChild(img);
    left.appendChild(meta);

    const right = document.createElement('div');
    right.style.display = 'flex';
    right.style.gap = '6px';

    const upBtn = document.createElement('button');
    upBtn.className = 'btn-secondary move-up';
    upBtn.dataset.idx = String(idx);
    upBtn.title = 'Move up';
    upBtn.textContent = '↑';

    const downBtn = document.createElement('button');
    downBtn.className = 'btn-secondary move-down';
    downBtn.dataset.idx = String(idx);
    downBtn.title = 'Move down';
    downBtn.textContent = '↓';

    const editBtn = document.createElement('button');
    editBtn.className = 'btn-secondary edit';
    editBtn.dataset.idx = String(idx);
    editBtn.textContent = 'Edit';

    const delBtn = document.createElement('button');
    delBtn.className = 'btn-secondary del';
    delBtn.dataset.idx = String(idx);
    delBtn.textContent = 'Delete';

    right.appendChild(upBtn);
    right.appendChild(downBtn);
    right.appendChild(editBtn);
    right.appendChild(delBtn);
    row.appendChild(left);
    row.appendChild(right);
    return row;
  }

  function render() {
    hideHoverTip();
    Array.from(dockInner.querySelectorAll('.dock-item')).forEach((n) => n.remove());
    const indexed = items.map((it, idx) => ({ it, idx }));
    const left = indexed.filter(({ it }) => it.side !== 'right');
    const right = indexed.filter(({ it }) => it.side === 'right');

    left.forEach(({ it, idx }, sidePos) => {
      dockInner.insertBefore(makeBtn(it, idx, sidePos), separator);
    });

    dockRight.innerHTML = '';
    right.forEach(({ it, idx }, sidePos) => {
      dockRight.appendChild(makeBtn(it, idx, sidePos));
    });

    dockItemsList.innerHTML = '';
    items.forEach((it, idx) => {
      dockItemsList.appendChild(renderEditorRow(it, idx));
    });
  }

  function setupDockDropZones() {
    const allowDrop = (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    };

    dockRight.addEventListener('dragover', (e) => {
      allowDrop(e);
      if (!Number.isFinite(dragIndex)) return;
      const pos = computeInsertPosByX(getRightDockItemsWithPlaceholder(), e.clientX);
      insertPlaceholder('right', pos);
    });
    dockRight.addEventListener('dragenter', () => {
      if (!Number.isFinite(dragIndex)) return;
      insertPlaceholder('right', getRightDockItemsWithPlaceholder().filter((n) => n !== placeholder).length);
    });
    dockRight.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (!Number.isFinite(dragIndex)) return;
      const drop = getDropFromPlaceholder() || { side: 'right', pos: splitBySide().right.length };
      const changed = moveItemTo(dragIndex, drop.side, drop.pos);
      if (!changed) return;
      await save();
      render();
    });

    separator.addEventListener('dragover', (e) => {
      allowDrop(e);
      if (!Number.isFinite(dragIndex)) return;
      const sepRect = separator.getBoundingClientRect();
      const toLeft = e.clientX < (sepRect.left + sepRect.width / 2);
      insertPlaceholder(toLeft ? 'left' : 'right', toLeft ? splitBySide().left.length : 0);
    });
    separator.addEventListener('dragenter', (e) => {
      if (!Number.isFinite(dragIndex)) return;
      const sepRect = separator.getBoundingClientRect();
      const toLeft = e.clientX < (sepRect.left + sepRect.width / 2);
      insertPlaceholder(toLeft ? 'left' : 'right', toLeft ? splitBySide().left.length : 0);
    });
    separator.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (!Number.isFinite(dragIndex)) return;
      const drop = getDropFromPlaceholder();
      if (!drop) return;
      const changed = moveItemTo(dragIndex, drop.side, drop.pos);
      if (!changed) return;
      await save();
      render();
    });

    dockInner.addEventListener('dragover', (e) => {
      allowDrop(e);
      if (!Number.isFinite(dragIndex)) return;
      const sepRect = separator.getBoundingClientRect();
      const deadzone = 18;
      const leftBoundary = sepRect.left - deadzone;
      const rightBoundary = sepRect.right + deadzone;
      let side = currentPlaceholderSide();
      if (e.clientX <= leftBoundary) side = 'left';
      else if (e.clientX >= rightBoundary) side = 'right';
      else if (!side) side = e.clientX < (sepRect.left + sepRect.width / 2) ? 'left' : 'right';

      if (side === 'left') {
        const pos = computeInsertPosByX(getLeftDockItemsWithPlaceholder(), e.clientX);
        insertPlaceholder('left', pos);
      } else {
        const pos = computeInsertPosByX(getRightDockItemsWithPlaceholder(), e.clientX);
        insertPlaceholder('right', pos);
      }
    });
    dockInner.addEventListener('drop', async (e) => {
      if (!(e.target instanceof HTMLElement)) return;
      if (e.target.closest('.dock-item') || e.target.closest('#dockRight') || e.target.closest('#dockSeparator')) return;
      e.preventDefault();
      if (!Number.isFinite(dragIndex)) return;
      const sepRect = separator.getBoundingClientRect();
      const toLeft = e.clientX < (sepRect.left + sepRect.width / 2);
      insertPlaceholder(toLeft ? 'left' : 'right', toLeft ? splitBySide().left.length : splitBySide().right.length);
      const drop = getDropFromPlaceholder();
      if (!drop) return;
      const changed = moveItemTo(dragIndex, drop.side, drop.pos);
      if (!changed) return;
      await save();
      render();
    });
  }

  let outsideClickListener = null;
  openEditorBtn.addEventListener('click', () => {
    dockEditor.classList.remove('hidden');
    resetForm();
    render();
    outsideClickListener = (ev) => {
      const card = dockEditor.querySelector('.modal-card');
      if (!card || card.contains(ev.target)) return;
      dockEditor.classList.add('hidden');
      document.removeEventListener('mousedown', outsideClickListener);
      outsideClickListener = null;
    };
    setTimeout(() => document.addEventListener('mousedown', outsideClickListener), 10);
  });

  closeDockEditor.addEventListener('click', () => {
    dockEditor.classList.add('hidden');
    if (outsideClickListener) document.removeEventListener('mousedown', outsideClickListener);
    outsideClickListener = null;
  });

  if (cancelDockEdit) {
    cancelDockEdit.addEventListener('click', () => resetForm());
  }

  updateDockOpenModeBtn();
  if (dockOpenModeBtn) {
    dockOpenModeBtn.addEventListener('click', async () => {
      dockOpenMode = dockOpenMode === 'same-tab' ? 'new-tab' : 'same-tab';
      updateDockOpenModeBtn();
      await storage.set({ dockOpenMode });
    });
  }

  addDockItemBtn.addEventListener('click', async () => {
    const inputUrl = dockItemUrl.value.trim();
    const url = normalizeUrl(inputUrl);
    if (!url) return alert('Enter redirect URL');
    const iconUrl = dockItemIconUrl.value.trim();
    const label = (dockItemName.value || '').trim() || hostnameFromUrl(url);
    const nextItem = normalizeItem({
      url,
      iconUrl: iconUrl || fallbackIconForUrl(url),
      label,
      side: 'right'
    });

    if (editingIndex === null) {
      items.push(nextItem);
    } else {
      const existing = items[editingIndex];
      items[editingIndex] = { ...nextItem, side: existing?.side || 'right' };
    }

    await save();
    resetForm();
    render();
  });

  dockItemsList.addEventListener('click', async (e) => {
    const btn = e.target;
    if (!(btn instanceof HTMLElement)) return;
    if (btn.matches('.del')) {
      const idx = Number(btn.dataset.idx);
      if (Number.isNaN(idx)) return;
      items.splice(idx, 1);
      if (editingIndex === idx) resetForm();
      await save();
      render();
      return;
    }

    if (btn.matches('.edit')) {
      const idx = Number(btn.dataset.idx);
      if (Number.isNaN(idx)) return;
      const it = items[idx];
      fillFormForEdit(it, idx);
      return;
    }

    if (btn.matches('.move-up')) {
      const idx = Number(btn.dataset.idx);
      if (Number.isNaN(idx) || !items[idx]) return;
      const info = sidePosForIndex(idx);
      if (!info) return;
      let changed = false;
      if (info.pos > 0) {
        changed = moveItemTo(idx, info.side, info.pos - 1);
      } else if (info.side === 'right') {
        changed = moveItemTo(idx, 'left', splitBySide().left.length);
      }
      if (!changed) return;
      await save();
      render();
      return;
    }

    if (btn.matches('.move-down')) {
      const idx = Number(btn.dataset.idx);
      if (Number.isNaN(idx) || !items[idx]) return;
      const info = sidePosForIndex(idx);
      if (!info) return;
      const parts = splitBySide();
      const sideLen = info.side === 'right' ? parts.right.length : parts.left.length;
      let changed = false;
      if (info.pos < sideLen - 1) {
        changed = moveItemTo(idx, info.side, info.pos + 1);
      } else if (info.side === 'left') {
        changed = moveItemTo(idx, 'right', 0);
      }
      if (!changed) return;
      await save();
      render();
    }
  });

  setupDockDropZones();
  window.addEventListener('scroll', () => hideHoverTip(), { passive: true });
  window.addEventListener('blur', () => hideHoverTip());
  await save();
  render();
  return { items, save, render };
}
