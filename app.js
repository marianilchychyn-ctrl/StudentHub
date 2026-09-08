(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
  const fullDays = ['Неділя', 'Понеділок', 'Вівторок', 'Середа', 'Четвер', 'П’ятниця', 'Субота'];
  const seed = { lessons: [], tasks: [], files: [] };
  const clone = value => JSON.parse(JSON.stringify(value));

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem('student-hub-v5'));
      if (!saved || !Array.isArray(saved.lessons) || !Array.isArray(saved.tasks) || !Array.isArray(saved.files)) return clone(seed);
      return saved;
    } catch { return clone(seed); }
  }

  let data = load();
  let selectedDay = new Date().getDay() || 7;
  let selectedWeek = localStorage.getItem('student-hub-week') || 'numerator';
  let selectedSemester = localStorage.getItem('student-hub-semester') || (new Date().toISOString().slice(0, 10) >= '2027-01-01' ? 'spring' : 'autumn');
  let taskFilter = 'all';
  let editing = { type: null, id: null };
  const temporaryFiles = new Map();
  const uid = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const today = () => new Date().getDay() || 7;
  const save = () => localStorage.setItem('student-hub-v5', JSON.stringify(data));
  const safe = text => String(text || '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const date = value => new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'short' }).format(new Date(`${value}T12:00:00`));
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const isOverdue = item => !item.done && item.due && item.due < todayISO();
  function showEmpty(node) { node.append($('#empty-state').content.cloneNode(true)); }

  // --- Тривалість пари (за замовчуванням 1 год 30 хв) — використовується таймером, прогрес-баром і .ics-експортом ---
  const DEFAULT_LESSON_DURATION = 90;
  let lessonDuration = Number(localStorage.getItem('student-hub-duration')) || DEFAULT_LESSON_DURATION;

  // Розбирає рядок часу пари: повертає {start:{h,m}, end:{h,m}}. Якщо вказано лише початок — кінець
  // обчислюється додаванням поточної налаштованої тривалості пари.
  function parseLessonRange(text) {
    const matches = [...String(text || '').matchAll(/(\d{1,2}):(\d{2})/g)];
    if (!matches.length) return null;
    const start = { h: Number(matches[0][1]), m: Number(matches[0][2]) };
    let end;
    if (matches[1]) {
      end = { h: Number(matches[1][1]), m: Number(matches[1][2]) };
    } else {
      const totalEnd = start.h * 60 + start.m + lessonDuration;
      end = { h: Math.floor(totalEnd / 60) % 24, m: totalEnd % 60 };
    }
    return { start, end };
  }
  // Якщо в полі часу вказано лише початок — дописує кінець на основі налаштованої тривалості,
  // зберігаючи введений формат без змін, якщо діапазон уже вказано.
  function normalizeLessonTime(text) {
    const matches = [...String(text || '').matchAll(/(\d{1,2}):(\d{2})/g)];
    if (matches.length < 2) {
      const range = parseLessonRange(text);
      if (!range) return text;
      const pad = n => String(n).padStart(2, '0');
      return `${pad(range.start.h)}:${pad(range.start.m)} – ${pad(range.end.h)}:${pad(range.end.m)}`;
    }
    return text;
  }
  function dateAt(dayOffset, h, m) {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(h, m, 0, 0);
    return d;
  }
  // Формат зворотного відліку: якщо до пари лишається більше доби, показуємо
  // «Nд ГГ:ХХ» замість тризначної кількості годин (раніше, наприклад, показувало
  // потворне «158:32:44» для пари через 6+ днів).
  function formatCountdown(ms) {
    const totalSeconds = Math.max(0, Math.round(ms / 1000));
    const d = Math.floor(totalSeconds / 86400);
    const h = Math.floor((totalSeconds % 86400) / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const pad = n => String(n).padStart(2, '0');
    if (d > 0) return `${d}д ${pad(h)}:${pad(m)}`;
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }
  // Знаходить пару, яка триває зараз, або найближчу наступну (сьогодні чи в один із наступних 7 днів).
  function computeTimerState() {
    const now = new Date();
    const todayDow = today();
    const candidates = [];
    data.lessons.forEach(item => {
      if (item.week && item.week !== 'both' && item.week !== selectedWeek) return;
      const range = parseLessonRange(item.time);
      if (!range) return;
      const offset = (Number(item.day) - todayDow + 7) % 7;
      const start = dateAt(offset, range.start.h, range.start.m);
      let end = dateAt(offset, range.end.h, range.end.m);
      if (end <= start) end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
      if (end < now) { start.setDate(start.getDate() + 7); end.setDate(end.getDate() + 7); }
      candidates.push({ item, start, end });
    });
    candidates.sort((a, b) => a.start - b.start);
    const active = candidates.find(c => c.start <= now && now <= c.end);
    if (active) return { status: 'active', ...active };
    if (candidates[0]) return { status: 'upcoming', ...candidates[0] };
    return { status: 'none' };
  }
  function renderPairTimer() {
    const el = $('#pair-timer');
    if (!el) return;
    const state = computeTimerState();
    el.classList.toggle('active', state.status === 'active');
    if (state.status === 'none') {
      el.innerHTML = `<div class="timer-empty"><span aria-hidden="true">◌</span><b>Немає запланованих пар</b><p>Додай пари до розкладу, щоб побачити таймер до початку та завершення заняття.</p></div>`;
      return;
    }
    const { item, start, end, status } = state;
    const now = new Date();
    if (status === 'active') {
      const percent = Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));
      el.innerHTML = `<div class="timer-head"><span class="pulse" aria-hidden="true"></span><b>Зараз триває</b><span class="type ${kindClass(item.kind)}">${safe(item.kind)}</span></div><h3>${safe(item.title)}</h3><p class="timer-place">${safe(item.place)} · ${safe(item.time)}</p><div class="timer-bar" role="progressbar" aria-valuenow="${Math.round(percent)}" aria-valuemin="0" aria-valuemax="100" aria-label="Прогрес пари"><div class="timer-bar-fill" style="width:${percent.toFixed(1)}%"></div></div><div class="timer-row"><span>До кінця пари</span><b class="timer-count">${formatCountdown(end - now)}</b></div>`;
    } else {
      el.innerHTML = `<div class="timer-head"><b>Наступна пара</b><span class="type ${kindClass(item.kind)}">${safe(item.kind)}</span></div><h3>${safe(item.title)}</h3><p class="timer-place">${safe(item.place)} · ${safe(item.time)}</p><div class="timer-row"><span>До початку</span><b class="timer-count">${formatCountdown(start - now)}</b></div>`;
    }
  }
  function applyDurationUI() {
    $$('.duration-choice').forEach(button => {
      const on = Number(button.dataset.duration) === lessonDuration;
      button.classList.toggle('active', on);
      button.setAttribute('aria-pressed', String(on));
    });
    const input = $('#duration-custom-input');
    if (input && document.activeElement !== input) input.value = lessonDuration;
  }
  function setLessonDuration(value) {
    lessonDuration = Math.min(240, Math.max(10, Math.round(Number(value) || DEFAULT_LESSON_DURATION)));
    localStorage.setItem('student-hub-duration', String(lessonDuration));
    applyDurationUI();
    renderPairTimer();
  }

  // IndexedDB запускається тільки в момент роботи з PDF — це не ламає сайт при відкритті index.html.
  let dbPromise;
  function filesDb() {
    if (!('indexedDB' in window)) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    try {
      dbPromise = new Promise((resolve) => {
        const request = indexedDB.open('StudentHubFiles', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('pdf');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      });
      return dbPromise;
    } catch { return Promise.resolve(null); }
  }
  async function persistPdf(id, file) {
    temporaryFiles.set(id, file);
    const db = await filesDb();
    if (!db) return;
    await new Promise(resolve => { const tx = db.transaction('pdf', 'readwrite'); tx.objectStore('pdf').put(file, id); tx.oncomplete = resolve; tx.onerror = resolve; });
  }
  async function getPdf(id) {
    if (temporaryFiles.has(id)) return temporaryFiles.get(id);
    const db = await filesDb();
    if (!db) return null;
    return new Promise(resolve => { const request = db.transaction('pdf').objectStore('pdf').get(id); request.onsuccess = () => resolve(request.result || null); request.onerror = () => resolve(null); });
  }
  async function deletePdf(id) {
    temporaryFiles.delete(id);
    const db = await filesDb();
    if (!db) return;
    await new Promise(resolve => { const tx = db.transaction('pdf', 'readwrite'); tx.objectStore('pdf').delete(id); tx.oncomplete = resolve; tx.onerror = resolve; });
  }

  function renderHome() {
    const current = data.lessons.filter(item => item.day === today() && (!item.week || item.week === 'both' || item.week === selectedWeek)).sort((a, b) => a.time.localeCompare(b.time));
    $('#lessons-today').textContent = current.length;
    $('#tasks-open').textContent = data.tasks.filter(item => !item.done).length;
    $('#file-count').textContent = data.files.length;
    $('#task-counter').textContent = data.tasks.filter(item => !item.done).length;
    const todayList = $('#today-list'); todayList.innerHTML = current.map(lessonRow).join(''); if (!current.length) showEmpty(todayList);
    const deadlines = data.tasks.filter(item => !item.done).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 4);
    const deadlineList = $('#deadline-list');
    deadlineList.innerHTML = deadlines.map(item => `<div class="deadline ${isOverdue(item) ? 'overdue' : ''}"><b>${safe(item.title)}</b><p>${safe(item.subject)}</p><small>${isOverdue(item) ? 'ПРОСТРОЧЕНО' : `ДО ${date(item.due)}`}</small></div>`).join('');
    if (!deadlines.length) showEmpty(deadlineList);
    renderPairTimer();
  }

  function lessonRow(item) {
    return `<div class="lesson-row" data-edit-lesson="${item.id}" title="Клацни, щоб редагувати"><span class="time">${safe(item.time)}</span><div class="info"><b>${safe(item.title)}</b><small>${safe(item.place)}</small></div><span class="type ${kindClass(item.kind)}">${safe(item.kind)}</span></div>`;
  }
  function kindClass(kind) { return kind === 'Практика' ? 'practice' : kind === 'Лабораторна' ? 'lab' : ''; }

  function renderSchedule() {
    $$('.week-choice:not(.duration-choice):not(.semester-choice):not(.share-format-choice)').forEach(button => {
      const on = button.dataset.week === selectedWeek;
      button.classList.toggle('active', on);
      button.setAttribute('aria-pressed', String(on));
    });
    applyDurationUI();
    $('#day-tabs').innerHTML = days.map((day, index) => {
      const dayNumber = index + 1;
      const isActive = selectedDay === dayNumber;
      const fullName = fullDays[dayNumber === 7 ? 0 : dayNumber];
      return `<button class="day-tab ${isActive ? 'active' : ''} ${index > 4 ? 'weekend' : ''}" data-day="${dayNumber}" aria-pressed="${isActive}" aria-label="${fullName}">${day}</button>`;
    }).join('');
    const board = $('#schedule-board');
    if (selectedDay > 5) {
      const name = selectedDay === 6 ? 'Субота' : 'Неділя';
      board.innerHTML = `<article class="weekend-panel"><div><p class="beer" aria-hidden="true">🍺</p><h3>${name} — без пар</h3><p>За розкладом: пиво, відпочинок і перезавантаження.</p></div></article>`;
      return;
    }
    const lessons = data.lessons.filter(item => item.day === selectedDay && (!item.week || item.week === 'both' || item.week === selectedWeek)).sort((a, b) => a.time.localeCompare(b.time));
    board.innerHTML = lessons.map(item => `<article class="schedule-card" data-edit-lesson="${item.id}" title="Клацни, щоб редагувати"><span class="time">${safe(item.time)}</span><div><b>${safe(item.title)}</b><p>${safe(item.place)}</p></div><span class="type ${kindClass(item.kind)}">${safe(item.kind)}</span><button class="delete" data-remove-lesson="${item.id}" title="Видалити" aria-label="Видалити пару «${safe(item.title)}»">×</button></article>`).join('');
    if (!lessons.length) showEmpty(board);
  }

  function renderTasks() {
    let tasks = data.tasks;
    if (taskFilter === 'open') tasks = tasks.filter(item => !item.done);
    if (taskFilter === 'done') tasks = tasks.filter(item => item.done);
    if (taskFilter === 'overdue') tasks = tasks.filter(isOverdue);
    const query = ($('#search-tasks').value || '').trim().toLowerCase();
    if (query) tasks = tasks.filter(item => `${item.title} ${item.subject}`.toLowerCase().includes(query));
    const list = $('#task-list');
    list.innerHTML = tasks.sort((a, b) => a.due.localeCompare(b.due)).map(item => `<article class="task-card ${item.done ? 'done' : ''} ${isOverdue(item) ? 'overdue' : ''}" data-edit-task="${item.id}" title="Клацни, щоб редагувати"><label><input class="check" type="checkbox" data-done="${item.id}" aria-label="Позначити «${safe(item.title)}» виконаним" ${item.done ? 'checked' : ''}><strong>${safe(item.title)}</strong></label><p>${safe(item.note)}</p><div class="task-meta"><span class="tag">${safe(item.subject)}</span><span>${item.done ? 'ГОТОВО' : isOverdue(item) ? 'ПРОСТРОЧЕНО' : `ДО ${date(item.due)}`}</span><button class="delete" data-remove-task="${item.id}" title="Видалити" aria-label="Видалити завдання «${safe(item.title)}»">×</button></div></article>`).join('');
    if (!tasks.length) showEmpty(list);
  }

  function renderFiles(query = $('#search-files').value) {
    const search = query.trim().toLowerCase();
    const files = data.files.filter(item => `${item.title} ${item.subject}`.toLowerCase().includes(search));
    const list = $('#file-list');
    list.innerHTML = files.map(item => `<article class="file-card" data-edit-file="${item.id}" title="Клацни, щоб редагувати"><div class="file-icon" aria-hidden="true">${safe(item.type || 'PDF').slice(0, 1)}</div><strong>${safe(item.title)}</strong><p>${safe(item.description || 'Навчальний матеріал')}</p><span class="tag">${safe(item.subject)}</span>${item.pdfId ? `<br><button class="open-file" data-open-pdf="${item.pdfId}" aria-label="Відкрити PDF «${safe(item.title)}»">Відкрити PDF ↗</button>` : ''}<button class="delete" data-remove-file="${item.id}" title="Видалити" aria-label="Видалити матеріал «${safe(item.title)}»">×</button></article>`).join('');
    if (!files.length) showEmpty(list);
  }

  function renderAll() { renderHome(); renderSchedule(); renderTasks(); renderFiles(); renderAcademic(); }

  const forms = {
    lesson: {
      title: 'Додати пару', kicker: 'РОЗКЛАД',
      html: (item) => `<div class="form-grid"><div class="field full"><label for="f-lesson-title">Назва предмета</label><input id="f-lesson-title" name="title" required placeholder="Наприклад, Вебтехнології" value="${safe(item?.title)}"></div><div class="field"><label for="f-lesson-day">День</label><select id="f-lesson-day" name="day">${days.map((d, i) => `<option value="${i + 1}" ${item && item.day === i + 1 ? 'selected' : ''}>${d}</option>`).join('')}</select></div><div class="field"><label for="f-lesson-week">Тиждень</label><select id="f-lesson-week" name="week"><option value="numerator" ${item?.week === 'numerator' ? 'selected' : ''}>Чисельник</option><option value="denominator" ${item?.week === 'denominator' ? 'selected' : ''}>Знаменник</option><option value="both" ${item?.week === 'both' ? 'selected' : ''}>Щотижня</option></select></div><div class="field"><label for="f-lesson-kind">Тип</label><select id="f-lesson-kind" name="kind"><option ${item?.kind === 'Лекція' ? 'selected' : ''}>Лекція</option><option ${item?.kind === 'Практика' ? 'selected' : ''}>Практика</option><option ${item?.kind === 'Лабораторна' ? 'selected' : ''}>Лабораторна</option></select></div><div class="field"><label for="f-lesson-time">Час</label><input id="f-lesson-time" name="time" required placeholder="09:00 – 10:20 або лише 09:00" value="${safe(item?.time)}"></div><div class="field full"><label for="f-lesson-place">Аудиторія / посилання</label><input id="f-lesson-place" name="place" required placeholder="ауд. 304" value="${safe(item?.place)}"></div></div>`
    },
    task: {
      title: 'Нове завдання', kicker: 'ДЕДЛАЙН',
      html: (item) => `<div class="form-grid"><div class="field full"><label for="f-task-title">Назва завдання</label><input id="f-task-title" name="title" required placeholder="Що потрібно зробити?" value="${safe(item?.title)}"></div><div class="field"><label for="f-task-subject">Предмет</label><input id="f-task-subject" name="subject" required placeholder="Назва предмета" value="${safe(item?.subject)}"></div><div class="field"><label for="f-task-due">Дедлайн</label><input id="f-task-due" name="due" required type="date" value="${safe(item?.due)}"></div><div class="field full"><label for="f-task-note">Опис</label><textarea id="f-task-note" name="note" placeholder="Деталі завдання">${safe(item?.note)}</textarea></div></div>`
    },
    file: {
      title: 'Додати матеріал', kicker: 'KNOWLEDGE BASE',
      html: (item) => `<div class="form-grid"><div class="field full"><label for="f-file-title">Назва матеріалу</label><input id="f-file-title" name="title" required placeholder="Наприклад, Конспект лекції №3" value="${safe(item?.title)}"></div><div class="field"><label for="f-file-subject">Предмет</label><input id="f-file-subject" name="subject" required placeholder="Назва предмета" value="${safe(item?.subject)}"></div><div class="field"><label for="f-file-type">Тип</label><select id="f-file-type" name="type"><option ${item?.type === 'PDF' ? 'selected' : ''}>PDF</option><option ${item?.type === 'NOTE' ? 'selected' : ''}>NOTE</option><option ${item?.type === 'LINK' ? 'selected' : ''}>LINK</option><option ${item?.type === 'VIDEO' ? 'selected' : ''}>VIDEO</option></select></div><div class="field full"><label for="f-file-pdf">Завантажити PDF (за бажанням)</label><input id="f-file-pdf" class="file-input" name="pdf" type="file" accept="application/pdf,.pdf">${item?.pdfId ? '<small class="hint">Уже прикріплено PDF. Обери новий файл, щоб замінити.</small>' : ''}</div><div class="field full"><label for="f-file-description">Опис</label><textarea id="f-file-description" name="description" placeholder="Коротко опиши матеріал">${safe(item?.description)}</textarea></div></div>`
    }
  };

  const editTitles = { lesson: 'Редагувати пару', task: 'Редагувати завдання', file: 'Редагувати матеріал' };

  function findItem(type, id) {
    if (type === 'lesson') return data.lessons.find(item => String(item.id) === String(id));
    if (type === 'task') return data.tasks.find(item => String(item.id) === String(id));
    if (type === 'file') return data.files.find(item => String(item.id) === String(id));
    return null;
  }

  let lastFocusedElement = null;
  function openModal(type, id = null) {
    const form = forms[type]; if (!form) return;
    editing = { type, id };
    const item = id ? findItem(type, id) : null;
    lastFocusedElement = document.activeElement;
    $('#modal-kicker').textContent = form.kicker;
    $('#modal-title').textContent = item ? editTitles[type] : form.title;
    $('#entry-form').dataset.type = type;
    $('#entry-form').innerHTML = form.html(item) + `<button class="primary-button save" type="submit">${item ? 'Зберегти зміни →' : 'Зберегти →'}</button>`;
    $('#modal-wrap').classList.add('open'); $('#modal-wrap').setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => { $('#entry-form').querySelector('input, select, textarea')?.focus(); });
  }
  function closeModal() {
    $('#modal-wrap').classList.remove('open'); $('#modal-wrap').setAttribute('aria-hidden', 'true'); editing = { type: null, id: null };
    lastFocusedElement?.focus();
    lastFocusedElement = null;
  }
  // Утримує фокус усередині відкритої модалки (доступність для клавіатури)
  $('#modal-wrap').addEventListener('keydown', event => {
    if (event.key !== 'Tab' || !$('#modal-wrap').classList.contains('open')) return;
    const focusables = $$('#modal-wrap button, #modal-wrap input, #modal-wrap select, #modal-wrap textarea').filter(el => !el.disabled && el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  // Кнопка «+ Додати» в шапці: на сторінках, де є природна дія додавання,
  // веде саме до відповідної форми (пара / завдання / матеріал) замість
  // того, щоб завжди відкривати форму пари. На сторінках без такої дії
  // (Графік навчання, Автори, Підтримка) кнопку ховаємо — там додавати нічого.
  const topbarAddConfig = {
    home: { modal: 'lesson', label: 'Додати пару' },
    schedule: { modal: 'lesson', label: 'Додати пару' },
    tasks: { modal: 'task', label: 'Нове завдання' },
    files: { modal: 'file', label: 'Додати матеріал' },
  };
  function updateTopbarAddButton(page) {
    const btn = $('#topbar-add-btn');
    if (!btn) return;
    const config = topbarAddConfig[page];
    if (!config) { btn.hidden = true; return; }
    btn.hidden = false;
    btn.dataset.modal = config.modal;
    btn.innerHTML = `<span aria-hidden="true">＋</span> ${config.label}`;
  }

  function showPage(page) {
    renderAll();
    $$('.page').forEach(item => item.classList.toggle('active', item.id === page));
    $$('.nav-btn').forEach(item => {
      const isActive = item.dataset.page === page;
      item.classList.toggle('active', isActive);
      if (isActive) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
    });
    $('#heading').textContent = ({ home: 'Твій навчальний простір', schedule: 'Твій навчальний тиждень', tasks: 'Не пропусти дедлайни', files: 'Твоя база знань', academic: 'Знай терміни наперед', authors: 'Команда проєкту', support: 'Ми тут, щоб допомогти' })[page];
    updateTopbarAddButton(page);
    setSidebarOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  $$('.nav-btn').forEach(button => button.addEventListener('click', () => showPage(button.dataset.page)));
  // data-page-link елементи (в т.ч. лого) завжди повертають на потрібну сторінку; лого — посилання, тож гасимо перехід за href.
  $$('[data-page-link]').forEach(button => button.addEventListener('click', event => { event.preventDefault(); showPage(button.dataset.pageLink); }));
  // Прив'язка через button.dataset.modal читається в момент кліку, тож динамічна
  // зміна data-modal у updateTopbarAddButton() коректно підхоплюється й тут.
  $$('[data-modal]').forEach(button => button.addEventListener('click', () => openModal(button.dataset.modal)));
  // Мобільне меню: підсвічений фон, aria-expanded, закриття по Escape або кліку поза меню
  const sidebarEl = $('#sidebar');
  const sidebarBackdrop = $('#sidebar-backdrop');
  const menuToggleBtn = $('#menu-toggle');
  function setSidebarOpen(open) {
    sidebarEl.classList.toggle('open', open);
    if (sidebarBackdrop) sidebarBackdrop.hidden = !open;
    menuToggleBtn.setAttribute('aria-expanded', String(open));
    menuToggleBtn.setAttribute('aria-label', open ? 'Закрити меню' : 'Відкрити меню');
    document.body.classList.toggle('no-scroll', open);
  }
  menuToggleBtn.addEventListener('click', () => setSidebarOpen(!sidebarEl.classList.contains('open')));
  sidebarBackdrop?.addEventListener('click', () => setSidebarOpen(false));
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && sidebarEl.classList.contains('open')) setSidebarOpen(false); });
  $('#go-today').addEventListener('click', () => { selectedDay = today(); showPage('schedule'); });
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal-wrap').addEventListener('click', event => { if (event.target === $('#modal-wrap')) closeModal(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && $('#modal-wrap').classList.contains('open')) closeModal(); });
  $('#day-tabs').addEventListener('click', event => { if (event.target.dataset.day) { selectedDay = Number(event.target.dataset.day); renderSchedule(); } });
  $$('.week-choice:not(.semester-choice):not(.duration-choice):not(.share-format-choice)').forEach(button => button.addEventListener('click', () => { selectedWeek = button.dataset.week; localStorage.setItem('student-hub-week', selectedWeek); renderAll(); }));
  $$('.duration-choice').forEach(button => button.addEventListener('click', () => setLessonDuration(button.dataset.duration)));
  $('#duration-custom-input')?.addEventListener('change', event => setLessonDuration(event.target.value));
  $$('.semester-choice').forEach(button => button.addEventListener('click', () => { selectedSemester = button.dataset.semester; localStorage.setItem('student-hub-semester', selectedSemester); renderAcademic(); }));
  $$('.filter').forEach(button => button.addEventListener('click', () => { taskFilter = button.dataset.filter; $$('.filter').forEach(item => { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button)); }); renderTasks(); }));
  $('#search-files').addEventListener('input', event => renderFiles(event.target.value));
  $('#search-tasks').addEventListener('input', renderTasks);
  $('#task-list').addEventListener('change', event => { const id = event.target.dataset.done; if (!id) return; const task = data.tasks.find(item => String(item.id) === id); if (task) { task.done = event.target.checked; save(); renderAll(); } });

  // Клацання по картці відкриває редагування; клацання по кнопці видалення/відкриття PDF — свою дію.
  document.addEventListener('click', async event => {
    const removeLesson = event.target.dataset.removeLesson;
    const removeTask = event.target.dataset.removeTask;
    const removeFile = event.target.dataset.removeFile;
    if (removeLesson || removeTask || removeFile) {
      event.stopPropagation();
      if (!confirm('Видалити цей запис?')) return;
      if (removeLesson) data.lessons = data.lessons.filter(item => String(item.id) !== removeLesson);
      if (removeTask) data.tasks = data.tasks.filter(item => String(item.id) !== removeTask);
      if (removeFile) {
        const file = data.files.find(item => String(item.id) === removeFile);
        if (file?.pdfId) await deletePdf(file.pdfId);
        data.files = data.files.filter(item => String(item.id) !== removeFile);
      }
      save(); renderAll(); return;
    }
    const pdfId = event.target.dataset.openPdf;
    if (pdfId) {
      // Вкладку відкриваємо СИНХРОННО, ще до await — інакше Safari на iOS встигає
      // «забути», що це відповідь на дотик користувача, і мовчки блокує спливаюче вікно.
      // Далі просто підставляємо туди готовий файл, коли він прочитається з IndexedDB.
      const win = window.open('', '_blank');
      const pdf = await getPdf(pdfId);
      if (!pdf) { win?.close(); return alert('Файл не знайдено. Додай цей PDF ще раз.'); }
      const url = URL.createObjectURL(pdf);
      if (win) win.location.href = url;
      else alert('Не вдалося відкрити файл — дозволь спливаючі вікна для цього сайту й спробуй ще раз.');
      return;
    }
    if (event.target.closest('label')) return; // клік по назві завдання перемикає чекбокс, а не редагування
    const lessonCard = event.target.closest('[data-edit-lesson]');
    const taskCard = event.target.closest('[data-edit-task]');
    const fileCard = event.target.closest('[data-edit-file]');
    if (lessonCard) openModal('lesson', lessonCard.dataset.editLesson);
    else if (taskCard) openModal('task', taskCard.dataset.editTask);
    else if (fileCard) openModal('file', fileCard.dataset.editFile);
  });

  $('#entry-form').addEventListener('submit', async event => {
    event.preventDefault();
    const type = event.currentTarget.dataset.type;
    const input = Object.fromEntries(new FormData(event.currentTarget));
    const existing = editing.id ? findItem(type, editing.id) : null;

    if (type === 'lesson') {
      const record = { id: existing?.id ?? Date.now(), day: Number(input.day), week: input.week, time: normalizeLessonTime(input.time), title: input.title, kind: input.kind, place: input.place };
      if (existing) Object.assign(existing, record); else data.lessons.push(record);
    }
    if (type === 'task') {
      const record = { id: existing?.id ?? Date.now(), title: input.title, subject: input.subject, due: input.due, note: input.note || 'Без додаткового опису.', done: existing?.done ?? false };
      if (existing) Object.assign(existing, record); else data.tasks.push(record);
    }
    if (type === 'file') {
      const record = existing ? { ...existing } : { id: Date.now(), title: '', subject: '', type: 'PDF', description: '' };
      record.title = input.title; record.subject = input.subject; record.type = input.type; record.description = input.description || 'Навчальний матеріал.';
      if (input.pdf && input.pdf.size) {
        if (input.pdf.type && input.pdf.type !== 'application/pdf') return alert('Можна додати лише PDF-файл.');
        if (existing?.pdfId) await deletePdf(existing.pdfId);
        record.type = 'PDF'; record.pdfId = uid(); await persistPdf(record.pdfId, input.pdf);
      }
      if (existing) Object.assign(existing, record); else data.files.push(record);
    }
    save(); closeModal(); renderAll();
  });

  // --- Мобільно-безпечне збереження/поширення файлів -------------------------------------------
  // iOS (у т.ч. встановлений PWA) часто мовчки ігнорує клік по <a download>, тож для нього відкриваємо
  // blob напряму новою вкладкою (Safari сам пропонує «Поділитися» / «Зберегти у Файли»). Скрізь, де є
  // Web Share API з підтримкою файлів (сучасні Android і iOS), пріоритет — рідне меню «Надіслати».
  function isIOSDevice() {
    return /iP(hone|od|ad)/.test(navigator.platform) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);
  }
  function downloadBlob(blob, filename) {
    if (isIOSDevice()) {
      // На iOS (особливо у встановленому як PWA сайті) window.open() з blob:-посиланням
      // часто мовчки провалюється — нова вкладка лишається порожньою. Натомість читаємо
      // файл у data:-URI (він не прив'язаний до пам'яті сторінки-джерела) і відкриваємо
      // його як звичайну навігацію: Safari показує перегляд файлу з кнопкою «Поділитися» /
      // «Зберегти у Файли». `download` Safari все одно ігнорує, тож він тут не потрібен.
      // Вкладку відкриваємо СИНХРОННО (до читання blob), інакше Safari забуде, що це
      // відповідь на дотик користувача, і заблокує спливаюче вікно; сам хаб лишиться
      // відкритим позаду, у застосунку без адресного рядка/кнопки «Назад» це важливо.
      const win = window.open('', '_blank');
      const reader = new FileReader();
      reader.onload = () => {
        if (win) win.location.href = reader.result;
        else alert('Не вдалося відкрити файл — дозволь спливаючі вікна для цього сайту й спробуй ще раз.');
      };
      reader.onerror = () => { win?.close(); alert('Не вдалося підготувати файл для збереження. Спробуй ще раз.'); };
      reader.readAsDataURL(blob);
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = filename; link.rel = 'noopener';
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  async function shareOrDownloadFile(blob, filename, title, text) {
    try {
      const file = new File([blob], filename, { type: blob.type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title, text });
        return;
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return; // користувач сам закрив системне меню — нічого не робимо
    }
    downloadBlob(blob, filename);
  }

  // Резервне копіювання / відновлення всіх даних (тексту; вкладені PDF лишаються у сховищі цього браузера).
  $('#export-data').addEventListener('click', async () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    await shareOrDownloadFile(blob, `student-hub-backup-${todayISO()}.json`, 'Резервна копія Student Hub', 'Повна резервна копія даних Student Hub.');
  });
  $('#import-data').addEventListener('click', () => $('#import-input').click());
  $('#import-input').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed.lessons) || !Array.isArray(parsed.tasks) || !Array.isArray(parsed.files)) throw new Error('bad shape');
      if (!confirm('Імпорт замінить поточні дані на дані з файлу. Продовжити?')) return;
      data = parsed; save(); renderAll();
    } catch { alert('Не вдалося прочитати файл — переконайся, що це резервна копія Student Hub.'); }
    event.target.value = '';
  });

  // --- Синхронізація розкладу з Google Calendar / Apple Calendar (iCal) / Outlook через .ics ---
  const weekdayCode = { 1: 'MO', 2: 'TU', 3: 'WE', 4: 'TH', 5: 'FR', 6: 'SA', 7: 'SU' };
  const dayFromWeekdayCode = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };
  function nextDateForWeekday(weekday, offsetWeeks = 0) {
    const now = new Date();
    const todayDow = now.getDay() || 7;
    let diff = weekday - todayDow;
    if (diff < 0) diff += 7;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff + offsetWeeks * 7);
  }
  function icsStamp(date, h, m) {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(h)}${pad(m)}00`;
  }
  function escapeICS(text) { return String(text || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); }
  function generateICS() {
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Student Hub//UA', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    const now = new Date();
    const stamp = icsStamp(now, now.getUTCHours(), now.getUTCMinutes()) + 'Z';
    data.lessons.forEach(item => {
      const range = parseLessonRange(item.time);
      const weekday = Number(item.day);
      if (!range || !weekdayCode[weekday]) return;
      const isBoth = !item.week || item.week === 'both';
      const offsetWeeks = isBoth ? 0 : (item.week === selectedWeek ? 0 : 1);
      const anchor = nextDateForWeekday(weekday, offsetWeeks);
      const rrule = isBoth ? `RRULE:FREQ=WEEKLY;BYDAY=${weekdayCode[weekday]}` : `RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=${weekdayCode[weekday]}`;
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${item.id}@student-hub`);
      lines.push(`DTSTAMP:${stamp}`);
      lines.push(`DTSTART:${icsStamp(anchor, range.start.h, range.start.m)}`);
      lines.push(`DTEND:${icsStamp(anchor, range.end.h, range.end.m)}`);
      lines.push(rrule);
      lines.push(`SUMMARY:${escapeICS(item.title)}${item.kind ? ' — ' + escapeICS(item.kind) : ''}`);
      if (item.place) lines.push(`LOCATION:${escapeICS(item.place)}`);
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }
  // Мінімальний парсер .ics для імпорту (свій експорт і типові щотижневі розклади з BYDAY).
  function parseICS(text) {
    const unfolded = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
    const blocks = unfolded.split('BEGIN:VEVENT').slice(1);
    const lessons = [];
    blocks.forEach(block => {
      const get = key => { const m = block.match(new RegExp(`${key}[^:\\r\\n]*:([^\\r\\n]+)`)); return m ? m[1].trim() : ''; };
      const unesc = value => value.replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
      const dtstart = get('DTSTART'), dtend = get('DTEND'), rrule = get('RRULE');
      const summary = unesc(get('SUMMARY'));
      const location = unesc(get('LOCATION'));
      const parseStamp = value => { const m = value.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/); return m ? { date: new Date(+m[1], +m[2] - 1, +m[3]), h: +m[4], m: +m[5] } : null; };
      const start = parseStamp(dtstart), end = parseStamp(dtend);
      if (!start || !summary) return;
      let day = start.date.getDay() || 7;
      const byday = rrule.match(/BYDAY=([A-Z,]+)/);
      if (byday) day = dayFromWeekdayCode[byday[1].split(',')[0]] || day;
      const week = /INTERVAL=2/.test(rrule) ? 'numerator' : 'both'; // при потребі відкоригуй тиждень уже в застосунку
      const pad = n => String(n).padStart(2, '0');
      const time = end ? `${pad(start.h)}:${pad(start.m)} – ${pad(end.h)}:${pad(end.m)}` : `${pad(start.h)}:${pad(start.m)}`;
      const parts = summary.split(' — ');
      lessons.push({ id: uid(), day, week, time, title: parts[0], kind: parts.slice(1).join(' — '), place: location });
    });
    return lessons;
  }

  // --- PDF: власного генератора PDF немає (кирилиця вимагає вбудованого шрифту), тож використовуємо
  // системний друк — на Android і iOS діалог друку вміє «Зберегти як PDF», а на iPhone там-таки є «Поділитися».
  function buildPrintableScheduleHTML() {
    const weeks = [{ key: 'numerator', label: 'Чисельник' }, { key: 'denominator', label: 'Знаменник' }];
    let html = `<h1>Розклад занять — Student Hub</h1><p class="print-sub">Сформовано ${new Intl.DateTimeFormat('uk-UA', { dateStyle: 'long' }).format(new Date())}</p>`;
    weeks.forEach(week => {
      const lessons = data.lessons.filter(item => !item.week || item.week === 'both' || item.week === week.key);
      if (!lessons.length) return;
      html += `<h2>Тиждень: ${safe(week.label)}</h2>`;
      for (let day = 1; day <= 5; day++) {
        const rows = lessons.filter(item => item.day === day).sort((a, b) => a.time.localeCompare(b.time));
        if (!rows.length) continue;
        html += `<table><thead><tr><th colspan="4">${safe(fullDays[day])}</th></tr><tr><th>Час</th><th>Предмет</th><th>Тип</th><th>Аудиторія</th></tr></thead><tbody>`;
        html += rows.map(item => `<tr><td>${safe(item.time)}</td><td>${safe(item.title)}</td><td>${safe(item.kind)}</td><td>${safe(item.place)}</td></tr>`).join('');
        html += '</tbody></table>';
      }
    });
    return html;
  }
  function printSchedule() {
    if (!data.lessons.length) { alert('Спочатку додай хоча б одну пару до розкладу.'); return; }
    $('#print-schedule-root').innerHTML = buildPrintableScheduleHTML();
    document.body.classList.add('printing-schedule');
    window.print();
  }
  window.addEventListener('afterprint', () => document.body.classList.remove('printing-schedule'));

  // --- Поділитися розкладом (JSON / ICS / PDF) ---
  let shareFormat = 'ics';
  const shareFormatHints = {
    ics: '.ics відкривається одним кліком у Google Calendar, Apple Calendar та Outlook. Пари з позначкою «Чисельник»/«Знаменник» додаються як події раз на два тижні, «Щотижня» — як щотижневі.',
    json: '.json імпортується назад у Student Hub на будь-якому пристрої — кнопкою «⇧ Імпортувати з файлу» нижче.',
    pdf: 'PDF створюється через системний друк — обери «Зберегти як PDF» у діалозі друку. На iPhone там-таки є кнопка «Поділитися».'
  };
  $$('.share-format-choice').forEach(button => button.addEventListener('click', () => {
    shareFormat = button.dataset.format;
    $$('.share-format-choice').forEach(item => { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button)); });
    $('#share-format-hint').textContent = shareFormatHints[shareFormat];
  }));
  function scheduleJSONBlob() {
    const payload = { type: 'student-hub-schedule', version: 1, generatedAt: todayISO(), duration: lessonDuration, lessons: data.lessons };
    return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  }
  function scheduleICSBlob() { return new Blob([generateICS()], { type: 'text/calendar;charset=utf-8' }); }
  $('#share-schedule')?.addEventListener('click', async () => {
    if (shareFormat === 'pdf') { printSchedule(); return; }
    if (!data.lessons.length) { alert('Спочатку додай хоча б одну пару до розкладу.'); return; }
    const isIcs = shareFormat === 'ics';
    const blob = isIcs ? scheduleICSBlob() : scheduleJSONBlob();
    const filename = isIcs ? 'student-hub-schedule.ics' : `student-hub-schedule-${todayISO()}.json`;
    await shareOrDownloadFile(blob, filename, 'Мій розклад — Student Hub', 'Ось мій розклад занять зі Student Hub.');
  });
  $('#download-schedule')?.addEventListener('click', () => {
    if (shareFormat === 'pdf') { printSchedule(); return; }
    if (!data.lessons.length) { alert('Спочатку додай хоча б одну пару до розкладу.'); return; }
    const isIcs = shareFormat === 'ics';
    downloadBlob(isIcs ? scheduleICSBlob() : scheduleJSONBlob(), isIcs ? 'student-hub-schedule.ics' : `student-hub-schedule-${todayISO()}.json`);
  });

  // --- Швидке імпортування за посиланням: розклад кодується у хеші URL (#s=...), без будь-якого сервера ---
  function encodeScheduleForLink() {
    const payload = { t: 'shs', v: 1, l: data.lessons.map(x => ({ d: x.day, w: x.week, ti: x.time, n: x.title, k: x.kind, p: x.place })) };
    const base64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeScheduleFromCode(code) {
    const base64 = code.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '==='.slice((base64.length + 3) % 4);
    const payload = JSON.parse(decodeURIComponent(escape(atob(padded))));
    if (payload.t !== 'shs' || !Array.isArray(payload.l)) throw new Error('bad shape');
    return payload.l.filter(x => x && x.d && x.ti && x.n).map(x => ({ id: uid(), day: Number(x.d), week: x.w || 'both', time: String(x.ti), title: String(x.n), kind: String(x.k || ''), place: String(x.p || '') }));
  }
  function buildImportLink() { return `${location.origin}${location.pathname}#s=${encodeScheduleForLink()}`; }
  function extractScheduleCode(text) {
    const trimmed = String(text || '').trim();
    const match = trimmed.match(/#s=([A-Za-z0-9_-]+)/);
    if (match) return match[1];
    return /^[A-Za-z0-9_-]{12,}$/.test(trimmed) ? trimmed : null;
  }
  function applyImportedLessons(lessons, sourceLabel) {
    if (!lessons.length) { alert('Не знайшлося жодної пари для імпорту.'); return; }
    const replace = confirm(`Знайдено пар: ${lessons.length} (${sourceLabel}).\n\n«ОК» — ЗАМІНИТИ поточний розклад цими парами.\n«Скасувати» — ДОДАТИ ці пари до наявного розкладу.`);
    data.lessons = replace ? lessons : [...data.lessons, ...lessons];
    save(); renderAll(); showPage('schedule');
  }
  $('#generate-share-link')?.addEventListener('click', () => {
    if (!data.lessons.length) { alert('Спочатку додай хоча б одну пару до розкладу.'); return; }
    $('#share-link-output').value = buildImportLink();
    $('#copy-share-link').disabled = false;
    $('#share-share-link').disabled = false;
  });
  $('#copy-share-link')?.addEventListener('click', async () => {
    const output = $('#share-link-output'); if (!output.value) return;
    const button = $('#copy-share-link');
    try { await navigator.clipboard.writeText(output.value); } catch { output.select(); document.execCommand('copy'); }
    const original = button.textContent; button.textContent = 'Скопійовано ✓';
    setTimeout(() => { button.textContent = original; }, 1800);
  });
  $('#share-share-link')?.addEventListener('click', async () => {
    const output = $('#share-link-output'); if (!output.value) return;
    if (navigator.share) {
      try { await navigator.share({ title: 'Мій розклад — Student Hub', text: 'Відкрий посилання, щоб імпортувати мій розклад у Student Hub.', url: output.value }); return; }
      catch (err) { if (err && err.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(output.value); alert('Посилання скопійовано — встав його в чат із другом.'); }
    catch { output.select(); alert('Скопіюй посилання вручну (виділено нижче).'); }
  });
  $('#import-schedule-btn')?.addEventListener('click', () => $('#import-schedule-input').click());
  $('#import-schedule-input')?.addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
      const text = await file.text();
      let lessons;
      if (/\.ics$/i.test(file.name) || text.trim().startsWith('BEGIN:VCALENDAR')) {
        lessons = parseICS(text);
      } else {
        const parsed = JSON.parse(text);
        const raw = Array.isArray(parsed.lessons) ? parsed.lessons : null;
        if (!raw) throw new Error('bad shape');
        lessons = raw.filter(l => l && l.day && l.time && l.title).map(l => ({ id: uid(), day: Number(l.day), week: l.week || 'both', time: String(l.time), title: String(l.title), kind: String(l.kind || ''), place: String(l.place || '') }));
      }
      applyImportedLessons(lessons, file.name);
    } catch { alert('Не вдалося прочитати файл — переконайся, що це .json (експорт розкладу Student Hub) або .ics файл.'); }
    event.target.value = '';
  });
  $('#import-link-btn')?.addEventListener('click', () => {
    const code = extractScheduleCode($('#import-link-value').value);
    if (!code) { alert('Не вдалося знайти код розкладу в цьому тексті. Встав повне посилання-запрошення або сам код.'); return; }
    try { applyImportedLessons(decodeScheduleFromCode(code), 'посилання'); $('#import-link-value').value = ''; }
    catch { alert('Це посилання не схоже на дійсний код розкладу Student Hub.'); }
  });
  function checkIncomingScheduleLink() {
    const code = extractScheduleCode(window.location.hash);
    if (!code) return;
    history.replaceState(null, '', window.location.pathname + window.location.search);
    try {
      const lessons = decodeScheduleFromCode(code);
      if (lessons.length && confirm(`Отримано посилання з розкладом (пар: ${lessons.length}).\n\nІмпортувати зараз?`)) applyImportedLessons(lessons, 'вхідне посилання');
    } catch { /* пошкоджене або чуже посилання — тихо ігноруємо */ }
  }

  // --- Графік навчального процесу (2026/2027 н.р., ННІ КНІТ) ---
  const academicColumns = ['Курс', 'Групи', 'Теоретичне навчання', '1-й модульний тиждень', 'Теоретичне навчання', '2-й модульний тиждень', 'Семестровий контроль', 'Канікули', 'Практика', 'Дипломне проектування', 'Атестація (ДЕ, ККЗ, ДР/П, МР)'];
  const academicSemesters = {
    autumn: {
      label: 'Осінній семестр', rows: [
        { course: '1', groups: 'КН, ІСТ, ІПЗ, КІ, КБ', values: ['01.09.26–25.10.26', '12.10.26–25.10.26', '26.10.26–20.12.26', '07.12.26–20.12.26', '21.12.26–31.12.26', '–', '–', '–', '–'] },
        { course: '1', groups: 'КНС, ІСТС, ІПЗС, КІС', values: ['01.09.26–25.10.26', '12.10.26–25.10.26', '26.10.26–20.12.26', '07.12.26–20.12.26', '21.12.26–31.12.26', '–', '–', '–', '–'] },
        { course: '2', groups: 'КН, ІСТ, ІПЗ, КІ', values: ['01.09.26–25.10.26', '12.10.26–25.10.26', '26.10.26–20.12.26', '07.12.26–20.12.26', '21.12.26–31.12.26', '01.07.26–31.08.26', '–', '–', '–'] },
        { course: '2', groups: 'КНС, ІСТС, ІПЗС, КІС', values: ['01.09.26–25.10.26', '12.10.26–25.10.26', '26.10.26–20.12.26', '07.12.26–20.12.26', '21.12.26–31.12.26', '01.07.26–31.08.26', '–', '–', '–'] },
        { course: '3', groups: 'КН, ІСТ, ІПЗ, КІ', values: ['01.09.26–25.10.26', '12.10.26–25.10.26', '26.10.26–20.12.26', '07.12.26–20.12.26', '21.12.26–31.12.26', '01.07.26–31.08.26', '–', '–', '–'] },
        { course: '3', groups: 'КНС, ІСТС, ІПЗС', values: ['01.09.26–25.10.26', '12.10.26–25.10.26', '26.10.26–20.12.26', '07.12.26–20.12.26', '21.12.26–31.12.26', '01.07.26–31.08.26', '–', '–', '–'] },
        { course: '4', groups: 'КН, ІСТ, ІПЗ', values: ['01.09.26–25.10.26', '12.10.26–25.10.26', '26.10.26–20.12.26', '07.12.26–20.12.26', '21.12.26–31.12.26', '01.07.26–31.08.26', '–', '–', '–'] },
        { course: '5', groups: 'КН(м)', values: ['01.09.26–25.10.26', '12.10.26–25.10.26', '26.10.26–20.12.26', '07.12.26–20.12.26', '21.12.26–31.12.26', '–', '–', '–', '–'] },
        { course: '6', groups: 'КН (м)', values: ['–', '–', '–', '–', '–', '01.07.26–31.08.26', '01.09.26–18.10.26', '19.10.26–13.12.26', '14.12.26–31.12.26'] },
      ]
    },
    spring: {
      label: 'Весняний семестр', rows: [
        { course: '1', groups: 'КН, ІСТ, ІПЗ, КІ, КБ', values: ['25.01.27–21.03.27', '09.03.27–21.03.27', '22.03.27–16.05.27', '03.05.25–16.05.27', '17.05.27–06.06.27', '01.01.27–24.01.27, 07.06.27–30.06.27', '–', '–', '–'] },
        { course: '1', groups: 'КНС, ІСТС, ІПЗС, КІС', values: ['25.01.27–21.03.27', '09.03.27–21.03.27', '22.03.27–16.05.27', '03.05.25–16.05.27', '17.05.27–06.06.27', '01.01.27–24.01.27, 07.06.27–30.06.27', '–', '–', '–'] },
        { course: '2', groups: 'КН, ІСТ, ІПЗ, КІ', values: ['25.01.27–21.03.27', '09.03.27–21.03.27', '22.03.27–16.05.27', '03.05.25–16.05.27', '17.05.27–06.06.27', '01.01.27–24.01.27, 07.06.27–30.06.27', '–', '–', '–'] },
        { course: '2', groups: 'КНС, ІСТС, ІПЗС, КІС', values: ['25.01.27–21.03.27', '09.03.27–21.03.27', '22.03.27–16.05.27', '03.05.25–16.05.27', '07.06.27–20.06.27', '01.01.27–24.01.27, 21.06.27–30.06.27', '17.05.27–06.06.27 (3 тижні)', '–', '–'] },
        { course: '3', groups: 'КН, ІСТ, ІПЗ, КІ', values: ['25.01.27–21.03.27', '09.03.27–21.03.27', '22.03.27–16.05.27', '03.05.25–16.05.27', '07.06.27–20.06.27', '01.01.27–24.01.27, 21.06.27–30.06.27', '17.05.27–06.06.27 (3 тижні)', '–', '–'] },
        { course: '3', groups: 'КНС, ІСТС, ІПЗС', values: ['25.01.27–07.03.27', '01.03.27–07.03.27', '08.03.27–18.04.27', '12.04.27–18.04.27', '24.05.27–06.06.27', '01.01.27–24.01.27', '19.04.27–16.05.27, 17.05.27–23.05.27, 07.06.27–13.06.27 (4 тижні)', '–', '14.06.27–30.06.27'] },
        { course: '4', groups: 'КН, ІСТ, ІПЗ', values: ['25.01.27–07.03.27', '01.03.27–07.03.27', '08.03.27–18.04.27', '12.04.27–18.04.27', '24.05.27–06.06.27', '01.01.27–24.01.27', '19.04.27–16.05.27, 17.05.27–23.05.27, 07.06.27–13.06.27 (4 тижні)', '–', '14.06.27–30.06.27'] },
        { course: '5', groups: 'КН(м)', values: ['25.01.27–21.03.27', '09.03.27–21.03.27', '22.03.27–16.05.27', '03.05.25–16.05.27', '17.05.27–06.06.27', '01.01.27–24.01.27, 21.06.27–30.06.27', '–', '11.01.27–24.01.27, 07.06.27–20.06.27', '–'] },
      ]
    }
  };
  function renderAcademic() {
    const root = $('#academic-content');
    if (!root) return;
    $$('.semester-choice').forEach(button => {
      const on = button.dataset.semester === selectedSemester;
      button.classList.toggle('active', on);
      button.setAttribute('aria-pressed', String(on));
    });
    const semester = academicSemesters[selectedSemester];
    if (!semester) return;
    // Курс виводиться одним об'єднаним рядком (rowspan), якщо кілька груп курсу мають однаковий графік підряд.
    let bodyRows = '';
    for (let i = 0; i < semester.rows.length; i++) {
      const row = semester.rows[i];
      const isFirstOfCourse = i === 0 || semester.rows[i - 1].course !== row.course;
      let span = 1;
      if (isFirstOfCourse) { while (semester.rows[i + span] && semester.rows[i + span].course === row.course) span++; }
      bodyRows += `<tr>${isFirstOfCourse ? `<td class="course-cell" rowspan="${span}">${safe(row.course)}</td>` : ''}<td class="groups-cell">${safe(row.groups)}</td>${row.values.map(value => `<td>${safe(value)}</td>`).join('')}</tr>`;
    }
    root.innerHTML = `<article class="panel academic-table-wrap"><div class="panel-title"><div><p class="micro">${selectedSemester === 'autumn' ? 'СЕМЕСТР I' : 'СЕМЕСТР II'}</p><h3>${safe(semester.label)}</h3></div></div><div class="academic-scroll"><table class="academic-table"><thead><tr>${academicColumns.map(column => `<th>${safe(column)}</th>`).join('')}</tr></thead><tbody>${bodyRows}</tbody></table></div></article>`;
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }

  $('#date-label').textContent = `${fullDays[new Date().getDay()].toUpperCase()} · STUDY MODE`;
  applyDurationUI();
  renderAll();
  checkIncomingScheduleLink();
  setInterval(renderPairTimer, 1000);
})();
