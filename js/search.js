// search.js
export function initSearch() {
  const form = document.getElementById('searchForm');
  const input = document.getElementById('searchInput');
  const suggestionsEl = document.getElementById('searchSuggestions');
  const searchWidget = document.getElementById('widget-search');
  let debounceTimer = null;
  let activeIndex = -1;
  let currentSuggestions = [];
  let mathSuggestionValue = null;

  function tryEvaluateMathExpression(rawQuery) {
    const q = String(rawQuery || '').trim();
    if (!q) return null;
    const normalized = q.replace(/[xX]/g, '*');
    if (!/^[\d+\-*/().\s]+$/.test(normalized)) return null;
    if (!/[+\-*/]/.test(normalized)) return null;
    try {
      const result = Function(`"use strict"; return (${normalized});`)();
      if (typeof result !== 'number' || !Number.isFinite(result)) return null;
      return Number(result.toFixed(10)).toString();
    } catch (_) {
      return null;
    }
  }

  function setSearchOpen(isOpen) {
    if (!searchWidget) return;
    searchWidget.classList.toggle('search-open', isOpen);
  }

  function renderSuggestions(items) {
    if (!suggestionsEl) return;
    suggestionsEl.innerHTML = '';
    currentSuggestions = items.slice(0, 6);
    activeIndex = -1;
    if (!currentSuggestions.length) {
      suggestionsEl.classList.add('hidden');
      setSearchOpen(document.activeElement === input);
      return;
    }

    currentSuggestions.forEach((txt, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'search-suggestion-item';
      btn.textContent = txt;
      btn.addEventListener('click', () => {
        if (mathSuggestionValue !== null && txt.includes('=')) {
          input.value = mathSuggestionValue;
        } else {
          input.value = txt;
        }
        suggestionsEl.classList.add('hidden');
        if (mathSuggestionValue === null) {
          form.requestSubmit();
        }
      });
      btn.addEventListener('mouseenter', () => {
        activeIndex = idx;
        updateActiveSuggestion();
      });
      suggestionsEl.appendChild(btn);
    });
    suggestionsEl.classList.remove('hidden');
    setSearchOpen(true);
  }

  function updateActiveSuggestion() {
    if (!suggestionsEl) return;
    Array.from(suggestionsEl.querySelectorAll('.search-suggestion-item')).forEach((el, idx) => {
      el.classList.toggle('active', idx === activeIndex);
    });
  }

  async function fetchSuggestions(query) {
    try {
      const url = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=6&namespace=0&format=json&origin=*`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data?.[1]) ? data[1].filter(Boolean) : [];
    } catch (err) {
      return [];
    }
  }

  input.addEventListener('input', () => {
    const q = input.value.trim();
    mathSuggestionValue = tryEvaluateMathExpression(q);
    if (debounceTimer) clearTimeout(debounceTimer);
    if (!q) {
      mathSuggestionValue = null;
      renderSuggestions([]);
      return;
    }
    if (mathSuggestionValue !== null) {
      renderSuggestions([`${q} = ${mathSuggestionValue}`]);
      return;
    }
    debounceTimer = setTimeout(async () => {
      const items = await fetchSuggestions(q);
      if (input.value.trim() !== q) return;
      renderSuggestions(items);
    }, 180);
  });

  input.addEventListener('keydown', (e) => {
    if (!currentSuggestions.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % currentSuggestions.length;
      updateActiveSuggestion();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + currentSuggestions.length) % currentSuggestions.length;
      updateActiveSuggestion();
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      if (mathSuggestionValue !== null) {
        input.value = mathSuggestionValue;
        suggestionsEl.classList.add('hidden');
        return;
      }
      input.value = currentSuggestions[activeIndex];
      form.requestSubmit();
    } else if (e.key === 'Escape') {
      renderSuggestions([]);
    }
  });

  input.addEventListener('focus', () => {
    setSearchOpen(true);
  });

  document.addEventListener('mousedown', (e) => {
    if (!suggestionsEl) return;
    if (suggestionsEl.contains(e.target) || e.target === input) return;
    suggestionsEl.classList.add('hidden');
    setSearchOpen(false);
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    const mathResult = tryEvaluateMathExpression(q);
    if (mathResult !== null) {
      input.value = mathResult;
      mathSuggestionValue = mathResult;
      renderSuggestions([`${q} = ${mathResult}`]);
      return;
    }
    const url = 'https://www.google.com/search?q=' + encodeURIComponent(q);
    window.location.href = url;
    renderSuggestions([]);
    input.value = '';
    setSearchOpen(false);
  });
  Array.from(document.querySelectorAll('.search-shortcuts button')).forEach(btn=>{
    btn.addEventListener('click', () => {
      const engine = btn.dataset.engine;
      const q = input.value.trim();
      const mathResult = tryEvaluateMathExpression(q);
      if (mathResult !== null) {
        input.value = mathResult;
        mathSuggestionValue = mathResult;
        renderSuggestions([`${q} = ${mathResult}`]);
        return;
      }
      const url = engine + encodeURIComponent(q || '');
      window.location.href = url;
      renderSuggestions([]);
      setSearchOpen(false);
    });
  });
}
