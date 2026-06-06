import { storage } from './storage.js';

const STORAGE_KEY = 'iconCacheV1';
const DEFAULT_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const MAX_ENTRIES = 180;

let cacheLoaded = false;
let cacheStore = {};
const inflight = new Map();

function isHttpUrl(url) {
  return /^https?:\/\//i.test(url || '');
}

function clampMaxAge(maxAgeMs) {
  return Number.isFinite(maxAgeMs) && maxAgeMs > 0 ? maxAgeMs : DEFAULT_MAX_AGE_MS;
}

function now() {
  return Date.now();
}

async function ensureLoaded() {
  if (cacheLoaded) return;
  const res = await storage.get([STORAGE_KEY]);
  const raw = res?.[STORAGE_KEY];
  cacheStore = raw && typeof raw === 'object' ? raw : {};
  cacheLoaded = true;
}

function prune(maxAgeMs) {
  const age = clampMaxAge(maxAgeMs);
  const cutoff = now() - age;
  const entries = Object.entries(cacheStore)
    .filter(([, v]) => v && typeof v.dataUrl === 'string' && v.dataUrl.startsWith('data:') && Number.isFinite(v.savedAt))
    .filter(([, v]) => v.savedAt >= cutoff)
    .sort((a, b) => (b[1].savedAt || 0) - (a[1].savedAt || 0))
    .slice(0, MAX_ENTRIES);

  cacheStore = Object.fromEntries(entries);
}

async function persist() {
  await storage.set({ [STORAGE_KEY]: cacheStore });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error || new Error('Failed to read icon blob'));
    reader.readAsDataURL(blob);
  });
}

async function fetchIconDataUrl(url) {
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`Icon fetch failed: ${res.status}`);
  const blob = await res.blob();
  if (!blob || !blob.size) throw new Error('Icon blob is empty');
  return blobToDataUrl(blob);
}

export async function resolveCachedIconUrl(rawUrl, options = {}) {
  const url = String(rawUrl || '').trim();
  if (!url || !isHttpUrl(url)) return url;

  const maxAgeMs = clampMaxAge(options.maxAgeMs);
  await ensureLoaded();

  const existing = cacheStore[url];
  const isFresh = existing && Number.isFinite(existing.savedAt) && (now() - existing.savedAt) <= maxAgeMs;
  if (isFresh && typeof existing.dataUrl === 'string' && existing.dataUrl.startsWith('data:')) {
    return existing.dataUrl;
  }

  if (inflight.has(url)) return inflight.get(url);

  const req = (async () => {
    try {
      const dataUrl = await fetchIconDataUrl(url);
      cacheStore[url] = { dataUrl, savedAt: now() };
      prune(maxAgeMs);
      await persist();
      return dataUrl;
    } catch (err) {
      if (existing && typeof existing.dataUrl === 'string' && existing.dataUrl.startsWith('data:')) {
        return existing.dataUrl;
      }
      return url;
    } finally {
      inflight.delete(url);
    }
  })();

  inflight.set(url, req);
  return req;
}

export async function clearIconCache() {
  cacheStore = {};
  cacheLoaded = true;
  inflight.clear();
  await storage.set({ [STORAGE_KEY]: {} });
}
