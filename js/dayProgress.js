export function initDayProgress() {
  const pctEl = document.getElementById('dayProgressPct');
  const barEl = document.getElementById('dayProgressBar');
  const metaEl = document.getElementById('dayProgressMeta');
  if (!pctEl || !barEl || !metaEl) return;

  function formatHHMM(date) {
    const hh = date.getHours().toString().padStart(2, '0');
    const mm = date.getMinutes().toString().padStart(2, '0');
    return `${hh}:${mm}`;
  }

  function render() {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(24, 0, 0, 0);

    const totalMs = end.getTime() - start.getTime();
    const elapsedMs = now.getTime() - start.getTime();
    const pct = Math.max(0, Math.min(100, (elapsedMs / totalMs) * 100));
    const remainingMs = totalMs - elapsedMs;
    const remH = Math.floor(remainingMs / (1000 * 60 * 60));
    const remM = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));

    pctEl.textContent = `${pct.toFixed(1)}%`;
    barEl.style.width = `${pct}%`;
    metaEl.textContent = `Now ${formatHHMM(now)}  |  Left ${remH}h ${remM}m`;
  }

  render();
  return setInterval(render, 30 * 1000);
}
