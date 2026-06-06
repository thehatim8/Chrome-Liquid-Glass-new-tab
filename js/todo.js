// todo.js
import { storage } from './storage.js';
const TODO_ALARM_PREFIX = 'todo-reminder:';

export async function initTodo() {
  const input = document.getElementById('todoInput');
  const list = document.getElementById('todoList');
  const res = await storage.get(['todos', 'settings']);
  const state = { todos: normalizeTodos(res.todos || []) };
  state.autoMode = normalizeAutoReminderMode(res.settings?.todoAutoReminderMode);
  const reminderTimers = new Map();
  let editorOpenForId = null;
  let alertState = null;
  let reminderAudio = null;
  let autoPromptTodoId = null;
  let toastTimer = null;

  const reminderEditor = createReminderEditor();
  const reminderAlert = createReminderAlert();
  const autoPrompt = createAutoReminderPrompt();
  const autoToast = createAutoReminderToast();

  function render() {
    list.innerHTML = '';
    state.todos.forEach((t) => {
      const li = document.createElement('li');
      li.className = t.done ? 'completed' : '';
      li.dataset.id = t.id;
      li.dataset.reminderAt = t.reminderAt ? String(t.reminderAt) : '';
      li.dataset.reminderSentAt = t.reminderSentAt ? String(t.reminderSentAt) : '';
      li.dataset.reminderConfirmed = t.reminderConfirmed === false ? 'false' : 'true';
      li.dataset.reminderSource = t.reminderSource === 'auto' ? 'auto' : 'manual';

      const hasReminder = Number.isFinite(t.reminderAt);
      const reminderTitle = hasReminder
        ? `Reminder: ${formatReminderDate(t.reminderAt)}`
        : 'Set reminder';

      li.innerHTML = `
        <div class="todo-1st-half">
          <input type="checkbox" data-id="${t.id}" ${t.done ? 'checked' : ''}>
          <div class="task-text">${escapeHtml(t.text)}</div>
        </div>
        <div class="todo-actions">
          <button class="todo-edit pointer" data-id="${t.id}" title="Edit task" aria-label="Edit task" ${t.done ? 'disabled' : ''}>&#9998;</button>
          <button class="todo-remind pointer ${hasReminder ? 'active' : ''}" title="${escapeHtml(reminderTitle)}" aria-label="${escapeHtml(reminderTitle)}" data-id="${t.id}" ${t.done ? 'disabled' : ''}><img class="todo-remind-icon" src="icons/bell-icon.svg" alt="" aria-hidden="true"></button>
          <button class="del pointer" data-id="${t.id}" title="Delete task" aria-label="Delete task">&#10006;</button>
        </div>
      `;
      list.appendChild(li);
    });
  }

  async function saveAndRefresh() {
    await storage.set({ todos: state.todos });
    try {
      await chrome.runtime.sendMessage({ type: 'todos-updated' });
    } catch (_) {
      // ignore: background sync will also run via storage change listener
    }
    render();
    scheduleAllReminders();
  }

  async function clearReminderAlarmForTodo(todoId) {
    if (!todoId) return;
    if (!chrome?.alarms?.clear) return;
    try {
      await new Promise((resolve) => chrome.alarms.clear(`${TODO_ALARM_PREFIX}${todoId}`, () => resolve()));
    } catch (_) {
      // no-op
    }
  }

  function findTodoIndexById(id) {
    if (!id) return -1;
    return state.todos.findIndex((t) => t.id === id);
  }

  function isReminderPending(todo, mode = state.autoMode) {
    if (!todo || todo.done) return false;
    if (!Number.isFinite(todo.reminderAt)) return false;
    if (todo.reminderConfirmed === false) return false;
    if (mode === 'never' && todo.reminderSource === 'auto') return false;
    const sentAt = Number.isFinite(todo.reminderSentAt) ? todo.reminderSentAt : null;
    return !sentAt || sentAt < todo.reminderAt;
  }

  function scheduleAllReminders() {
    reminderTimers.forEach((timer) => clearTimeout(timer));
    reminderTimers.clear();

    const now = Date.now();
    state.todos.forEach((t) => {
      if (!isReminderPending(t, state.autoMode)) return;
      const delay = Math.max(0, t.reminderAt - now);
      const timer = setTimeout(() => fireReminder(t.id), delay);
      reminderTimers.set(t.id, timer);
    });
  }

  function ensureReminderAudio() {
    if (reminderAudio) return reminderAudio;
    const src = chrome?.runtime?.getURL
      ? chrome.runtime.getURL('sound/ps2_notification.mp3')
      : 'sound/ps2_notification.mp3';
    reminderAudio = new Audio(src);
    reminderAudio.loop = true;
    reminderAudio.preload = 'auto';
    return reminderAudio;
  }

  function playReminderSound() {
    const audio = ensureReminderAudio();
    if (!audio) return;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }

  function stopReminderSound() {
    const audio = ensureReminderAudio();
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
  }

  function showReminderAlert(todo) {
    alertState = todo.id;
    reminderAlert.message.textContent = `Reminder: ${todo.text}`;
    reminderAlert.meta.textContent = formatReminderDate(todo.reminderAt || Date.now());
    reminderAlert.root.classList.remove('hidden');
    playReminderSound();
  }

  function hideReminderAlert() {
    reminderAlert.root.classList.add('hidden');
    alertState = null;
    stopReminderSound();
  }

  function fireReminder(todoId) {
    reminderTimers.delete(todoId);
    const idx = findTodoIndexById(todoId);
    if (idx < 0) return;
    const todo = state.todos[idx];
    if (!isReminderPending(todo, state.autoMode)) return;
    if (Date.now() + 500 < todo.reminderAt) return;

    state.todos[idx].reminderSentAt = Date.now();
    storage.set({ todos: state.todos });
    render();
    showReminderAlert(state.todos[idx]);
  }

  function setEditorDateTime(ms) {
    const d = new Date(ms);
    const yr = d.getFullYear();
    const mon = d.getMonth() + 1;
    const day = d.getDate();
    const hour24 = d.getHours();
    const minute = d.getMinutes();

    if (!Array.from(reminderEditor.year.options).some((o) => Number(o.value) === yr)) {
      const opt = document.createElement('option');
      opt.value = String(yr);
      opt.textContent = String(yr);
      reminderEditor.year.appendChild(opt);
    }

    reminderEditor.year.value = String(yr);
    reminderEditor.month.value = String(mon);
    rebuildDayOptions();
    reminderEditor.day.value = String(day);

    const ampm = hour24 >= 12 ? 'PM' : 'AM';
    const hour12 = hour24 % 12 || 12;
    reminderEditor.hour.value = String(hour12);
    reminderEditor.minute.value = String(minute).padStart(2, '0');
    reminderEditor.ampm.value = ampm;
  }

  function getEditorDateTimeMs() {
    const y = Number(reminderEditor.year.value);
    const m = Number(reminderEditor.month.value);
    const d = Number(reminderEditor.day.value);
    const h = Number(reminderEditor.hour.value);
    const min = Number(reminderEditor.minute.value);
    const ap = reminderEditor.ampm.value;
    if (![y, m, d, h, min].every(Number.isFinite)) return NaN;

    let hour24 = h % 12;
    if (ap === 'PM') hour24 += 12;
    const dt = new Date(y, m - 1, d, hour24, min, 0, 0);
    const ms = dt.getTime();
    return Number.isFinite(ms) ? ms : NaN;
  }

  function rebuildDayOptions() {
    const y = Number(reminderEditor.year.value) || new Date().getFullYear();
    const m = Number(reminderEditor.month.value) || 1;
    const oldDay = Number(reminderEditor.day.value) || 1;
    const maxDay = new Date(y, m, 0).getDate();
    reminderEditor.day.innerHTML = '';
    for (let i = 1; i <= maxDay; i += 1) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = String(i);
      reminderEditor.day.appendChild(opt);
    }
    reminderEditor.day.value = String(Math.min(oldDay, maxDay));
  }

  function updateEditorSummary() {
    const ms = getEditorDateTimeMs();
    reminderEditor.summary.textContent = Number.isFinite(ms)
      ? `Will ring on ${formatReminderDate(ms)}`
      : 'Pick a valid date and time.';
  }

  function openReminderEditor(todoId) {
    const idx = findTodoIndexById(todoId);
    if (idx < 0) return;
    const todo = state.todos[idx];
    if (todo.done) return;

    editorOpenForId = todoId;
    reminderEditor.title.textContent = `Reminder for: ${todo.text}`;
    setEditorDateTime(todo.reminderAt || nextRoundedTimeMs(30));
    updateEditorSummary();
    reminderEditor.root.classList.remove('hidden');
    setTimeout(() => reminderEditor.hour.focus(), 20);
  }

  function closeReminderEditor() {
    reminderEditor.root.classList.add('hidden');
    editorOpenForId = null;
  }

  function showAutoReminderPrompt(todoId, whenMs, text) {
    autoPromptTodoId = todoId;
    autoPrompt.message.textContent = `Detected time in task: "${text}"`;
    autoPrompt.meta.textContent = `Auto reminder set for ${formatReminderDate(whenMs)}.`;
    autoPrompt.root.classList.remove('hidden');
  }

  async function setAutoReminderMode(mode) {
    state.autoMode = normalizeAutoReminderMode(mode);
    const current = await storage.get(['settings']);
    const nextSettings = { ...(current.settings || {}), todoAutoReminderMode: state.autoMode };
    await storage.set({ settings: nextSettings });
  }

  function showAutoReminderToast(message) {
    autoToast.text.textContent = message;
    autoToast.root.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      autoToast.root.classList.remove('show');
    }, 2600);
  }

  function hideAutoReminderPrompt() {
    autoPrompt.root.classList.add('hidden');
    autoPromptTodoId = null;
  }

  reminderEditor.cancelBtn.addEventListener('click', closeReminderEditor);
  reminderEditor.root.addEventListener('click', (e) => {
    if (e.target === reminderEditor.root) closeReminderEditor();
  });

  reminderEditor.clearBtn.addEventListener('click', async () => {
    if (!editorOpenForId) return;
    const idx = findTodoIndexById(editorOpenForId);
    if (idx < 0) return;
    state.todos[idx].reminderAt = null;
    state.todos[idx].reminderSentAt = null;
    state.todos[idx].reminderConfirmed = true;
    state.todos[idx].reminderSource = 'manual';
    await clearReminderAlarmForTodo(state.todos[idx].id);
    closeReminderEditor();
    await saveAndRefresh();
  });

  reminderEditor.saveBtn.addEventListener('click', async () => {
    if (!editorOpenForId) return;
    const idx = findTodoIndexById(editorOpenForId);
    if (idx < 0) return;
    const ms = getEditorDateTimeMs();
    if (!Number.isFinite(ms)) return alert('Pick a valid date and time.');
    if (ms <= Date.now()) return alert('Reminder must be in the future.');

    state.todos[idx].reminderAt = ms;
    state.todos[idx].reminderSentAt = null;
    state.todos[idx].reminderConfirmed = true;
    state.todos[idx].reminderSource = 'manual';
    closeReminderEditor();
    await saveAndRefresh();
  });

  reminderEditor.year.addEventListener('change', () => {
    rebuildDayOptions();
    updateEditorSummary();
  });
  reminderEditor.month.addEventListener('change', () => {
    rebuildDayOptions();
    updateEditorSummary();
  });
  reminderEditor.day.addEventListener('change', updateEditorSummary);
  reminderEditor.hour.addEventListener('change', updateEditorSummary);
  reminderEditor.minute.addEventListener('change', updateEditorSummary);
  reminderEditor.ampm.addEventListener('change', updateEditorSummary);

  reminderEditor.quickBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const mins = Number(btn.dataset.minutes);
      if (!Number.isFinite(mins) || mins <= 0) return;
      setEditorDateTime(Date.now() + mins * 60 * 1000);
      updateEditorSummary();
    });
  });

  reminderAlert.dismissBtn.addEventListener('click', async () => {
    if (!alertState) return hideReminderAlert();
    const idx = findTodoIndexById(alertState);
    if (idx >= 0) {
      state.todos[idx].done = true;
      state.todos[idx].reminderConfirmed = true;
    }
    hideReminderAlert();
    if (idx >= 0) await saveAndRefresh();
  });
  reminderAlert.snoozeBtn.addEventListener('click', async () => {
    if (!alertState) return;
    const idx = findTodoIndexById(alertState);
    if (idx < 0) return hideReminderAlert();
    state.todos[idx].reminderAt = Date.now() + 5 * 60 * 1000;
    state.todos[idx].reminderSentAt = null;
    state.todos[idx].reminderConfirmed = true;
    state.todos[idx].reminderSource = 'manual';
    hideReminderAlert();
    await saveAndRefresh();
  });

  autoPrompt.keepBtn.addEventListener('click', async () => {
    if (!autoPromptTodoId) return hideAutoReminderPrompt();
    const idx = findTodoIndexById(autoPromptTodoId);
    if (idx >= 0) {
      state.todos[idx].reminderConfirmed = true;
      await saveAndRefresh();
    }
    hideAutoReminderPrompt();
  });
  autoPrompt.removeBtn.addEventListener('click', async () => {
    if (!autoPromptTodoId) return hideAutoReminderPrompt();
    const idx = findTodoIndexById(autoPromptTodoId);
    if (idx >= 0) {
      state.todos[idx].reminderAt = null;
      state.todos[idx].reminderSentAt = null;
      state.todos[idx].reminderConfirmed = true;
      state.todos[idx].reminderSource = 'manual';
      await clearReminderAlarmForTodo(state.todos[idx].id);
      await saveAndRefresh();
    }
    hideAutoReminderPrompt();
  });
  autoPrompt.neverAskBtn.addEventListener('click', async () => {
    if (!autoPromptTodoId) return hideAutoReminderPrompt();
    const idx = findTodoIndexById(autoPromptTodoId);
    if (idx >= 0) {
      state.todos[idx].reminderConfirmed = true;
      await saveAndRefresh();
    }
    await setAutoReminderMode('always');
    showAutoReminderToast('Auto reminder mode set to Always keep.');
    hideAutoReminderPrompt();
  });
  autoPrompt.root.addEventListener('click', (e) => {
    if (e.target === autoPrompt.root) hideAutoReminderPrompt();
  });

  list.addEventListener('change', async (e) => {
    if (!e.target.matches('input[type="checkbox"]')) return;
    const idx = findTodoIndexById(e.target.dataset.id);
    if (idx < 0) return;
    state.todos[idx].done = e.target.checked;
    if (state.todos[idx].done && alertState === state.todos[idx].id) hideReminderAlert();
    if (state.todos[idx].done) {
      state.todos[idx].reminderAt = null;
      state.todos[idx].reminderSentAt = null;
      state.todos[idx].reminderConfirmed = true;
      state.todos[idx].reminderSource = 'manual';
      await clearReminderAlarmForTodo(state.todos[idx].id);
    }
    await saveAndRefresh();
  });

  list.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('.todo-edit');
    if (editBtn) {
      if (editBtn.disabled) return;
      const idx = findTodoIndexById(editBtn.dataset.id);
      if (idx < 0) return;
      const current = state.todos[idx].text;
      const nextText = prompt('Edit task', current);
      if (nextText === null) return;
      const trimmed = nextText.trim();
      if (!trimmed) return alert('Task cannot be empty.');
      state.todos[idx].text = trimmed;
      await saveAndRefresh();
      return;
    }

    const remindBtn = e.target.closest('.todo-remind');
    if (remindBtn) {
      if (remindBtn.disabled) return;
      openReminderEditor(remindBtn.dataset.id);
      return;
    }

    const delBtn = e.target.closest('.del');
    if (delBtn) {
      const idx = findTodoIndexById(delBtn.dataset.id);
      if (idx < 0) return;
      if (alertState === state.todos[idx].id) hideReminderAlert();
      await clearReminderAlarmForTodo(state.todos[idx].id);
      state.todos.splice(idx, 1);
      await saveAndRefresh();
    }
  });

  input.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const v = input.value.trim();
    if (!v) return;

    const latest = await storage.get(['settings']);
    const modeFromUi = document.getElementById('todoAutoReminderMode')?.value;
    const mode = normalizeAutoReminderMode(modeFromUi ?? latest?.settings?.todoAutoReminderMode ?? state.autoMode);
    state.autoMode = mode;

    const auto = mode === 'never' ? null : extractTimeReminder(v);
    const autoReminderAt = auto?.whenMs || null;
    const shouldSetAutoReminder = !!autoReminderAt && mode !== 'never';
    const shouldAsk = !!autoReminderAt && mode === 'ask';
    const todo = {
      id: createId(),
      text: v,
      done: false,
      reminderAt: shouldSetAutoReminder ? autoReminderAt : null,
      reminderSentAt: null,
      reminderConfirmed: shouldAsk ? false : true,
      reminderSource: shouldSetAutoReminder ? 'auto' : 'manual'
    };

    state.todos.unshift(todo);
    input.value = '';
    await saveAndRefresh();

    if (shouldAsk) {
      showAutoReminderPrompt(todo.id, autoReminderAt, auto.rawMatch);
    } else if (autoReminderAt && mode === 'always') {
      showAutoReminderToast(`Reminder added for ${formatReminderDate(autoReminderAt)}.`);
    }
  });

  render();
  scheduleAllReminders();

  if (chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      if (!changes?.settings) return;
      const next = normalizeAutoReminderMode(changes.settings.newValue?.todoAutoReminderMode);
      state.autoMode = next;
      scheduleAllReminders();
    });
  }
}

function normalizeTodos(input) {
  const arr = Array.isArray(input) ? input : [];
  return arr.filter((t) => t && typeof t === 'object').map((t) => ({
    id: typeof t.id === 'string' && t.id.trim() ? t.id : createId(),
    text: String(t.text || '').trim() || 'Untitled task',
    done: !!t.done,
    reminderAt: normalizeReminderTimestamp(t.reminderAt),
    reminderSentAt: normalizeReminderTimestamp(t.reminderSentAt),
    reminderConfirmed: typeof t.reminderConfirmed === 'boolean' ? t.reminderConfirmed : true,
    reminderSource: inferReminderSource(t)
  }));
}

function normalizeAutoReminderMode(mode) {
  const m = String(mode || '').trim().toLowerCase();
  if (m === 'always' || m.includes('always')) return 'always';
  if (m === 'never' || m.includes('never')) return 'never';
  return 'ask';
}

function inferReminderSource(todo) {
  if (todo?.reminderSource === 'auto') return 'auto';
  if (todo?.reminderSource === 'manual') return 'manual';
  const hasReminder = Number.isFinite(normalizeReminderTimestamp(todo?.reminderAt));
  const hasTimeInText = /(?:\b(?:at|on)\b\s*)?(?:\d{1,2}(?::[0-5]\d)?\s*(?:am|pm)\b|(?:[01]?\d|2[0-3]):[0-5]\d\b)/i.test(String(todo?.text || ''));
  return hasReminder && hasTimeInText ? 'auto' : 'manual';
}

function normalizeReminderTimestamp(value) {
  if (value === null || typeof value === 'undefined' || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n > 0 ? n : null;
}

function extractTimeReminder(text) {
  const src = String(text || '');

  const ampmMatch = src.match(/(?:\b(?:at|on)\b\s*)?(\d{1,2})(?::([0-5]\d))?\s*(am|pm)\b/i);
  if (ampmMatch) {
    const hourRaw = Number(ampmMatch[1]);
    const minute = Number(ampmMatch[2] || '0');
    const ampm = ampmMatch[3].toUpperCase();
    if (hourRaw >= 1 && hourRaw <= 12) {
      let hour24 = hourRaw % 12;
      if (ampm === 'PM') hour24 += 12;
      const whenMs = resolveNextDateForTime(hour24, minute);
      return { whenMs, rawMatch: ampmMatch[0].trim() };
    }
  }

  const hhmmMatch = src.match(/(?:\b(?:at|on)\b\s*)?([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (hhmmMatch) {
    const hour24 = Number(hhmmMatch[1]);
    const minute = Number(hhmmMatch[2]);
    const whenMs = hour24 >= 1 && hour24 <= 12
      ? resolveClosestUpcomingForAmbiguousHour(hour24, minute)
      : resolveNextDateForTime(hour24, minute);
    return { whenMs, rawMatch: hhmmMatch[0].trim() };
  }

  return null;
}

function resolveNextDateForTime(hour24, minute) {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour24, minute, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime();
}

function resolveClosestUpcomingForAmbiguousHour(hour12, minute) {
  const base = hour12 % 12;
  const amMs = resolveNextDateForTime(base, minute);
  const pmMs = resolveNextDateForTime(base + 12, minute);
  return amMs <= pmMs ? amMs : pmMs;
}

function createReminderEditor() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const years = [currentYear, currentYear + 1, currentYear + 2, currentYear + 3, currentYear + 4]
    .map((y) => `<option value="${y}">${y}</option>`)
    .join('');
  const months = Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
  const days = Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
  const hours = Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
  const minutes = Array.from({ length: 60 }, (_, i) => `<option value="${String(i).padStart(2, '0')}">${String(i).padStart(2, '0')}</option>`).join('');

  const root = document.createElement('div');
  root.className = 'todo-reminder-overlay hidden';
  root.innerHTML = `
    <div class="todo-reminder-card" role="dialog" aria-modal="true" aria-label="Set reminder">
      <h3 class="todo-reminder-title">Set Reminder</h3>
      <p class="todo-reminder-task"></p>

      <div class="todo-reminder-grid">
        <label><span>Year</span><select class="todo-reminder-year">${years}</select></label>
        <label><span>Month</span><select class="todo-reminder-month">${months}</select></label>
        <label><span>Day</span><select class="todo-reminder-day">${days}</select></label>
        <label><span>Hour</span><select class="todo-reminder-hour">${hours}</select></label>
        <label><span>Minute</span><select class="todo-reminder-minute">${minutes}</select></label>
        <label><span>AM/PM</span><select class="todo-reminder-ampm"><option>AM</option><option>PM</option></select></label>
      </div>

      <div class="todo-reminder-quick">
        <button type="button" class="btn-secondary todo-reminder-quick-btn" data-minutes="10">+10m</button>
        <button type="button" class="btn-secondary todo-reminder-quick-btn" data-minutes="30">+30m</button>
        <button type="button" class="btn-secondary todo-reminder-quick-btn" data-minutes="60">+1h</button>
      </div>

      <p class="todo-reminder-summary"></p>

      <div class="todo-reminder-actions">
        <button type="button" class="btn-secondary todo-reminder-clear">Clear</button>
        <button type="button" class="btn-secondary todo-reminder-cancel">Cancel</button>
        <button type="button" class="btn-primary todo-reminder-save">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  return {
    root,
    title: root.querySelector('.todo-reminder-task'),
    year: root.querySelector('.todo-reminder-year'),
    month: root.querySelector('.todo-reminder-month'),
    day: root.querySelector('.todo-reminder-day'),
    hour: root.querySelector('.todo-reminder-hour'),
    minute: root.querySelector('.todo-reminder-minute'),
    ampm: root.querySelector('.todo-reminder-ampm'),
    summary: root.querySelector('.todo-reminder-summary'),
    quickBtns: Array.from(root.querySelectorAll('.todo-reminder-quick-btn')),
    clearBtn: root.querySelector('.todo-reminder-clear'),
    cancelBtn: root.querySelector('.todo-reminder-cancel'),
    saveBtn: root.querySelector('.todo-reminder-save')
  };
}

function createReminderAlert() {
  const root = document.createElement('div');
  root.className = 'todo-reminder-overlay hidden';
  root.innerHTML = `
    <div class="todo-reminder-card todo-reminder-alert" role="alertdialog" aria-modal="true" aria-label="Reminder alert">
      <h3 class="todo-reminder-title">Reminder</h3>
      <p class="todo-reminder-message"></p>
      <p class="todo-reminder-meta"></p>
      <div class="todo-reminder-actions">
        <button type="button" class="btn-secondary todo-reminder-snooze">Snooze 5m</button>
        <button type="button" class="btn-primary todo-reminder-dismiss">Dismiss</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);
  return {
    root,
    message: root.querySelector('.todo-reminder-message'),
    meta: root.querySelector('.todo-reminder-meta'),
    snoozeBtn: root.querySelector('.todo-reminder-snooze'),
    dismissBtn: root.querySelector('.todo-reminder-dismiss')
  };
}

function createAutoReminderPrompt() {
  const root = document.createElement('div');
  root.className = 'todo-reminder-overlay hidden';
  root.innerHTML = `
    <div class="todo-reminder-card todo-auto-reminder-card" role="dialog" aria-modal="true" aria-label="Auto reminder set">
      <h3 class="todo-reminder-title">Auto Reminder Detected</h3>
      <p class="todo-reminder-message"></p>
      <p class="todo-reminder-meta"></p>
      <div class="todo-reminder-actions">
        <button type="button" class="btn-secondary todo-auto-remove">Remove reminder</button>
        <button type="button" class="btn-secondary todo-auto-neverask">Don't ask again</button>
        <button type="button" class="btn-primary todo-auto-keep">Keep reminder</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);
  return {
    root,
    message: root.querySelector('.todo-reminder-message'),
    meta: root.querySelector('.todo-reminder-meta'),
    keepBtn: root.querySelector('.todo-auto-keep'),
    removeBtn: root.querySelector('.todo-auto-remove'),
    neverAskBtn: root.querySelector('.todo-auto-neverask')
  };
}

function createAutoReminderToast() {
  const root = document.createElement('div');
  root.className = 'todo-auto-toast';
  root.innerHTML = `<span class="todo-auto-toast-text"></span>`;
  document.body.appendChild(root);
  return {
    root,
    text: root.querySelector('.todo-auto-toast-text')
  };
}

function nextRoundedTimeMs(stepMinutes) {
  const stepMs = Math.max(1, stepMinutes) * 60 * 1000;
  return Math.ceil(Date.now() / stepMs) * stepMs;
}

function formatReminderDate(ms) {
  const d = new Date(ms);
  return d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function createId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `todo-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function escapeHtml(s) {
  return (s + '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
