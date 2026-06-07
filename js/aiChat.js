function appendMessage(container, role, text) {
  if (!container) return;
  const msg = document.createElement('div');
  msg.className = `ai-chat-msg ${role}`;
  msg.textContent = text;
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}

function requestAIChat({ token, model, messages }) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        {
          type: 'ai-chat',
          token,
          model,
          messages
        },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve({
              ok: false,
              status: 0,
              error: chrome.runtime.lastError.message || 'Message transport failed.'
            });
            return;
          }
          resolve(response || { ok: false, status: 0, error: 'No response from background worker.' });
        }
      );
    } catch (err) {
      resolve({ ok: false, status: 0, error: err?.message || 'Message send failed.' });
    }
  });
}

function extractAIText(data) {
  if (typeof data?.choices?.[0]?.message?.content === 'string') {
    return data.choices[0].message.content;
  }
  if (Array.isArray(data) && typeof data[0]?.generated_text === 'string') return data[0].generated_text;
  if (typeof data?.generated_text === 'string') return data.generated_text;
  if (typeof data?.summary_text === 'string') return data.summary_text;
  if (typeof data?.answer === 'string') return data.answer;
  return '';
}

function cleanAssistantText(rawText) {
  const src = String(rawText || '');
  const withoutThink = src.replace(/<think>[\s\S]*?<\/think>/gi, '');
  return withoutThink.trim();
}

function normalizeModelName(rawModel) {
  const m = String(rawModel || '').trim();
  if (!m) return 'openrouter/auto';
  return m;
}

export function initAIChat(appState) {
  const messagesEl = document.getElementById('aiChatMessages');
  const inputEl = document.getElementById('aiChatInput');
  const sendBtn = document.getElementById('aiChatSend');
  if (!messagesEl || !inputEl || !sendBtn) return;

  const history = [];
  const hasApiKey = !!(appState?.aiChatSettings?.apiKey || '').trim();
  if (!hasApiKey) {
    appendMessage(
      messagesEl,
      'assistant',
      'AI chat is ready. Set your OpenRouter API key in Settings > AI Chat settings.'
    );
  }

  async function submitMessage() {
    const q = inputEl.value.trim();
    if (!q) return;

    const settings = appState?.aiChatSettings || {};
    const apiKey = (settings.apiKey || '').trim();
    const model = normalizeModelName(settings.model || 'openrouter/auto');
    if (!apiKey) {
      appendMessage(messagesEl, 'assistant', 'Missing API key. Add an OpenRouter key in Settings > AI Chat settings.');
      return;
    }

    appendMessage(messagesEl, 'user', q);
    history.push({ role: 'user', content: q });
    inputEl.value = '';
    sendBtn.disabled = true;
    sendBtn.textContent = '...';

    try {
      const userName = String(appState?.userName || '').trim() || 'User';
      const messages = [
        { role: 'system', content: `You are a concise assistant in a browser widget. The user's name is ${userName}.` },
        ...history.map((m) => ({ role: m.role, content: m.content }))
      ];
      const response = await requestAIChat({
        token: apiKey,
        model,
        messages
      });

      if (!response?.ok) {
        const detail = String(response?.error || '');
        const used = response?.modelUsed ? ` [model: ${response.modelUsed}]` : '';
        appendMessage(
          messagesEl,
          'assistant',
          `AI request failed (${response?.status || 0}). ${detail || 'Check token/model and try again.'}${used}`
        );
        return;
      }

      const data = response.data;
      const text = cleanAssistantText(extractAIText(data)) || 'No response text returned.';
      history.push({ role: 'assistant', content: text });
      appendMessage(messagesEl, 'assistant', text);
    } catch (err) {
      appendMessage(messagesEl, 'assistant', `Network error: ${err?.message || 'unknown error'}`);
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send';
      inputEl.focus();
    }
  }

  sendBtn.addEventListener('click', submitMessage);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitMessage();
    }
  });
}
