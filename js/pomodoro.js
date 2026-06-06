import { storage } from './storage.js';

const FOCUS_SECONDS = 25 * 60;
const BREAK_SECONDS = 5 * 60;

export async function initPomodoro() {
  const timeEl = document.getElementById('pomodoroTime');
  const modeEl = document.getElementById('pomodoroMode');
  const startPauseBtn = document.getElementById('pomodoroStartPause');
  const resetBtn = document.getElementById('pomodoroReset');
  const toggleModeBtn = document.getElementById('pomodoroToggleMode');

  if (!timeEl || !modeEl || !startPauseBtn || !resetBtn || !toggleModeBtn) return;

  const res = await storage.get(['pomodoroState']);
  const rawMode = res.pomodoroState?.mode;
  const rawSeconds = res.pomodoroState?.secondsLeft;
  const isLegacyDefault =
    rawMode === 'break' &&
    (rawSeconds === 300 || rawSeconds === 210);

  const state = {
    mode: isLegacyDefault ? 'focus' : (rawMode === 'break' ? 'break' : 'focus'),
    running: false,
    secondsLeft: isLegacyDefault
      ? FOCUS_SECONDS
      : Number.isFinite(rawSeconds)
      ? rawSeconds
      : FOCUS_SECONDS
  };

  let timer = null;

  function modeDuration(mode) {
    return mode === 'break' ? BREAK_SECONDS : FOCUS_SECONDS;
  }

  function format(sec) {
    const mm = Math.floor(sec / 60).toString().padStart(2, '0');
    const ss = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${mm}:${ss}`;
  }

  async function persist() {
    await storage.set({
      pomodoroState: {
        mode: state.mode,
        secondsLeft: state.secondsLeft
      }
    });
  }

  function render() {
    timeEl.textContent = format(state.secondsLeft);
    modeEl.textContent = state.mode === 'break' ? 'Break' : 'Focus';
    startPauseBtn.textContent = state.running ? 'Pause' : 'Start';
    toggleModeBtn.textContent = state.mode === 'break' ? 'Focus' : 'Break';
  }

  async function tick() {
    if (!state.running) return;
    state.secondsLeft -= 1;
    if (state.secondsLeft <= 0) {
      state.mode = state.mode === 'break' ? 'focus' : 'break';
      state.secondsLeft = modeDuration(state.mode);
      state.running = false;
      clearInterval(timer);
      timer = null;
      alert(state.mode === 'break' ? 'Focus complete. Break time.' : 'Break complete. Back to focus.');
    }
    render();
    await persist();
  }

  startPauseBtn.addEventListener('click', async () => {
    state.running = !state.running;
    if (state.running && !timer) {
      timer = setInterval(() => { void tick(); }, 1000);
    } else if (!state.running && timer) {
      clearInterval(timer);
      timer = null;
    }
    render();
    await persist();
  });

  resetBtn.addEventListener('click', async () => {
    state.running = false;
    state.secondsLeft = modeDuration(state.mode);
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    render();
    await persist();
  });

  toggleModeBtn.addEventListener('click', async () => {
    state.running = false;
    state.mode = state.mode === 'break' ? 'focus' : 'break';
    state.secondsLeft = modeDuration(state.mode);
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    render();
    await persist();
  });

  render();
}
