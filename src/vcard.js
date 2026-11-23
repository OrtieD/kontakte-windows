// vCard 2.1 / 3.0 / 4.0 Parser + vCard 3.0 Writer + CSV-Export
(function () {
  const LABELS = {
    tel: { CELL: 'Mobil', IPHONE: 'iPhone', HOME: 'Privat', WORK: 'Arbeit', MAIN: 'Hauptnummer', FAX: 'Fax', PAGER: 'Pager', OTHER: 'Andere' },
    email: { HOME: 'Privat', WORK: 'Arbeit', OTHER: 'Andere', ICLOUD: 'iCloud' },
    adr: { HOME: 'Privat', WORK: 'Arbeit', OTHER: 'Andere' },
    url: { HOME: 'Privat', WORK: 'Arbeit', HOMEPAGE: 'Homepage', OTHER: 'Andere' }
  };
  const REV = {};
  for (const k in LABELS) { REV[k] = {}; for (const t in LABELS[k]) REV[k][LABELS[k][t]] = t; }

  function unescape(s) { return s.replace(/\\n/gi, '\n').replace(/\\([,;\\:])/g, '$1'); }
  function esc(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1'); }
  function splitUnescaped(s, ch) {
    const out = []; let cur = '';
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '\\' && i + 1 < s.length) { cur += s[i] + s[i + 1]; i++; continue; }
      if (s[i] === ch) { out.push(cur); cur = ''; } else cur += s[i];
    }
    out.push(cur); return out;
  }
  function decodeQP(s, charset) {
    const bytes = [];
    s = s.replace(/=\r?\n/g, '');
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '=' && /^[0-9A-F]{2}$/i.test(s.substr(i + 1, 2))) { bytes.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; }
      else bytes.push(s.charCodeAt(i) & 0xff);
    }
    try { return new TextDecoder(charset || 'utf-8').decode(new Uint8Array(bytes)); } catch (_) { return new TextDecoder().decode(new Uint8Array(bytes)); }
  }

  function unfold(text) {
    const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const lines = [];
    for (const l of raw) {
      if (/^[ \t]/.test(l) && lines.length) lines[lines.length - 1] += l.slice(1);
      else if (lines.length && /ENCODING=QUOTED-PRINTABLE/i.test(lines[lines.length - 1]) && /=$/.test(lines[lines.length - 1])) lines[lines.length - 1] = lines[lines.length - 1].slice(0, -1) + l;
      else lines.push(l);
    }
    return lines.filter(l => l.trim());
  }

  function parseLine(line) {
    let idx = -1, inQ = false;
    for (let i = 0; i < line.length; i++) { if (line[i] === '"') inQ = !inQ; if (line[i] === ':' && !inQ) { idx = i; break; } }
    if (idx < 0) return null;
    const head = line.slice(0, idx); let value = line.slice(idx + 1);
    const parts = head.split(';');
    let name = parts.shift(); let group = '';
    if (name.includes('.')) { [group, name] = [name.slice(0, name.lastIndexOf('.')), name.slice(name.lastIndexOf('.') + 1)]; }
    name = name.toUpperCase();
    const params = { TYPE: [] };
    for (const p of parts) {
      const eq = p.indexOf('=');
      if (eq < 0) { params.TYPE.push(p.toUpperCase()); continue; }
      const k = p.slice(0, eq).toUpperCase(); const v = p.slice(eq + 1).replace(/^"|"$/g, '');
      if (k === 'TYPE') params.TYPE.push(...v.split(',').map(x => x.toUpperCase()));
      else params[k] = v;
    }
    if ((params.ENCODING || '').toUpperCase() === 'QUOTED-PRINTABLE') value = decodeQP(value, params.CHARSET);
    return { group, name, params, value, raw: line };
  }

  function labelFor(kind, types, abLabel) {
    if (abLabel) {
      const m = abLabel.match(/^_\$!<(.+)>!\$_$/);
      const l = m ? m[1] : abLabel;
      const map = { Mobile: 'Mobil', Home: 'Privat', Work: 'Arbeit', Main: 'Hauptnummer', Other: 'Andere', HomePage: 'Homepage', iPhone: 'iPhone' };
      return map[l] || l;
    }
    const t = types.filter(x => !['PREF', 'VOICE', 'INTERNET', 'X400'].includes(x));
    if (kind === 'tel' && t.includes('FAX')) return 'Fax';
    if (kind === 'tel' && t.includes('CELL')) return 'Mobil';
    for (const x of t) if (LABELS[kind] && LABELS[kind][x]) return LABELS[kind][x];
    return kind === 'tel' ? 'Mobil' : kind === 'url' ? 'Homepage' : 'Privat';
  }

  function parse(text) {
    const lines = unfold(text);
    const contacts = []; let cur = null; let props = [];
    for (const line of lines) {
      if (/^BEGIN:VCARD/i.test(line)) { cur = {}; props = []; continue; }
      if (/^END:VCARD/i.test(line)) { if (cur !== null) contacts.push(build(props)); cur = null; continue; }
      if (cur === null) continue;
      const p = parseLine(line); if (p) props.push(p);
    }
    return contacts;
  }

  function build(props) {
    const c = { firstName: '', lastName: '', middleName: '', prefix: '', suffix: '', nickname: '', company: '', department: '', jobTitle: '',
      phones: [], emails: [], urls: [], addresses: [], birthday: '', notes: '', photo: '', groupNames: [] };
    const abLabels = {};
    props.filter(p => p.name === 'X-ABLABEL').forEach(p => { abLabels[p.group] = unescape(p.value); });
    const HANDLED = new Set(['N', 'FN', 'NICKNAME', 'ORG', 'TITLE', 'TEL', 'EMAIL', 'URL', 'ADR', 'BDAY', 'NOTE', 'CATEGORIES', 'PHOTO', 'X-ABSHOWAS', 'VERSION', 'UID', 'REV', 'PRODID', 'X-ABLABEL', 'BEGIN', 'END', 'X-ADDRESSBOOKSERVER-KIND', 'X-ADDRESSBOOKSERVER-MEMBER']);
    const extraGroups = new Set(props.filter(p => p.group && !HANDLED.has(p.name)).map(p => p.group));
    c.extra = props.filter(p => !HANDLED.has(p.name) || (p.name === 'X-ABLABEL' && extraGroups.has(p.group)))
      .map(p => p.group ? p.raw.replace(/^[^.]+\./, 'k' + p.group.replace(/[^\w-]/g, '') + '.') : p.raw);
    const kind = props.find(p => p.name === 'X-ADDRESSBOOKSERVER-KIND');
    const uidP = props.find(p => p.name === 'UID'); if (uidP) c.uid = unescape(uidP.value.trim()).replace(/^urn:uuid:/i, '');
    const revP = props.find(p => p.name === 'REV'); if (revP) c.rev = parseRev(revP.value.trim());
    if (kind && /group/i.test(kind.value)) {
      const fnP = props.find(p => p.name === 'FN'); const nP = props.find(p => p.name === 'N');
      return { kind: 'group', uid: c.uid, rev: c.rev, name: unescape((fnP || nP || { value: 'Gruppe' }).value).replace(/;+$/, ''),
        members: props.filter(p => p.name === 'X-ADDRESSBOOKSERVER-MEMBER').map(p => p.value.trim().replace(/^urn:uuid:/i, '')), extra: c.extra };
    }
    let fn = '';
    for (const p of props) {
      const lab = (k) => labelFor(k, p.params.TYPE, p.group ? abLabels[p.group] : '');
      switch (p.name) {
        case 'N': { const n = splitUnescaped(p.value, ';').map(unescape); c.lastName = n[0] || ''; c.firstName = n[1] || ''; c.middleName = n[2] || ''; c.prefix = n[3] || ''; c.suffix = n[4] || ''; break; }
        case 'FN': fn = unescape(p.value); break;
        case 'NICKNAME': c.nickname = unescape(p.value); break;
        case 'ORG': { const o = splitUnescaped(p.value, ';').map(unescape); c.company = o[0] || ''; c.department = o.slice(1).filter(Boolean).join(', '); break; }
        case 'TITLE': c.jobTitle = unescape(p.value); break;
        case 'TEL': c.phones.push({ label: lab('tel'), value: unescape(p.value).replace(/^tel:/i, '') }); break;
        case 'EMAIL': c.emails.push({ label: lab('email'), value: unescape(p.value).replace(/^mailto:/i, '') }); break;
        case 'URL': c.urls.push({ label: lab('url'), value: unescape(p.value) }); break;
        case 'ADR': { const a = splitUnescaped(p.value, ';').map(unescape);
          c.addresses.push({ label: lab('adr'), street: [a[1], a[2]].filter(Boolean).join('\n'), city: a[3] || '', region: a[4] || '', zip: a[5] || '', country: a[6] || '' }); break; }
        case 'BDAY': { const v = p.value.trim(); let m = v.match(/^(\d{4})-?(\d{2})-?(\d{2})/); if (m) c.birthday = `${m[1]}-${m[2]}-${m[3]}`;
          else if ((m = v.match(/^--(\d{2})-?(\d{2})/))) c.birthday = `1604-${m[1]}-${m[2]}`; break; }
        case 'NOTE': c.notes = unescape(p.value); break;
        case 'CATEGORIES': c.groupNames.push(...splitUnescaped(p.value, ',').map(unescape).map(s => s.trim()).filter(Boolean)); break;
        case 'PHOTO': {
          const v = p.value.trim();
          if (/^data:/i.test(v)) c.photo = v;
          else if ((p.params.ENCODING || '').toUpperCase() === 'B' || (p.params.ENCODING || '').toUpperCase() === 'BASE64' || p.params.TYPE.some(t => ['JPEG', 'PNG', 'GIF'].includes(t))) {
            const t = (p.params.TYPE.find(t => ['JPEG', 'PNG', 'GIF'].includes(t)) || 'JPEG').toLowerCase();
            c.photo = `data:image/${t};base64,${v.replace(/\s/g, '')}`;
          }
          break;
        }
        case 'X-ABSHOWAS': if (/COMPANY/i.test(p.value)) c.isCompany = true; break;
      }
    }
    if (!c.photo) props.filter(p => p.name === 'PHOTO').forEach(p => c.extra.push(p.raw));
    if (!c.firstName && !c.lastName && fn && !c.company) { const parts = fn.split(' '); c.lastName = parts.length > 1 ? parts.pop() : fn; c.firstName = parts.join(' '); }
    if (!c.firstName && !c.lastName && !fn && c.company) c.isCompany = true;
    return c;
  }

  function parseRev(v) {
    const m = v.match(/^(\d{4})-?(\d{2})-?(\d{2})(?:T(\d{2}):?(\d{2}):?(\d{2}))?/);
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) : 0;
  }
  function fold(line) {
    // 75 Oktette je Zeile; vereinfacht nach Zeichen (UTF-8-sicher genug für Apple/Google/Outlook)
    const out = []; let s = line;
    while (s.length > 74) { out.push(s.slice(0, 74)); s = ' ' + s.slice(74); }
    out.push(s); return out.join('\r\n');
  }

  function serialize(c, groupNames, opts = {}) {
    const L = ['BEGIN:VCARD', 'VERSION:3.0'];
    if (c.uid) L.push(`UID:${c.uid}`);
    L.push(`N:${[c.lastName, c.firstName, c.middleName, c.prefix, c.suffix].map(esc).join(';')}`);
    const fn = [c.prefix, c.firstName, c.middleName, c.lastName, c.suffix].filter(Boolean).join(' ') || c.company || '';
    L.push(`FN:${esc(fn)}`);
    if (c.nickname) L.push(`NICKNAME:${esc(c.nickname)}`);
    if (c.company || c.department) L.push(`ORG:${esc(c.company)}${c.department ? ';' + esc(c.department) : ''}`);
    if (c.jobTitle) L.push(`TITLE:${esc(c.jobTitle)}`);
    let item = 1;
    const typed = (prop, kind, entry, value) => {
      const t = REV[kind][entry.label];
      if (t) return `${prop};TYPE=${kind === 'email' ? 'INTERNET,' : ''}${t === 'IPHONE' ? 'IPHONE,CELL' : t}:${value}`;
      const g = `item${item++}`;
      L.push(`${g}.X-ABLabel:${esc(entry.label)}`);
      return `${g}.${prop}${kind === 'email' ? ';TYPE=INTERNET' : ''}:${value}`;
    };
    (c.phones || []).filter(x => x.value).forEach(x => L.push(typed('TEL', 'tel', x, esc(x.value))));
    (c.emails || []).filter(x => x.value).forEach(x => L.push(typed('EMAIL', 'email', x, esc(x.value))));
    (c.urls || []).filter(x => x.value).forEach(x => L.push(typed('URL', 'url', x, esc(x.value))));
    (c.addresses || []).filter(a => a.street || a.city || a.zip || a.country).forEach(a => {
      L.push(typed('ADR', 'adr', a, ['', '', a.street, a.city, a.region, a.zip, a.country].map(esc).join(';')));
    });
    if (c.birthday) L.push(c.birthday.startsWith('1604-') ? `BDAY;X-APPLE-OMIT-YEAR=1604:${c.birthday}` : `BDAY;VALUE=date:${c.birthday}`);
    if (c.notes) L.push(`NOTE:${esc(c.notes)}`);
    if (groupNames && groupNames.length) L.push(`CATEGORIES:${groupNames.map(esc).join(',')}`);
    if (c.isCompany) L.push('X-ABShowAs:COMPANY');
    (c.extra || []).filter(x => !(c.photo && /^PHOTO[;:]/i.test(x))).forEach(x => L.push(x));
    if (c.photo) { const m = c.photo.match(/^data:image\/(\w+);base64,(.*)$/); if (m) L.push(`PHOTO;ENCODING=b;TYPE=${m[1].toUpperCase()}:${m[2]}`); }
    if (!opts.noRev) L.push(`REV:${new Date(c.updated || Date.now()).toISOString().replace(/\.\d+Z$/, 'Z')}`);
    L.push('END:VCARD');
    return L.map(l => (c.extra || []).includes(l) ? l : fold(l)).join('\r\n') + '\r\n';
  }

  function serializeGroup(g, memberUids, opts = {}) {
    const L = ['BEGIN:VCARD', 'VERSION:3.0', `UID:${g.uid}`, `N:${esc(g.name)}`, `FN:${esc(g.name)}`, 'X-ADDRESSBOOKSERVER-KIND:group'];
    [...memberUids].sort().forEach(u => L.push(`X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:${u}`));
    (g.extra || []).forEach(x => L.push(x));
    if (!opts.noRev) L.push(`REV:${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}`);
    L.push('END:VCARD');
    return L.join('\r\n') + '\r\n';
  }

  function toCSV(contacts, groupNameFn) {
    const cols = ['Vorname', 'Nachname', 'Firma', 'Abteilung', 'Position', 'Telefon 1', 'Telefon 2', 'Telefon 3', 'E-Mail 1', 'E-Mail 2', 'Straße', 'PLZ', 'Ort', 'Land', 'Webseite', 'Geburtstag', 'Gruppen', 'Notizen'];
    const q = v => { v = String(v ?? ''); return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const rows = [cols.join(';')];
    for (const c of contacts) {
      const a = (c.addresses || [])[0] || {};
      const ph = (c.phones || []).map(p => p.value), em = (c.emails || []).map(e => e.value);
      rows.push([c.firstName, c.lastName, c.company, c.department, c.jobTitle, ph[0], ph[1], ph[2], em[0], em[1], a.street, a.zip, a.city, a.country,
        ((c.urls || [])[0] || {}).value, c.birthday && !c.birthday.startsWith('1604-') ? c.birthday : '', groupNameFn(c).join(', '), c.notes].map(q).join(';'));
    }
    return rows.join('\r\n');
  }

  // CSV-Import (Outlook/Google/eigener Export) – erkennt Spalten heuristisch
  function parseCSV(text) {
    text = text.replace(/^\ufeff/, '');
    const first = text.split(/\r?\n/)[0] || '';
    const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
    const rows = []; let row = [], cur = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') inQ = false; else cur += ch; continue; }
      if (ch === '"') inQ = true; else if (ch === sep) { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    if (rows.length < 2) return [];
    const head = rows[0].map(h => h.trim().toLowerCase());
    const find = (...keys) => head.findIndex(h => keys.some(k => h === k || h.startsWith(k)));
    const idx = {
      fn: find('vorname', 'first name', 'given name'), ln: find('nachname', 'last name', 'family name'), co: find('firma', 'company', 'organization 1 - name', 'organisation'),
      dep: find('abteilung', 'department'), job: find('position', 'job title', 'organization 1 - title'), street: find('straße', 'strasse', 'business street', 'home street', 'address 1 - street'),
      zip: find('plz', 'postleitzahl', 'business postal code', 'home postal code', 'address 1 - postal code'), city: find('ort', 'stadt', 'business city', 'home city', 'address 1 - city'),
      country: find('land', 'country', 'business country', 'address 1 - country'), web: find('webseite', 'web page', 'website 1 - value'), bday: find('geburtstag', 'birthday'), notes: find('notizen', 'notes'),
      groups: find('gruppen', 'categories', 'group membership')
    };
    const phoneCols = head.map((h, i) => /telefon|phone|mobil|handy/.test(h) && !/type|typ/.test(h) ? i : -1).filter(i => i >= 0);
    const mailCols = head.map((h, i) => /e-?mail/.test(h) && !/type|typ|display/.test(h) ? i : -1).filter(i => i >= 0);
    const g = (r, i) => (i >= 0 ? (r[i] || '').trim() : '');
    return rows.slice(1).filter(r => r.some(x => x && x.trim())).map(r => {
      const c = { firstName: g(r, idx.fn), lastName: g(r, idx.ln), company: g(r, idx.co), department: g(r, idx.dep), jobTitle: g(r, idx.job),
        phones: phoneCols.map(i => ({ label: /mobil|mobile|handy|cell/.test(head[i]) ? 'Mobil' : /gesch|business|work|arbeit/.test(head[i]) ? 'Arbeit' : 'Privat', value: g(r, i) })).filter(p => p.value),
        emails: mailCols.map(i => ({ label: /gesch|business|work|arbeit/.test(head[i]) ? 'Arbeit' : 'Privat', value: g(r, i) })).filter(e => e.value),
        urls: g(r, idx.web) ? [{ label: 'Homepage', value: g(r, idx.web) }] : [], addresses: [], birthday: '', notes: g(r, idx.notes), photo: '',
        groupNames: g(r, idx.groups).split(/[,:]{1,3}/).map(s => s.replace(/\*/g, '').trim()).filter(s => s && !/^mycontacts$/i.test(s)) };
      if (g(r, idx.street) || g(r, idx.city) || g(r, idx.zip)) c.addresses.push({ label: 'Arbeit', street: g(r, idx.street), zip: g(r, idx.zip), city: g(r, idx.city), region: '', country: g(r, idx.country) });
      const b = g(r, idx.bday); let m;
      if ((m = b.match(/^(\d{4})-(\d{2})-(\d{2})/))) c.birthday = `${m[1]}-${m[2]}-${m[3]}`;
      else if ((m = b.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/))) c.birthday = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      if (!c.firstName && !c.lastName && c.company) c.isCompany = true;
      return c;
    });
  }

  window.VCard = { parse, serialize, serializeGroup, toCSV, parseCSV };
})();
