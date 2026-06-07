import { storage } from './storage.js';
import { getImageWidgetState, updateImageWidgetState } from './imageWidget.js';
import { normalizeIconGridWidgets, renderIconGridWidgets } from './iconGrid.js';
import { computeGrid, posToCell, sizeToCells } from './grid.js';
import { setResizeOverlaysVisible, updateOverlayForWidget } from './resize.js';
const WEB3FORMS_ENDPOINT = 'https://api.web3forms.com/submit';
const WEB3FORMS_ACCESS_KEY = '064c5b74-a292-4d22-9974-aa594882df1d';

function dataUrlSizeInKB(dataUrl) {
  const base64 = dataUrl.split(',')[1] || '';
  return Math.ceil((base64.length * 3) / 4 / 1024);
}

function redactApiKeysDeep(value) {
  if (Array.isArray(value)) return value.map((v) => redactApiKeysDeep(v));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  Object.entries(value).forEach(([k, v]) => {
    // Keep all user data except API credentials.
    if (/(api[_-]?keys?|access[_-]?key|token|secret)/i.test(k)) return;
    out[k] = redactApiKeysDeep(v);
  });
  return out;
}

const UNSPLASH_THEMES = ['random', 'nature', 'city', 'abstract', 'space', 'minimal', 'mountains', 'ocean'];

function normalizeUnsplashSettings(input) {
  const src = (input && typeof input === 'object') ? input : {};
  const rawTheme = typeof src.theme === 'string' ? src.theme.trim().toLowerCase() : 'random';
  return {
    autoDaily: !!src.autoDaily,
    apiKey: typeof src.apiKey === 'string' ? src.apiKey.trim() : '',
    theme: UNSPLASH_THEMES.includes(rawTheme) ? rawTheme : 'random',
    lastUpdatedDate: typeof src.lastUpdatedDate === 'string' ? src.lastUpdatedDate : ''
  };
}

function downscaleImage(file, maxKB = 900) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; };
    reader.onerror = reject;
    img.onerror = reject;

    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      let ratio = 1;

      (function attempt() {
        canvas.width = Math.round(img.width * ratio);
        canvas.height = Math.round(img.height * ratio);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        if (dataUrlSizeInKB(dataUrl) <= maxKB || ratio < 0.2) {
          resolve(dataUrl);
          return;
        }
        ratio *= 0.8;
        attempt();
      })();
    };

    reader.readAsDataURL(file);
  });
}

function listFilesInPackageDir(dirName) {
  return new Promise((resolve) => {
    if (!chrome?.runtime?.getPackageDirectoryEntry) {
      resolve([]);
      return;
    }

    chrome.runtime.getPackageDirectoryEntry((root) => {
      if (chrome.runtime.lastError || !root) {
        resolve([]);
        return;
      }

      root.getDirectory(
        dirName,
        {},
        (dirEntry) => {
          const reader = dirEntry.createReader();
          const out = [];

          const readAll = () => {
            reader.readEntries(
              (entries) => {
                if (!entries || !entries.length) {
                  resolve(out);
                  return;
                }
                entries.forEach((entry) => {
                  if (entry.isFile) out.push(`${dirName}/${entry.name}`);
                });
                readAll();
              },
              () => resolve(out)
            );
          };

          readAll();
        },
        () => resolve([])
      );
    });
  });
}

async function pathExists(path) {
  try {
    const res = await fetch(chrome.runtime.getURL(path), { cache: 'no-store' });
    return res.ok;
  } catch (_) {
    return false;
  }
}

export async function initSettings(appState, options = {}) {
  const widgetIds = options.widgetIds || ['widget-search', 'widget-clock', 'widget-todo', 'widget-image'];
  const defaultPositions = options.defaultPositions || {};
  const defaultSizes = options.defaultSizes || {};

  const modal = document.getElementById('settings');
  const open = document.getElementById('openSettings');
  const close = document.getElementById('closeSettings');
  const openBugReport = document.getElementById('openBugReport');
  const bugReportModal = document.getElementById('bugReportModal');
  const closeBugReport = document.getElementById('closeBugReport');
  const submitBugReport = document.getElementById('submitBugReport');
  const bugReportName = document.getElementById('bugReportName');
  const bugReportEmail = document.getElementById('bugReportEmail');
  const bugReportMessage = document.getElementById('bugReportMessage');
  const toggleGlass = document.getElementById('toggleGlass');
  const toggleAnalog = document.getElementById('toggleAnalog');
  const toggleNotesAutoMath = document.getElementById('toggleNotesAutoMath');
  const settingsUserName = document.getElementById('settingsUserName');
  const saveUserName = document.getElementById('saveUserName');
  const glassStyle = document.getElementById('glassStyle');
  const glassDarknessRow = document.getElementById('glassDarknessRow');
  const glassDarkness = document.getElementById('glassDarkness');
  const glassDarknessValue = document.getElementById('glassDarknessValue');
  const resetPositions = document.getElementById('resetPositions');
  const bgUpload = document.getElementById('bgUpload');
  const useUploadedBg = document.getElementById('useUploadedBg');
  const bgUrl = document.getElementById('bgUrl');
  const setBgUrl = document.getElementById('setBgUrl');
  const wallpaperGrid = document.getElementById('wallpaperGrid');
  const bgDailyUnsplash = document.getElementById('bgDailyUnsplash');
  const unsplashApiKey = document.getElementById('unsplashApiKey');
  const unsplashTheme = document.getElementById('unsplashTheme');
  const saveUnsplashSettings = document.getElementById('saveUnsplashSettings');
  const clearBg = document.getElementById('clearBg');
  const exportSettings = document.getElementById('exportSettings');
  const importSettingsFile = document.getElementById('importSettingsFile');
  const importSettings = document.getElementById('importSettings');
  const openPrivacyPolicy = document.getElementById('openPrivacyPolicy');
  const openTermsConditions = document.getElementById('openTermsConditions');
  const widgetVisibilityList = document.getElementById('widgetVisibilityList');
  const imageWidgetSettingsSection = document.getElementById('imageWidgetSettingsSection');
  const imageWidgetUpload = document.getElementById('imageWidgetUpload');
  const imageWidgetUrl = document.getElementById('imageWidgetUrl');
  const setImageWidgetUrl = document.getElementById('setImageWidgetUrl');
  const sportsWidgetSettingsSection = document.getElementById('sportsWidgetSettingsSection');
  const aiChatSettingsSection = document.getElementById('aiChatSettingsSection');
  const weatherSettingsSection = document.getElementById('weatherSettingsSection');
  const weatherApiKey = document.getElementById('weatherApiKey');
  const weatherUnits = document.getElementById('weatherUnits');
  const weatherCityInput = document.getElementById('weatherCityInput');
  const saveWeatherSettings = document.getElementById('saveWeatherSettings');
  const currencySettingsSection = document.getElementById('currencySettingsSection');
  const currencyBase = document.getElementById('currencyBase');
  const currencyCryptoIds = document.getElementById('currencyCryptoIds');
  const currencyFiatCodes = document.getElementById('currencyFiatCodes');
  const saveCurrencySettings = document.getElementById('saveCurrencySettings');
  const pomodoroFocusMinutes = document.getElementById('pomodoroFocusMinutes');
  const pomodoroFocusValue = document.getElementById('pomodoroFocusValue');
  const pomodoroBreakMinutes = document.getElementById('pomodoroBreakMinutes');
  const pomodoroBreakValue = document.getElementById('pomodoroBreakValue');
  const pomodoroSettingsSection = document.getElementById('pomodoroSettingsSection');
  const sportsApiHelp = document.getElementById('sportsApiHelp');
  const unsplashApiHelp = document.getElementById('unsplashApiHelp');
  const sportsWidgetApiKeys = document.getElementById('sportsWidgetApiKeys');
  const sportsWidgetTournament = document.getElementById('sportsWidgetTournament');
  const saveSportsWidgetSettings = document.getElementById('saveSportsWidgetSettings');
  const aiChatApiKey = document.getElementById('aiChatApiKey');
  const aiChatModel = document.getElementById('aiChatModel');
  const todoAutoReminderMode = document.getElementById('todoAutoReminderMode');
  const saveAiChatSettings = document.getElementById('saveAiChatSettings');
  const iconGridOpenModeBtn = document.getElementById('iconGridOpenModeBtn');
  const addIconGridWidget = document.getElementById('addIconGridWidget');
  const iconGridWidgetsList = document.getElementById('iconGridWidgetsList');
  let builtInWallpapers = [];

  appState.unsplashSettings = normalizeUnsplashSettings(appState.unsplashSettings);

  function clampGlassDarkness(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 68;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  function sanitizeUserName(name) {
    const s = String(name || '').trim().replace(/\s+/g, ' ');
    if (!s) return '';
    return s.slice(0, 40);
  }

  function applyUserNameLocally(name) {
    appState.userName = name;
    if (settingsUserName) settingsUserName.value = name;
    const greetingEl = document.getElementById('greeting');
    if (greetingEl) greetingEl.textContent = name ? `Hello, ${name}.` : 'Hello.';
  }

  function applyGlassDarknessLocally() {
    const darkness = clampGlassDarkness(appState.settings.glassDarkness);
    appState.settings.glassDarkness = darkness;
    document.documentElement.style.setProperty('--glass-darkness', String(darkness));
    if (glassDarkness) glassDarkness.value = String(darkness);
    if (glassDarknessValue) glassDarknessValue.textContent = `${darkness}%`;

    const showDarknessSlider = !!appState.settings.glass && appState.settings.glassStyle !== 'light';
    if (glassDarknessRow) glassDarknessRow.classList.toggle('hidden', !showDarknessSlider);
  }

  function applySettingsLocally() {
    document.body.classList.toggle('glass', !!appState.settings.glass);
    document.body.classList.toggle('glass-light', appState.settings.glassStyle === 'light');
    applyGlassDarknessLocally();
    const settingsIconImg = document.querySelector('#openSettings img');
    if (settingsIconImg) {
      const useBlackIcon = !!appState.settings.glass && appState.settings.glassStyle === 'light';
      settingsIconImg.src = useBlackIcon ? 'icons/settings-black.svg' : 'icons/settings-white.svg';
    }
    if (appState.background) {
      document.body.style.background = `url("${appState.background}") center / cover no-repeat fixed`;
      document.body.classList.add('custom-bg');
    } else {
      document.body.style.background = '';
      document.body.classList.remove('custom-bg');
    }
    document.body.dataset.iconGridOpenMode = appState.iconGridOpenMode === 'same-tab' ? 'same-tab' : 'new-tab';
  }

  function updateIconGridOpenModeBtn() {
    if (!iconGridOpenModeBtn) return;
    const isSameTab = appState.iconGridOpenMode === 'same-tab';
    iconGridOpenModeBtn.textContent = isSameTab ? 'Open: Same Tab' : 'Open: New Tab';
    iconGridOpenModeBtn.title = isSameTab
      ? 'Icon Grid links open in the current tab'
      : 'Icon Grid links open in a new tab';
  }

  async function getBuiltInWallpapers() {
    const allowedExt = /\.(jpg|jpeg|png|webp)$/i;
    const imageDirFiles = await listFilesInPackageDir('Images');
    const wallpapersDirFiles = await listFilesInPackageDir('wallpapers');

    const list = [];

    // Keep explicit default wallpaper first when available.
    if (imageDirFiles.includes('Images/wallpaper-default.jpg')) {
      list.push('Images/wallpaper-default.jpg');
    }

    const wallpapers = wallpapersDirFiles
      .filter((p) => allowedExt.test(p))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

    wallpapers.forEach((p) => {
      if (!list.includes(p)) list.push(p);
    });

    // Fallback for environments where directory listing is unavailable.
    if (!list.length && await pathExists('Images/wallpaper-default.jpg')) {
      list.push('Images/wallpaper-default.jpg');
    }

    return list;
  }

  function isWallpaperActive(path) {
    const cur = String(appState.background || '');
    if (!cur) return false;
    if (cur === path) return true;
    return cur.endsWith(`/${path}`);
  }

  async function setBackgroundAndPersist(path) {
    appState.background = path;
    applySettingsLocally();
    await storage.set({ background: appState.background });
    renderWallpaperGrid();
  }

  function todayLocalStamp() {
    const now = new Date();
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  async function fetchUnsplashDailyImage(apiKey, theme = 'random') {
    const key = String(apiKey || '').trim();
    if (!key) throw new Error('Unsplash API key is missing.');

    let url = 'https://api.unsplash.com/photos/random?orientation=landscape&content_filter=high';
    if (theme && theme !== 'random') {
      url += `&query=${encodeURIComponent(theme)}`;
    }
    const res = await fetch(url, {
      headers: {
        Authorization: `Client-ID ${key}`,
        'Accept-Version': 'v1'
      }
    });
    if (!res.ok) {
      const details = await res.text().catch(() => '');
      throw new Error(`Unsplash request failed (${res.status}). ${details}`);
    }

    const payload = await res.json();
    const imageUrl = payload?.urls?.regular || payload?.urls?.full || payload?.urls?.raw || '';
    if (!imageUrl) throw new Error('Unsplash response did not include a usable image URL.');
    return imageUrl;
  }

  async function refreshDailyUnsplashWallpaper({ force = false, silent = true } = {}) {
    const cfg = normalizeUnsplashSettings(appState.unsplashSettings);
    appState.unsplashSettings = cfg;
    if (!cfg.autoDaily || !cfg.apiKey) return false;

    const today = todayLocalStamp();
    if (!force && cfg.lastUpdatedDate === today) return false;

    try {
      const imageUrl = await fetchUnsplashDailyImage(cfg.apiKey, cfg.theme);
      appState.background = imageUrl;
      appState.unsplashSettings.lastUpdatedDate = today;
      applySettingsLocally();
      await storage.set({
        background: appState.background,
        unsplashSettings: appState.unsplashSettings
      });
      renderWallpaperGrid();
      return true;
    } catch (err) {
      console.error('settings:unsplash:refresh:error', err);
      if (!silent) {
        alert('Failed to fetch daily wallpaper from Unsplash. Check your API key and try again.');
      }
      return false;
    }
  }

  function renderWallpaperGrid() {
    if (!wallpaperGrid) return;
    wallpaperGrid.innerHTML = '';
    builtInWallpapers.forEach((path) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `wallpaper-tile ${isWallpaperActive(path) ? 'active' : ''}`;
      btn.title = path;
      btn.setAttribute('aria-label', `Use ${path}`);
      const img = document.createElement('img');
      img.src = chrome.runtime.getURL(path);
      img.alt = path;
      btn.appendChild(img);
      btn.addEventListener('click', async () => {
        await setBackgroundAndPersist(path);
      });
      wallpaperGrid.appendChild(btn);
    });
  }

  function widgetLabelFromId(id) {
    return id.replace(/^widget-/, '').replace(/(^\w|-\w)/g, (m) => m.replace('-', '').toUpperCase());
  }

  function renderWidgetVisibility() {
    if (!widgetVisibilityList) return;
    widgetVisibilityList.innerHTML = '';
    widgetIds.forEach((id) => {
      const row = document.createElement('label');
      row.className = 'toggle-row';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = appState.visibleWidgets?.[id] !== false;
      input.addEventListener('change', async () => {
        appState.visibleWidgets = appState.visibleWidgets || {};
        appState.visibleWidgets[id] = input.checked;
        const el = document.getElementById(id);
        if (el) el.classList.toggle('hidden', !input.checked);
        updateOverlayForWidget(id);
        await storage.set({ visibleWidgets: appState.visibleWidgets });
        updateImageSettingsVisibility();
      });

      const text = document.createElement('span');
      text.textContent = widgetLabelFromId(id);

      row.appendChild(input);
      row.appendChild(text);
      widgetVisibilityList.appendChild(row);
    });
    updateImageSettingsVisibility();
  }

  function updateImageSettingsVisibility() {
    const showImageSettings = appState.visibleWidgets?.['widget-image'] !== false;
    if (imageWidgetSettingsSection) {
      imageWidgetSettingsSection.classList.toggle('hidden', !showImageSettings);
    }
    const showSportsSettings = appState.visibleWidgets?.['widget-sports'] !== false;
    if (sportsWidgetSettingsSection) {
      sportsWidgetSettingsSection.classList.toggle('hidden', !showSportsSettings);
    }
    const showAIChatSettings = appState.visibleWidgets?.['widget-aichat'] !== false;
    if (aiChatSettingsSection) {
      aiChatSettingsSection.classList.toggle('hidden', !showAIChatSettings);
    }
    const showWeatherSettings = appState.visibleWidgets?.['widget-weather'] !== false;
    if (weatherSettingsSection) {
      weatherSettingsSection.classList.toggle('hidden', !showWeatherSettings);
    }
    const showCurrencySettings = appState.visibleWidgets?.['widget-currency'] !== false;
    if (currencySettingsSection) {
      currencySettingsSection.classList.toggle('hidden', !showCurrencySettings);
    }
    const showPomodoroSettings = appState.visibleWidgets?.['widget-pomodoro'] !== false;
    if (pomodoroSettingsSection) {
      pomodoroSettingsSection.classList.toggle('hidden', !showPomodoroSettings);
    }
  }

  function initSportsWidgetSettings() {
    function collectSportsKeys(settings) {
      const out = [];
      const seen = new Set();
      const push = (k) => {
        const v = String(k || '').trim();
        if (!v || seen.has(v)) return;
        seen.add(v);
        out.push(v);
      };
      const cfg = settings || {};
      if (Array.isArray(cfg.apiKeys)) cfg.apiKeys.forEach(push);
      if (typeof cfg.apiKeys === 'string') {
        cfg.apiKeys.split(/\r?\n/).forEach(push);
      }
      push(cfg.apiKey);
      return out;
    }

    appState.sportsSettings = appState.sportsSettings || {};
    const keys = collectSportsKeys(appState.sportsSettings);
    if (sportsWidgetApiKeys) sportsWidgetApiKeys.value = keys.join('\n');
    if (sportsWidgetTournament) sportsWidgetTournament.value = appState.sportsSettings.tournament || "ICC Men's T20 World Cup";

    if (saveSportsWidgetSettings) {
      saveSportsWidgetSettings.addEventListener('click', async () => {
        try {
          const typedTournament = (sportsWidgetTournament?.value || '').trim();
          const keyLines = String(sportsWidgetApiKeys?.value || '')
            .split(/\r?\n/)
            .map((k) => k.trim())
            .filter(Boolean);
          const uniqueKeys = Array.from(new Set(keyLines));
          const nextSportsSettings = {
            apiKeys: uniqueKeys,
            apiKey: uniqueKeys[0] || '',
            tournament: typedTournament || "ICC Men's T20 World Cup"
          };

          await storage.set({ sportsSettings: nextSportsSettings });
          const verify = await storage.get(['sportsSettings']);
          const saved = verify?.sportsSettings || {};
          const savedKeys = collectSportsKeys(saved);
          const sameKeys = JSON.stringify(savedKeys) === JSON.stringify(uniqueKeys);
          const sameTournament = String(saved.tournament || '') === String(nextSportsSettings.tournament || '');

          if (!sameKeys || !sameTournament) {
            throw new Error('Settings verification failed after save.');
          }

          appState.sportsSettings = nextSportsSettings;
          alert('CricAPI settings saved.');
        } catch (err) {
          console.error('settings:sports:save:error', err);
          alert('Failed to save CricAPI settings. Please try again.');
        }
      });
    }

    if (sportsApiHelp) {
      sportsApiHelp.addEventListener('click', () => {
        const helpUrl = chrome.runtime.getURL('sports-api-help.html');
        window.open(helpUrl, '_blank', 'noopener,noreferrer');
      });
    }
    if (unsplashApiHelp) {
      unsplashApiHelp.addEventListener('click', () => {
        const helpUrl = chrome.runtime.getURL('sports-api-help.html');
        window.open(helpUrl, '_blank', 'noopener,noreferrer');
      });
    }
  }

  function initAIChatSettings() {
    appState.aiChatSettings = appState.aiChatSettings || {};
    if (aiChatApiKey) aiChatApiKey.value = appState.aiChatSettings.apiKey || '';
    if (aiChatModel) aiChatModel.value = appState.aiChatSettings.model || 'openrouter/auto';

    if (saveAiChatSettings) {
      saveAiChatSettings.addEventListener('click', async () => {
        appState.aiChatSettings = {
          apiKey: (aiChatApiKey?.value || '').trim(),
          model: (aiChatModel?.value || 'openrouter/auto').trim() || 'openrouter/auto'
        };
        await storage.set({ aiChatSettings: appState.aiChatSettings });
        alert('AI Chat settings saved.');
      });
    }
  }

  function initWeatherSettings() {
    appState.weatherSettings = appState.weatherSettings || {};
    if (weatherApiKey) weatherApiKey.value = appState.weatherSettings.apiKey || '';
    if (weatherUnits) weatherUnits.value = appState.weatherSettings.units === 'imperial' ? 'imperial' : 'metric';
    if (weatherCityInput) weatherCityInput.value = appState.weatherSettings.city || '';

    if (saveWeatherSettings) {
      saveWeatherSettings.addEventListener('click', async () => {
        appState.weatherSettings = {
          apiKey: (weatherApiKey?.value || '').trim(),
          units: weatherUnits?.value === 'imperial' ? 'imperial' : 'metric',
          city: (weatherCityInput?.value || '').trim()
        };
        await storage.set({ weatherSettings: appState.weatherSettings });
        alert('Weather settings saved.');
      });
    }
  }

  function initCurrencySettings() {
    const toLines = (v) => Array.isArray(v) ? v.join('\n') : String(v || '');
    appState.currencySettings = appState.currencySettings || {};
    if (currencyBase) currencyBase.value = appState.currencySettings.base || 'usd';
    if (currencyCryptoIds) currencyCryptoIds.value = toLines(appState.currencySettings.cryptoIds);
    if (currencyFiatCodes) currencyFiatCodes.value = toLines(appState.currencySettings.fiatCodes);

    if (saveCurrencySettings) {
      saveCurrencySettings.addEventListener('click', async () => {
        const parseList = (raw) => String(raw || '')
          .split(/[\n,]/)
          .map((s) => s.trim())
          .filter(Boolean);
        appState.currencySettings = {
          base: ((currencyBase?.value || 'usd').trim() || 'usd').toLowerCase(),
          cryptoIds: parseList(currencyCryptoIds?.value).map((s) => s.toLowerCase()),
          fiatCodes: parseList(currencyFiatCodes?.value).map((s) => s.toUpperCase())
        };
        await storage.set({ currencySettings: appState.currencySettings });
        alert('Markets settings saved.');
      });
    }
  }

  function initPomodoroSettings() {
    appState.pomodoroSettings = appState.pomodoroSettings || { focusMinutes: 25, breakMinutes: 5 };
    const focus = Math.max(1, Math.round(Number(appState.pomodoroSettings.focusMinutes) || 25));
    const brk = Math.max(1, Math.round(Number(appState.pomodoroSettings.breakMinutes) || 5));

    if (pomodoroFocusMinutes) pomodoroFocusMinutes.value = String(focus);
    if (pomodoroBreakMinutes) pomodoroBreakMinutes.value = String(brk);
    if (pomodoroFocusValue) pomodoroFocusValue.textContent = `${focus} min`;
    if (pomodoroBreakValue) pomodoroBreakValue.textContent = `${brk} min`;

    const save = async () => {
      appState.pomodoroSettings = {
        focusMinutes: Math.max(1, Math.round(Number(pomodoroFocusMinutes?.value) || 25)),
        breakMinutes: Math.max(1, Math.round(Number(pomodoroBreakMinutes?.value) || 5))
      };
      await storage.set({ pomodoroSettings: appState.pomodoroSettings });
    };

    if (pomodoroFocusMinutes) {
      pomodoroFocusMinutes.addEventListener('input', () => {
        if (pomodoroFocusValue) pomodoroFocusValue.textContent = `${pomodoroFocusMinutes.value} min`;
      });
      pomodoroFocusMinutes.addEventListener('change', save);
    }
    if (pomodoroBreakMinutes) {
      pomodoroBreakMinutes.addEventListener('input', () => {
        if (pomodoroBreakValue) pomodoroBreakValue.textContent = `${pomodoroBreakMinutes.value} min`;
      });
      pomodoroBreakMinutes.addEventListener('change', save);
    }
  }

  function initImageWidgetSettings() {
    const imageState = getImageWidgetState();
    if (imageWidgetUrl) imageWidgetUrl.value = imageState.src?.startsWith('http') ? imageState.src : '';

    if (setImageWidgetUrl) {
      setImageWidgetUrl.addEventListener('click', async () => {
        const url = imageWidgetUrl.value.trim();
        if (!url) return;
        await updateImageWidgetState({ src: url });
      });
    }

    if (imageWidgetUpload) {
      imageWidgetUpload.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        await updateImageWidgetState({ src: dataUrl });
      });
    }
  }

  function ensureIconGridState() {
    appState.iconGridWidgets = normalizeIconGridWidgets(appState.iconGridWidgets || []);
  }

  async function syncLiveStateBeforeExport() {
    const patch = {};
    patch.userName = appState.userName || '';

    const notesInput = document.getElementById('notesInput');
    if (notesInput) patch.notesText = notesInput.value;

    const todoList = document.getElementById('todoList');
    if (todoList) {
      const todos = [];
      todoList.querySelectorAll('li').forEach((li) => {
        const text = li.querySelector('.task-text')?.textContent?.trim() || '';
        if (!text) return;
        const done = !!li.querySelector('input[type="checkbox"]')?.checked;
        const id = String(li.dataset.id || '').trim();
        const reminderAtRaw = Number(li.dataset.reminderAt);
        const reminderSentAtRaw = Number(li.dataset.reminderSentAt);
        const reminderConfirmed = li.dataset.reminderConfirmed !== 'false';
        const reminderSource = li.dataset.reminderSource === 'auto' ? 'auto' : 'manual';
        todos.push({
          ...(id ? { id } : {}),
          text,
          done,
          reminderAt: Number.isFinite(reminderAtRaw) && reminderAtRaw > 0 ? reminderAtRaw : null,
          reminderSentAt: Number.isFinite(reminderSentAtRaw) && reminderSentAtRaw > 0 ? reminderSentAtRaw : null,
          reminderConfirmed,
          reminderSource
        });
      });
      patch.todos = todos;
    }

    const res = await storage.get([
      'positions',
      'sizes',
      'dockItems',
      'dockOpenMode',
      'imageWidget',
      'pomodoroState'
    ]);
    const positions = { ...(res.positions || {}) };
    const sizes = { ...(res.sizes || {}) };
    const workspace = document.getElementById('workspace');
    const grid = workspace ? computeGrid(workspace) : null;
    document.querySelectorAll('.widget').forEach((el) => {
      if (!el.id) return;
      const x = parseFloat(el.style.left || '0');
      const y = parseFloat(el.style.top || '0');
      const cell = grid ? posToCell(x, y, grid) : null;
      if (Number.isFinite(x) && Number.isFinite(y)) {
        positions[el.id] = {
          ...(positions[el.id] || {}),
          ...(cell ? { col: cell.col, row: cell.row } : {}),
          x: Math.round(x),
          y: Math.round(y)
        };
      }
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const span = grid ? sizeToCells(w, h, grid) : null;
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
        sizes[el.id] = {
          ...(sizes[el.id] || {}),
          ...(span ? { cw: span.cw, ch: span.ch } : {}),
          w: Math.round(w),
          h: Math.round(h)
        };
      }
    });

    patch.positions = positions;
    patch.sizes = sizes;
    patch.settings = appState.settings;
    patch.background = appState.background ?? null;
    patch.visibleWidgets = appState.visibleWidgets || {};
    patch.iconGridWidgets = appState.iconGridWidgets || [];
    patch.iconGridOpenMode = appState.iconGridOpenMode === 'same-tab' ? 'same-tab' : 'new-tab';
    patch.sportsSettings = appState.sportsSettings || {};
    patch.aiChatSettings = appState.aiChatSettings || {};
    patch.dockItems = Array.isArray(res.dockItems) ? res.dockItems : [];
    patch.dockOpenMode = res.dockOpenMode === 'same-tab' ? 'same-tab' : 'new-tab';
    patch.imageWidget = res.imageWidget || getImageWidgetState() || {};
    patch.pomodoroState = res.pomodoroState || {};

    await storage.set(patch);
  }

  async function saveIconGridState(extra = {}) {
    await storage.set({
      iconGridWidgets: appState.iconGridWidgets,
      visibleWidgets: appState.visibleWidgets,
      ...extra
    });
  }

  function renderIconGridManager() {
    if (!iconGridWidgetsList) return;
    ensureIconGridState();
    iconGridWidgetsList.innerHTML = '';

    appState.iconGridWidgets.forEach((widget, wIdx) => {
      const card = document.createElement('div');
      card.className = 'icon-grid-config-card';
      card.dataset.widgetIndex = String(wIdx);

      const top = document.createElement('div');
      top.className = 'icon-grid-config-top';
      top.innerHTML = `
        <input class="ig-title" value="${(widget.title || '').replace(/"/g, '&quot;')}" placeholder="Widget title">
        <button class="btn-secondary ig-remove-widget" type="button">Remove Widget</button>
      `;

      const list = document.createElement('div');
      list.className = 'icon-grid-config-icons';
      widget.icons.forEach((icon, iIdx) => {
        const row = document.createElement('div');
        row.className = 'icon-grid-config-row';
        row.dataset.iconIndex = String(iIdx);
        row.innerHTML = `
          <input class="ig-label" value="${(icon.label || '').replace(/"/g, '&quot;')}" placeholder="Hover name">
          <input class="ig-url" value="${(icon.url || '').replace(/"/g, '&quot;')}" placeholder="Redirect URL">
          <input class="ig-iconurl" value="${(icon.iconUrl || '').replace(/"/g, '&quot;')}" placeholder="Icon URL">
          <button class="btn-secondary ig-remove-icon" type="button">Remove</button>
        `;
        list.appendChild(row);
      });

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'btn-secondary ig-add-icon';
      addBtn.textContent = 'Add Icon';

      card.appendChild(top);
      card.appendChild(list);
      card.appendChild(addBtn);
      iconGridWidgetsList.appendChild(card);
    });
  }

  open.addEventListener('click', () => {
    renderWidgetVisibility();
    modal.classList.remove('hidden');
    setTimeout(() => modal.querySelector('input,button')?.focus(), 60);

    setTimeout(() => {
      const outsideHandler = (ev) => {
        const card = modal.querySelector('.modal-card');
        if (!card || card.contains(ev.target)) return;
        modal.classList.add('hidden');
        document.removeEventListener('mousedown', outsideHandler);
      };
      document.addEventListener('mousedown', outsideHandler);
    }, 10);
  });

  close.addEventListener('click', () => modal.classList.add('hidden'));

  // ── Edit Layout mode ──────────────────────────────────────────────────
  const enterEditLayoutBtn = document.getElementById('enterEditLayout');
  const exitEditLayoutBtn  = document.getElementById('exitEditLayout');
  const editModeBanner     = document.getElementById('editModeBanner');

  function enterEditMode() {
    modal.classList.add('hidden');
    const widgets = Array.from(document.querySelectorAll('.widget:not(.hidden)'));
    widgets.forEach((w, i) => w.style.setProperty('--jiggle-offset', String(i % 6)));
    document.body.classList.add('edit-layout-mode');
    setResizeOverlaysVisible(true);
    if (editModeBanner) editModeBanner.classList.remove('hidden');
    if (exitEditLayoutBtn) exitEditLayoutBtn.focus();
  }

  function exitEditMode() {
    document.body.classList.remove('edit-layout-mode');
    setResizeOverlaysVisible(false);
    if (editModeBanner) editModeBanner.classList.add('hidden');
    document.querySelectorAll('.widget').forEach(w => w.style.removeProperty('--jiggle-offset'));
  }

  if (enterEditLayoutBtn) {
    enterEditLayoutBtn.addEventListener('click', enterEditMode);
  }
  if (exitEditLayoutBtn) {
    exitEditLayoutBtn.addEventListener('click', exitEditMode);
  }

  // Also allow Escape to exit edit mode
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('edit-layout-mode')) {
      exitEditMode();
    }
  });
  // ─────────────────────────────────────────────────────────────────────

  function resetBugReportForm() {
    if (bugReportName) bugReportName.value = '';
    if (bugReportEmail) bugReportEmail.value = '';
    if (bugReportMessage) bugReportMessage.value = '';
  }

  if (openBugReport && bugReportModal) {
    openBugReport.addEventListener('click', () => {
      modal.classList.add('hidden');
      bugReportModal.classList.remove('hidden');
      if (bugReportName && !bugReportName.value) {
        bugReportName.value = (appState.userName || '').trim();
      }
      setTimeout(() => bugReportMessage?.focus(), 40);
    });
  }

  if (closeBugReport && bugReportModal) {
    closeBugReport.addEventListener('click', () => {
      bugReportModal.classList.add('hidden');
      resetBugReportForm();
    });
    bugReportModal.addEventListener('mousedown', (e) => {
      if (e.target !== bugReportModal) return;
      bugReportModal.classList.add('hidden');
      resetBugReportForm();
    });
  }

  if (submitBugReport) {
    submitBugReport.addEventListener('click', async () => {
      try {
        const name = (bugReportName?.value || '').trim();
        const email = (bugReportEmail?.value || '').trim();
        const message = (bugReportMessage?.value || '').trim();
        if (!name || !email || !message) {
          alert('Please fill name, email, and message.');
          return;
        }

        const formData = new FormData();
        formData.append('access_key', WEB3FORMS_ACCESS_KEY);
        formData.append('name', name);
        formData.append('email', email);
        formData.append('message', message);
        formData.append('subject', 'Bug Report - Liquid New Tab Dashboard');
        formData.append('from_name', 'Liquid New Tab Dashboard');

        const res = await fetch(WEB3FORMS_ENDPOINT, {
          method: 'POST',
          body: formData
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || payload?.success === false) {
          throw new Error(payload?.message || `HTTP ${res.status}`);
        }
        alert('Bug report submitted. Thank you.');

        bugReportModal?.classList.add('hidden');
        resetBugReportForm();
      } catch (err) {
        console.error('bug-report:submit:error', err);
        alert('Failed to submit bug report. Please try again.');
      }
    });
  }

  toggleGlass.checked = !!appState.settings.glass;
  toggleAnalog.checked = !!appState.settings.showAnalog;
  appState.settings.todoAutoReminderMode =
    appState.settings.todoAutoReminderMode === 'always' || appState.settings.todoAutoReminderMode === 'never'
      ? appState.settings.todoAutoReminderMode
      : 'ask';
  if (todoAutoReminderMode) todoAutoReminderMode.value = appState.settings.todoAutoReminderMode;
  if (toggleNotesAutoMath) {
    toggleNotesAutoMath.checked = appState.settings.notesAutoMath !== false;
  }
  if (settingsUserName) settingsUserName.value = sanitizeUserName(appState.userName || '');
  appState.settings.glassStyle = appState.settings.glassStyle || 'dark';
  appState.settings.glassDarkness = clampGlassDarkness(appState.settings.glassDarkness);
  if (glassStyle) glassStyle.value = appState.settings.glassStyle;
  if (glassDarkness) glassDarkness.value = String(appState.settings.glassDarkness);
  if (glassDarknessValue) glassDarknessValue.textContent = `${appState.settings.glassDarkness}%`;

  if (saveUserName && settingsUserName) {
    saveUserName.addEventListener('click', async () => {
      const nextName = sanitizeUserName(settingsUserName.value);
      if (!nextName) {
        alert('Please enter your name.');
        settingsUserName.focus();
        return;
      }
      applyUserNameLocally(nextName);
      await storage.set({ userName: nextName, userNameOnboarded: true });
      alert('Name updated.');
    });
    settingsUserName.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      saveUserName.click();
    });
  }

  toggleGlass.addEventListener('change', async (e) => {
    appState.settings.glass = !!e.target.checked;
    await storage.set({ settings: appState.settings });
    applySettingsLocally();
  });

  toggleAnalog.addEventListener('change', async (e) => {
    appState.settings.showAnalog = !!e.target.checked;
    await storage.set({ settings: appState.settings });
  });

  if (toggleNotesAutoMath) {
    toggleNotesAutoMath.addEventListener('change', async (e) => {
      appState.settings.notesAutoMath = !!e.target.checked;
      await storage.set({ settings: appState.settings });
    });
  }

  if (todoAutoReminderMode) {
    todoAutoReminderMode.addEventListener('change', async (e) => {
      const v = e.target.value;
      appState.settings.todoAutoReminderMode = (v === 'always' || v === 'never') ? v : 'ask';
      await storage.set({ settings: appState.settings });
    });
  }

  appState.iconGridOpenMode = appState.iconGridOpenMode === 'same-tab' ? 'same-tab' : 'new-tab';
  updateIconGridOpenModeBtn();
  document.body.dataset.iconGridOpenMode = appState.iconGridOpenMode;

  if (iconGridOpenModeBtn) {
    iconGridOpenModeBtn.addEventListener('click', async () => {
      appState.iconGridOpenMode = appState.iconGridOpenMode === 'same-tab' ? 'new-tab' : 'same-tab';
      updateIconGridOpenModeBtn();
      document.body.dataset.iconGridOpenMode = appState.iconGridOpenMode;
      await storage.set({ iconGridOpenMode: appState.iconGridOpenMode });
    });
  }

  if (glassStyle) {
    glassStyle.addEventListener('change', async (e) => {
      appState.settings.glassStyle = e.target.value === 'light' ? 'light' : 'dark';
      await storage.set({ settings: appState.settings });
      applySettingsLocally();
    });
  }

  if (glassDarkness) {
    glassDarkness.addEventListener('input', (e) => {
      appState.settings.glassDarkness = clampGlassDarkness(e.target.value);
      applySettingsLocally();
    });
    glassDarkness.addEventListener('change', async (e) => {
      appState.settings.glassDarkness = clampGlassDarkness(e.target.value);
      await storage.set({ settings: appState.settings });
      applySettingsLocally();
    });
  }

  resetPositions.addEventListener('click', async () => {
    await storage.set({
      positions: defaultPositions,
      sizes: defaultSizes
    });
    location.reload();
  });

  let uploadedDataUrl = null;
  if (useUploadedBg) useUploadedBg.disabled = true;

  if (bgUpload) {
    bgUpload.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) {
        uploadedDataUrl = null;
        useUploadedBg.disabled = true;
        return;
      }
      if (file.size > 500 * 1024) {
        uploadedDataUrl = await downscaleImage(file, 900);
      } else {
        uploadedDataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      }
      useUploadedBg.disabled = false;
      useUploadedBg.textContent = 'Use Uploaded Image';
    });
  }

  if (useUploadedBg) {
    useUploadedBg.addEventListener('click', async () => {
      if (!uploadedDataUrl) return;
      appState.background = uploadedDataUrl;
      applySettingsLocally();
      await storage.set({ background: appState.background });
      bgUpload.value = '';
      uploadedDataUrl = null;
      useUploadedBg.disabled = true;
      useUploadedBg.textContent = 'Use Uploaded';
    });
  }

  if (setBgUrl) {
    setBgUrl.addEventListener('click', async () => {
      const url = bgUrl.value.trim();
      if (!url) return;
      appState.background = url;
      applySettingsLocally();
      await storage.set({ background: appState.background });
      renderWallpaperGrid();
    });
  }

  if (bgDailyUnsplash) {
    bgDailyUnsplash.checked = !!appState.unsplashSettings.autoDaily;
  }
  if (unsplashApiKey) {
    unsplashApiKey.value = appState.unsplashSettings.apiKey || '';
  }
  if (unsplashTheme) {
    unsplashTheme.value = appState.unsplashSettings.theme || 'random';
  }
  if (saveUnsplashSettings) {
    saveUnsplashSettings.addEventListener('click', async () => {
      const themeChanged = unsplashTheme && unsplashTheme.value !== (appState.unsplashSettings?.theme || 'random');
      const next = normalizeUnsplashSettings({
        autoDaily: !!bgDailyUnsplash?.checked,
        apiKey: unsplashApiKey?.value || '',
        theme: unsplashTheme?.value || 'random',
        // Force a refresh when the theme changes by clearing the daily stamp.
        lastUpdatedDate: themeChanged ? '' : (appState.unsplashSettings?.lastUpdatedDate || '')
      });

      if (next.autoDaily && !next.apiKey) {
        alert('Enter your Unsplash Access Key to enable daily wallpaper.');
        unsplashApiKey?.focus();
        return;
      }

      appState.unsplashSettings = next;
      await storage.set({ unsplashSettings: appState.unsplashSettings });

      if (!next.autoDaily) {
        alert('Daily Unsplash wallpaper disabled.');
        return;
      }

      const changedNow = await refreshDailyUnsplashWallpaper({ force: true, silent: false });
      if (changedNow) {
        alert('Daily Unsplash wallpaper enabled and refreshed.');
      }
    });
  }

  if (clearBg) {
    clearBg.addEventListener('click', async () => {
      appState.background = null;
      await storage.set({ background: null });
      applySettingsLocally();
      renderWallpaperGrid();
    });
  }

  if (exportSettings) {
    exportSettings.addEventListener('click', async () => {
      try {
        await syncLiveStateBeforeExport();
        const allData = await storage.get(null);
        const safeData = redactApiKeysDeep(allData);
        const payload = {
          meta: {
            exportedAt: new Date().toISOString(),
            app: 'Liquid New Tab Dashboard'
          },
          data: safeData
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        a.href = url;
        a.download = `liquid-newtab-backup-${stamp}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error('settings:export:error', err);
        alert('Failed to export settings.');
      }
    });
  }

  if (importSettings) {
    importSettings.addEventListener('click', async () => {
      try {
        const file = importSettingsFile?.files?.[0];
        if (!file) return alert('Choose a backup JSON file first.');
        const text = await file.text();
        const parsed = JSON.parse(text);
        const nextData = (parsed && typeof parsed === 'object' && parsed.data && typeof parsed.data === 'object')
          ? parsed.data
          : parsed;
        if (!nextData || typeof nextData !== 'object' || Array.isArray(nextData)) {
          return alert('Invalid backup file format.');
        }
        await storage.set(nextData);
        alert('Settings imported successfully. The page will reload.');
        location.reload();
      } catch (err) {
        console.error('settings:import:error', err);
        alert('Failed to import settings. Please verify the JSON file.');
      }
    });
  }

  if (openPrivacyPolicy) {
    openPrivacyPolicy.addEventListener('click', () => {
      const url = chrome.runtime.getURL('privacy-policy.html');
      window.open(url, '_blank', 'noopener,noreferrer');
    });
  }

  if (openTermsConditions) {
    openTermsConditions.addEventListener('click', () => {
      const url = chrome.runtime.getURL('terms-and-conditions.html');
      window.open(url, '_blank', 'noopener,noreferrer');
    });
  }

  if (addIconGridWidget) {
    addIconGridWidget.addEventListener('click', async () => {
      ensureIconGridState();
      const id = `widget-icon-grid-${Date.now()}`;
      appState.iconGridWidgets.push({
        id,
        title: `Icon Grid ${appState.iconGridWidgets.length + 1}`,
        icons: []
      });
      appState.visibleWidgets[id] = true;
      await saveIconGridState();
      location.reload();
    });
  }

  if (iconGridWidgetsList) {
    iconGridWidgetsList.addEventListener('input', async (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const card = target.closest('.icon-grid-config-card');
      if (!card) return;
      const wIdx = Number(card.dataset.widgetIndex);
      if (Number.isNaN(wIdx) || !appState.iconGridWidgets[wIdx]) return;
      const widget = appState.iconGridWidgets[wIdx];

      if (target.classList.contains('ig-title')) {
        widget.title = target.value || `Icon Grid ${wIdx + 1}`;
      } else {
        const row = target.closest('.icon-grid-config-row');
        if (!row) return;
        const iIdx = Number(row.dataset.iconIndex);
        if (Number.isNaN(iIdx) || !widget.icons[iIdx]) return;
        if (target.classList.contains('ig-label')) widget.icons[iIdx].label = target.value;
        if (target.classList.contains('ig-url')) widget.icons[iIdx].url = target.value;
        if (target.classList.contains('ig-iconurl')) widget.icons[iIdx].iconUrl = target.value;
      }

      await saveIconGridState();
      renderIconGridWidgets(appState.iconGridWidgets);
    });

    iconGridWidgetsList.addEventListener('click', async (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const card = target.closest('.icon-grid-config-card');
      if (!card) return;
      const wIdx = Number(card.dataset.widgetIndex);
      if (Number.isNaN(wIdx) || !appState.iconGridWidgets[wIdx]) return;
      const widget = appState.iconGridWidgets[wIdx];

      if (target.classList.contains('ig-add-icon')) {
        widget.icons.push({ label: 'Name', url: '', iconUrl: '' });
        await saveIconGridState();
        renderIconGridManager();
        renderIconGridWidgets(appState.iconGridWidgets);
        return;
      }

      if (target.classList.contains('ig-remove-widget')) {
        appState.iconGridWidgets.splice(wIdx, 1);
        delete appState.visibleWidgets[widget.id];
        const res = await storage.get(['positions', 'sizes']);
        const positions = res.positions || {};
        const sizes = res.sizes || {};
        delete positions[widget.id];
        delete sizes[widget.id];
        await saveIconGridState({ positions, sizes });
        location.reload();
        return;
      }

      if (target.classList.contains('ig-remove-icon')) {
        const row = target.closest('.icon-grid-config-row');
        if (!row) return;
        const iIdx = Number(row.dataset.iconIndex);
        if (Number.isNaN(iIdx)) return;
        widget.icons.splice(iIdx, 1);
        await saveIconGridState();
        renderIconGridManager();
        renderIconGridWidgets(appState.iconGridWidgets);
      }
    });
  }

  initImageWidgetSettings();
  initSportsWidgetSettings();
  initAIChatSettings();
  initWeatherSettings();
  initCurrencySettings();
  initPomodoroSettings();
  builtInWallpapers = await getBuiltInWallpapers();
  renderWallpaperGrid();
  renderWidgetVisibility();
  renderIconGridManager();
  applySettingsLocally();
  await refreshDailyUnsplashWallpaper({ force: false, silent: true });
}
