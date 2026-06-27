// clock.js
export function initClock(settings) {
  const digital = document.getElementById('clockDigital');
  const analog = document.getElementById('clockAnalog');
  const widget = document.getElementById('widget-clock');

  const clockStyle = settings.clockStyle || {};
  const use12h = clockStyle.format === '12h';
  const showSeconds = clockStyle.showSeconds !== false;
  const fontFamily = clockStyle.fontFamily || 'system';

  if (widget) widget.dataset.clockFont = fontFamily;

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
    digital.textContent = showSeconds
      ? `${hhStr}:${mm}:${ss}${suffix}`
      : `${hhStr}:${mm}${suffix}`;

    if (settings.showAnalog) {
      analog.style.display = 'block';
      analog.innerHTML = analogClockSVG(now);
    } else {
      analog.style.display = 'none';
    }
  }

  tick();
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
