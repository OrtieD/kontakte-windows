// Kontakte – Renderer
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const h = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const newUid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); })).toUpperCase();
const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

const LABEL_OPTS = {
  phones: ['Mobil', 'iPhone', 'Privat', 'Arbeit', 'Hauptnummer', 'Fax', 'Pager', 'Andere'],
  emails: ['Privat', 'Arbeit', 'iCloud', 'Andere'],
  urls: ['Homepage', 'Privat', 'Arbeit', 'Andere'],
  addresses: ['Privat', 'Arbeit', 'Andere']
};

let db = { version: 1, contacts: [], groups: [], settings: { sortBy: 'last', showFirstFirst: true } };
let view = 'all';            // 'all' | 'fav' | groupId
let selected = new Set();    // ausgewählte Kontakt-IDs
let current = null;          // primärer Kontakt
let anchor = null;           // für Umschalt-Auswahl
let draft = null;            // Bearbeitungsentwurf
let isNew = false;
let query = '';
let visible = [];            // aktuell sichtbare Kontakte in Reihenfolge

// ---------- Persistenz ----------
let saveTimer;
function save(fromSync) { clearTimeout(saveTimer); saveTimer = setTimeout(() => { saveTimer = null; window.api.save(db); }, 250); if (!fromSync) scheduleSync(4000); }
window.addEventListener('beforeunload', () => { if (saveTimer) { clearTimeout(saveTimer); window.api.save(db); } });

// ---------- Hilfen ----------
function displayName(c) {
  const n = db.settings.showFirstFirst ? [c.prefix, c.firstName, c.middleName, c.lastName, c.suffix] : [c.lastName && (c.lastName + (c.firstName ? ',' : '')), c.firstName, c.middleName];
  const s = n.filter(Boolean).join(' ').trim();
  if (c.isCompany && c.company) return c.company;
  return s || c.company || (c.emails?.[0]?.value) || (c.phones?.[0]?.value) || 'Kein Name';
}
function listNameHTML(c, q) {
  if (c.isCompany && c.company) return `<b>${hl(c.company, q)}</b>`;
  const f = [c.firstName, c.middleName].filter(Boolean).join(' '), l = c.lastName;
  if (!f && !l) return `<b>${hl(displayName(c), q)}</b>`;
  const boldLast = db.settings.sortBy === 'last';
  const fp = f ? (boldLast ? hl(f, q) : `<b>${hl(f, q)}</b>`) : '';
  const lp = l ? (boldLast ? `<b>${hl(l, q)}</b>` : hl(l, q)) : '';
  return db.settings.showFirstFirst ? [fp, lp].filter(Boolean).join(' ') : [lp + (fp ? ',' : ''), fp].filter(Boolean).join(' ');
}
function hl(text, q) {
  text = h(text); if (!q) return text;
  const i = text.toLowerCase().indexOf(h(q).toLowerCase());
  return i < 0 ? text : text.slice(0, i) + '<mark>' + text.slice(i, i + h(q).length) + '</mark>' + text.slice(i + h(q).length);
}
function sortKey(c) {
  if (c.isCompany && c.company) return c.company;
  const k = db.settings.sortBy === 'last' ? [c.lastName, c.firstName] : [c.firstName, c.lastName];
  return k.filter(Boolean).join(' ') || c.company || displayName(c);
}
function letterOf(c) {
  const ch = sortKey(c).trim().charAt(0).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return /[A-Z]/.test(ch) ? ch : '#';
}
function initials(c) {
  if (c.isCompany && c.company) return c.company.slice(0, 2).toUpperCase();
  const s = ((c.firstName || '').charAt(0) + (c.lastName || '').charAt(0)).toUpperCase();
  return s || displayName(c).charAt(0).toUpperCase();
}
function avatar(c, cls) { return `<div class="${cls}">${c.photo ? `<img src="${h(c.photo)}" alt="">` : h(initials(c))}</div>`; }
function groupName(id) { return db.groups.find(g => g.id === id)?.name || ''; }
function haystack(c) {
  return [c.firstName, c.lastName, c.middleName, c.nickname, c.company, c.department, c.jobTitle, c.notes,
    ...(c.phones || []).map(p => p.value + ' ' + p.value.replace(/\D/g, '')), ...(c.emails || []).map(e => e.value), ...(c.urls || []).map(u => u.value),
    ...(c.addresses || []).map(a => [a.street, a.zip, a.city, a.country].join(' ')), ...(c.groups || []).map(groupName)].join(' ').toLowerCase();
}
function emptyContact() {
  return { id: uid(), uid: newUid(), firstName: '', lastName: '', middleName: '', prefix: '', suffix: '', nickname: '', company: '', department: '', jobTitle: '', isCompany: false,
    phones: [], emails: [], urls: [], addresses: [], birthday: '', notes: '', photo: '', groups: [], favorite: false, created: Date.now(), updated: Date.now() };
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), 2600); }
function fmtBirthday(b) {
  if (!b) return ''; const [y, m, d] = b.split('-');
  const months = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  if (y === '1604') return `${+d}. ${months[+m - 1]}`;
  const now = new Date(); let age = now.getFullYear() - +y; if (now.getMonth() + 1 < +m || (now.getMonth() + 1 === +m && now.getDate() < +d)) age--;
  return `${+d}. ${months[+m - 1]} ${y}  (${age} Jahre)`;
}
function telHref(v) { return 'tel:' + v.replace(/[^\d+]/g, ''); }

// ---------- Sidebar ----------
function renderSidebar() {
  const fixed = [
    { id: 'all', ico: '👤', name: 'Alle Kontakte', n: db.contacts.length },
    { id: 'fav', ico: '★', name: 'Favoriten', n: db.contacts.filter(c => c.favorite).length }
  ];
  $('#sb-fixed').innerHTML = fixed.map(f => `<li data-view="${f.id}" class="${view === f.id ? 'sel' : ''}"><span class="ico">${f.ico}</span><span class="lbl">${f.name}</span><span class="n">${f.n}</span></li>`).join('');
  const groups = [...db.groups].sort((a, b) => collator.compare(a.name, b.name));
  $('#sb-groups').innerHTML = groups.map(g => `<li data-view="${g.id}" data-group="${g.id}" class="${view === g.id ? 'sel' : ''}"><span class="ico">▢</span><span class="lbl">${h(g.name)}</span><span class="n">${db.contacts.filter(c => c.groups?.includes(g.id)).length}</span></li>`).join('')
    || '<li style="color:var(--muted);font-size:12px">Keine Gruppen</li>';
}
document.getElementById('sidebar').addEventListener('click', e => {
  const li = e.target.closest('li[data-view]'); if (!li || li.querySelector('input')) return;
  if (!confirmLeaveEdit()) return;
  view = li.dataset.view; renderAll(true);
});
$('#sb-groups').addEventListener('dblclick', e => { const li = e.target.closest('li[data-group]'); if (li) renameGroup(li.dataset.group); });
$('#sb-groups').addEventListener('contextmenu', e => {
  const li = e.target.closest('li[data-group]'); if (!li) return; e.preventDefault();
  const id = li.dataset.group;
  showMenu(e.clientX, e.clientY, [
    { label: 'Umbenennen', fn: () => renameGroup(id) },
    { label: 'Gruppe als vCard exportieren', fn: () => exportVCF(db.contacts.filter(c => c.groups?.includes(id)), groupName(id)) },
    '-',
    { label: 'Gruppe löschen', danger: true, fn: () => deleteGroup(id) }
  ]);
});
function renameGroup(id, isNewGroup) {
  const li = $(`#sb-groups li[data-group="${id}"]`); if (!li) return;
  const g = db.groups.find(x => x.id === id);
  li.innerHTML = `<span class="ico">▢</span><input value="${h(g.name)}">`;
  const inp = li.querySelector('input'); inp.focus(); inp.select();
  let done = false;
  const finish = (ok) => {
    if (done) return; done = true;
    const v = inp.value.trim();
    if (ok && v) g.name = v; else if (isNewGroup && !v) db.groups = db.groups.filter(x => x.id !== id);
    save(); renderSidebar();
  };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); e.stopPropagation(); });
  inp.addEventListener('blur', () => finish(true));
}
async function deleteGroup(id) {
  if (!(await window.api.confirm({ message: `Gruppe „${groupName(id)}“ löschen?`, detail: 'Die Kontakte selbst bleiben erhalten.' }))) return;
  tombstone(db.groups.find(g => g.id === id));
  db.groups = db.groups.filter(g => g.id !== id);
  db.contacts.forEach(c => { c.groups = (c.groups || []).filter(x => x !== id); });
  if (view === id) view = 'all';
  save(); renderAll(true);
}
$('#btn-add-group').addEventListener('click', () => {
  const g = { id: uid(), uid: newUid(), name: 'Neue Gruppe' }; db.groups.push(g);
  // ausgewählte Kontakte gleich übernehmen, wenn mehrere markiert sind
  if (selected.size > 1) db.contacts.forEach(c => { if (selected.has(c.id)) c.groups = [...(c.groups || []), g.id]; });
  renderSidebar(); renameGroup(g.id, true);
});

// Drag & Drop Kontakte -> Gruppe / Favoriten
$('#sidebar').addEventListener('dragover', e => {
  if (!e.dataTransfer.types.includes('application/x-kontakt')) return;
  const li = e.target.closest('li[data-group], li[data-view="fav"]'); if (!li) return;
  e.preventDefault(); document.querySelectorAll('#sidebar li.drop').forEach(x => x.classList.remove('drop')); li.classList.add('drop');
});
$('#sidebar').addEventListener('dragleave', e => { const li = e.target.closest('li'); if (li) li.classList.remove('drop'); });
$('#sidebar').addEventListener('drop', e => {
  const li = e.target.closest('li[data-group], li[data-view="fav"]'); document.querySelectorAll('#sidebar li.drop').forEach(x => x.classList.remove('drop'));
  if (!li) return; e.preventDefault();
  const ids = JSON.parse(e.dataTransfer.getData('application/x-kontakt') || '[]');
  ids.forEach(id => {
    const c = db.contacts.find(x => x.id === id); if (!c) return;
    if (li.dataset.group) { c.groups = c.groups || []; if (!c.groups.includes(li.dataset.group)) c.groups.push(li.dataset.group); }
    else c.favorite = true;
  });
  save(); renderSidebar();
  toast(`${ids.length} Kontakt${ids.length > 1 ? 'e' : ''} zu „${li.dataset.group ? groupName(li.dataset.group) : 'Favoriten'}“ hinzugefügt`);
});

// ---------- Liste ----------
function computeVisible() {
  let list = db.contacts;
  if (view === 'fav') list = list.filter(c => c.favorite);
  else if (view !== 'all') list = list.filter(c => c.groups?.includes(view));
  const q = query.trim().toLowerCase();
  if (q) { const terms = q.split(/\s+/); list = list.filter(c => { const hs = haystack(c); return terms.every(t => hs.includes(t)); }); }
  visible = [...list].sort((a, b) => { const la = letterOf(a), lb = letterOf(b); if (la === '#' && lb !== '#') return 1; if (lb === '#' && la !== '#') return -1; return collator.compare(sortKey(a), sortKey(b)); });
}
function renderList() {
  computeVisible();
  const q = query.trim().split(/\s+/)[0] || '';
  let html = '', last = '';
  for (const c of visible) {
    const L = letterOf(c);
    if (L !== last && !query.trim()) { html += `<div class="letter" id="L-${L}">${L}</div>`; last = L; }
    const sub = query.trim() ? (c.company && !(c.isCompany) ? c.company : (c.emails?.[0]?.value || c.phones?.[0]?.value || '')) : '';
    html += `<div class="row ${selected.has(c.id) ? 'sel' : ''}" data-id="${c.id}" draggable="true">${avatar(c, 'avatar-s')}<div class="name">${listNameHTML(c, q)}${sub ? `<div class="sub">${hl(sub, q)}</div>` : ''}</div>${c.favorite ? '<span class="star">★</span>' : ''}</div>`;
  }
  if (!visible.length) html = `<div class="empty">${query ? 'Keine Treffer' : db.contacts.length ? 'Keine Kontakte in dieser Ansicht' : 'Noch keine Kontakte.<br><br>Mit „Neuer Kontakt“ unten rechts einen anlegen<br>oder eine vCard importieren.'}</div>`;
  $('#list').innerHTML = html;
  const letters = [...new Set(visible.map(letterOf))];
  $('#alpha').innerHTML = query.trim() ? '' : letters.map(l => `<span data-l="${l}">${l}</span>`).join('');
  $('#count').textContent = `${visible.length} Kontakt${visible.length === 1 ? '' : 'e'}${selected.size > 1 ? ` · ${selected.size} ausgewählt` : ''}`;
}
$('#alpha').addEventListener('click', e => { const l = e.target.dataset.l; if (l) document.getElementById('L-' + l)?.scrollIntoView({ block: 'start' }); });
$('#alpha').addEventListener('mousemove', e => { if (e.buttons === 1) { const l = e.target.dataset?.l; if (l) document.getElementById('L-' + l)?.scrollIntoView({ block: 'start' }); } });

function select(id, { add = false, range = false, keepScroll = false } = {}) {
  if (!confirmLeaveEdit()) return;
  if (range && anchor) {
    const a = visible.findIndex(c => c.id === anchor), b = visible.findIndex(c => c.id === id);
    if (a >= 0 && b >= 0) { if (!add) selected.clear(); visible.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(c => selected.add(c.id)); }
  } else if (add) { selected.has(id) ? selected.delete(id) : selected.add(id); anchor = id; }
  else { selected = new Set([id]); anchor = id; }
  current = selected.has(id) ? id : [...selected][0] || null;
  renderList(); renderDetail();
  if (!keepScroll) $(`#list .row[data-id="${current}"]`)?.scrollIntoView({ block: 'nearest' });
}
$('#list').addEventListener('mousedown', e => {
  const row = e.target.closest('.row'); if (!row) return;
  if (e.button === 2 && selected.has(row.dataset.id)) return;
  if (e.button === 0 && selected.has(row.dataset.id) && !e.ctrlKey && !e.shiftKey && selected.size > 1) return; // Drag mehrerer
  select(row.dataset.id, { add: e.ctrlKey || e.metaKey, range: e.shiftKey, keepScroll: true });
});
$('#list').addEventListener('click', e => {
  const row = e.target.closest('.row'); if (row && selected.size > 1 && !e.ctrlKey && !e.shiftKey && selected.has(row.dataset.id)) select(row.dataset.id, { keepScroll: true });
});
$('#list').addEventListener('dblclick', e => { if (e.target.closest('.row')) startEdit(); });
$('#list').addEventListener('dragstart', e => {
  const row = e.target.closest('.row'); if (!row) return;
  const ids = selected.has(row.dataset.id) ? [...selected] : [row.dataset.id];
  e.dataTransfer.setData('application/x-kontakt', JSON.stringify(ids));
  e.dataTransfer.effectAllowed = 'copy';
});
$('#list').addEventListener('contextmenu', e => {
  const row = e.target.closest('.row'); if (!row) return; e.preventDefault();
  if (!selected.has(row.dataset.id)) select(row.dataset.id, { keepScroll: true });
  const sel = db.contacts.filter(c => selected.has(c.id)); const one = sel.length === 1 ? sel[0] : null;
  const items = [];
  if (one) items.push({ label: 'Bearbeiten', fn: startEdit });
  const allFav = sel.every(c => c.favorite);
  items.push({ label: allFav ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen', fn: () => { sel.forEach(c => c.favorite = !allFav); save(); renderAll(); } });
  if (db.groups.length) {
    items.push('-', { header: 'Zu Gruppe hinzufügen' });
    [...db.groups].sort((a, b) => collator.compare(a.name, b.name)).forEach(g => items.push({ label: '   ' + g.name, fn: () => { sel.forEach(c => { c.groups = c.groups || []; if (!c.groups.includes(g.id)) c.groups.push(g.id); }); save(); renderAll(); toast(`Zu „${g.name}“ hinzugefügt`); } }));
  }
  if (view !== 'all' && view !== 'fav') items.push({ label: `Aus „${groupName(view)}“ entfernen`, fn: () => { sel.forEach(c => c.groups = (c.groups || []).filter(x => x !== view)); save(); selected.clear(); current = null; renderAll(); } });
  items.push('-', { label: sel.length > 1 ? `${sel.length} Kontakte als vCard exportieren…` : 'Als vCard exportieren…', fn: () => exportVCF(sel) });
  if (sel.length > 1) items.push({ label: `${sel.length} Kontakte zusammenführen`, fn: () => mergeContacts(sel) });
  items.push('-', { label: sel.length > 1 ? `${sel.length} Kontakte löschen` : 'Kontakt löschen', danger: true, fn: deleteSelected });
  showMenu(e.clientX, e.clientY, items);
});

// ---------- Detail ----------
const ICONS = {
  msg: '<svg viewBox="0 0 24 24"><path d="M12 3C6.5 3 2 6.8 2 11.5c0 2.6 1.4 4.9 3.6 6.5L5 21l3.7-1.8c1 .3 2.1.4 3.3.4 5.5 0 10-3.8 10-8.5S17.5 3 12 3z"/></svg>',
  call: '<svg viewBox="0 0 24 24"><path d="M6.6 10.8a15.1 15.1 0 006.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1z"/></svg>',
  video: '<svg viewBox="0 0 24 24"><path d="M15 8v8H4V8h11m1-2H3a1 1 0 00-1 1v10a1 1 0 001 1h13a1 1 0 001-1v-3.5l4 4v-11l-4 4V7a1 1 0 00-1-1z"/></svg>',
  mail: '<svg viewBox="0 0 24 24"><path d="M20 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V6a2 2 0 00-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>',
  map: '<svg viewBox="0 0 24 24"><path d="M12 2a7 7 0 00-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 00-7-7zm0 9.5A2.5 2.5 0 1112 6a2.5 2.5 0 010 5.5z"/></svg>'
};
function renderDetail() {
  const body = $('#detail-body');
  $('#btn-edit').textContent = draft ? 'Fertig' : 'Bearbeiten';
  $('#btn-edit').classList.toggle('primary', !!draft);
  $('#btn-edit').disabled = !draft && !current;
  $('#btn-share').disabled = !current;
  if (draft) return renderEdit();
  if (selected.size > 1) { body.innerHTML = `<div class="placeholder">${selected.size} Kontakte ausgewählt</div>`; return; }
  const c = db.contacts.find(x => x.id === current);
  if (!c) { body.innerHTML = `<div class="placeholder">${db.contacts.length ? 'Kein Kontakt ausgewählt' : ''}</div>`; return; }
  const meta = [c.isCompany ? '' : c.jobTitle, c.isCompany ? '' : c.department, c.isCompany ? '' : c.company].filter(Boolean).join(' · ');
  const tel = c.phones?.[0]?.value, mail = c.emails?.[0]?.value;
  let html = `<div class="card-head">${avatar(c, 'avatar-l')}<div><h1>${h(displayName(c))}${c.favorite ? ' <span style="color:#ffcc00;font-size:18px">★</span>' : ''}</h1>
    ${c.nickname ? `<div class="meta">„${h(c.nickname)}“</div>` : ''}${meta ? `<div class="meta">${h(meta)}</div>` : ''}
    <div class="actions">
      <button class="act" data-href="${tel ? h('sms:' + tel.replace(/[^\d+]/g, '')) : ''}" ${tel ? '' : 'disabled'}><span class="c">${ICONS.msg}</span>Nachricht</button>
      <button class="act" data-href="${tel ? h(telHref(tel)) : ''}" ${tel ? '' : 'disabled'}><span class="c">${ICONS.call}</span>Anrufen</button>
      <button class="act" data-href="${tel || mail ? h('https://teams.microsoft.com/l/call/0/0?users=' + encodeURIComponent(mail || tel)) : ''}" ${tel || mail ? '' : 'disabled'}><span class="c">${ICONS.video}</span>Video</button>
      <button class="act" data-href="${mail ? h('mailto:' + mail) : ''}" ${mail ? '' : 'disabled'}><span class="c">${ICONS.mail}</span>E-Mail</button>
    </div></div></div>`;
  const rows = [];
  (c.phones || []).forEach(p => rows.push([p.label, `<a data-href="${h(telHref(p.value))}">${h(p.value)}</a>`]));
  (c.emails || []).forEach(e => rows.push([e.label, `<a data-href="${h('mailto:' + e.value)}">${h(e.value)}</a>`]));
  (c.urls || []).forEach(u => { const url = /^https?:/i.test(u.value) ? u.value : 'https://' + u.value; rows.push([u.label, `<a data-href="${h(url)}">${h(u.value)}</a>`]); });
  if (rows.length) html += `<div class="fields">${rows.map(([k, v]) => `<div class="k">${h(k)}</div><div class="v">${v}</div>`).join('')}</div>`;
  const ad = (c.addresses || []).map(a => {
    const txt = [a.street, [a.zip, a.city].filter(Boolean).join(' '), a.region, a.country].filter(Boolean).join('\n');
    const q = encodeURIComponent(txt.replace(/\n/g, ', '));
    return `<div class="k">${h(a.label)}</div><div class="v"><a data-href="https://www.google.com/maps/search/?api=1&query=${q}" title="In Karten öffnen">${h(txt)}</a></div>`;
  });
  if (ad.length) html += `<div class="fields">${ad.join('')}</div>`;
  const more = [];
  if (c.birthday) more.push(['Geburtstag', h(fmtBirthday(c.birthday))]);
  if (c.groups?.length) more.push(['Gruppen', h(c.groups.map(groupName).filter(Boolean).join(', '))]);
  if (c.notes) more.push(['Notiz', h(c.notes)]);
  if (more.length) html += `<div class="fields">${more.map(([k, v]) => `<div class="k">${k}</div><div class="v">${v}</div>`).join('')}</div>`;
  body.innerHTML = html;
}
$('#detail-body').addEventListener('click', e => {
  const a = e.target.closest('[data-href]'); if (!a || draft) return;
  if (a.dataset.href) window.api.openExternal(a.dataset.href);
});

// ---------- Bearbeiten ----------
function startEdit() {
  if (draft) return;
  const c = db.contacts.find(x => x.id === current); if (!c) return;
  draft = JSON.parse(JSON.stringify(c)); isNew = false; renderDetail(); focusFirst();
}
function newContact() {
  if (!confirmLeaveEdit()) return;
  draft = emptyContact(); isNew = true;
  draft.phones.push({ label: 'Mobil', value: '' }); draft.emails.push({ label: 'Privat', value: '' });
  if (view !== 'all' && view !== 'fav') draft.groups = [view];
  if (view === 'fav') draft.favorite = true;
  selected.clear(); current = null; renderList(); renderDetail(); focusFirst();
}
function focusFirst() { setTimeout(() => $('#detail-body input')?.focus(), 0); }
function confirmLeaveEdit() { if (!draft) return true; commitEdit(); return true; }

function labelSelect(kind, val, i) {
  const opts = [...LABEL_OPTS[kind]]; if (val && !opts.includes(val)) opts.unshift(val);
  return `<select data-kind="${kind}" data-i="${i}" data-f="label">${opts.map(o => `<option ${o === val ? 'selected' : ''}>${h(o)}</option>`).join('')}<option value="__custom">Eigenes Etikett…</option></select>`;
}
function renderEdit() {
  const d = draft;
  const inp = (f, ph, cls = '') => `<input type="text" data-f="${f}" class="${cls}" placeholder="${ph}" value="${h(d[f])}">`;
  const multi = (kind, ph, add) => d[kind].map((x, i) => `<div class="k">${labelSelect(kind, x.label, i)}</div>
      <div class="line"><button class="rm" data-rm="${kind}" data-i="${i}" title="Entfernen">−</button><input type="text" data-kind="${kind}" data-i="${i}" data-f="value" placeholder="${ph}" value="${h(x.value)}"></div>`).join('')
    + `<div class="k"></div><div><button class="add" data-add="${kind}"><span class="plus">+</span>${add}</button></div>`;
  const adr = d.addresses.map((a, i) => `<div class="k">${labelSelect('addresses', a.label, i)}</div>
      <div class="line" style="align-items:flex-start"><button class="rm" data-rm="addresses" data-i="${i}" style="margin-top:6px">−</button>
      <div class="adr-grid"><textarea rows="2" data-kind="addresses" data-i="${i}" data-f="street" placeholder="Straße">${h(a.street)}</textarea>
      <input type="text" data-kind="addresses" data-i="${i}" data-f="zip" placeholder="PLZ" value="${h(a.zip)}"><input type="text" data-kind="addresses" data-i="${i}" data-f="city" placeholder="Ort" value="${h(a.city)}">
      <input type="text" data-kind="addresses" data-i="${i}" data-f="region" placeholder="Bundesland" value="${h(a.region)}"><input type="text" data-kind="addresses" data-i="${i}" data-f="country" placeholder="Land" value="${h(a.country)}"></div></div>`).join('')
    + `<div class="k"></div><div><button class="add" data-add="addresses"><span class="plus">+</span>Adresse hinzufügen</button></div>`;
  const bdayYearless = d.birthday?.startsWith('1604-');
  $('#detail-body').innerHTML = `<div class="edit">
    <div class="card-head">
      <div class="avatar-l editable" id="photo-pick" title="Foto wählen (Rechtsklick: entfernen)">${d.photo ? `<img src="${h(d.photo)}">` : h(initials(d) || '+')}</div>
      <div class="name-grid">
        ${inp('firstName', 'Vorname', 'big')}${inp('lastName', 'Nachname', 'big')}
        ${inp('company', 'Firma')}${inp('jobTitle', 'Position')}
        ${inp('department', 'Abteilung')}${inp('nickname', 'Spitzname')}
        <label class="chk"><input type="checkbox" data-f="isCompany" ${d.isCompany ? 'checked' : ''}> Firma (als Firmenkarte anzeigen)</label>
        <label class="chk"><input type="checkbox" data-f="favorite" ${d.favorite ? 'checked' : ''}> Favorit</label>
      </div>
    </div>
    <div class="fields">${multi('phones', 'Telefon', 'Telefon hinzufügen')}</div>
    <div class="fields">${multi('emails', 'E-Mail', 'E-Mail hinzufügen')}</div>
    <div class="fields">${multi('urls', 'Webseite', 'URL hinzufügen')}</div>
    <div class="fields">${adr}</div>
    <div class="fields">
      <div class="k">Geburtstag</div><div class="line"><input type="date" data-f="birthday" value="${h(bdayYearless ? '' : d.birthday)}" style="max-width:170px">
        ${bdayYearless ? `<span style="color:var(--muted)">${h(fmtBirthday(d.birthday))} (ohne Jahr)</span>` : ''}</div>
      <div class="k">Gruppen</div><div class="line" style="flex-wrap:wrap;gap:10px">${db.groups.length ? [...db.groups].sort((a, b) => collator.compare(a.name, b.name)).map(g => `<label class="chk"><input type="checkbox" data-group="${g.id}" ${d.groups.includes(g.id) ? 'checked' : ''}> ${h(g.name)}</label>`).join('') : '<span style="color:var(--muted)">–</span>'}</div>
      <div class="k">Notiz</div><div><textarea data-f="notes" rows="4" placeholder="Notiz">${h(d.notes)}</textarea></div>
    </div>
    <div class="edit-bar">${isNew ? '' : '<button class="danger-link" id="edit-delete">Kontakt löschen</button>'}<button class="ghost" id="edit-cancel">Abbrechen</button><button class="ghost primary" id="edit-done">Fertig</button></div>
  </div>`;
}
$('#detail-body').addEventListener('input', e => {
  if (!draft) return; const t = e.target;
  if (t.dataset.group) { draft.groups = t.checked ? [...draft.groups, t.dataset.group] : draft.groups.filter(x => x !== t.dataset.group); return; }
  if (t.dataset.kind) {
    if (t.dataset.f === 'label' && t.value === '__custom') {
      const { kind, i } = t.dataset; const entry = draft[kind][+i]; const old = entry.label;
      const box = document.createElement('input'); box.type = 'text'; box.placeholder = 'Etikett'; box.style.cssText = 'text-align:right;font-size:12px;padding:2px 5px';
      t.replaceWith(box); box.focus();
      let done = false;
      const fin = (ok) => { if (done) return; done = true; entry.label = (ok && box.value.trim()) || old; renderEdit(); };
      box.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); fin(true); } if (ev.key === 'Escape') { ev.stopPropagation(); fin(false); } });
      box.addEventListener('blur', () => fin(true));
      return;
    }
    draft[t.dataset.kind][+t.dataset.i][t.dataset.f] = t.value; return;
  }
  if (!t.dataset.f) return;
  if (t.type === 'checkbox') draft[t.dataset.f] = t.checked;
  else if (t.dataset.f === 'birthday') { if (t.value || !draft.birthday?.startsWith('1604-')) draft.birthday = t.value; }
  else draft[t.dataset.f] = t.value;
});
$('#detail-body').addEventListener('click', async e => {
  if (!draft) return;
  const add = e.target.closest('[data-add]'), rm = e.target.closest('[data-rm]');
  if (add) {
    const k = add.dataset.add; const used = draft[k].map(x => x.label);
    const label = LABEL_OPTS[k].find(l => !used.includes(l)) || LABEL_OPTS[k][0];
    draft[k].push(k === 'addresses' ? { label, street: '', zip: '', city: '', region: '', country: 'Deutschland' } : { label, value: '' });
    renderEdit(); const ins = $(`#detail-body [data-kind="${k}"][data-i="${draft[k].length - 1}"]:not(select)`); ins?.focus(); return;
  }
  if (rm) { draft[rm.dataset.rm].splice(+rm.dataset.i, 1); renderEdit(); return; }
  if (e.target.closest('#photo-pick')) { const p = await window.api.pickPhoto(); if (p) { draft.photo = await shrinkPhoto(p); renderEdit(); } return; }
  if (e.target.id === 'edit-done') { commitEdit(); return; }
  if (e.target.id === 'edit-cancel') { cancelEdit(); return; }
  if (e.target.id === 'edit-delete') { cancelEdit(); deleteSelected(); }
});
$('#detail-body').addEventListener('contextmenu', e => { if (draft && e.target.closest('#photo-pick') && draft.photo) { e.preventDefault(); showMenu(e.clientX, e.clientY, [{ label: 'Foto entfernen', danger: true, fn: () => { draft.photo = ''; renderEdit(); } }]); } });
$('#detail-body').addEventListener('keydown', e => {
  if (!draft) return;
  if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type === 'text' && !e.shiftKey) { e.preventDefault(); commitEdit(); }
});

function shrinkPhoto(dataUrl) {
  return new Promise(res => {
    const img = new Image(); img.onload = () => {
      const s = Math.min(img.width, img.height), size = Math.min(400, s), cv = document.createElement('canvas'); cv.width = cv.height = size;
      cv.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      res(cv.toDataURL('image/jpeg', 0.85));
    }; img.onerror = () => res(dataUrl); img.src = dataUrl;
  });
}
function clean(c) {
  ['phones', 'emails', 'urls'].forEach(k => c[k] = c[k].map(x => ({ ...x, value: x.value.trim() })).filter(x => x.value));
  c.addresses = c.addresses.filter(a => [a.street, a.zip, a.city, a.region].some(v => v && v.trim()));
  ['firstName', 'lastName', 'company', 'jobTitle', 'department', 'nickname'].forEach(f => c[f] = (c[f] || '').trim());
  return c;
}
function isEmpty(c) { return !c.firstName && !c.lastName && !c.company && !c.phones.length && !c.emails.length && !c.notes && !c.addresses.length; }
function commitEdit() {
  if (!draft) return;
  const c = clean(draft); draft = null;
  if (isEmpty(c)) { if (!isNew) toast('Leerer Kontakt – Änderungen verworfen'); renderAll(); return; }
  c.updated = Date.now();
  if (isNew) db.contacts.push(c); else db.contacts[db.contacts.findIndex(x => x.id === c.id)] = c;
  isNew = false; selected = new Set([c.id]); current = c.id; anchor = c.id;
  save(); renderAll(); $(`#list .row[data-id="${c.id}"]`)?.scrollIntoView({ block: 'nearest' });
}
function cancelEdit() { draft = null; isNew = false; renderAll(); }

async function deleteSelected() {
  const sel = db.contacts.filter(c => selected.has(c.id)); if (!sel.length) return;
  const msg = sel.length === 1 ? `„${displayName(sel[0])}“ wirklich löschen?` : `${sel.length} Kontakte wirklich löschen?`;
  if (!(await window.api.confirm({ message: msg, detail: 'Dies kann nicht widerrufen werden (tägliche Sicherung im Datenordner).' }))) return;
  const idx = visible.findIndex(c => c.id === current);
  db.contacts.filter(c => selected.has(c.id)).forEach(tombstone);
  db.contacts = db.contacts.filter(c => !selected.has(c.id));
  save(); computeVisible();
  const next = visible[Math.min(idx, visible.length - 1)];
  selected = new Set(next ? [next.id] : []); current = next?.id || null;
  renderAll();
}

// ---------- Import / Export ----------
function dupKey(c) { return [(c.firstName || '').toLowerCase(), (c.lastName || '').toLowerCase(), (c.company || '').toLowerCase()].join('|'); }
function importTexts(items) {
  let added = 0, merged = 0;
  const byKey = new Map(db.contacts.map(c => [dupKey(c), c]));
  let lastId = null;
  for (const { name, text } of items) {
    const parsed = /\.csv$/i.test(name || '') || (!/BEGIN:VCARD/i.test(text) && text.includes(';')) ? VCard.parseCSV(text) : VCard.parse(text);
    const usedUids = new Set(db.contacts.map(c => c.uid));
    for (const gc of parsed.filter(p => p.kind === 'group')) {
      let g = db.groups.find(x => x.name.toLowerCase() === gc.name.toLowerCase()); if (!g) { g = { id: uid(), uid: newUid(), name: gc.name }; db.groups.push(g); }
      parsed.filter(p => p.kind !== 'group' && gc.members.includes(p.uid)).forEach(p => { (p.groupNames = p.groupNames || []).push(g.name); });
    }
    for (const p of parsed.filter(p => p.kind !== 'group')) {
      if (!p.uid || usedUids.has(p.uid)) p.uid = newUid(); usedUids.add(p.uid); delete p.rev;
      const groups = (p.groupNames || []).map(n => { let g = db.groups.find(x => x.name.toLowerCase() === n.toLowerCase()); if (!g) { g = { id: uid(), uid: newUid(), name: n }; db.groups.push(g); } return g.id; });
      if (view !== 'all' && view !== 'fav') groups.push(view);
      delete p.groupNames;
      const key = dupKey(p); const ex = key !== '||' ? byKey.get(key) : null;
      if (ex) { mergeInto(ex, p); ex.groups = [...new Set([...(ex.groups || []), ...groups])]; ex.updated = Date.now(); merged++; lastId = ex.id; continue; }
      const c = { ...emptyContact(), ...p, groups: [...new Set(groups)] };
      db.contacts.push(c); byKey.set(key, c); added++; lastId = c.id;
    }
  }
  save();
  if (lastId) { selected = new Set([lastId]); current = lastId; }
  renderAll();
  toast(added + merged ? `${added} importiert${merged ? `, ${merged} mit vorhandenen zusammengeführt` : ''}` : 'Keine Kontakte gefunden');
}
function mergeInto(a, b) {
  for (const f of ['firstName', 'lastName', 'middleName', 'prefix', 'suffix', 'nickname', 'company', 'department', 'jobTitle', 'birthday', 'photo']) if (!a[f] && b[f]) a[f] = b[f];
  if (b.notes && !(a.notes || '').includes(b.notes)) a.notes = [a.notes, b.notes].filter(Boolean).join('\n\n');
  const norm = (k, v) => k === 'phones' ? v.replace(/[^\d+]/g, '').replace(/^\+49/, '0').replace(/^0049/, '0') : v.toLowerCase().trim();
  for (const k of ['phones', 'emails', 'urls']) { a[k] = a[k] || []; for (const x of b[k] || []) if (!a[k].some(y => norm(k, y.value) === norm(k, x.value))) a[k].push(x); }
  a.addresses = a.addresses || [];
  for (const x of b.addresses || []) if (!a.addresses.some(y => (y.street || '').toLowerCase() === (x.street || '').toLowerCase() && y.zip === x.zip)) a.addresses.push(x);
  a.favorite = a.favorite || b.favorite;
  a.groups = [...new Set([...(a.groups || []), ...(b.groups || [])])];
}
async function mergeContacts(sel) {
  if (!(await window.api.confirm({ message: `${sel.length} Kontakte zu einem zusammenführen?`, detail: `Basis: „${displayName(sel[0])}“. Alle Nummern, Adressen und Notizen werden übernommen.`, ok: 'Zusammenführen' }))) return;
  const [base, ...rest] = sel; rest.forEach(r => mergeInto(base, r)); base.updated = Date.now();
  rest.forEach(tombstone); const ids = new Set(rest.map(r => r.id)); db.contacts = db.contacts.filter(c => !ids.has(c.id));
  selected = new Set([base.id]); current = base.id; save(); renderAll(); toast('Zusammengeführt');
}
function findDuplicates() {
  const groups = new Map();
  for (const c of db.contacts) { const k = dupKey(c); if (k === '||') continue; groups.set(k, [...(groups.get(k) || []), c]); }
  const dups = [...groups.values()].filter(g => g.length > 1);
  if (!dups.length) return toast('Keine Duplikate gefunden');
  window.api.confirm({ message: `${dups.length} Duplikat-Gruppe${dups.length > 1 ? 'n' : ''} gefunden (${dups.reduce((s, g) => s + g.length, 0)} Kontakte).`, detail: 'Jetzt alle zusammenführen?', ok: 'Zusammenführen' }).then(ok => {
    if (!ok) return; const rm = new Set();
    dups.forEach(([base, ...rest]) => { rest.forEach(r => { mergeInto(base, r); rm.add(r.id); tombstone(r); }); base.updated = Date.now(); });
    db.contacts = db.contacts.filter(c => !rm.has(c.id)); selected.clear(); current = null; save(); renderAll(); toast(`${rm.size} Duplikate zusammengeführt`);
  });
}
async function exportVCF(list, baseName) {
  if (!list.length) return toast('Nichts zu exportieren');
  const content = list.map(c => VCard.serialize(c, (c.groups || []).map(groupName).filter(Boolean))).join('\r\n') + '\r\n';
  const name = (baseName || (list.length === 1 ? displayName(list[0]) : `${list.length} Kontakte`)).replace(/[\\/:*?"<>|]/g, '_') + '.vcf';
  if (await window.api.exportDialog({ defaultName: name, content, ext: 'vcf' })) toast(`${list.length} Kontakt${list.length > 1 ? 'e' : ''} exportiert`);
}
async function exportCSV() {
  computeVisible();
  const content = VCard.toCSV(visible, c => (c.groups || []).map(groupName).filter(Boolean));
  if (await window.api.exportDialog({ defaultName: 'Kontakte.csv', content, ext: 'csv' })) toast(`${visible.length} Kontakte als CSV exportiert`);
}
$('#btn-import').addEventListener('click', async () => { const files = await window.api.importDialog(); if (files.length) importTexts(files); });
$('#btn-share').addEventListener('click', () => exportVCF(db.contacts.filter(c => selected.has(c.id))));
$('#btn-more').addEventListener('click', e => {
  const r = e.target.getBoundingClientRect();
  showMenu(r.left, r.top - 8, [
    { label: 'Ansicht als vCard exportieren…', fn: () => { computeVisible(); exportVCF(visible, view === 'all' ? 'Alle Kontakte' : view === 'fav' ? 'Favoriten' : groupName(view)); } },
    { label: 'Ansicht als CSV (Excel) exportieren…', fn: exportCSV },
    '-',
    { label: 'iCloud-Synchronisierung…', fn: openIcloudDialog },
    { label: 'Duplikate suchen und zusammenführen', fn: findDuplicates },
    '-',
    { label: (db.settings.sortBy === 'last' ? '✓ ' : '    ') + 'Sortieren nach Nachname', fn: () => { db.settings.sortBy = 'last'; save(); renderAll(); } },
    { label: (db.settings.sortBy === 'first' ? '✓ ' : '    ') + 'Sortieren nach Vorname', fn: () => { db.settings.sortBy = 'first'; save(); renderAll(); } },
    { label: (db.settings.showFirstFirst ? '✓ ' : '    ') + 'Vorname zuerst anzeigen', fn: () => { db.settings.showFirstFirst = !db.settings.showFirstFirst; save(); renderAll(); } },
    '-',
    { label: 'Datenordner öffnen (Sicherungen)', fn: () => window.api.openDataFolder() }
  ], true);
});

// Datei-Drop
let dragDepth = 0;
window.addEventListener('dragenter', e => { if (e.dataTransfer.types.includes('Files')) { dragDepth++; $('#dropzone').classList.remove('hidden'); } });
window.addEventListener('dragleave', e => { if (e.dataTransfer.types.includes('Files') && --dragDepth <= 0) { dragDepth = 0; $('#dropzone').classList.add('hidden'); } });
window.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
window.addEventListener('drop', async e => {
  if (!e.dataTransfer.files.length) return; e.preventDefault(); dragDepth = 0; $('#dropzone').classList.add('hidden');
  const files = await Promise.all([...e.dataTransfer.files].filter(f => /\.(vcf|vcard|csv)$/i.test(f.name)).map(async f => ({ name: f.name, text: await f.text() })));
  if (files.length) importTexts(files); else toast('Nur .vcf- oder .csv-Dateien');
});

// ---------- Menü ----------
function showMenu(x, y, items, above) {
  const m = $('#ctx');
  m.innerHTML = items.map((it, i) => it === '-' ? '<hr>' : it.header ? `<div class="sub-h">${h(it.header)}</div>` : `<div class="it ${it.danger ? 'danger' : ''}" data-i="${i}">${h(it.label)}</div>`).join('');
  m.classList.remove('hidden');
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 6) + 'px';
  m.style.top = (above ? Math.max(6, y - r.height) : Math.min(y, innerHeight - r.height - 6)) + 'px';
  m.onclick = ev => { const it = items[ev.target.closest('.it')?.dataset.i]; if (it) { hideMenu(); it.fn(); } };
}
function hideMenu() { $('#ctx').classList.add('hidden'); }
window.addEventListener('mousedown', e => { if (!e.target.closest('#ctx')) hideMenu(); });
window.addEventListener('blur', hideMenu);

// ---------- Tastatur ----------
window.addEventListener('keydown', e => {
  const inField = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  const ctrl = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape') { if (!$('#ctx').classList.contains('hidden')) return hideMenu(); if (draft) return cancelEdit(); if (query) { $('#search').value = ''; query = ''; renderList(); } return; }
  if (ctrl && e.key.toLowerCase() === 'n') { e.preventDefault(); return newContact(); }
  if (ctrl && e.key.toLowerCase() === 'f') { e.preventDefault(); $('#search').focus(); $('#search').select(); return; }
  if (ctrl && e.key.toLowerCase() === 'e') { e.preventDefault(); return draft ? commitEdit() : startEdit(); }
  if (ctrl && e.key.toLowerCase() === 's' && draft) { e.preventDefault(); return commitEdit(); }
  if (ctrl && e.key.toLowerCase() === 'i') { e.preventDefault(); return $('#btn-import').click(); }
  if (inField && document.activeElement.id !== 'search') return;
  if (draft) return;
  if (ctrl && e.key.toLowerCase() === 'a' && document.activeElement.id !== 'search') { e.preventDefault(); selected = new Set(visible.map(c => c.id)); renderList(); renderDetail(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); if (!visible.length) return;
    let i = visible.findIndex(c => c.id === current);
    i = e.key === 'ArrowDown' ? Math.min(visible.length - 1, i + 1) : Math.max(0, i - 1);
    select(visible[i].id, { range: e.shiftKey });
    return;
  }
  if (e.key === 'Enter' && current && document.activeElement.id !== 'search') return startEdit();
  if ((e.key === 'Delete' || e.key === 'Backspace') && !inField && selected.size) { e.preventDefault(); deleteSelected(); }
});

// ---------- Suche & Buttons ----------
$('#search').addEventListener('input', e => {
  query = e.target.value; renderList();
  if (visible.length && !visible.some(c => c.id === current)) { selected = new Set([visible[0].id]); current = visible[0].id; renderList(); renderDetail(); }
});
$('#search').addEventListener('keydown', e => { if (e.key === 'Enter' && visible.length) { $('#list').focus(); } });
$('#btn-new').addEventListener('click', newContact);
$('#btn-edit').addEventListener('click', () => draft ? commitEdit() : startEdit());

function renderAll(resetSelection) {
  renderSidebar(); computeVisible();
  if (resetSelection || (current && !visible.some(c => c.id === current))) {
    if (!draft) { selected = new Set(visible[0] ? [visible[0].id] : []); current = visible[0]?.id || null; }
  }
  renderList(); renderDetail();
}

// ---------- Start ----------
(async function init() {
  const data = await window.api.load();
  if (data && Array.isArray(data.contacts)) db = { ...db, ...data, settings: { ...db.settings, ...(data.settings || {}) } };
  renderAll(true);
  const files = await window.api.initialFiles();
  if (files.length) importTexts(files.map(text => ({ name: 'datei.vcf', text })));
  window.api.onOpenFiles(texts => importTexts(texts.map(text => ({ name: 'datei.vcf', text }))));
  const st = await window.api.icloud.status();
  syncState.connected = st.connected; syncState.appleId = st.appleId || '';
  renderSync();
  if (st.connected) runSync();
  setInterval(() => runSync(), 5 * 60 * 1000);
  setInterval(renderSync, 30 * 1000);
})();


// =====================================================================
// iCloud-Synchronisierung (CardDAV)
// =====================================================================
const syncState = { connected: false, appleId: '', busy: false, error: '', again: false, timer: null };
function tombstone(item) { if (item?.sync?.href && !String(item.sync.href).startsWith('__')) (db.tombstones = db.tombstones || []).push({ href: item.sync.href, etag: item.sync.etag }); }
function fnv(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36) + '.' + s.length; }
function contactCard(c) { return VCard.serialize(c, null, { noRev: true }); }
function groupCard(g) { return VCard.serializeGroup(g, db.contacts.filter(c => c.groups?.includes(g.id)).map(c => c.uid), { noRev: true }); }
function withRev(card) { return card.replace(/END:VCARD\r\n$/, `REV:${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}\r\nEND:VCARD\r\n`); }
function isDirty(item, card) { return !item.sync?.href || item.sync.hash !== fnv(card); }
function ensureUids() {
  const seen = new Set();
  for (const x of [...db.contacts, ...db.groups]) { if (!x.uid || seen.has(x.uid)) { x.uid = newUid(); if (x.sync && !x.sync.href) x.sync = null; } seen.add(x.uid); }
}
function scheduleSync(ms) { if (!syncState.connected) return; clearTimeout(syncState.timer); syncState.timer = setTimeout(runSync, ms); }

function fromRemote(local, card, href, etag) {
  const c = { ...emptyContact(), ...card, id: local?.id || uid(), favorite: !!local?.favorite, groups: [...(local?.groups || [])], created: local?.created || Date.now(), updated: card.rev || Date.now() };
  delete c.groupNames; delete c.rev; delete c.kind;
  if (!c.uid) c.uid = local?.uid || newUid();
  c.sync = { href, etag, hash: fnv(contactCard(c)) };
  return c;
}

async function runSync() {
  if (!syncState.connected) return;
  if (syncState.busy) { syncState.again = true; return; }
  syncState.busy = true; syncState.error = ''; renderSync();
  const api = window.api.icloud;
  let pulled = 0, pushed = 0, removed = 0;
  try {
    const book = await api.book();
    ensureUids();

    // 1) lokale Löschungen übertragen
    const tomb = db.tombstones || []; db.tombstones = [];
    for (const t of tomb) { const r = await api.del(t.href, t.etag); if (r.status >= 500) db.tombstones.push(t); }

    // 2) Server-Stand holen
    const remote = await api.list();
    const rmap = new Map(remote.map(r => [r.href, r.etag]));
    const known = new Map();
    db.contacts.forEach(c => c.sync?.href && known.set(c.sync.href, c));
    db.groups.forEach(g => g.sync?.href && known.set(g.sync.href, g));
    const toFetch = remote.filter(r => { const k = known.get(r.href); return !k || k.sync.etag !== r.etag; }).map(r => r.href);
    const fetched = toFetch.length ? await api.multiget(toFetch) : [];
    const cards = fetched.map(f => ({ ...f, card: VCard.parse(f.data)[0] })).filter(f => f.card);

    // 3) Kontakte vom Server übernehmen
    const unsyncedByKey = new Map(db.contacts.filter(c => !c.sync?.href).map(c => [dupKey(c), c]));
    for (const f of cards.filter(f => f.card.kind !== 'group')) {
      let local = known.get(f.href);
      if (!local) {
        local = (f.card.uid && db.contacts.find(c => c.uid === f.card.uid && !c.sync?.href)) || (dupKey(f.card) !== '||' ? unsyncedByKey.get(dupKey(f.card)) : null) || null;
      }
      const rv = fromRemote(local, f.card, f.href, f.etag);
      if (local) {
        if (!local.sync?.href) {
          // Erstabgleich: lokale Zusatzinfos in die iCloud-Version übernehmen
          mergeInto(rv, local); rv.favorite = local.favorite; unsyncedByKey.delete(dupKey(local));
        } else if (isDirty(local, contactCard(local)) && (local.updated || 0) > (f.card.rev || 0)) {
          local.sync.etag = f.etag; continue; // lokale Änderung ist neuer → später hochladen
        }
        db.contacts[db.contacts.indexOf(local)] = rv;
      } else db.contacts.push(rv);
      pulled++;
    }

    // 4) auf dem Server gelöschte Kontakte
    for (const c of [...db.contacts]) {
      if (!c.sync?.href || rmap.has(c.sync.href)) continue;
      if (isDirty(c, contactCard(c))) c.sync = null; // lokal geändert → neu anlegen
      else { db.contacts.splice(db.contacts.indexOf(c), 1); removed++; selected.delete(c.id); if (current === c.id) current = null; }
    }

    // 5) Gruppen vom Server übernehmen
    for (const f of cards.filter(f => f.card.kind === 'group')) {
      let g = known.get(f.href) || db.groups.find(x => x.uid === f.card.uid && !x.sync?.href) || db.groups.find(x => !x.sync?.href && x.name.toLowerCase() === f.card.name.toLowerCase());
      const wasUnsynced = !!g && !g.sync?.href;
      if (!g) { g = { id: uid(), uid: f.card.uid || newUid(), name: f.card.name }; db.groups.push(g); }
      const before = new Set(db.contacts.filter(c => c.groups?.includes(g.id)).map(c => c.id));
      g.name = f.card.name; g.uid = f.card.uid || g.uid; g.extra = f.card.extra;
      const mem = new Set(f.card.members);
      db.contacts.forEach(c => {
        const inG = mem.has(c.uid) || (before.has(c.id) && (wasUnsynced || !c.sync?.href));
        c.groups = (c.groups || []).filter(x => x !== g.id); if (inG) c.groups.push(g.id);
      });
      g.sync = { href: f.href, etag: f.etag, hash: fnv(VCard.serializeGroup(g, f.card.members, { noRev: true })) };
      pulled++;
    }
    for (const g of [...db.groups]) {
      if (!g.sync?.href || rmap.has(g.sync.href)) continue;
      if (isDirty(g, groupCard(g))) g.sync = null;
      else { db.groups = db.groups.filter(x => x !== g); db.contacts.forEach(c => c.groups = (c.groups || []).filter(x => x !== g.id)); if (view === g.id) view = 'all'; removed++; }
    }

    // 6) lokale Änderungen hochladen (erst Kontakte, dann Gruppen)
    const pushItem = async (item, card, name) => {
      const h = fnv(card);
      if (item.sync?.href && item.sync.hash === h) return;
      const href = item.sync?.href || (book + encodeURIComponent(item.uid) + '.vcf');
      const r = await api.put(href, withRev(card), item.sync?.href ? item.sync.etag : null);
      if (r.status >= 200 && r.status < 300) { item.sync = { href, etag: r.etag || null, hash: h }; pushed++; }
      else if (r.status === 412) item.sync = { href, etag: '__stale', hash: item.sync?.hash || '' }; // Konflikt → nächster Lauf
      else throw new Error(`Hochladen fehlgeschlagen (HTTP ${r.status}): ${name}`);
    };
    for (const c of [...db.contacts]) await pushItem(c, contactCard(c), displayName(c));
    for (const g of [...db.groups]) await pushItem(g, groupCard(g), g.name);

    // 7) fehlende ETags nachziehen
    if ([...db.contacts, ...db.groups].some(x => x.sync && !x.sync.etag)) {
      const fresh = new Map((await api.list()).map(r => [r.href, r.etag]));
      [...db.contacts, ...db.groups].forEach(x => { if (x.sync && !x.sync.etag) x.sync.etag = fresh.get(x.sync.href) || '__stale'; });
    }
    db.lastSync = Date.now();
    if (pulled || pushed || removed) toast(`iCloud: ${[pulled && `${pulled} empfangen`, pushed && `${pushed} gesendet`, removed && `${removed} entfernt`].filter(Boolean).join(', ')}`);
  } catch (e) {
    syncState.error = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    window.api.log('Sync-Fehler: ' + syncState.error);
  } finally {
    syncState.busy = false;
    save(true);
    if (draft) { renderSidebar(); renderList(); } else renderAll();
    renderSync();
    if (syncState.again) { syncState.again = false; scheduleSync(1000); }
  }
}

function renderSync() {
  const dot = $('#sync-dot'), txt = $('#sync-text');
  $('#btn-sync').classList.toggle('hidden', !syncState.connected);
  $('#btn-sync').classList.toggle('spin', syncState.busy);
  dot.className = 'dot ' + (!syncState.connected ? 'off' : syncState.busy ? 'busy' : syncState.error ? 'err' : '');
  if (!syncState.connected) txt.textContent = 'iCloud nicht verbunden';
  else if (syncState.busy) txt.textContent = 'Synchronisiere…';
  else if (syncState.error) txt.textContent = 'Fehler: ' + syncState.error;
  else if (db.lastSync) {
    const min = Math.round((Date.now() - db.lastSync) / 60000);
    txt.textContent = 'iCloud · ' + (min < 1 ? 'aktuell' : min < 60 ? `vor ${min} Min.` : new Date(db.lastSync).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }));
  } else txt.textContent = 'iCloud verbunden';
  $('#sync-box').title = syncState.error || (syncState.connected ? `Verbunden als ${syncState.appleId}` : 'Klicken, um iCloud zu verbinden');
}
$('#sync-box').addEventListener('click', e => { if (e.target.id === 'btn-sync') { runSync(); return; } openIcloudDialog(); });

function openIcloudDialog() {
  $('#dlg-back').classList.remove('hidden');
  $('#dlg-connected').classList.toggle('hidden', !syncState.connected);
  $('#dlg-form').classList.toggle('hidden', syncState.connected);
  $('#dlg-user').textContent = syncState.appleId;
  $('#dlg-err').classList.add('hidden'); $('#dlg-pw').value = '';
  if (!syncState.connected) setTimeout(() => ($('#dlg-id').value ? $('#dlg-pw') : $('#dlg-id')).focus(), 0);
}
function closeIcloudDialog() { $('#dlg-back').classList.add('hidden'); }
$('#dlg-cancel').addEventListener('click', closeIcloudDialog);
$('#dlg-close2').addEventListener('click', closeIcloudDialog);
$('#dlg-back').addEventListener('mousedown', e => { if (e.target.id === 'dlg-back') closeIcloudDialog(); });
$('#dlg-back').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') closeIcloudDialog(); if (e.key === 'Enter' && !$('#dlg-form').classList.contains('hidden')) $('#dlg-connect').click(); });
$('#dlg-link').addEventListener('click', () => window.api.openExternal('https://account.apple.com/account/manage'));
$('#dlg-connect').addEventListener('click', async () => {
  const id = $('#dlg-id').value.trim(), pw = $('#dlg-pw').value.trim(), btn = $('#dlg-connect'), err = $('#dlg-err');
  if (!id || !pw) { err.textContent = 'Bitte Apple-ID und app-spezifisches Passwort eingeben.'; err.classList.remove('hidden'); return; }
  btn.disabled = true; btn.textContent = 'Verbinde…'; err.classList.add('hidden');
  try {
    const st = await window.api.icloud.connect(id, pw);
    syncState.connected = true; syncState.appleId = st.appleId; closeIcloudDialog(); renderSync(); runSync();
  } catch (e) {
    err.textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); err.classList.remove('hidden');
  } finally { btn.disabled = false; btn.textContent = 'Verbinden'; }
});
$('#dlg-disconnect').addEventListener('click', async () => {
  if (!(await window.api.confirm({ message: 'Verbindung zu iCloud trennen?', detail: 'Die Kontakte bleiben auf diesem PC erhalten. Bei erneuter Verbindung werden sie wieder abgeglichen.', ok: 'Trennen' }))) return;
  await window.api.icloud.disconnect();
  db.contacts.forEach(c => delete c.sync); db.groups.forEach(g => delete g.sync); db.tombstones = []; db.lastSync = 0;
  syncState.connected = false; syncState.error = ''; save(true); closeIcloudDialog(); renderSync();
});
