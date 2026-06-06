// clock.js
export function initClock(settings) {
  const digital = document.getElementById('clockDigital');
  const analog = document.getElementById('clockAnalog');

  function tick() {
    const now = new Date();
    const hh = now.getHours().toString().padStart(2,'0');
    const mm = now.getMinutes().toString().padStart(2,'0');
    const ss = now.getSeconds().toString().padStart(2,'0');
    digital.textContent = `${hh}:${mm}:${ss}`;
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

function analogClockSVG(date){
  const w = 140, h = 80, cx = 70, cy = 40, r = 32;
  const s = date.getSeconds(), m = date.getMinutes(), hr = date.getHours() % 12;
  const secAng = (s/60) * 360 - 90;
  const minAng = (m/60) * 360 - 90;
  const hrAng = ((hr + m/60)/12) * 360 - 90;
  function lineFromAngle(len, ang){
    const rad = ang * Math.PI/180;
    const x = cx + Math.cos(rad) * len;
    const y = cy + Math.sin(rad) * len;
    return `${cx},${cy} ${x},${y}`;
  }
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.06)" />
    <polyline points="${lineFromAngle(r*0.6, hrAng)}" stroke="rgba(255,255,255,0.9)" stroke-width="3" stroke-linecap="round"/>
    <polyline points="${lineFromAngle(r*0.85, minAng)}" stroke="rgba(255,255,255,0.95)" stroke-width="2" stroke-linecap="round"/>
    <polyline points="${lineFromAngle(r*0.95, secAng)}" stroke="${getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#61dafb'}" stroke-width="1" stroke-linecap="round"/>
  </svg>`;
}
