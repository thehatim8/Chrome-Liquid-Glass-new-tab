const DEFAULT_OPENROUTER_MODEL = 'openrouter/auto';
const TODO_ALARM_PREFIX = 'todo-reminder:';
const POMODORO_ALARM = 'pomodoro-end';

function normalizeModelName(rawModel) {
  const m = String(rawModel || '').trim();
  if (!m) return DEFAULT_OPENROUTER_MODEL;
  return m;
}

function stringifyProviderError(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (typeof err.error === 'string') return err.error;
  if (typeof err.message === 'string') return err.message;
  try {
    return JSON.stringify(err);
  } catch (_) {
    return String(err);
  }
}

function makeTodoId() {
  if (self.crypto?.randomUUID) return self.crypto.randomUUID();
  return `todo-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function normalizeTodos(input) {
  const src = Array.isArray(input) ? input : [];
  let changed = false;
  const todos = src
    .filter((t) => t && typeof t === 'object')
      .map((t) => {
        const id = (typeof t.id === 'string' && t.id.trim()) ? t.id : makeTodoId();
        if (id !== t.id) changed = true;
        const reminderAt = normalizeReminderTimestamp(t.reminderAt);
        const reminderSentAt = normalizeReminderTimestamp(t.reminderSentAt);
        const reminderConfirmed = typeof t.reminderConfirmed === 'boolean' ? t.reminderConfirmed : true;
        const reminderSource = inferReminderSource(t);
        if (reminderAt !== t.reminderAt) changed = true;
        if (reminderSentAt !== t.reminderSentAt) changed = true;
        if (reminderConfirmed !== t.reminderConfirmed) changed = true;
        if (reminderSource !== t.reminderSource) changed = true;
        return {
          ...t,
          id,
          done: !!t.done,
          reminderAt,
          reminderSentAt,
          reminderConfirmed,
          reminderSource
        };
      });
  return { todos, changed };
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

function normalizeAutoReminderMode(mode) {
  const m = String(mode || '').trim().toLowerCase();
  if (m === 'always' || m.includes('always')) return 'always';
  if (m === 'never' || m.includes('never')) return 'never';
  return 'ask';
}

function isReminderPending(todo, mode = 'ask') {
  if (!todo || todo.done) return false;
  if (!Number.isFinite(todo.reminderAt)) return false;
  if (todo.reminderConfirmed === false) return false;
  if (mode === 'never' && todo.reminderSource === 'auto') return false;
  const sentAt = Number.isFinite(todo.reminderSentAt) ? todo.reminderSentAt : null;
  return !sentAt || sentAt < todo.reminderAt;
}

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}

function alarmsGetAll() {
  return new Promise((resolve) => chrome.alarms.getAll(resolve));
}

function alarmsCreate(name, when) {
  return new Promise((resolve) => {
    chrome.alarms.create(name, { when });
    resolve();
  });
}

function alarmsClear(name) {
  return new Promise((resolve) => chrome.alarms.clear(name, resolve));
}

function notificationsCreate(id, options) {
  return new Promise((resolve) => chrome.notifications.create(id, options, resolve));
}

async function scheduleTodoReminderAlarmsFromStorage() {
  const res = await storageGet(['todos', 'settings']);
  const normalized = normalizeTodos(res.todos || []);
  const todos = normalized.todos;
  const mode = normalizeAutoReminderMode(res.settings?.todoAutoReminderMode);
  if (normalized.changed) {
    await storageSet({ todos });
  }

  const alarms = await alarmsGetAll();
  await Promise.all(
    alarms
      .filter((a) => a?.name?.startsWith(TODO_ALARM_PREFIX))
      .map((a) => alarmsClear(a.name))
  );

  const now = Date.now();
  const pending = todos.filter((todo) => isReminderPending(todo, mode));
  await Promise.all(
    pending.map((todo) => {
      const when = Math.max(now + 1000, todo.reminderAt);
      return alarmsCreate(`${TODO_ALARM_PREFIX}${todo.id}`, when);
    })
  );
}

function pomodoroDuration(mode, settings) {
  const focus = Math.max(1, Math.round(Number(settings?.focusMinutes) || 25));
  const brk = Math.max(1, Math.round(Number(settings?.breakMinutes) || 5));
  return (mode === 'break' ? brk : focus) * 60;
}

// Advance the Pomodoro to the next mode and notify. Idempotent: only acts if a
// running timer has actually reached (or passed) its end time.
async function advancePomodoro() {
  const res = await storageGet(['pomodoroState', 'pomodoroSettings']);
  const state = res.pomodoroState || {};
  const settings = res.pomodoroSettings || {};
  if (!state.running) return;
  const endTime = Number(state.endTime) || 0;
  if (endTime && Date.now() < endTime - 1500) return; // not done yet

  const finishedMode = state.mode === 'break' ? 'break' : 'focus';
  const nextMode = finishedMode === 'break' ? 'focus' : 'break';
  const nextSeconds = pomodoroDuration(nextMode, settings);

  await storageSet({
    pomodoroState: {
      mode: nextMode,
      running: false,
      endTime: 0,
      secondsLeft: nextSeconds
    }
  });
  await alarmsClear(POMODORO_ALARM);

  await notificationsCreate(`pomodoro-${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: finishedMode === 'break' ? 'Break complete' : 'Focus complete',
    message: finishedMode === 'break'
      ? 'Break over — back to focus.'
      : 'Nice work! Time for a break.',
    priority: 2
  });
}

async function markReminderSent(todoId) {
  const res = await storageGet(['todos', 'settings']);
  const normalized = normalizeTodos(res.todos || []);
  const todos = normalized.todos;
  const mode = normalizeAutoReminderMode(res.settings?.todoAutoReminderMode);
  const idx = todos.findIndex((t) => t.id === todoId);
  if (idx < 0) return null;
  const todo = todos[idx];
  if (!isReminderPending(todo, mode)) return null;
  todos[idx] = { ...todo, reminderSentAt: Date.now() };
  await storageSet({ todos });
  return todos[idx];
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'todos-updated') {
    scheduleTodoReminderAlarmsFromStorage()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err?.message || 'Failed to refresh reminders.' }));
    return true;
  }

  if (message?.type === 'pomodoro-schedule') {
    const when = Number(message.endTime) || (Date.now() + 1000);
    alarmsCreate(POMODORO_ALARM, Math.max(Date.now() + 1000, when))
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err?.message || 'Failed to schedule.' }));
    return true;
  }

  if (message?.type === 'pomodoro-clear') {
    alarmsClear(POMODORO_ALARM)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === 'pomodoro-fire') {
    advancePomodoro()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err?.message || 'Failed.' }));
    return true;
  }

  if (!message || (message.type !== 'ai-chat' && message.type !== 'hf-chat')) return false;

  const token = String(message.token || '').trim();
  const messages = Array.isArray(message.messages) ? message.messages : [];
  const model = normalizeModelName(message.model || DEFAULT_OPENROUTER_MODEL);

  if (!token || !messages.length) {
    sendResponse({ ok: false, status: 400, error: 'Missing token or messages.' });
    return false;
  }

  (async () => {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'HTTP-Referer': 'https://liquid-new-tab.local',
          'X-Title': 'Liquid New Tab Dashboard'
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: 220
        })
      });

      const text = await response.text();
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch (_) {
        parsed = null;
      }

      if (!response.ok) {
        sendResponse({
          ok: false,
          status: response.status,
          error: stringifyProviderError(parsed || text || 'Unknown OpenRouter error.'),
          modelUsed: model
        });
        return;
      }

      sendResponse({
        ok: true,
        status: response.status,
        data: parsed ?? text,
        modelUsed: parsed?.model || model
      });
    } catch (err) {
      sendResponse({
        ok: false,
        status: 0,
        error: err?.message || 'Network error.'
      });
    }
  })();

  return true;
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm?.name === POMODORO_ALARM) {
    await advancePomodoro();
    return;
  }
  if (!alarm?.name || !alarm.name.startsWith(TODO_ALARM_PREFIX)) return;
  const todoId = alarm.name.slice(TODO_ALARM_PREFIX.length);
  if (!todoId) return;

  const todo = await markReminderSent(todoId);
  if (!todo) return;

  await notificationsCreate(`todo-reminder-${todoId}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Todo Reminder',
    message: todo.text || 'You have a pending task.',
    priority: 2
  });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (!changes?.todos && !changes?.settings) return;
  scheduleTodoReminderAlarmsFromStorage().catch(() => {});
});

chrome.runtime.onInstalled.addListener(() => {
  scheduleTodoReminderAlarmsFromStorage().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  scheduleTodoReminderAlarmsFromStorage().catch(() => {});
});

scheduleTodoReminderAlarmsFromStorage().catch(() => {});
