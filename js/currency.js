import { storage } from './storage.js';

const CACHE_TTL_MS = 5 * 60 * 1000;

function normalizeCurrencySettings(input) {
  const src = (input && typeof input === 'object') ? input : {};
  const toList = (v) => Array.isArray(v)
    ? v.map((s) => String(s || '').trim()).filter(Boolean)
    : String(v || '').split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  return {
    cryptoIds: toList(src.cryptoIds).map((s) => s.toLowerCase()),
    fiatCodes: toList(src.fiatCodes).map((s) => s.toUpperCase()),
    base: (typeof src.base === 'string' && src.base.trim() ? src.base.trim() : 'usd').toLowerCase()
  };
}

function titleCase(id) {
  return id.replace(/(^|[-\s])\w/g, (m) => m.toUpperCase()).replace(/-/g, ' ');
}

function formatPrice(value, currency) {
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 1 ? 2 : 4;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.toUpperCase(),
      maximumFractionDigits: digits,
      minimumFractionDigits: 0
    }).format(value);
  } catch (_) {
    return `${value.toFixed(digits)} ${currency.toUpperCase()}`;
  }
}

export function initCurrency(appState) {
  const statusEl = document.getElementById('currencyStatus');
  const listEl = document.getElementById('currencyList');
  const refreshBtn = document.getElementById('currencyRefresh');
  if (!statusEl || !listEl) return;

  let settings = normalizeCurrencySettings(appState?.currencySettings);
  if (appState) appState.currencySettings = settings;

  function showStatus(msg) {
    statusEl.textContent = msg;
    statusEl.classList.remove('hidden');
  }

  function addRow(label, value, changePct) {
    const li = document.createElement('li');
    li.className = 'currency-row';
    const changeHtml = Number.isFinite(changePct)
      ? `<span class="currency-change ${changePct >= 0 ? 'up' : 'down'}">${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%</span>`
      : '';
    li.innerHTML = `
      <span class="currency-name">${label}</span>
      <span class="currency-value">${value}</span>
      ${changeHtml}`;
    listEl.appendChild(li);
  }

  function render(data) {
    listEl.innerHTML = '';
    let rows = 0;

    (data.crypto || []).forEach((c) => {
      addRow(titleCase(c.id), formatPrice(c.price, settings.base), c.change);
      rows += 1;
    });
    (data.fiat || []).forEach((f) => {
      addRow(`${settings.base.toUpperCase()} → ${f.code}`, f.rate.toLocaleString(undefined, { maximumFractionDigits: 4 }), undefined);
      rows += 1;
    });

    if (rows === 0) {
      showStatus('No pairs configured. Add some in Settings.');
    } else {
      statusEl.classList.add('hidden');
    }
  }

  async function fetchCrypto() {
    if (!settings.cryptoIds.length) return [];
    const ids = settings.cryptoIds.join(',');
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=${encodeURIComponent(settings.base)}&include_24hr_change=true`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Crypto request failed (${res.status})`);
    const data = await res.json();
    return settings.cryptoIds
      .filter((id) => data[id] && Number.isFinite(data[id][settings.base]))
      .map((id) => ({
        id,
        price: data[id][settings.base],
        change: data[id][`${settings.base}_24h_change`]
      }));
  }

  async function fetchFiat() {
    if (!settings.fiatCodes.length) return [];
    const url = `https://open.er-api.com/v6/latest/${settings.base.toUpperCase()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fiat request failed (${res.status})`);
    const data = await res.json();
    const rates = data?.rates || {};
    return settings.fiatCodes
      .filter((code) => Number.isFinite(rates[code]))
      .map((code) => ({ code, rate: rates[code] }));
  }

  async function load({ force = false } = {}) {
    settings = normalizeCurrencySettings(appState?.currencySettings || settings);
    if (appState) appState.currencySettings = settings;

    const cacheKey = JSON.stringify({ c: settings.cryptoIds, f: settings.fiatCodes, b: settings.base });
    const cached = (await storage.get(['currencyCache'])).currencyCache;
    if (!force && cached && cached.key === cacheKey && (Date.now() - (cached.ts || 0)) < CACHE_TTL_MS && cached.data) {
      render(cached.data);
      return;
    }

    if (!settings.cryptoIds.length && !settings.fiatCodes.length) {
      render({ crypto: [], fiat: [] });
      return;
    }

    showStatus('Loading rates...');
    try {
      const [crypto, fiat] = await Promise.all([fetchCrypto(), fetchFiat()]);
      const data = { crypto, fiat };
      render(data);
      await storage.set({ currencyCache: { ts: Date.now(), key: cacheKey, data } });
    } catch (err) {
      console.error('currency:load:error', err);
      showStatus(err?.message ? `Rates error: ${err.message}` : 'Failed to load rates.');
    }
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      load({ force: true });
    });
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.currencySettings) return;
      settings = normalizeCurrencySettings(changes.currencySettings.newValue);
      if (appState) appState.currencySettings = settings;
      load({ force: true });
    });
  } catch (_) { /* ignore */ }

  load();
}
