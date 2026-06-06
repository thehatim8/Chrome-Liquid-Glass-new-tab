import { resolveCachedIconUrl } from './iconCache.js';

const ICON_CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

function normalizeUrl(raw) {
  const v = (raw || '').trim();
  if (!v) return '';
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(v)) return v;
  return `https://${v}`;
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

function hostFromUrl(url) {
  try {
    return new URL(normalizeUrl(url)).hostname.replace(/^www\./, '');
  } catch (err) {
    return (url || '').replace(/^https?:\/\//, '').replace(/^www\./, '');
  }
}

function fallbackIcon(url) {
  const host = hostFromUrl(url);
  if (!host) return '';
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}

function normalizeWidget(widget, idx = 0) {
  const id = widget?.id || `widget-icon-grid-${Date.now()}-${idx}`;
  const title = (widget?.title || `Icon Grid ${idx + 1}`).trim();
  const icons = Array.isArray(widget?.icons) ? widget.icons : [];
  return {
    id,
    title,
    icons: icons.map((it) => ({
      label: (it?.label || hostFromUrl(it?.url || '') || 'Link').trim(),
      url: normalizeUrl(it?.url || ''),
      iconUrl: ((it?.iconUrl || '').trim().includes('domain=&sz=64') ? '' : (it?.iconUrl || '').trim()) || fallbackIcon(it?.url || '')
    }))
  };
}

function makeWidgetElement(widget) {
  const el = document.createElement('div');
  el.className = 'widget icon-grid-widget';
  el.id = widget.id;
  el.setAttribute('data-widget', 'icon-grid');
  el.innerHTML = `
    <div class="widget-handle">${widget.title}</div>
    <div class="widget-body">
      <div class="icon-grid-body" id="${widget.id}-body"></div>
    </div>
  `;
  return el;
}

function renderBody(widget) {
  const body = document.getElementById(`${widget.id}-body`);
  if (!body) return;
  body.innerHTML = '';
  widget.icons.forEach((it) => {
    const btn = document.createElement('button');
    btn.className = 'icon-grid-item';
    btn.type = 'button';
    btn.title = it.label || it.url;
    btn.setAttribute('data-label', it.label || hostFromUrl(it.url));

    const iconSrc = (it.iconUrl || '').trim() || fallbackIcon(it.url || '');
    if (iconSrc) {
      const img = document.createElement('img');
      applyCachedIcon(img, iconSrc);
      img.alt = it.label || 'Icon';
      img.className = 'icon-grid-item-icon';
      btn.appendChild(img);
    } else {
      const ph = document.createElement('span');
      ph.className = 'icon-grid-item-fallback';
      ph.textContent = (it.label || '+').trim().slice(0, 1).toUpperCase() || '+';
      btn.appendChild(ph);
    }

    btn.addEventListener('click', () => {
      const url = normalizeUrl(it.url);
      if (!url) return;
      const mode = document.body?.dataset?.iconGridOpenMode === 'same-tab' ? 'same-tab' : 'new-tab';
      if (mode === 'same-tab') {
        window.location.href = url;
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    });

    body.appendChild(btn);
  });
}

export function normalizeIconGridWidgets(rawWidgets) {
  const list = Array.isArray(rawWidgets) ? rawWidgets : [];
  return list.map((w, idx) => normalizeWidget(w, idx));
}

export function ensureIconGridWidgetsInWorkspace(workspaceEl, widgets) {
  Array.from(workspaceEl.querySelectorAll('.icon-grid-widget')).forEach((n) => n.remove());
  widgets.forEach((widget) => {
    workspaceEl.appendChild(makeWidgetElement(widget));
  });
}

export function renderIconGridWidgets(widgets) {
  widgets.forEach((widget) => {
    const handle = document.querySelector(`#${widget.id} .widget-handle`);
    if (handle) handle.textContent = widget.title;
    renderBody(widget);
  });
}
