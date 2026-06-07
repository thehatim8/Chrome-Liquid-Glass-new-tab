import { storage } from './storage.js';

const CACHE_TTL_MS = 20 * 60 * 1000; // refresh at most every 20 min unless forced
const OWM_BASE = 'https://api.openweathermap.org/data/2.5';

function normalizeWeatherSettings(input) {
  const src = (input && typeof input === 'object') ? input : {};
  return {
    apiKey: typeof src.apiKey === 'string' ? src.apiKey.trim() : '',
    units: src.units === 'imperial' ? 'imperial' : 'metric',
    city: typeof src.city === 'string' ? src.city.trim() : ''
  };
}

async function detectLocationFromIP() {
  const res = await fetch('https://ipapi.co/json/');
  if (!res.ok) throw new Error(`IP lookup failed (${res.status})`);
  const data = await res.json();
  if (!Number.isFinite(Number(data.latitude)) || !Number.isFinite(Number(data.longitude))) {
    throw new Error('Could not detect your location.');
  }
  return { lat: Number(data.latitude), lon: Number(data.longitude), city: data.city || '' };
}

async function fetchJson(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.message || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

// Collapse the 3-hourly forecast list into up to 3 upcoming days.
function summarizeForecast(list) {
  const byDay = new Map();
  const todayKey = new Date().toISOString().slice(0, 10);
  (list || []).forEach((entry) => {
    const dt = new Date(entry.dt * 1000);
    const key = dt.toISOString().slice(0, 10);
    if (key === todayKey) return;
    if (!byDay.has(key)) {
      byDay.set(key, { key, date: dt, min: Infinity, max: -Infinity, noonIcon: null, noonDiff: Infinity, desc: '' });
    }
    const day = byDay.get(key);
    day.min = Math.min(day.min, entry.main.temp_min);
    day.max = Math.max(day.max, entry.main.temp_max);
    const hourDiff = Math.abs(dt.getHours() - 13);
    if (hourDiff < day.noonDiff) {
      day.noonDiff = hourDiff;
      day.noonIcon = entry.weather?.[0]?.icon || null;
      day.desc = entry.weather?.[0]?.main || '';
    }
  });
  return Array.from(byDay.values()).slice(0, 3);
}

export function initWeather(appState) {
  const statusEl = document.getElementById('weatherStatus');
  const currentEl = document.getElementById('weatherCurrent');
  const iconEl = document.getElementById('weatherIcon');
  const tempEl = document.getElementById('weatherTemp');
  const descEl = document.getElementById('weatherDesc');
  const cityEl = document.getElementById('weatherCity');
  const forecastEl = document.getElementById('weatherForecast');
  const refreshBtn = document.getElementById('weatherRefresh');
  if (!statusEl || !currentEl || !forecastEl) return;

  let settings = normalizeWeatherSettings(appState?.weatherSettings);
  if (appState) appState.weatherSettings = settings;

  function unitSymbol() { return settings.units === 'imperial' ? '°F' : '°C'; }

  function showStatus(msg) {
    statusEl.textContent = msg;
    statusEl.classList.remove('hidden');
    currentEl.classList.add('hidden');
    forecastEl.innerHTML = '';
  }

  function render(data) {
    if (!data || !data.current) {
      showStatus('Weather unavailable.');
      return;
    }
    statusEl.classList.add('hidden');
    currentEl.classList.remove('hidden');

    const c = data.current;
    const icon = c.weather?.[0]?.icon;
    if (icon) {
      iconEl.src = `https://openweathermap.org/img/wn/${icon}@2x.png`;
      iconEl.classList.remove('hidden');
    } else {
      iconEl.classList.add('hidden');
    }
    tempEl.textContent = `${Math.round(c.main.temp)}${unitSymbol()}`;
    descEl.textContent = c.weather?.[0]?.description || '';
    cityEl.textContent = data.cityName || c.name || '';

    forecastEl.innerHTML = '';
    (data.forecast || []).forEach((day) => {
      const row = document.createElement('div');
      row.className = 'weather-forecast-day';
      const label = day.date.toLocaleDateString(undefined, { weekday: 'short' });
      const dayIcon = day.noonIcon
        ? `<img class="weather-forecast-icon" src="https://openweathermap.org/img/wn/${day.noonIcon}.png" alt="">`
        : '';
      row.innerHTML = `
        <span class="weather-forecast-label">${label}</span>
        ${dayIcon}
        <span class="weather-forecast-temp">${Math.round(day.max)}° / ${Math.round(day.min)}°</span>`;
      forecastEl.appendChild(row);
    });
  }

  async function load({ force = false } = {}) {
    settings = normalizeWeatherSettings(appState?.weatherSettings || settings);
    if (appState) appState.weatherSettings = settings;

    if (!settings.apiKey) {
      showStatus('Add an OpenWeatherMap API key in Settings.');
      return;
    }

    const cached = (await storage.get(['weatherCache'])).weatherCache;
    if (!force && cached && cached.units === settings.units && cached.city === settings.city
        && (Date.now() - (cached.ts || 0)) < CACHE_TTL_MS && cached.data) {
      // Revive date objects from cache
      cached.data.forecast = (cached.data.forecast || []).map((d) => ({ ...d, date: new Date(d.date) }));
      render(cached.data);
      return;
    }

    showStatus('Loading weather...');
    try {
      let query;
      let cityName = '';
      if (settings.city) {
        query = `q=${encodeURIComponent(settings.city)}`;
        cityName = settings.city;
      } else {
        const loc = await detectLocationFromIP();
        query = `lat=${loc.lat}&lon=${loc.lon}`;
        cityName = loc.city;
      }
      const common = `${query}&units=${settings.units}&appid=${settings.apiKey}`;
      const [current, forecastRaw] = await Promise.all([
        fetchJson(`${OWM_BASE}/weather?${common}`),
        fetchJson(`${OWM_BASE}/forecast?${common}`)
      ]);

      const data = {
        current,
        cityName: cityName || current.name || '',
        forecast: summarizeForecast(forecastRaw.list)
      };
      render(data);

      // Persist a serializable copy (dates → ISO strings).
      const serializable = {
        ...data,
        forecast: data.forecast.map((d) => ({ ...d, date: d.date.toISOString() }))
      };
      await storage.set({
        weatherCache: { ts: Date.now(), units: settings.units, city: settings.city, data: serializable }
      });
    } catch (err) {
      console.error('weather:load:error', err);
      showStatus(err?.message ? `Weather error: ${err.message}` : 'Failed to load weather.');
    }
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      load({ force: true });
    });
  }

  // React to settings changes saved from the Settings panel.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.weatherSettings) return;
      settings = normalizeWeatherSettings(changes.weatherSettings.newValue);
      if (appState) appState.weatherSettings = settings;
      load({ force: true });
    });
  } catch (_) { /* ignore */ }

  load();
}
