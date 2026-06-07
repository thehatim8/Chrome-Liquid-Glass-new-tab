import { storage } from './storage.js';

function sendBg(type, payload = {}) {
  try {
    chrome.runtime.sendMessage({ type, ...payload }, () => void chrome.runtime.lastError);
  } catch (_) { /* extension context not available */ }
}

export async function initPomodoro(appState) {
  const timeEl = document.getElementById('pomodoroTime');
  const modeEl = document.getElementById('pomodoroMode');
  const startPauseBtn = document.getElementById('pomodoroStartPause');
  const resetBtn = document.getElementById('pomodoroReset');
  const toggleModeBtn = document.getElementById('pomodoroToggleMode');

  if (!timeEl || !modeEl || !startPauseBtn || !resetBtn || !toggleModeBtn) return;

  const settings = appState?.pomodoroSettings || { focusMinutes: 25, breakMinutes: 5 };

  function focusSecs() { return Math.max(1, Math.round((Number(settings.focusMinutes) || 25) * 60)); }
  function breakSecs() { return Math.max(1, Math.round((Number(settings.breakMinutes) || 5) * 60)); }
  function modeDuration(mode) { return mode === 'break' ? breakSecs() : focusSecs(); }

  const res = await storage.get(['pomodoroState']);
  const st = res.pomodoroState || {};

  let mode = st.mode === 'break' ? 'break' : 'focus';
  let running = !!st.running;
  let endTime = Number.isFinite(st.endTime) ? st.endTime : 0;
  let secondsLeft = Number.isFinite(st.secondsLeft) ? st.secondsLeft : modeDuration(mode);

  // Legacy default cleanup: old builds seeded a 5-min break as the default.
  const looksLegacy = st.mode === 'break' && !running && (st.secondsLeft === 300 || st.secondsLeft === 210);
  if (looksLegacy) {
    mode = 'focus';
    secondsLeft = modeDuration('focus');
  }

  let timer = null;
  let firedFor = 0;

  function currentSeconds() {
    if (running && endTime) return Math.max(0, Math.round((endTime - Date.now()) / 1000));
    return Math.max(0, secondsLeft);
  }

  function format(sec) {
    const mm = Math.floor(sec / 60).toString().padStart(2, '0');
    const ss = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${mm}:${ss}`;
  }

  function startTicker() {
    if (timer) return;
    timer = setInterval(render, 1000);
  }
  function stopTicker() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  function render() {
    const s = currentSeconds();
    timeEl.textContent = format(s);
    modeEl.textContent = mode === 'break' ? 'Break' : 'Focus';
    startPauseBtn.textContent = running ? 'Pause' : 'Start';
    toggleModeBtn.textContent = mode === 'break' ? 'Focus' : 'Break';
    // When the running timer hits zero, let the background service worker do the
    // mode switch + notification (works even if this tab later closes). Fire once.
    if (running && s <= 0 && firedFor !== endTime) {
      firedFor = endTime;
      sendBg('pomodoro-fire');
    }
  }

  async function persist() {
    await storage.set({ pomodoroState: { mode, running, endTime, secondsLeft } });
  }

  startPauseBtn.addEventListener('click', async () => {
    if (!running) {
      const s = secondsLeft > 0 ? secondsLeft : modeDuration(mode);
      running = true;
      secondsLeft = s;
      endTime = Date.now() + s * 1000;
      firedFor = 0;
      startTicker();
      await persist();
      sendBg('pomodoro-schedule', { endTime });
    } else {
      secondsLeft = currentSeconds();
      running = false;
      endTime = 0;
      stopTicker();
      await persist();
      sendBg('pomodoro-clear');
    }
    render();
  });

  resetBtn.addEventListener('click', async () => {
    running = false;
    endTime = 0;
    secondsLeft = modeDuration(mode);
    stopTicker();
    await persist();
    sendBg('pomodoro-clear');
    render();
  });

  toggleModeBtn.addEventListener('click', async () => {
    running = false;
    endTime = 0;
    mode = mode === 'break' ? 'focus' : 'break';
    secondsLeft = modeDuration(mode);
    stopTicker();
    await persist();
    sendBg('pomodoro-clear');
    render();
  });

  // Follow background-driven transitions (mode switch when a timer completes).
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.pomodoroState) {
        const v = changes.pomodoroState.newValue || {};
        mode = v.mode === 'break' ? 'break' : 'focus';
        running = !!v.running;
        endTime = Number.isFinite(v.endTime) ? v.endTime : 0;
        secondsLeft = Number.isFinite(v.secondsLeft) ? v.secondsLeft : modeDuration(mode);
        if (running) { firedFor = 0; startTicker(); } else { stopTicker(); }
        render();
      }
      if (changes.pomodoroSettings) {
        const v = changes.pomodoroSettings.newValue || {};
        if (Number.isFinite(Number(v.focusMinutes))) settings.focusMinutes = Number(v.focusMinutes);
        if (Number.isFinite(Number(v.breakMinutes))) settings.breakMinutes = Number(v.breakMinutes);
        if (appState) appState.pomodoroSettings = settings;
        if (!running) {
          secondsLeft = modeDuration(mode);
          render();
        }
      }
    });
  } catch (_) { /* storage events unavailable */ }

  if (running) startTicker();
  render();
}
