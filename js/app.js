/* МИР — Курсы ОГЭ. PWA, данные на Яндекс Диске */
'use strict';

const CLIENT_ID = 'f120aaf32f904b9895a3345aa4f7cdb2t';
const OAUTH_URL = 'https://oauth.yandex.ru/authorize?response_type=token&client_id=' + CLIENT_ID;
const DISK = 'https://cloud-api.yandex.net/v1/disk';
const APP_DIR = 'disk:/Приложения/МИР-Курсы';

const DEFAULT_DATA = {
  settings: { orgName: 'Учебный центр «МИР»', logoPath: APP_DIR + '/materials/logo.png', homeworkFormUrl: '' },
  courses: [
    { id: 'math', title: 'ОГЭ Математика', subject: 'Математика', description: 'Подготовка к ОГЭ по математике', lessons: [], tests: [], tasks: [] },
    { id: 'inf', title: 'ОГЭ Информатика', subject: 'Информатика', description: 'Подготовка к ОГЭ по информатике', lessons: [], tests: [], tasks: [] }
  ],
  students: [], grades: [], attendance: [], payments: [], submissions: []
};

const S = { mode: null, role: null, token: null, data: null, me: null, schoolIndex: null, catalog: null, studentFile: null };

/* ---------- утилиты ---------- */
const $ = s => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today = () => new Date().toISOString().slice(0, 10);
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.add('hidden'), ms); }
function show(id) { document.querySelectorAll('.screen').forEach(x => x.classList.add('hidden')); $(id).classList.remove('hidden'); window.scrollTo(0, 0); }
function courseName(id) { const c = (S.catalog ? S.catalog.courses : S.data.courses).find(c => c.id === id); return c ? c.title : id; }

/* ---------- Яндекс Диск API (учитель) ---------- */
function ya(method, url, body, isForm) {
  return fetch(DISK + url, {
    method,
    headers: Object.assign({ Authorization: 'OAuth ' + S.token }, isForm ? {} : { 'Content-Type': 'application/json' }),
    body: body || undefined
  }).then(async r => {
    if (r.status === 401) { toast('Сессия Яндекса истекла, войдите заново'); throw new Error('401'); }
    const txt = await r.text();
    return txt ? JSON.parse(txt) : {};
  });
}
const enc = encodeURIComponent;
async function ensureDir(path) { try { await ya('PUT', '/resources?path=' + enc(path)); } catch (e) { /* уже существует */ } }
async function uploadHref(path) { const r = await ya('GET', '/resources/upload?overwrite=true&path=' + enc(path)); return r.href; }
async function uploadFile(path, file) { const href = await uploadHref(path); const r = await fetch(href, { method: 'PUT', body: file }); if (!r.ok && r.status !== 201 && r.status !== 202) throw new Error('Ошибка загрузки ' + r.status); }
async function readJson(path) {
  const r = await ya('GET', '/resources/download?path=' + enc(path));
  const resp = await fetch(r.href); if (resp.status === 404) return null;
  return resp.json();
}
async function writeJson(path, obj) { await uploadFile(path, new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })); }
async function publish(path) { await ya('PUT', '/resources/publish?path=' + enc(path)); }
async function publicUrl(path) { const r = await ya('GET', '/resources?path=' + enc(path) + '&fields=public_url'); return r.public_url; }

/* публичное чтение (ученик/родитель, без токена) */
async function pubReadJson(publicKey) {
  const r = await fetch(DISK + '/public/resources/download?public_key=' + enc(publicKey));
  if (!r.ok) throw new Error('Не удалось открыть ссылку-приглашение');
  return r.json();
}

/* ---------- OAuth ---------- */
function parseHashToken() {
  const m = location.hash.match(/access_token=([^&]+)/);
  if (m) { const t = m[1]; history.replaceState(null, '', location.pathname + location.search); return t; }
  return null;
}
function yandexLogin() { location.href = OAUTH_URL; }

/* ---------- данные учителя ---------- */
async function loadTeacherData() {
  await ensureDir(APP_DIR); await ensureDir(APP_DIR + '/materials'); await ensureDir(APP_DIR + '/public');
  let d = await readJson(APP_DIR + '/data.json');
  if (!d) { d = JSON.parse(JSON.stringify(DEFAULT_DATA)); await writeJson(APP_DIR + '/data.json', d); }
  S.data = d;
  if (d.settings.logoPath) { try { S.data.settings.logoPublicUrl = await publicUrl(d.settings.logoPath); } catch (e) {} }
}
async function saveTeacherData() { await writeJson(APP_DIR + '/data.json', S.data); }

/* ---------- публикация для учеников ---------- */
async function publishAll() {
  const d = S.data;
  toast('Публикую данные…');
  const catalog = { settings: { orgName: d.settings.orgName, logoUrl: d.settings.logoPublicUrl || null, homeworkFormUrl: d.settings.homeworkFormUrl || '' }, courses: d.courses };
  await writeJson(APP_DIR + '/catalog.json', catalog); await publish(APP_DIR + '/catalog.json');
  catalog._publicUrl = await publicUrl(APP_DIR + '/catalog.json');
  const index = { school: d.settings.orgName, logo: d.settings.logoPublicUrl || null, catalogUrl: catalog._publicUrl, students: {} };
  for (const s of d.students) {
    const p = APP_DIR + '/public/' + s.code + '.json';
    const sj = {
      student: s,
      grades: d.grades.filter(g => g.studentId === s.id),
      attendance: d.attendance.filter(a => a.studentId === s.id),
      payments: d.payments.filter(p => p.studentId === s.id).map(p => ({ ...p, receiptUrl: p.receiptPublicUrl || null })),
      submissions: d.submissions.filter(x => x.studentId === s.id)
    };
    await writeJson(p, sj); await publish(p);
    index.students[s.code] = await publicUrl(p);
  }
  await writeJson(APP_DIR + '/index.json', index); await publish(APP_DIR + '/index.json');
  const invite = await publicUrl(APP_DIR + '/index.json');
  d._inviteLink = invite;
  await saveTeacherData();
  return invite;
}

/* ---------- вход ученика/родителя ---------- */
async function studentEnter(linkOrCode, code, role) {
  $('#auth-error').textContent = '';
  try {
    const idx = await pubReadJson(linkOrCode.trim());
    const fileUrl = idx.students && idx.students[code.trim()];
    if (!fileUrl) { $('#auth-error').textContent = 'Код не найден. Проверьте код у учителя.'; return; }
    const sf = await pubReadJson(fileUrl);
    const catalog = await pubReadJson(idx.catalogUrl);
    S.schoolIndex = idx; S.catalog = catalog; S.studentFile = sf; S.role = role;
    document.getElementById('hdr-org').textContent = idx.school || 'Учебный центр';
    if (idx.logo) $('#hdr-logo').src = idx.logo;
    enterApp();
  } catch (e) { $('#auth-error').textContent = 'Ошибка: ' + e.message; }
}

/* ---------- вход в приложение ---------- */
function enterApp() {
  localStorage.setItem('mir_session', JSON.stringify({ role: S.role, mode: S.mode, schoolIndex: S.schoolIndex ? { url: S.schoolIndex.catalogUrl ? null : null } : null, code: S.me ? S.me.code : null, hasIndex: !!S.schoolIndex }));
  show('#screen-app');
  if (S.role === 'teacher') { renderTabs(['courses', 'students', 'journal', 'payments', 'publish', 'settings']); openTab('courses'); }
  else { renderTabs(['courses', 'tests', 'tasks', 'grades', 'schedule', 'attendance', 'payments']); openTab('courses'); checkNewGrades(); }
}

/* ---------- табы ---------- */
let TABS = [], TAB_TITLES_T = { courses: 'Курсы', students: 'Ученики', journal: 'Журнал', payments: 'Оплаты', publish: 'Публикация', settings: 'Настройки' };
let TAB_TITLES_S = { courses: 'Уроки', tests: 'Тесты', tasks: 'Задания', grades: 'Оценки', schedule: 'Расписание', attendance: 'Посещаемость', payments: 'Оплаты' };
let curTab = null;
function renderTabs(keys) {
  TABS = keys;
  const titles = S.role === 'teacher' ? TAB_TITLES_T : TAB_TITLES_S;
  const nav = $('#tabs'); nav.innerHTML = '';
  keys.forEach(k => { const b = document.createElement('button'); b.textContent = titles[k]; b.dataset.k = k; b.onclick = () => openTab(k); nav.appendChild(b); });
}
function openTab(k) {
  curTab = k;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.k === k));
  const p = $('#panel'); p.innerHTML = '';
  if (S.role === 'teacher') ({ courses: tabCourses, students: tabStudents, journal: tabJournal, payments: tabPaymentsT, publish: tabPublish, settings: tabSettings }[k])(p);
  else ({ courses: tabSLessons, tests: tabSTests, tasks: tabSTasks, grades: tabSGrades, schedule: tabSSchedule, attendance: tabSAttendance, payments: tabSPayments }[k])(p);
}

/* ============ ТАБЫ УЧИТЕЛЯ ============ */
function tabCourses(p) {
  p.innerHTML = '<div class="card"><h3>Курсы</h3><div id="course-list"></div>' +
    '<label>Новый курс</label><div class="row"><input id="nc-title" placeholder="Например: ОГЭ Физика"><button class="btn primary mini" id="nc-add">Добавить</button></div></div>' +
    '<div id="course-editor"></div>';
  renderCourseList();
  $('#nc-add').onclick = async () => {
    const t = $('#nc-title').value.trim(); if (!t) return;
    S.data.courses.push({ id: uid(), title: t, subject: t, description: '', lessons: [], tests: [], tasks: [] });
    await saveTeacherData(); renderCourseList(); $('#nc-title').value = ''; toast('Курс добавлен');
  };
}
function renderCourseList() {
  const box = $('#course-list');
  box.innerHTML = S.data.courses.map(c =>
    '<div class="row" style="margin:6px 0"><span class="pill teal">' + esc(c.title) + '</span>' +
    '<span class="muted small">уроков: ' + c.lessons.length + ', тестов: ' + c.tests.length + ', заданий: ' + c.tasks.length + '</span>' +
    '<button class="btn mini ghost" data-e="' + c.id + '">Редактировать</button></div>').join('');
  box.querySelectorAll('[data-e]').forEach(b => b.onclick = () => editCourse(b.dataset.e));
}
function editCourse(id) {
  const c = S.data.courses.find(x => x.id === id); if (!c) return;
  const e = $('#course-editor');
  e.innerHTML = '<div class="card"><h3>' + esc(c.title) + '</h3>' +
    '<label>Описание</label><textarea id="c-desc">' + esc(c.description) + '</textarea>' +
    '<h3 style="margin-top:14px">Видеоуроки</h3><div id="lessons"></div>' +
    '<div class="card" style="background:#F4FAFA"><label>Название урока</label><input id="nl-title">' +
    '<label>Описание урока</label><textarea id="nl-desc"></textarea>' +
    '<label>Видеофайл (mp4)</label><input type="file" id="nl-video" accept="video/*">' +
    '<label>Материалы (pdf, изображения — можно несколько)</label><input type="file" id="nl-files" multiple>' +
    '<button class="btn primary mini" id="nl-add">Добавить урок</button><span id="nl-status" class="muted small"></span></div>' +
    '<h3 style="margin-top:14px">Тесты</h3><div id="tests"></div>' +
    '<div class="card" style="background:#F4FAFA"><label>Название теста</label><input id="nt-title">' +
    '<label>Вопросы — по строке: вопрос; вариант 1; вариант 2; вариант 3; номер правильного</label>' +
    '<textarea id="nt-qs" placeholder="Сколько будет 2+2?;3;4;5;2"></textarea>' +
    '<button class="btn primary mini" id="nt-add">Добавить тест</button></div>' +
    '<h3 style="margin-top:14px">Задания</h3><div id="tasks"></div>' +
    '<div class="card" style="background:#F4FAFA"><label>Название задания</label><input id="nk-title">' +
    '<label>Текст задания</label><textarea id="nk-text"></textarea>' +
    '<label>Файл задания (необязательно)</label><input type="file" id="nk-file">' +
    '<button class="btn primary mini" id="nk-add">Добавить задание</button><span id="nk-status" class="muted small"></span></div></div>';
  renderLessons(c); renderTests(c); renderTasks(c);
  $('#c-desc').onchange = async () => { c.description = $('#c-desc').value; await saveTeacherData(); };
  $('#nl-add').onclick = async () => {
    const st = $('#nl-status'); st.textContent = 'Загрузка…';
    try {
      const lesson = { id: uid(), title: $('#nl-title').value.trim() || 'Урок', description: $('#nl-desc').value, video: null, files: [] };
      const vf = $('#nl-video').files[0];
      if (vf) { const p = APP_DIR + '/materials/' + c.id + '_' + Date.now() + '_' + vf.name; await ensureDir(APP_DIR + '/materials'); await uploadFile(p, vf); await publish(p); lesson.video = { name: vf.name, path: p, publicUrl: await publicUrl(p) }; }
      for (const f of $('#nl-files').files) { const p2 = APP_DIR + '/materials/' + c.id + '_' + Date.now() + '_' + f.name; await uploadFile(p2, f); await publish(p2); lesson.files.push({ name: f.name, publicUrl: await publicUrl(p2) }); }
      c.lessons.push(lesson); await saveTeacherData(); renderLessons(c); st.textContent = 'Готово'; toast('Урок добавлен');
    } catch (e) { st.textContent = 'Ошибка: ' + e.message; }
  };
  $('#nt-add').onclick = async () => {
    const qs = $('#nt-qs').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const parts = l.split(';').map(x => x.trim()); const correct = parseInt(parts.pop(), 10); return { q: parts[0], options: parts.slice(1), correct: correct - 1 }; }).filter(x => x.q && x.options.length);
    if (!qs.length) { toast('Не распознано ни одного вопроса'); return; }
    c.tests.push({ id: uid(), title: $('#nt-title').value.trim() || 'Тест', questions: qs }); await saveTeacherData(); renderTests(c); toast('Тест добавлен');
  };
  $('#nk-add').onclick = async () => {
    const st = $('#nk-status'); st.textContent = 'Сохранение…';
    try {
      const task = { id: uid(), title: $('#nk-title').value.trim() || 'Задание', text: $('#nk-text').value, file: null };
      const f = $('#nk-file').files[0];
      if (f) { const p = APP_DIR + '/materials/' + c.id + '_' + Date.now() + '_' + f.name; await uploadFile(p, f); await publish(p); task.file = { name: f.name, publicUrl: await publicUrl(p) }; }
      c.tasks.push(task); await saveTeacherData(); renderTasks(c); st.textContent = 'Готово';
    } catch (e) { st.textContent = 'Ошибка: ' + e.message; }
  };
}
function renderLessons(c) {
  $('#lessons').innerHTML = c.lessons.map(l =>
    '<div class="row" style="margin:6px 0"><span class="pill amber">' + esc(l.title) + '</span><span class="muted small">' + (l.video ? '🎥 ' + esc(l.video.name) : 'без видео') + ', файлов: ' + l.files.length + '</span>' +
    '<button class="btn mini danger" data-dl="' + l.id + '">Удалить</button></div>').join('') || '<p class="muted small">Пока нет уроков</p>';
  $('#lessons').querySelectorAll('[data-dl]').forEach(b => b.onclick = async () => { c.lessons = c.lessons.filter(l => l.id !== b.dataset.dl); await saveTeacherData(); renderLessons(c); });
}
function renderTests(c) {
  $('#tests').innerHTML = c.tests.map(t => '<div class="row" style="margin:6px 0"><span class="pill teal">' + esc(t.title) + '</span><span class="muted small">вопросов: ' + t.questions.length + '</span><button class="btn mini danger" data-dt="' + t.id + '">Удалить</button></div>').join('') || '<p class="muted small">Пока нет тестов</p>';
  $('#tests').querySelectorAll('[data-dt]').forEach(b => b.onclick = async () => { c.tests = c.tests.filter(t => t.id !== b.dataset.dt); await saveTeacherData(); renderTests(c); });
}
function renderTasks(c) {
  $('#tasks').innerHTML = c.tasks.map(t => '<div class="row" style="margin:6px 0"><span class="pill amber">' + esc(t.title) + '</span><button class="btn mini danger" data-dk="' + t.id + '">Удалить</button></div>').join('') || '<p class="muted small">Пока нет заданий</p>';
  $('#tasks').querySelectorAll('[data-dk]').forEach(b => b.onclick = async () => { c.tasks = c.tasks.filter(t => t.id !== b.dataset.dk); await saveTeacherData(); renderTasks(c); });
}

function tabStudents(p) {
  p.innerHTML = '<div class="card"><h3>Ученики</h3><div id="st-list"></div>' +
    '<label>Добавить ученика</label><input id="ns-fio" placeholder="ФИО ученика"><input id="ns-parent" placeholder="Телефон/имя родителя">' +
    '<div class="row"><input id="ns-courses" placeholder="ID курсов через запятую (math, inf)" value="math, inf">' +
    '<button class="btn primary mini" id="ns-add">Добавить</button></div></div>';
  renderStudents();
  $('#ns-add').onclick = async () => {
    const fio = $('#ns-fio').value.trim(); if (!fio) return;
    const code = 'MK-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    S.data.students.push({ id: uid(), fio, code, parentContact: $('#ns-parent').value.trim(), courseIds: $('#ns-courses').value.split(',').map(x => x.trim()).filter(Boolean) });
    await saveTeacherData(); renderStudents(); toast('Ученик добавлен. Код: ' + code);
  };
}
function renderStudents() {
  $('#st-list').innerHTML = S.data.students.map(s =>
    '<div class="row" style="margin:6px 0"><b>' + esc(s.fio) + '</b><span class="pill teal">код: ' + esc(s.code) + '</span>' +
    '<span class="muted small">' + esc(s.parentContact || '') + '</span>' +
    '<button class="btn mini ghost" data-c="' + s.code + '">Копировать код</button>' +
    '<button class="btn mini danger" data-d="' + s.id + '">Удалить</button></div>').join('') || '<p class="muted small">Учеников пока нет</p>';
  $('#st-list').querySelectorAll('[data-c]').forEach(b => b.onclick = () => { navigator.clipboard && navigator.clipboard.writeText(b.dataset.c); toast('Код скопирован'); });
  $('#st-list').querySelectorAll('[data-d]').forEach(b => b.onclick = async () => {
    S.data.students = S.data.students.filter(x => x.id !== b.dataset.d);
    ['grades', 'attendance', 'payments', 'submissions'].forEach(k => S.data[k] = S.data[k].filter(x => x.studentId !== b.dataset.d));
    await saveTeacherData(); renderStudents();
  });
}

function tabJournal(p) {
  const opts = s => S.data.students.map(x => '<option value="' + x.id + '">' + esc(x.fio) + '</option>').join('');
  p.innerHTML = '<div class="card"><h3>Оценка</h3>' +
    '<label>Ученик</label><select id="g-st">' + opts() + '</select>' +
    '<label>Курс</label><select id="g-course">' + S.data.courses.map(c => '<option value="' + c.id + '">' + esc(c.title) + '</option>').join('') + '</select>' +
    '<label>Тема</label><input id="g-topic"><div class="row"><input id="g-date" type="date" value="' + today() + '" style="flex:1">' +
    '<input id="g-score" type="number" min="0" max="100" placeholder="Балл" style="flex:1"></div>' +
    '<input id="g-comment" placeholder="Комментарий">' +
    '<button class="btn primary" id="g-add">Поставить оценку (родителю придёт уведомление)</button></div>' +
    '<div class="card"><h3>Посещаемость</h3>' +
    '<label>Ученик</label><select id="a-st">' + opts() + '</select>' +
    '<div class="row"><select id="a-status" style="flex:1"><option value="present">Был</option><option value="absent">Отсутствовал</option><option value="late">Опоздал</option></select>' +
    '<input id="a-date" type="date" value="' + today() + '" style="flex:1"><button class="btn primary mini" id="a-add">Отметить</button></div></div>' +
    '<div class="card"><h3>Последние записи журнала</h3><div id="journal-list"></div></div>';
  renderJournal();
  $('#g-add').onclick = async () => {
    const stId = $('#g-st').value; if (!stId) return;
    S.data.grades.unshift({ id: uid(), studentId: stId, courseId: $('#g-course').value, date: $('#g-date').value, topic: $('#g-topic').value.trim(), score: Number($('#g-score').value), comment: $('#g-comment').value.trim(), ts: Date.now() });
    await saveTeacherData(); renderJournal(); toast('Оценка сохранена');
  };
  $('#a-add').onclick = async () => {
    const stId = $('#a-st').value; if (!stId) return;
    S.data.attendance.unshift({ id: uid(), studentId: stId, date: $('#a-date').value, status: $('#a-status').value, ts: Date.now() });
    await saveTeacherData(); renderJournal(); toast('Отметка сохранена');
  };
}
function renderJournal() {
  const items = S.data.grades.slice(0, 20).map(g => {
    const s = S.data.students.find(x => x.id === g.studentId);
    return '<tr><td>' + esc(s ? s.fio : '?') + '</td><td>' + esc(courseName(g.courseId)) + '</td><td>' + esc(g.date) + '</td><td><b>' + g.score + '</b></td><td>' + esc(g.topic) + '</td></tr>';
  }).join('');
  $('#journal-list').innerHTML = '<table><tr><th>Ученик</th><th>Курс</th><th>Дата</th><th>Балл</th><th>Тема</th></tr>' + items + '</table>';
}

function tabPaymentsT(p) {
  const opts = S.data.students.map(x => '<option value="' + x.id + '">' + esc(x.fio) + '</option>').join('');
  p.innerHTML = '<div class="card"><h3>Оплата</h3>' +
    '<label>Ученик</label><select id="p-st">' + opts() + '</select>' +
    '<label>Период</label><input id="p-period" placeholder="Ноябрь 2026">' +
    '<div class="row"><input id="p-amount" type="number" placeholder="Сумма, ₽" style="flex:1"><input id="p-date" type="date" value="' + today() + '" style="flex:1"></div>' +
    '<label>Чек (фото/PDF)</label><input type="file" id="p-file">' +
    '<button class="btn primary" id="p-add">Добавить запись об оплате</button><span id="p-status" class="muted small"></span></div>';
  $('#p-add').onclick = async () => {
    const stId = $('#p-st').value; if (!stId) return;
    const rec = { id: uid(), studentId: stId, period: $('#p-period').value.trim(), amount: Number($('#p-amount').value), date: $('#p-date').value, receiptPath: null, receiptPublicUrl: null, ts: Date.now() };
    const f = $('#p-file').files[0]; const st = $('#p-status');
    try {
      if (f) { st.textContent = 'Загрузка чека…'; const p = APP_DIR + '/materials/receipts/' + Date.now() + '_' + f.name; await ensureDir(APP_DIR + '/materials/receipts'); await uploadFile(p, f); await publish(p); rec.receiptPath = p; rec.receiptPublicUrl = await publicUrl(p); }
      S.data.payments.unshift(rec); await saveTeacherData(); st.textContent = 'Готово'; toast('Оплата добавлена');
    } catch (e) { st.textContent = 'Ошибка: ' + e.message; }
  };
}

async function tabPublish(p) {
  p.innerHTML = '<div class="card"><h3>Публикация данных</h3>' +
    '<p class="small muted">Ученики и родители видят только свои данные. Публикация создаёт защищённую ссылку-приглашение — отправьте её ученикам.</p>' +
    '<button class="btn primary" id="pub-btn">Опубликовать / обновить</button>' +
    '<div id="pub-result" style="margin-top:10px"></div></div>';
  if (S.data._inviteLink) $('#pub-result').innerHTML = '<p>Текущая ссылка-приглашение:</p><div class="material-list"><a href="' + esc(S.data._inviteLink) + '" target="_blank">' + esc(S.data._inviteLink) + '</a></div><button class="btn mini ghost" id="pub-copy">Скопировать</button>', $('#pub-copy') && ($('#pub-copy').onclick = () => { navigator.clipboard && navigator.clipboard.writeText(S.data._inviteLink); toast('Ссылка скопирована'); }));
  $('#pub-btn').onclick = async () => {
    try { const invite = await publishAll(); $('#pub-result').innerHTML = '<p>Ссылка-приглашение (отправьте ученикам и родителям):</p><div class="material-list"><a href="' + esc(invite) + '" target="_blank">' + esc(invite) + '</a></div>'; toast('Опубликовано'); } catch (e) { toast('Ошибка: ' + e.message); }
  };
}

async function tabSettings(p) {
  const d = S.data;
  p.innerHTML = '<div class="card"><h3>Настройки</h3>' +
    '<label>Название учебного центра</label><input id="s-org" value="' + esc(d.settings.orgName) + '">' +
    '<label>Логотип (PNG/JPG) — сейчас: встроенный логотип МИР</label><input type="file" id="s-logo" accept="image/*">' +
    '<img id="s-logo-prev" src="' + esc(d.settings.logoPublicUrl || 'logo.png') + '" style="width:72px;margin-top:8px;border-radius:12px;background:#fff">' +
    '<label>Ссылка Яндекс Формы для сдачи работ (необязательно)</label><input id="s-form" value="' + esc(d.settings.homeworkFormUrl || '') + '">' +
    '<button class="btn primary" id="s-save">Сохранить</button></div>';
  $('#s-save').onclick = async () => {
    d.settings.orgName = $('#s-org').value.trim() || d.settings.orgName;
    d.settings.homeworkFormUrl = $('#s-form').value.trim();
    const f = $('#s-logo').files[0];
    if (f) { const p = APP_DIR + '/materials/logo.' + (f.name.split('.').pop() || 'png'); await uploadFile(p, f); await publish(p); d.settings.logoPath = p; d.settings.logoPublicUrl = await publicUrl(p); }
    await saveTeacherData(); $('#s-logo-prev').src = d.settings.logoPublicUrl || 'logo.png';
    $('#hdr-org').textContent = d.settings.orgName; if (d.settings.logoPublicUrl) $('#hdr-logo').src = d.settings.logoPublicUrl;
    toast('Сохранено');
  };
}

/* ============ ТАБЫ УЧЕНИКА И РОДИТЕЛЯ ============ */
function sf() { return S.studentFile; }
function tabSLessons(p) {
  const my = S.catalog.courses.filter(c => sf().student.courseIds.includes(c.id));
  p.innerHTML = my.map(c => '<div class="card"><h3>' + esc(c.title) + '</h3><p class="small muted">' + esc(c.description || '') + '</p>' +
    (c.lessons.map(l =>
      '<div style="border-top:1px solid #EEF3F3;margin-top:10px;padding-top:8px"><b>' + esc(l.title) + '</b>' +
      (l.description ? '<p class="small">' + esc(l.description) + '</p>' : '') +
      (l.video ? '<video controls playsinline oncontextmenu="return false" src="' + esc(l.video.publicUrl) + '"></video><p class="small muted">Видео доступно только для просмотра в приложении</p>' : '') +
      (l.files.length ? '<div class="material-list">' + l.files.map(f => '<a href="' + esc(f.publicUrl) + '" target="_blank">📄 ' + esc(f.name) + '</a>').join('') + '</div>' : '') +
      '</div>').join('') || '<p class="muted small">Уроков пока нет</p>') +
    '</div>').join('') || '<div class="card"><p class="muted">Курсы пока не назначены</p></div>';
}
function tabSTests(p) {
  const my = S.catalog.courses.filter(c => sf().student.courseIds.includes(c.id) && c.tests.length);
  p.innerHTML = my.map(c => '<div class="card"><h3>' + esc(c.title) + '</h3>' +
    c.tests.map(t => '<button class="btn ghost" data-t="' + t.id + '" style="margin:4px 0">' + esc(t.title) + ' (' + t.questions.length + ' вопр.)</button>').join('') +
    '</div>').join('') || '<div class="card"><p class="muted">Тестов пока нет</p></div>';
  p.querySelectorAll('[data-t]').forEach(b => b.onclick = () => takeTest(b.dataset.t, p));
}
function takeTest(id, p) {
  let test = null;
  for (const c of S.catalog.courses) { const t = (c.tests || []).find(x => x.id === id); if (t) { test = t; test._courseId = c.id; break; } }
  if (!test) return;
  const answers = {};
  p.innerHTML = '<div class="card"><h3>' + esc(test.title) + '</h3>' +
    test.questions.map((q, qi) => '<p style="margin-top:10px"><b>' + (qi + 1) + '. ' + esc(q.q) + '</b></p>' +
      q.options.map((o, oi) => '<span class="quiz-opt" data-q="' + qi + '" data-o="' + oi + '">' + esc(o) + '</span>').join('')).join('') +
    '<button class="btn primary" id="q-finish">Завершить тест</button><div id="q-result"></div></div>';
  p.querySelectorAll('.quiz-opt').forEach(el => el.onclick = () => {
    const q = el.dataset.q;
    p.querySelectorAll('.quiz-opt[data-q="' + q + '"]').forEach(x => x.classList.remove('sel'));
    el.classList.add('sel'); answers[q] = Number(el.dataset.o);
  });
  $('#q-finish').onclick = () => {
    let right = 0;
    test.questions.forEach((q, qi) => { if (answers[qi] === q.correct) right++; });
    const pct = Math.round(right / test.questions.length * 100);
    $('#q-result').innerHTML = '<div class="notice"><b>Результат: ' + right + ' из ' + test.questions.length + ' (' + pct + '%)</b><br>Результат сохранён на вашем устройстве. Пришлите его учителю вместе с домашним заданием или уточните порядок сдачи.</div>';
    const my = JSON.parse(localStorage.getItem('mir_testresults') || '[]');
    my.unshift({ test: test.title, course: test._courseId, right, total: test.questions.length, pct, date: today() });
    localStorage.setItem('mir_testresults', JSON.stringify(my.slice(0, 50)));
  };
}
function tabSTasks(p) {
  const my = S.catalog.courses.filter(c => sf().student.courseIds.includes(c.id) && (c.tasks.length || S.catalog.settings.homeworkFormUrl));
  p.innerHTML = (S.catalog.settings.homeworkFormUrl ? '<div class="card"><h3>Сдача работ</h3><p class="small">Загрузите решение через форму — учитель увидит его сразу:</p><a class="btn primary" style="text-align:center" href="' + esc(S.catalog.settings.homeworkFormUrl) + '" target="_blank">Открыть форму сдачи</a></div>' : '') +
    my.map(c => '<div class="card"><h3>' + esc(c.title) + '</h3>' +
      (c.tasks.map(t => '<div style="border-top:1px solid #EEF3F3;margin-top:10px;padding-top:8px"><b>' + esc(t.title) + '</b><p class="small">' + esc(t.text) + '</p>' +
        (t.file ? '<a class="small" href="' + esc(t.file.publicUrl) + '" target="_blank">📄 ' + esc(t.file.name) + '</a>' : '') + '</div>').join('') || '<p class="muted small">Заданий пока нет</p>') +
      '</div>').join('');
}
function tabSGrades(p) {
  const g = sf().grades || [];
  p.innerHTML = '<div class="card"><h3>Мои оценки</h3>' +
    (g.length ? '<table><tr><th>Дата</th><th>Курс</th><th>Тема</th><th>Балл</th></tr>' + g.map(x => '<tr><td>' + esc(x.date) + '</td><td>' + esc(courseName(x.courseId)) + '</td><td>' + esc(x.topic) + '</td><td class="grade-num">' + x.score + '</td></tr>').join('') + '</table>' : '<p class="muted">Оценок пока нет</p>') +
    '</div><div class="card"><h3>Мои результаты тестов</h3><div id="my-tests"></div></div>';
  const tr = JSON.parse(localStorage.getItem('mir_testresults') || '[]');
  $('#my-tests').innerHTML = tr.length ? tr.map(t => '<div class="row" style="margin:4px 0"><span class="pill teal">' + esc(t.test) + '</span><b>' + t.right + '/' + t.total + '</b><span class="muted small">' + t.date + '</span></div>').join('') : '<p class="muted small">Пока нет пройденных тестов</p>';
}
function tabSSchedule(p) {
  const g = sf().student.schedule || [];
  p.innerHTML = '<div class="card"><h3>Расписание занятий</h3>' +
    (g.length ? '<table><tr><th>Дата</th><th>Время</th><th>Курс</th><th>Тема</th></tr>' + g.map(x => '<tr><td>' + esc(x.date) + '</td><td>' + esc(x.time) + '</td><td>' + esc(courseName(x.courseId)) + '</td><td>' + esc(x.topic) + '</td></tr>').join('') + '</table>' : '<p class="muted">Расписание задаёт учитель в разделе «Журнал» → скоро появится. Сейчас расписание хранится в файле ученика.</p>') + '</div>';
}
function tabSAttendance(p) {
  const a = sf().attendance || [];
  const st = { present: '<span class="pill ok">Был</span>', absent: '<span class="pill err">Отсутствовал</span>', late: '<span class="pill amber">Опоздал</span>' };
  p.innerHTML = '<div class="card"><h3>Журнал посещаемости</h3>' +
    (a.length ? '<table><tr><th>Дата</th><th>Статус</th></tr>' + a.map(x => '<tr><td>' + esc(x.date) + '</td><td>' + (st[x.status] || esc(x.status)) + '</td></tr>').join('') + '</table>' : '<p class="muted">Отметок пока нет</p>') + '</div>';
}
function tabSPayments(p) {
  const pay = sf().payments || [];
  p.innerHTML = '<div class="card"><h3>Оплата занятий</h3>' +
    (pay.length ? pay.map(x => '<div class="row" style="margin:6px 0"><span class="pill teal">' + esc(x.period || x.date) + '</span><b>' + x.amount + ' ₽</b>' +
      (x.receiptUrl ? '<a class="btn mini ghost" href="' + esc(x.receiptUrl) + '" target="_blank">Чек</a>' : '') + '</div>').join('') : '<p class="muted">Записей пока нет</p>') + '</div>';
}

/* ---------- уведомления ---------- */
function checkNewGrades() {
  if (!S.studentFile) return;
  const n = (sf().grades || []).length;
  const seen = Number(localStorage.getItem('mir_seen_' + sf().student.code) || 0);
  if (n > seen) {
    const fresh = (sf().grades || []).slice(0, n - seen);
    const msg = 'Новая оценка: ' + fresh.map(x => courseName(x.courseId) + ' — ' + x.score).join(', ');
    if ('Notification' in window && Notification.permission === 'granted') new Notification('МИР — Курсы ОГЭ', { body: msg });
    else toast(msg);
    localStorage.setItem('mir_seen_' + sf().student.code, n);
  }
}
async function enablePush() {
  if (!('Notification' in window)) { toast('Уведомления не поддерживаются этим браузером'); return; }
  const r = await Notification.requestPermission();
  toast(r === 'granted' ? 'Уведомления включены — вы узнаете о новых оценках, когда откроете приложение' : 'Уведомления не разрешены в настройках браузера');
}

/* ---------- запуск ---------- */
function boot() {
  const tok = parseHashToken();
  if (tok) { S.token = tok; localStorage.setItem('mir_token', tok); }
  const params = new URLSearchParams(location.search);
  const school = params.get('school'), code = params.get('code');
  if (school) localStorage.setItem('mir_school', school);
  if (code) localStorage.setItem('mir_code', code);

  document.querySelectorAll('.role-btn').forEach(b => b.onclick = () => {
    document.querySelectorAll('.role-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); S.role = b.dataset.role;
    document.querySelectorAll('.auth-pane').forEach(x => x.classList.add('hidden'));
    $('#auth-' + (S.role === 'teacher' ? 'teacher' : S.role === 'student' ? 'student' : 'parent')).classList.remove('hidden');
    const savedSchool = localStorage.getItem('mir_school');
    if (S.role !== 'teacher' && savedSchool) { $('#in-school-link').value = savedSchool; $('#in-school-link-p').value = savedSchool; }
    const savedCode = localStorage.getItem('mir_code');
    if (S.role === 'student' && savedCode) $('#in-access-code').value = savedCode;
    if (S.role === 'parent' && savedCode) $('#in-access-code-p').value = savedCode;
  });

  $('#btn-yandex-login').onclick = yandexLogin;
  $('#btn-demo').onclick = async () => {
    S.mode = 'demo'; S.role = 'teacher'; S.data = JSON.parse(JSON.stringify(DEFAULT_DATA));
    S.data.students.push({ id: uid(), fio: 'Демо Ученик', code: 'MK-DEMO', parentContact: 'Родитель демо', courseIds: ['math', 'inf'] });
    enterApp(); toast('Демо-режим: изменения не сохраняются на Диск');
  };
  $('#btn-student-enter').onclick = () => studentEnter($('#in-school-link').value, $('#in-access-code').value, 'student');
  $('#btn-parent-enter').onclick = () => studentEnter($('#in-school-link-p').value, $('#in-access-code-p').value, 'parent');
  $('#btn-push-enable').onclick = enablePush;
  $('#btn-logout').onclick = () => { localStorage.removeItem('mir_session'); if (S.role === 'teacher') localStorage.removeItem('mir_token'); location.href = location.pathname; };

  // восстановление сессии
  if (S.token || localStorage.getItem('mir_token')) {
    S.token = S.token || localStorage.getItem('mir_token'); S.mode = 'yandex'; S.role = 'teacher';
    loadTeacherData().then(() => enterApp()).catch(e => { localStorage.removeItem('mir_token'); toast('Ошибка подключения к Диску: ' + e.message); });
  }
}
boot();
