// main.js
import { storage } from './storage.js';
import { makeLongPressDraggable } from './drag.js';
import { initSearch } from './search.js';
import { initClock } from './clock.js';
import { initTodo } from './todo.js';
import { initDock } from './dock.js';
import { initSettings } from './settings.js';
import { makeResizable, setResizeOverlaysVisible } from './resize.js';
import { initImageWidget } from './imageWidget.js';
import { updatePersistentGrid, computeGrid, posToCell, cellToPos, findNearestFreeCell } from './grid.js';
import { initNotes } from './notes.js';
import { initCalendar } from './calendar.js';
import { initDayProgress } from './dayProgress.js';
import { initPomodoro } from './pomodoro.js';
import { initSportsWidget } from './sports.js';
import { initWeather } from './weather.js';
import { initCurrency } from './currency.js';
import { initAIChat } from './aiChat.js';
import { setLayoutConfig, getLayoutConfig, normalizeLayoutConfig } from './layoutConfig.js';
import {
  normalizeIconGridWidgets,
  ensureIconGridWidgetsInWorkspace,
  renderIconGridWidgets
} from './iconGrid.js';

const WIDGET_IDS = [
  'widget-search',
  'widget-clock',
  'widget-todo',
  'widget-image',
  'widget-notes',
  'widget-aichat',
  'widget-calendar',
  'widget-dayprogress',
  'widget-pomodoro',
  'widget-sports',
  'widget-weather',
  'widget-currency'
];

const DEFAULT_PROFILE_PATH = 'default Settings/default-settings.json';
const DEFAULT_BACKGROUND = 'Images/wallpaper-default.jpg';
const DEFAULT_SETTINGS = {
  glass: true,
  showAnalog: false,
  notesAutoMath: true,
  glassStyle: 'dark',
  glassDarkness: 68,
  accentTheme: 'aqua',
  todoAutoReminderMode: 'ask',
  clockStyle: { format: '24h', showSeconds: true, fontFamily: 'system' },
  dockStyle: { iconSize: 28, bottomGap: 18, iconGap: 12, bgOpacity: 18, hidden: false }
};
const DEFAULT_DOCK_ITEMS = [
  {
    url: 'https://github.com',
    iconUrl: 'https://www.google.com/s2/favicons?domain=github.com&sz=64',
    label: 'GitHub',
    side: 'left'
  },
  {
    url: 'https://mail.google.com',
    iconUrl: 'https://www.google.com/s2/favicons?domain=gmail.com&sz=64',
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
const DEFAULT_TODOS = [{ text: 'Todo', done: false }];
const DEFAULT_NOTES_TEXT = 'Made by Hatim.';
const DEFAULT_USER_NAME = '';
const DEFAULT_POMODORO_STATE = { mode: 'focus', secondsLeft: 1500, running: false, endTime: 0 };
const DEFAULT_POMODORO_SETTINGS = { focusMinutes: 25, breakMinutes: 5 };
const DEFAULT_WEATHER_SETTINGS = { apiKey: '', units: 'metric', city: '' };
const DEFAULT_CURRENCY_SETTINGS = {
  cryptoIds: ['bitcoin', 'ethereum', 'solana'],
  fiatCodes: ['EUR', 'GBP', 'JPY'],
  base: 'usd'
};
const DEFAULT_IMAGE_WIDGET = { src: '' };
const DEFAULT_SPORTS_SETTINGS = {
  sport: 'cricket',
  apiKey: '7a209ecc-49a9-4172-831a-cc255dfd70f1',
  apiKeys: [
    'b14f5ef4-5035-4f1f-963c-e744f0c84017',
    '1dfd5e61-53f8-43f4-a70c-1cecae0bdf49',
    '621ba9ac-df95-419f-870c-21539f651652'
  ],
  footballApiKey: '',
  tournament: "ICC Men's T20 World Cup"
};
const DEFAULT_AI_CHAT_SETTINGS = {
  apiKey: '',
  model: 'openrouter/auto'
};
const DEFAULT_UNSPLASH_SETTINGS = {
  autoDaily: false,
  apiKey: '',
  theme: 'random',
  lastUpdatedDate: ''
};
const UNSPLASH_THEMES = ['random', 'nature', 'city', 'abstract', 'space', 'minimal', 'mountains', 'ocean'];

// Default layout fills the full 24x12 base grid edge-to-edge (cols 0-23,
// rows 0-11) so there is no dead space on the sides on a standard display.
const DEFAULT_POSITIONS = {
  // Top band (rows 0-2)
  "widget-clock":       { col: 0,  row: 0 },
  "widget-search":      { col: 4,  row: 0 },
  // Middle band (rows 3-8)
  "widget-todo":        { col: 0,  row: 3 },
  "widget-calendar":    { col: 6,  row: 3 },
  "widget-aichat":      { col: 12, row: 3 },
  "widget-notes":       { col: 19, row: 3 },
  "widget-weather":     { col: 19, row: 6 },
  // Bottom band (rows 9-11)
  "widget-dayprogress": { col: 0,  row: 9 },
  "widget-pomodoro":    { col: 5,  row: 9 },
  "widget-currency":    { col: 10, row: 9 },
  "widget-sports":      { col: 15, row: 9 },
  "widget-image":       { col: 20, row: 9 }
};

const DEFAULT_SPANS = {
  // Top band
  "widget-clock":       { cw: 4,  ch: 3 },
  "widget-search":      { cw: 20, ch: 3 },
  // Middle band
  "widget-todo":        { cw: 6,  ch: 6 },
  "widget-calendar":    { cw: 6,  ch: 6 },
  "widget-aichat":      { cw: 7,  ch: 6 },
  "widget-notes":       { cw: 5,  ch: 3 },
  "widget-weather":     { cw: 5,  ch: 3 },
  // Bottom band
  "widget-dayprogress": { cw: 5,  ch: 3 },
  "widget-pomodoro":    { cw: 5,  ch: 3 },
  "widget-currency":    { cw: 5,  ch: 3 },
  "widget-sports":      { cw: 5,  ch: 3 },
  "widget-image":       { cw: 4,  ch: 3 }
};

const DEFAULT_VISIBLE_WIDGETS = {
  "widget-search": true,
  "widget-clock": true,
  "widget-todo": true,
  "widget-image": true,
  "widget-notes": true,
  "widget-aichat": false,
  "widget-calendar": true,
  "widget-dayprogress": true,
  "widget-pomodoro": true,
  "widget-sports": true,
  "widget-weather": true,
  "widget-currency": true
};

function hasStoredValue(v) {
  return typeof v !== 'undefined';
}

function cloneDeep(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function spansFromSizes(sizeMap) {
  const out = {};
  Object.keys(sizeMap || {}).forEach((id) => {
    const s = sizeMap[id] || {};
    if (Number.isFinite(s.cw) && Number.isFinite(s.ch)) out[id] = { cw: s.cw, ch: s.ch };
  });
  return out;
}

function logicalPositionChanged(prev, next) {
  return prev?.col !== next.col || prev?.row !== next.row;
}

function logicalSizeChanged(prev, next) {
  return prev?.cw !== next.cw || prev?.ch !== next.ch;
}

function serializeLogicalPositions(positionMap) {
  const out = {};
  Object.keys(positionMap || {}).forEach((id) => {
    const p = positionMap[id] || {};
    if (!Number.isFinite(p.col) || !Number.isFinite(p.row)) return;
    out[id] = { col: p.col, row: p.row };
  });
  return out;
}

function serializeLogicalSizes(sizeMap) {
  const out = {};
  Object.keys(sizeMap || {}).forEach((id) => {
    const s = sizeMap[id] || {};
    if (!Number.isFinite(s.cw) || !Number.isFinite(s.ch)) return;
    out[id] = { cw: s.cw, ch: s.ch };
  });
  return out;
}

function sanitizeDefaultImageWidget(state) {
  if (!state || typeof state !== 'object') return { ...DEFAULT_IMAGE_WIDGET };
  const src = typeof state.src === 'string' ? state.src : '';
  return { src };
}

function sanitizeUserName(name) {
  const s = String(name || '').trim().replace(/\s+/g, ' ');
  if (!s) return '';
  return s.slice(0, 40);
}

function askUserNameViaModal() {
  return new Promise((resolve) => {
    const modal = document.getElementById('namePromptModal');
    const input = document.getElementById('namePromptInput');
    const saveBtn = document.getElementById('namePromptSave');
    if (!modal || !input || !saveBtn) {
      resolve('');
      return;
    }

    modal.classList.remove('hidden');
    input.value = '';
    setTimeout(() => input.focus(), 20);

    const finish = () => {
      const value = sanitizeUserName(input.value);
      modal.classList.add('hidden');
      saveBtn.removeEventListener('click', onSave);
      input.removeEventListener('keydown', onKeydown);
      resolve(value);
    };

    const onSave = () => finish();
    const onKeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finish();
      }
    };

    saveBtn.addEventListener('click', onSave);
    input.addEventListener('keydown', onKeydown);
  });
}

function sanitizeAIChatSettings(state) {
  const src = (state && typeof state === 'object') ? state : {};
  const apiKey = typeof src.apiKey === 'string' ? src.apiKey : '';
  const rawModel = typeof src.model === 'string' ? src.model.trim() : '';
  const looksLikeOldHFDefault = rawModel === 'HuggingFaceTB/SmolLM3-3B';
  const looksLikeHFInferenceSuffix = rawModel.endsWith(':hf-inference');
  let model = rawModel || DEFAULT_AI_CHAT_SETTINGS.model;
  if (looksLikeOldHFDefault || looksLikeHFInferenceSuffix) model = DEFAULT_AI_CHAT_SETTINGS.model;
  return { apiKey, model };
}

function sanitizeUnsplashSettings(state) {
  const src = (state && typeof state === 'object') ? state : {};
  const autoDaily = !!src.autoDaily;
  const apiKey = typeof src.apiKey === 'string' ? src.apiKey.trim() : '';
  const rawTheme = typeof src.theme === 'string' ? src.theme.trim().toLowerCase() : 'random';
  const theme = UNSPLASH_THEMES.includes(rawTheme) ? rawTheme : 'random';
  const lastUpdatedDate = typeof src.lastUpdatedDate === 'string' ? src.lastUpdatedDate : '';
  return { autoDaily, apiKey, theme, lastUpdatedDate };
}

async function loadDefaultProfile() {
  try {
    const url = chrome.runtime.getURL(DEFAULT_PROFILE_PATH);
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (err) {
    console.warn('Failed to load default profile:', err);
    return null;
  }
}

// Per-widget minimum cell sizes (override the global layout minimum).
const WIDGET_MIN_OVERRIDES = {
  'widget-aichat': { cols: 3, rows: 3 }
};

function minWidgetCols(id) {
  const base = Math.max(1, getLayoutConfig().minWidgetCols);
  const o = id && WIDGET_MIN_OVERRIDES[id];
  return o ? Math.max(base, o.cols) : base;
}

function minWidgetRows(id) {
  const base = Math.max(1, getLayoutConfig().minWidgetRows);
  const o = id && WIDGET_MIN_OVERRIDES[id];
  return o ? Math.max(base, o.rows) : base;
}

function pxFromSpan(span, grid, id) {
  const minCw = minWidgetCols(id);
  const minCh = minWidgetRows(id);
  const cw = Math.max(minCw, span.cw || minCw);
  const ch = Math.max(minCh, span.ch || minCh);
  const w = Math.max(32, Math.round(cw * grid.cellW - 12));
  const h = Math.max(32, Math.round(ch * grid.cellH - 12));
  return { w, h, cw, ch };
}

function normalizeLogicalPosition(raw, fallback = { col: 0, row: 0 }) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const fallbackCol = Number.isFinite(fallback?.col) ? fallback.col : 0;
  const fallbackRow = Number.isFinite(fallback?.row) ? fallback.row : 0;
  const col = Number.isFinite(src.col) ? src.col : fallbackCol;
  const row = Number.isFinite(src.row) ? src.row : fallbackRow;
  return {
    ...src,
    col: Math.max(0, Math.round(col)),
    row: Math.max(0, Math.round(row))
  };
}

function normalizeLogicalSpan(raw, fallback, id) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const minCw = minWidgetCols(id);
  const minCh = minWidgetRows(id);
  const fallbackCw = Number.isFinite(fallback?.cw) ? fallback.cw : minCw;
  const fallbackCh = Number.isFinite(fallback?.ch) ? fallback.ch : minCh;
  const cw = Number.isFinite(src.cw) ? src.cw : fallbackCw;
  const ch = Number.isFinite(src.ch) ? src.ch : fallbackCh;
  return {
    ...src,
    cw: Math.max(minCw, Math.round(cw)),
    ch: Math.max(minCh, Math.round(ch))
  };
}

function getCenteredVisibleWidgetShift(allWidgetIds, positions, sizes, visibleWidgets, grid) {
  const ids = allWidgetIds.filter((id) => visibleWidgets[id] !== false && Number.isFinite(positions[id]?.col));
  if (!ids.length) return 0;

  let usedLeft = Infinity;
  let usedRight = -Infinity;
  let minShift = -Infinity;
  let maxShift = Infinity;

  ids.forEach((id) => {
    const p = positions[id] || {};
    const s = sizes[id] || {};
    const col = Number.isFinite(p.col) ? p.col : 0;
    const minCw = minWidgetCols(id);
    const cw = Number.isFinite(s.cw) ? Math.max(minCw, s.cw) : minCw;

    usedLeft = Math.min(usedLeft, col);
    usedRight = Math.max(usedRight, col + cw);
    minShift = Math.max(minShift, -col);
    maxShift = Math.min(maxShift, grid.cols - (col + cw));
  });

  if (!Number.isFinite(usedLeft) || !Number.isFinite(usedRight)) return 0;
  const usedWidth = Math.max(1, usedRight - usedLeft);
  const targetLeft = (grid.cols - usedWidth) / 2;
  const desiredShift = Math.round(targetLeft - usedLeft);
  const shift = Math.max(minShift, Math.min(maxShift, desiredShift));
  return Number.isFinite(shift) ? shift : 0;
}

function itemsOverlap(a, b) {
  return a.col < b.col + b.cw && a.col + a.cw > b.col &&
    a.row < b.row + b.ch && a.row + a.ch > b.row;
}

function canPlaceDisplayItem(item, placed) {
  return !Object.values(placed).some((other) => itemsOverlap(item, other));
}

function buildCandidateSpans(target, id, grid) {
  const minCw = Math.min(minWidgetCols(id), grid.cols);
  const minCh = Math.min(minWidgetRows(id), grid.rows);
  const maxCw = Math.max(minCw, Math.min(target.cw, grid.cols));
  const maxCh = Math.max(minCh, Math.min(target.ch, grid.rows));
  const candidates = [];
  for (let cw = maxCw; cw >= minCw; cw--) {
    for (let ch = maxCh; ch >= minCh; ch--) {
      candidates.push({ cw, ch, area: cw * ch });
    }
  }
  candidates.sort((a, b) => b.area - a.area || b.cw - a.cw || b.ch - a.ch);
  return candidates;
}

function buildResponsiveLayout(allWidgetIds, positions, sizes, visibleWidgets, mergedDefaultPositions, mergedDefaultSpans, grid) {
  const normalizedPositions = {};
  const normalizedSpans = {};

  allWidgetIds.forEach((id) => {
    normalizedPositions[id] = normalizeLogicalPosition(positions[id], mergedDefaultPositions[id] || { col: 0, row: 0 });
    normalizedSpans[id] = normalizeLogicalSpan(sizes[id], mergedDefaultSpans[id], id);
  });

  const shift = getCenteredVisibleWidgetShift(allWidgetIds, normalizedPositions, normalizedSpans, visibleWidgets, grid);
  const placed = {};

  allWidgetIds.forEach((id) => {
    if (visibleWidgets[id] === false) return;

    const desiredPos = normalizedPositions[id];
    const desiredSpan = normalizedSpans[id];
    const desiredCol = Math.max(0, desiredPos.col + shift);
    const candidates = buildCandidateSpans(desiredSpan, id, grid);
    let placedItem = null;

    for (const candidate of candidates) {
      const maxCol = Math.max(0, grid.cols - candidate.cw);
      const maxRow = Math.max(0, grid.rows - candidate.ch);
      const direct = {
        col: Math.max(0, Math.min(desiredCol, maxCol)),
        row: Math.max(0, Math.min(desiredPos.row, maxRow)),
        cw: candidate.cw,
        ch: candidate.ch
      };

      if (canPlaceDisplayItem(direct, placed)) {
        placedItem = direct;
        break;
      }

      const free = findNearestFreeCell(direct.col, direct.row, candidate.cw, candidate.ch, placed, grid);
      if (free) {
        placedItem = { col: free.col, row: free.row, cw: candidate.cw, ch: candidate.ch };
        break;
      }
    }

    if (!placedItem) {
      const fallback = candidates[candidates.length - 1] || {
        cw: Math.min(minWidgetCols(id), grid.cols),
        ch: Math.min(minWidgetRows(id), grid.rows)
      };
      placedItem = {
        col: Math.max(0, Math.min(desiredCol, Math.max(0, grid.cols - fallback.cw))),
        row: Math.max(0, Math.min(desiredPos.row, Math.max(0, grid.rows - fallback.ch))),
        cw: fallback.cw,
        ch: fallback.ch
      };
    }

    placed[id] = placedItem;
  });

  return { normalizedPositions, normalizedSpans, placed };
}

async function bootstrap() {
  // Disable native context menu across the dashboard UI.
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  const profile = await loadDefaultProfile();
  const profileData = profile?.data || {};
  const profilePositions = profileData.positions || {};
  const profileSizes = profileData.sizes || {};
  const profileVisibleWidgets = profileData.visibleWidgets || {};
  const profileIconGridWidgets = normalizeIconGridWidgets(profileData.iconGridWidgets || []);
  const profileDockItems = Array.isArray(profileData.dockItems) ? profileData.dockItems : [];
  const profileBackground = typeof profileData.background === 'string' ? profileData.background.trim() : '';
  const profileTodos = Array.isArray(profileData.todos) ? profileData.todos : [];
  const profileNotesText = typeof profileData.notesText === 'string' ? profileData.notesText : '';
  const profileSeedUserName = sanitizeUserName(profileData.userName || '');
  const profilePomodoroState = profileData.pomodoroState || {};
  const profileImageWidget = profileData.imageWidget || {};
  const profileSportsSettings = profileData.sportsSettings || {};
  const profileAIChatSettings = profileData.aiChatSettings || {};
  const profileUnsplashSettings = profileData.unsplashSettings || {};
  const hasProfileLayout = !!(profileData.layout && typeof profileData.layout === 'object');
  const profileLayoutConfig = normalizeLayoutConfig(profileData.layout || {});
  const profileDockOpenMode = profileData.dockOpenMode === 'same-tab' ? 'same-tab' : 'new-tab';
  const profileIconGridOpenMode = profileData.iconGridOpenMode === 'same-tab' ? 'same-tab' : 'new-tab';

  const defaultPositions = Object.keys(profilePositions).length ? profilePositions : DEFAULT_POSITIONS;
  const defaultSizesFromProfile = Object.keys(profileSizes).length ? profileSizes : {};
  const defaultSpans = { ...DEFAULT_SPANS, ...spansFromSizes(defaultSizesFromProfile) };
  const defaultVisibleWidgets = { ...DEFAULT_VISIBLE_WIDGETS, ...profileVisibleWidgets };
  const defaultSettings = {
    ...DEFAULT_SETTINGS,
    ...(profileData.settings || {}),
    glass: true,
    glassStyle: 'dark'
  };
  const defaultIconGridWidgets = profileIconGridWidgets;
  const defaultDockItems = profileDockItems.length ? profileDockItems : DEFAULT_DOCK_ITEMS;
  const defaultBackground = profileBackground || DEFAULT_BACKGROUND;
  const defaultTodos = profileTodos.length ? profileTodos : DEFAULT_TODOS;
  const defaultNotesText = profileNotesText || DEFAULT_NOTES_TEXT;
  const defaultUserName = DEFAULT_USER_NAME;
  const defaultPomodoroState = { ...DEFAULT_POMODORO_STATE, ...profilePomodoroState };
  const defaultPomodoroSettings = { ...DEFAULT_POMODORO_SETTINGS, ...(profileData.pomodoroSettings || {}) };
  const defaultWeatherSettings = { ...DEFAULT_WEATHER_SETTINGS, ...(profileData.weatherSettings || {}) };
  const defaultCurrencySettings = { ...DEFAULT_CURRENCY_SETTINGS, ...(profileData.currencySettings || {}) };
  const defaultImageWidget = sanitizeDefaultImageWidget(profileImageWidget);
  const defaultSportsSettings = { ...DEFAULT_SPORTS_SETTINGS, ...profileSportsSettings };
  const defaultAIChatSettings = sanitizeAIChatSettings({
    ...DEFAULT_AI_CHAT_SETTINGS,
    ...profileAIChatSettings
  });
  const defaultUnsplashSettings = sanitizeUnsplashSettings({
    ...DEFAULT_UNSPLASH_SETTINGS,
    ...profileUnsplashSettings
  });

  const res = await storage.get([
    'positions',
    'settings',
    'todos',
    'dockItems',
    'background',
    'sizes',
    'visibleWidgets',
    'iconGridWidgets',
    'notesText',
    'userName',
    'userNameOnboarded',
    'pomodoroState',
    'pomodoroSettings',
    'weatherSettings',
    'currencySettings',
    'imageWidget',
    'sportsSettings',
    'aiChatSettings',
    'unsplashSettings',
    'dockOpenMode',
    'iconGridOpenMode',
    'layoutConfig'
  ]);
  const layoutConfig = hasProfileLayout
    ? profileLayoutConfig
    : normalizeLayoutConfig(res.layoutConfig || {});
  setLayoutConfig(layoutConfig);
  const positions = hasStoredValue(res.positions) ? res.positions : cloneDeep(defaultPositions);
  const settings = hasStoredValue(res.settings) ? { ...defaultSettings, ...(res.settings || {}) } : defaultSettings;
  const background = hasStoredValue(res.background) ? res.background : defaultBackground;
  const sizes = hasStoredValue(res.sizes) ? res.sizes : cloneDeep(defaultSizesFromProfile);
  const storedUserName = hasStoredValue(res.userName) ? sanitizeUserName(res.userName) : '';
  const hasUserNameOnboarded = res.userNameOnboarded === true;
  let userName = storedUserName || defaultUserName || '';
  const visibleWidgets = { ...defaultVisibleWidgets, ...(res.visibleWidgets || {}) };
  const iconGridWidgets = normalizeIconGridWidgets(
    hasStoredValue(res.iconGridWidgets) ? res.iconGridWidgets : defaultIconGridWidgets
  );
  const sportsSettings = hasStoredValue(res.sportsSettings) ? { ...defaultSportsSettings, ...res.sportsSettings } : defaultSportsSettings;
  const pomodoroSettings = hasStoredValue(res.pomodoroSettings) ? { ...defaultPomodoroSettings, ...res.pomodoroSettings } : defaultPomodoroSettings;
  const weatherSettings = hasStoredValue(res.weatherSettings) ? { ...defaultWeatherSettings, ...res.weatherSettings } : defaultWeatherSettings;
  const currencySettings = hasStoredValue(res.currencySettings) ? { ...defaultCurrencySettings, ...res.currencySettings } : defaultCurrencySettings;
  const aiChatSettings = hasStoredValue(res.aiChatSettings)
    ? sanitizeAIChatSettings({ ...defaultAIChatSettings, ...res.aiChatSettings })
    : defaultAIChatSettings;
  const unsplashSettings = hasStoredValue(res.unsplashSettings)
    ? sanitizeUnsplashSettings({ ...defaultUnsplashSettings, ...res.unsplashSettings })
    : defaultUnsplashSettings;
  const iconGridOpenMode = res.iconGridOpenMode === 'same-tab' ? 'same-tab' : profileIconGridOpenMode;

  const defaultsToPersist = {};
  Object.entries(profileData || {}).forEach(([key, value]) => {
    if (!hasStoredValue(res[key])) {
      defaultsToPersist[key] = cloneDeep(value);
    }
  });
  if (!hasStoredValue(res.positions)) defaultsToPersist.positions = cloneDeep(defaultPositions);
  if (!hasStoredValue(res.settings)) defaultsToPersist.settings = defaultSettings;
  if (!hasStoredValue(res.background)) defaultsToPersist.background = defaultBackground;
  if (!hasStoredValue(res.sizes)) defaultsToPersist.sizes = cloneDeep(defaultSizesFromProfile);
  if (!hasStoredValue(res.visibleWidgets)) defaultsToPersist.visibleWidgets = defaultVisibleWidgets;
  if (!hasStoredValue(res.iconGridWidgets)) defaultsToPersist.iconGridWidgets = defaultIconGridWidgets;
  if (!hasStoredValue(res.dockItems)) defaultsToPersist.dockItems = defaultDockItems;
  if (!hasStoredValue(res.todos)) defaultsToPersist.todos = defaultTodos;
  if (!hasStoredValue(res.notesText)) defaultsToPersist.notesText = defaultNotesText;
  if (!hasStoredValue(res.userName) && defaultUserName) defaultsToPersist.userName = defaultUserName;
  if (hasStoredValue(res.userName) && storedUserName !== res.userName) defaultsToPersist.userName = storedUserName;
  if (!hasUserNameOnboarded) {
    const hasNonSeedName = !!userName && (!profileSeedUserName || userName !== profileSeedUserName);
    if (hasNonSeedName) defaultsToPersist.userNameOnboarded = true;
    else if (profileSeedUserName && userName === profileSeedUserName) {
      userName = '';
      defaultsToPersist.userName = '';
    }
  }
  if (!hasStoredValue(res.pomodoroState)) defaultsToPersist.pomodoroState = defaultPomodoroState;
  if (!hasStoredValue(res.pomodoroSettings)) defaultsToPersist.pomodoroSettings = defaultPomodoroSettings;
  if (!hasStoredValue(res.weatherSettings)) defaultsToPersist.weatherSettings = defaultWeatherSettings;
  if (!hasStoredValue(res.currencySettings)) defaultsToPersist.currencySettings = defaultCurrencySettings;
  if (!hasStoredValue(res.imageWidget)) defaultsToPersist.imageWidget = defaultImageWidget;
  if (!hasStoredValue(res.sportsSettings)) defaultsToPersist.sportsSettings = defaultSportsSettings;
  if (!hasStoredValue(res.aiChatSettings)) defaultsToPersist.aiChatSettings = defaultAIChatSettings;
  if (hasStoredValue(res.aiChatSettings)) {
    const nextAI = sanitizeAIChatSettings(res.aiChatSettings);
    if (nextAI.model !== res.aiChatSettings?.model || nextAI.apiKey !== (res.aiChatSettings?.apiKey || '')) {
      defaultsToPersist.aiChatSettings = nextAI;
    }
  }
  if (!hasStoredValue(res.unsplashSettings)) defaultsToPersist.unsplashSettings = defaultUnsplashSettings;
  if (hasStoredValue(res.unsplashSettings)) {
    const nextUnsplash = sanitizeUnsplashSettings(res.unsplashSettings);
    if (
      nextUnsplash.autoDaily !== !!res.unsplashSettings?.autoDaily
      || nextUnsplash.apiKey !== (res.unsplashSettings?.apiKey || '')
      || nextUnsplash.theme !== (res.unsplashSettings?.theme || 'random')
      || nextUnsplash.lastUpdatedDate !== (res.unsplashSettings?.lastUpdatedDate || '')
    ) {
      defaultsToPersist.unsplashSettings = nextUnsplash;
    }
  }
  if (!hasStoredValue(res.dockOpenMode)) defaultsToPersist.dockOpenMode = profileDockOpenMode;
  if (!hasStoredValue(res.iconGridOpenMode)) defaultsToPersist.iconGridOpenMode = profileIconGridOpenMode;
  if (!hasStoredValue(res.layoutConfig) || hasProfileLayout) defaultsToPersist.layoutConfig = layoutConfig;
  if (Object.keys(defaultsToPersist).length) await storage.set(defaultsToPersist);

  const appState = {
    positions,
    settings,
    background,
    sizes,
    visibleWidgets,
    iconGridWidgets,
    iconGridOpenMode,
    sportsSettings,
    pomodoroSettings,
    weatherSettings,
    currencySettings,
    aiChatSettings,
    unsplashSettings,
    userName,
    layoutConfig
  };
  const workspace = document.getElementById('workspace');
  ensureIconGridWidgetsInWorkspace(workspace, iconGridWidgets);

  const iconGridIds = iconGridWidgets.map((w) => w.id);
  const allWidgetIds = [...WIDGET_IDS, ...iconGridIds];
  const dynamicDefaultPositions = {};
  const dynamicDefaultSpans = {};
  iconGridWidgets.forEach((w, idx) => {
    if (!defaultPositions[w.id]) dynamicDefaultPositions[w.id] = { col: (idx * 4) % 12, row: 0 + Math.floor(idx / 3) * 2 };
    if (!defaultSpans[w.id]) dynamicDefaultSpans[w.id] = { cw: 3, ch: 2 };
  });
  const mergedDefaultPositions = { ...DEFAULT_POSITIONS, ...defaultPositions, ...dynamicDefaultPositions };
  const mergedDefaultSpans = { ...DEFAULT_SPANS, ...defaultSpans, ...dynamicDefaultSpans };

  const bootGrid = computeGrid(workspace);
  let normalizedLayoutChanged = false;

  // apply background & glass early
  const glassDarkness = Number.isFinite(Number(settings.glassDarkness))
    ? Math.max(0, Math.min(100, Math.round(Number(settings.glassDarkness))))
    : 68;
  document.documentElement.style.setProperty('--glass-darkness', String(glassDarkness));
  // apply dock styling early so the dock doesn't flash at default size
  const clampNum = (v, lo, hi, fb) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fb;
  };
  const ds = settings.dockStyle || {};
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty('--dock-icon-size', `${clampNum(ds.iconSize, 18, 52, 28)}px`);
  rootStyle.setProperty('--dock-bottom', `${clampNum(ds.bottomGap, 0, 90, 18)}px`);
  rootStyle.setProperty('--dock-gap', `${clampNum(ds.iconGap, 2, 30, 12)}px`);
  rootStyle.setProperty('--dock-bg-alpha', String(clampNum(ds.bgOpacity, 0, 100, 18) / 100));
  const dockEl = document.getElementById('dock');
  if (dockEl) dockEl.classList.toggle('dock-hidden', !!ds.hidden);
  if (settings.glass) document.body.classList.add('glass');
  if ((settings.glassStyle || 'dark') === 'light') document.body.classList.add('glass-light');
  else document.body.classList.remove('glass-light');
  document.body.dataset.accent = settings.accentTheme || 'aqua';
  document.body.dataset.colorTheme = settings.colorTheme || 'default';
  const settingsIconImg = document.querySelector('#openSettings img');
  if (settingsIconImg) {
    const useBlackIcon = !!settings.glass && (settings.glassStyle || 'dark') === 'light';
    settingsIconImg.src = useBlackIcon ? 'icons/settings-black.svg' : 'icons/settings-white.svg';
  }
  if (background) {
    document.body.classList.add('custom-bg');
    document.body.style.backgroundImage = `url("${background}")`;
  }
  document.body.dataset.iconGridOpenMode = iconGridOpenMode;

  const greetingEl = document.getElementById('greeting');
  const setGreeting = (name) => {
    if (!greetingEl) return;
    greetingEl.textContent = name ? `Hello, ${name}.` : 'Hello.';
  };
  setGreeting(userName);

  if (!userName) {
    const typedName = await askUserNameViaModal();
    const nextName = typedName || 'Friend';
    appState.userName = nextName;
    setGreeting(nextName);
    await storage.set({ userName: nextName, userNameOnboarded: true });
  }

  // Normalize stored logical layout. Pixel x/y/w/h are viewport-specific, so
  // we keep them in memory only and avoid persisting them during boot.
  allWidgetIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const p = positions[id] || mergedDefaultPositions[id] || { col: 0, row: 0 };
    const stored = sizes[id] || {};
    let span = null;
    if (Number.isFinite(stored.cw) && Number.isFinite(stored.ch)) {
      span = { cw: stored.cw, ch: stored.ch };
    } else if (Number.isFinite(stored.w) && Number.isFinite(stored.h)) {
      const minCw = minWidgetCols(id);
      const minCh = minWidgetRows(id);
      span = {
        cw: Math.max(minCw, Math.ceil(stored.w / bootGrid.cellW)),
        ch: Math.max(minCh, Math.ceil(stored.h / bootGrid.cellH))
      };
    } else {
      span = mergedDefaultSpans[id] || { cw: minWidgetCols(id), ch: minWidgetRows(id) };
    }
    const minCw = minWidgetCols(id);
    const minCh = minWidgetRows(id);
    const spanNorm = {
      cw: Math.max(minCw, span.cw || minCw),
      ch: Math.max(minCh, span.ch || minCh)
    };
    if (Number.isFinite(p.col) && Number.isFinite(p.row)) {
      const nextPos = normalizeLogicalPosition(p, p);
      if (logicalPositionChanged(p, nextPos)) normalizedLayoutChanged = true;
      positions[id] = nextPos;
    } else if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
      const derivedCell = posToCell(p.x, p.y, bootGrid);
      positions[id] = normalizeLogicalPosition({ ...p, col: derivedCell.col, row: derivedCell.row }, derivedCell);
      normalizedLayoutChanged = true;
    } else {
      positions[id] = normalizeLogicalPosition(mergedDefaultPositions[id] || { col: 0, row: 0 });
      normalizedLayoutChanged = true;
    }
    const prevSize = sizes[id] || {};
    const nextSize = normalizeLogicalSpan(prevSize, spanNorm, id);
    if (logicalSizeChanged(prevSize, nextSize)) normalizedLayoutChanged = true;
    sizes[id] = nextSize;
    el.classList.toggle('hidden', visibleWidgets[id] === false);
  });

  function relayoutWidgetsToGrid() {
    const grid = computeGrid(workspace);
    const { normalizedPositions, normalizedSpans, placed } = buildResponsiveLayout(
      allWidgetIds,
      positions,
      sizes,
      visibleWidgets,
      mergedDefaultPositions,
      mergedDefaultSpans,
      grid
    );

    allWidgetIds.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      const display = placed[id] || {
        col: normalizedPositions[id]?.col || 0,
        row: normalizedPositions[id]?.row || 0,
        cw: Math.min(normalizedSpans[id]?.cw || minWidgetCols(id), grid.cols),
        ch: Math.min(normalizedSpans[id]?.ch || minWidgetRows(id), grid.rows)
      };
      const s = pxFromSpan(display, grid, id);
      const px = cellToPos(display.col, display.row, grid);

      positions[id] = { ...(positions[id] || {}), x: px.x, y: px.y };
      sizes[id] = { ...(sizes[id] || {}), w: s.w, h: s.h };
      el.style.left = `${px.x}px`;
      el.style.top = `${px.y}px`;
      el.style.width = `${s.w}px`;
      el.style.height = `${s.h}px`;
    });

    updatePersistentGrid(workspace);
  }

  if (normalizedLayoutChanged) {
    await storage.set({
      positions: serializeLogicalPositions(positions),
      sizes: serializeLogicalSizes(sizes)
    });
  }

  relayoutWidgetsToGrid();
  let relayoutRaf = 0;
  window.addEventListener('resize', () => {
    if (relayoutRaf) cancelAnimationFrame(relayoutRaf);
    relayoutRaf = requestAnimationFrame(() => {
      relayoutRaf = 0;
      relayoutWidgetsToGrid();
    });
  });

  // wire interactions
  allWidgetIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    makeLongPressDraggable(el, workspace, id, positions[id] || mergedDefaultPositions[id]);
    makeResizable(el, workspace, id);
  });

  initSearch();
  initClock(settings);
  await initImageWidget(appState);
  await initTodo();
  await initNotes(appState);
  initAIChat(appState);
  initCalendar();
  initDayProgress();
  await initPomodoro(appState);
  initSportsWidget(appState);
  initWeather(appState);
  initCurrency(appState);
  renderIconGridWidgets(iconGridWidgets);
  await initDock();

  const defaultSizes = {};
  Object.keys(mergedDefaultSpans).forEach((id) => {
    defaultSizes[id] = pxFromSpan(mergedDefaultSpans[id], bootGrid, id);
  });
  await initSettings(appState, {
    defaultPositions: mergedDefaultPositions,
    defaultSizes,
    widgetIds: allWidgetIds
  });

  document.body.classList.remove('app-booting');

  // outside click to close settings is handled in settings module
}

bootstrap();

