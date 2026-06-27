export function initCalendar() {
  const titleEl = document.getElementById('calendarTitle');
  const gridEl = document.getElementById('calendarGrid');
  const prevBtn = document.getElementById('calendarPrev');
  const nextBtn = document.getElementById('calendarNext');
  const pickerEl = document.getElementById('calendarPicker');
  const monthSelect = document.getElementById('calendarMonthSelect');
  const yearSelect = document.getElementById('calendarYearSelect');
  const applyPicker = document.getElementById('calendarApplyPicker');
  if (!titleEl || !gridEl || !prevBtn || !nextBtn || !pickerEl || !monthSelect || !yearSelect || !applyPicker) return;

  const monthCursor = new Date();
  monthCursor.setDate(1);
  let slideDir = 'next';

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  for (let m = 0; m < 12; m++) {
    const op = document.createElement('option');
    op.value = String(m);
    op.textContent = monthNames[m];
    monthSelect.appendChild(op);
  }

  const currentYear = new Date().getFullYear();
  for (let y = currentYear - 20; y <= currentYear + 20; y++) {
    const op = document.createElement('option');
    op.value = String(y);
    op.textContent = String(y);
    yearSelect.appendChild(op);
  }

  function render() {
    const year = monthCursor.getFullYear();
    const month = monthCursor.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startWeekday = firstDay.getDay();
    const daysInMonth = lastDay.getDate();
    const now = new Date();
    const isCurrentMonth = now.getFullYear() === year && now.getMonth() === month;

    titleEl.textContent = monthCursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    monthSelect.value = String(month);
    yearSelect.value = String(year);
    gridEl.innerHTML = '';

    // Weekday header row (fixed height) ...
    const namesRow = document.createElement('div');
    namesRow.className = 'calendar-day-names';
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((d) => {
      const head = document.createElement('div');
      head.className = 'calendar-day-name';
      head.textContent = d;
      namesRow.appendChild(head);
    });
    gridEl.appendChild(namesRow);

    // ... and the day cells in their own grid that stretches to fill the
    // remaining widget height, so cells grow/shrink with the widget size.
    const daysWrap = document.createElement('div');
    daysWrap.className = 'calendar-days';
    // Six rows always, so the grid height is stable across months.
    daysWrap.style.gridTemplateRows = 'repeat(6, minmax(0, 1fr))';

    for (let i = 0; i < startWeekday; i++) {
      const empty = document.createElement('div');
      empty.className = 'calendar-cell empty';
      daysWrap.appendChild(empty);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const cell = document.createElement('div');
      cell.className = 'calendar-cell';
      const num = document.createElement('span');
      num.className = 'calendar-cell-num';
      num.textContent = String(day);
      cell.appendChild(num);
      if (isCurrentMonth && day === now.getDate()) {
        cell.classList.add('today');
      }
      daysWrap.appendChild(cell);
    }
    gridEl.appendChild(daysWrap);

    gridEl.classList.remove('slide-prev', 'slide-next');
    void gridEl.offsetWidth;
    gridEl.classList.add(slideDir === 'prev' ? 'slide-prev' : 'slide-next');
  }

  prevBtn.addEventListener('click', () => {
    slideDir = 'prev';
    monthCursor.setMonth(monthCursor.getMonth() - 1);
    render();
  });

  nextBtn.addEventListener('click', () => {
    slideDir = 'next';
    monthCursor.setMonth(monthCursor.getMonth() + 1);
    render();
  });

  titleEl.addEventListener('click', () => {
    pickerEl.classList.toggle('hidden');
  });

  applyPicker.addEventListener('click', () => {
    const nextMonth = Number(monthSelect.value);
    const nextYear = Number(yearSelect.value);
    if (Number.isNaN(nextMonth) || Number.isNaN(nextYear)) return;
    slideDir = nextYear < monthCursor.getFullYear() || (nextYear === monthCursor.getFullYear() && nextMonth < monthCursor.getMonth())
      ? 'prev'
      : 'next';
    monthCursor.setFullYear(nextYear);
    monthCursor.setMonth(nextMonth);
    pickerEl.classList.add('hidden');
    render();
  });

  render();
}
