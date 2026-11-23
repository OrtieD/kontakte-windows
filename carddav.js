// Minimaler CardDAV-Client (iCloud-tauglich) für den Main-Prozess
'use strict';

const ICLOUD = process.env.KONTAKTE_DAV_URL || 'https://contacts.icloud.com/';

function unxml(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}
function xesc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
const tag = (name) => new RegExp(`<(?:[\\w-]+:)?${name}(?=[\\s/>])[^>]*?(?:/>|>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>)`, 'i');

function parseMultistatus(xml) {
  const out = [];
  const re = /<(?:[\w-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?response>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const body = m[1];
    const href = (body.match(tag('href')) || [])[1];
    if (!href) continue;
    // nur propstats mit Status 200 auswerten
    const okProps = [];
    const psRe = /<(?:[\w-]+:)?propstat\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?propstat>/gi; let p;
    while ((p = psRe.exec(body))) { const st = (p[1].match(tag('status')) || [])[1] || ''; if (/\s200\s/.test(st + ' ') || / 200/.test(st)) okProps.push(p[1]); }
    const props = okProps.join('\n') || body;
    const get = (n) => { const r = props.match(tag(n)); return r ? unxml((r[1] || '').trim()) : null; };
    out.push({
      href: unxml(href.trim()),
      etag: get('getetag'),
      data: get('address-data'),
      isCollection: /<(?:[\w-]+:)?collection(?=[\s\/>])[^>]*\/?>/i.test(props),
      isAddressbook: /<(?:[\w-]+:)?addressbook(?=[\s\/>])[^>]*\/?>/i.test(props),
      displayName: get('displayname'),
      principal: (() => { const r = props.match(tag('current-user-principal')); return r && r[1] ? unxml((r[1].match(tag('href')) || [])[1] || '') : null; })(),
      home: (() => { const r = props.match(tag('addressbook-home-set')); return r && r[1] ? unxml((r[1].match(tag('href')) || [])[1] || '') : null; })()
    });
  }
  return out;
}

class CardDAV {
  constructor(user, pass) { this.auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'); }

  async req(method, url, { body, headers = {}, depth } = {}) {
    let target = url;
    for (let i = 0; i < 6; i++) {
      const h = { Authorization: this.auth, 'User-Agent': 'Kontakte-Windows/1.0', ...headers };
      if (depth !== undefined) h.Depth = String(depth);
      if (body && !h['Content-Type']) h['Content-Type'] = 'application/xml; charset=utf-8';
      const res = await fetch(target, { method, headers: h, body, redirect: 'manual' });
      if ([301, 302, 307, 308].includes(res.status) && res.headers.get('location')) { target = new URL(res.headers.get('location'), target).href; continue; }
      const text = await res.text();
      if (res.status === 401) { const e = new Error('Anmeldung fehlgeschlagen – Apple-ID oder app-spezifisches Passwort prüfen.'); e.code = 401; throw e; }
      return { status: res.status, text, etag: res.headers.get('etag'), url: target };
    }
    throw new Error('Zu viele Weiterleitungen');
  }

  async discover() {
    let r = await this.req('PROPFIND', ICLOUD, { depth: 0, body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>' });
    const principal = parseMultistatus(r.text).map(x => x.principal).find(Boolean);
    if (!principal) throw new Error(`iCloud-Konto nicht gefunden (HTTP ${r.status}).`);
    const pUrl = new URL(principal, r.url).href;
    r = await this.req('PROPFIND', pUrl, { depth: 0, body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav"><d:prop><c:addressbook-home-set/></d:prop></d:propfind>' });
    const home = parseMultistatus(r.text).map(x => x.home).find(Boolean);
    if (!home) throw new Error('Adressbuch-Verzeichnis nicht gefunden.');
    const homeUrl = new URL(home, r.url).href;
    r = await this.req('PROPFIND', homeUrl, { depth: 1, body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:displayname/></d:prop></d:propfind>' });
    let books = parseMultistatus(r.text).filter(x => x.isAddressbook).map(x => ({ url: new URL(x.href, r.url).href, name: x.displayName || 'Kontakte' }));
    if (!books.length) {
      // Fallback: iCloud-Standardadressbuch „card“ direkt prüfen
      const cardUrl = new URL('card/', homeUrl).href;
      const t = await this.req('PROPFIND', cardUrl, { depth: 0, body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>' });
      if (t.status === 207) books = [{ url: cardUrl, name: 'card' }];
    }
    if (!books.length) throw new Error(`Kein Adressbuch im iCloud-Konto gefunden (HTTP ${r.status}).`);
    return { home: homeUrl, book: (books.find(b => /\/card\/?$/.test(b.url)) || books[0]).url };
  }

  async list(book) {
    const r = await this.req('PROPFIND', book, { depth: 1, body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/><d:resourcetype/></d:prop></d:propfind>' });
    if (r.status >= 400) throw new Error(`Liste fehlgeschlagen (HTTP ${r.status})`);
    return parseMultistatus(r.text).filter(x => !x.isCollection && x.etag).map(x => ({ href: new URL(x.href, book).pathname, etag: x.etag }));
  }

  async multiget(book, hrefs) {
    const out = [];
    for (let i = 0; i < hrefs.length; i += 80) {
      const chunk = hrefs.slice(i, i + 80);
      const body = `<?xml version="1.0"?><c:addressbook-multiget xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav"><d:prop><d:getetag/><c:address-data/></d:prop>${chunk.map(h => `<d:href>${xesc(h)}</d:href>`).join('')}</c:addressbook-multiget>`;
      const r = await this.req('REPORT', book, { depth: 1, body });
      if (r.status >= 400) throw new Error(`Abruf fehlgeschlagen (HTTP ${r.status})`);
      parseMultistatus(r.text).filter(x => x.data).forEach(x => out.push({ href: new URL(x.href, book).pathname, etag: x.etag, data: x.data }));
    }
    return out;
  }

  async put(book, href, data, etag) {
    const url = new URL(href, book).href;
    const headers = { 'Content-Type': 'text/vcard; charset=utf-8' };
    if (etag) headers['If-Match'] = etag; else headers['If-None-Match'] = '*';
    const r = await this.req('PUT', url, { body: data, headers });
    return { status: r.status, etag: r.etag };
  }

  async del(book, href, etag) {
    const r = await this.req('DELETE', new URL(href, book).href, { headers: etag ? { 'If-Match': etag } : {} });
    return { status: r.status };
  }
}

module.exports = { CardDAV, parseMultistatus };
