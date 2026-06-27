// clock.js
const CLOCK_FONTS = ['system', 'mono', 'thin', 'rounded', 'serif', 'condensed', 'digital'];

export function initClock(settings) {
  const digital = document.getElementById('clockDigital');
  const analog = document.getElementById('clockAnalog');
  const widget = document.getElementById('widget-clock');
  if (!digital || !widget) return;

  const clockStyle = settings.clockStyle || {};
  let use12h = clockStyle.format === '12h';
  let showSeconds = clockStyle.showSeconds !== false;
  let fontFamily = CLOCK_FONTS.includes(clockStyle.fontFamily) ? clockStyle.fontFamily : 'system';

  widget.dataset.clockFont = fontFamily;

  function tick() {
    const now = new Date();
    let hh = now.getHours();
    const mm = now.getMinutes().toString().padStart(2, '0');
    const ss = now.getSeconds().toString().padStart(2, '0');
    let suffix = '';

    if (use12h) {
      suffix = hh >= 12 ? ' PM' : ' AM';
      hh = hh % 12 || 12;
    }

    const hhStr = hh.toString().padStart(2, '0');
    const next = showSeconds
      ? `${hhStr}:${mm}:${ss}${suffix}`
      : `${hhStr}:${mm}${suffix}`;

    // Only re-fit when the character count changes (digits tick within a
    // fixed width thanks to tabular-nums), to avoid per-second reflow.
    const lenChanged = digital.textContent.length !== next.length;
    digital.textContent = next;
    if (lenChanged) refit();

    if (analog) {
      if (settings.showAnalog) {
        analog.style.display = 'block';
        analog.innerHTML = analogClockSVG(now);
      } else {
        analog.style.display = 'none';
      }
    }
  }

  // Scale the digital text to fill the widget's available space.
  function refit() {
    const body = digital.parentElement;
    if (!body || !body.clientWidth) return;
    const cs = window.getComputedStyle(body);
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);

    const availW = Math.max(10, body.clientWidth - padX - 4);
    const totalH = Math.max(10, body.clientHeight - padY);
    // Reserve room for the analog face when it's visible.
    const analogVisible = settings.showAnalog && analog && analog.style.display !== 'none';
    const availH = analogVisible ? totalH * 0.42 : totalH;

    // Measure the text's natural size at a known base font size.
    const prevWidth = digital.style.width;
    digital.style.width = 'max-content';
    digital.style.fontSize = '100px';
    const textW = digital.offsetWidth || 1;
    const textH = digital.offsetHeight || 1;
    digital.style.width = prevWidth;

    const scale = Math.min(availW / textW, availH / textH);
    const size = Math.max(12, Math.min(100 * scale, 400));
    digital.style.fontSize = `${size}px`;
  }

  // Live-apply changes from Settings without a page reload.
  widget.addEventListener('clock-restyle', (e) => {
    const ns = (e && e.detail) || {};
    use12h = ns.format === '12h';
    showSeconds = ns.showSeconds !== false;
    fontFamily = CLOCK_FONTS.includes(ns.fontFamily) ? ns.fontFamily : 'system';
    settings.showAnalog = ns.showAnalog !== undefined ? ns.showAnalog : settings.showAnalog;
    widget.dataset.clockFont = fontFamily;
    tick();
    refit();
  });

  // Re-fit whenever the widget is resized (drag-resize, window resize, etc.).
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => refit());
    ro.observe(widget);
  }

  tick();
  // Fit once layout has settled (widget gets its final px size after boot).
  requestAnimationFrame(refit);
  setTimeout(refit, 60);

  return setInterval(tick, 1000);
}

function analogClockSVG(date) {
  const s = date.getSeconds(), m = date.getMinutes(), hr = date.getHours() % 12;
  const secAng = (s / 60) * 360 - 90;
  const minAng = (m / 60) * 360 - 90;
  const hrAng = ((hr + m / 60) / 12) * 360 - 90;

  function lineFromAngle(cx, cy, len, ang) {
    const rad = ang * Math.PI / 180;
    const x = cx + Math.cos(rad) * len;
    const y = cy + Math.sin(rad) * len;
    return `${cx},${cy} ${x},${y}`;
  }

  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#61dafb';
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">
    <circle cx="50" cy="50" r="44" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.08)" stroke-width="1.5"/>
    <polyline points="${lineFromAngle(50, 50, 26, hrAng)}" stroke="rgba(255,255,255,0.9)" stroke-width="4" stroke-linecap="round"/>
    <polyline points="${lineFromAngle(50, 50, 36, minAng)}" stroke="rgba(255,255,255,0.95)" stroke-width="3" stroke-linecap="round"/>
    <polyline points="${lineFromAngle(50, 50, 40, secAng)}" stroke="${accent}" stroke-width="2" stroke-linecap="round"/>
    <circle cx="50" cy="50" r="3" fill="rgba(255,255,255,0.9)"/>
  </svg>`;
}
