// Storage for Kindred. Uses Firebase Firestore when config.js is filled in,
// otherwise a demo store in this browser only.
import config from './config.js';

export const GAP_MS = 4 * 60 * 60 * 1000; // one check-in per 4 hours
const HISTORY = 200;   // enough for a month even at the fastest pace
const KEEP_MS = 35 * 864e5; // trends only go back a month
const key = (n) => String(n || '').trim().toLowerCase();
export const cleanName = (n) => String(n || '').trim().replace(/\s+/g, ' ');

// ---------- input rules ----------
// Names: 1 to 20 letters or numbers, plus spaces, hyphens, apostrophes and full stops.
export const NAME_MAX = 20, NICK_MAX = 20, WISH_MAX = 40;
const NAME_RE = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} .'\u2019-]*$/u;
// Nicknames may also have emoji.
const NICK_RE = /^[\p{L}\p{M}\p{N}\p{Extended_Pictographic}\u200d\ufe0f .'\u2019-]+$/u;
// Wishes may have normal punctuation, but none of the characters often used in attacks.
const RISKY_RE = /[<>{}\[\]`\\|$;=&"\u0000-\u001f\u007f]/;
const len = (t) => [...t].length;
export function checkName(n) {
  if (!n) return 'Please type a name.';
  if (len(n) > NAME_MAX) return `Names can be up to ${NAME_MAX} characters.`;
  if (!NAME_RE.test(n)) return 'Names can use letters, numbers, spaces, hyphens, apostrophes and full stops.';
  return '';
}
export function checkNick(n) {
  if (len(n) > NICK_MAX) return `Nicknames can be up to ${NICK_MAX} characters.`;
  // "<3" is allowed as a heart; it's shown as text, never as code.
  if (n && !NICK_RE.test(n.replace(/<3/g, ''))) return 'Nicknames can use letters, numbers, emoji, <3, spaces, hyphens, apostrophes and full stops.';
  return '';
}
export function checkWish(w) {
  if (len(w) > WISH_MAX) return `Wishes can be up to ${WISH_MAX} characters.`;
  if (RISKY_RE.test(w)) return 'Wishes can\u2019t use < > { } [ ] ` \\ | $ ; = & or ".';
  return '';
}

function fail(msg, status, data) { const e = new Error(msg); e.status = status; e.data = data; throw e; }

export async function makeBackend() {
  return config && config.apiKey ? firebaseStore(config) : demoStore();
}

// Each person is one document:
// { name, partner, lastAt,
//   entries: [{ at, sickness, sleep, stress, affection, wishes }],
//   seen:    { entryAt, at }        I saw my partner's check-in from entryAt
//   granted: { entryAt, wishes }    wishes of my own check-in (entryAt) that my partner granted
//   nickname: { for, text }         what I call my partner (only shown in my app) }
async function firebaseStore(cfg) {
  const V = '13.4.0';
  const { initializeApp } = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`);
  const fs = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`);
  const db = fs.getFirestore(initializeApp(cfg));
  const ref = (n) => fs.doc(db, 'people', key(n));
  return {
    demo: false,
    async list() { const s = await fs.getDocs(fs.collection(db, 'people')); return s.docs.map((d) => d.data()); },
    async get(n) { const s = await fs.getDoc(ref(n)); return s.exists() ? s.data() : null; },
    async create(n) { await fs.setDoc(ref(n), { name: n, partner: null, entries: [], lastAt: null }); },
    async setPartner(n, partner) { await fs.updateDoc(ref(n), { partner }); },
    async addEntry(n, entries) { await fs.updateDoc(ref(n), { entries, lastAt: fs.serverTimestamp() }); },
    async setField(n, field, value) { await fs.updateDoc(ref(n), { [field]: value }); },
    async remove(n) { await fs.deleteDoc(ref(n)); },
    watch(n, cb) { return fs.onSnapshot(ref(n), cb, () => {}); },
  };
}

function demoStore() {
  const K = 'kindred.demo';
  const read = () => { try { return JSON.parse(localStorage.getItem(K)) || {}; } catch (e) { return {}; } };
  const write = (d) => { try { localStorage.setItem(K, JSON.stringify(d)); } catch (e) {} };
  const upd = (n, f) => { const d = read(); f(d[key(n)]); write(d); };
  return {
    demo: true,
    async list() { return Object.values(read()); },
    async get(n) { return read()[key(n)] || null; },
    async create(n) { const d = read(); d[key(n)] = { name: n, partner: null, entries: [], lastAt: null }; write(d); },
    async setPartner(n, partner) { upd(n, (p) => { p.partner = partner; }); },
    async addEntry(n, entries) { upd(n, (p) => { p.entries = entries; p.lastAt = Date.now(); }); },
    async setField(n, field, value) { upd(n, (p) => { p[field] = value; }); },
    async remove(n) { const d = read(); delete d[key(n)]; write(d); },
    watch() { return () => {}; },
  };
}

// The same small API the page used to call on the server.
export function makeApi(B) {
  const view = (p) => p && { name: p.name, latest: p.entries[p.entries.length - 1] || null, history: p.entries,
    seen: p.seen || null, granted: p.granted || null };
  async function state(name) {
    const me = await B.get(name);
    if (!me) fail('Unknown name. Please sign in again.', 404);
    const partner = me.partner ? await B.get(me.partner) : null;
    const mutual = !!(partner && key(partner.partner) === key(me.name));
    const last = me.entries[me.entries.length - 1];
    const nick = me.nickname && partner && key(me.nickname.for) === key(partner.name) ? me.nickname.text : '';
    return {
      me: view(me),
      nickname: nick,
      // Only show a partner's levels once they have picked you back.
      partner: partner ? (mutual ? view(partner) : { name: partner.name, latest: null, history: [], seen: null, granted: null }) : null,
      partnerPicksYou: mutual,
      nextCheckInAt: last ? last.at + GAP_MS : 0,
    };
  }
  return async function api(path, body = {}) {
    const [p, q] = path.split('?');
    const name = cleanName(body.name || new URLSearchParams(q).get('name'));
    if (p === 'people') return { people: (await B.list()).map((x) => x.name).sort((a, b) => a.localeCompare(b)) };
    if (p === 'login') {
      if (!(await B.get(name))) {
        const bad = checkName(name);
        if (bad) fail(bad, 400);
        await B.create(name);
      }
      return state(name);
    }
    if (p === 'state') return state(name);
    if (p === 'partner') {
      const partner = body.partner ? await B.get(body.partner) : null;
      if (body.partner && !partner) fail('That person has not signed in yet.', 404);
      if (partner && key(partner.name) === key(name)) fail('Pick someone other than yourself.', 400);
      await B.setPartner(name, partner ? partner.name : null);
      return state(name);
    }
    if (p === 'checkin') {
      const me = await B.get(name);
      if (!me) fail('Unknown name. Please sign in again.', 404);
      const last = me.entries[me.entries.length - 1];
      if (last && Date.now() - last.at < GAP_MS) fail('You can check in again a little later.', 429);
      const entry = { at: Date.now() };
      for (const m of ['sickness', 'sleep', 'stress', 'affection']) {
        const v = Math.round(Number(body[m]));
        if (!Number.isFinite(v) || v < 0 || v > 100) fail('Levels must be 0 to 100.', 400);
        entry[m] = v;
      }
      // Optional wishes: up to 3 short texts.
      const wishes = (Array.isArray(body.wishes) ? body.wishes : []).map((w) => String(w).trim()).filter(Boolean).slice(0, 3);
      for (const w of wishes) { const bad = checkWish(w); if (bad) fail(bad, 400); }
      entry.wishes = wishes;
      const keep = me.entries.filter((e) => Date.now() - e.at < KEEP_MS);
      await B.addEntry(name, [...keep, entry].slice(-HISTORY));
      return state(name);
    }
    if (p === 'nickname') {
      // Only stored in my own document and only shown in my app.
      const me = await B.get(name);
      if (!me || !me.partner) fail('Pick your partner first.', 400);
      const text = cleanName(body.nickname);
      const bad = checkNick(text);
      if (bad) fail(bad, 400);
      await B.setField(name, 'nickname', text ? { for: me.partner, text } : null);
      return state(name);
    }
    if (p === 'seen') {
      // "Seen you": mark that I've seen my partner's latest check-in.
      const at = Number(body.entryAt);
      if (!Number.isFinite(at)) fail('Nothing to mark as seen.', 400);
      await B.setField(name, 'seen', { entryAt: at, at: Date.now() });
      return state(name);
    }
    if (p === 'grant') {
      // Tick off one of my own wishes that my partner granted (toggle).
      const me = await B.get(name);
      const last = me && me.entries[me.entries.length - 1];
      if (!last || !(last.wishes || []).includes(body.wish)) fail('That wish is no longer open.', 400);
      const cur = me.granted && me.granted.entryAt === last.at ? me.granted.wishes : [];
      const wishes = cur.includes(body.wish) ? cur.filter((w) => w !== body.wish) : [...cur, body.wish];
      await B.setField(name, 'granted', { entryAt: last.at, wishes });
      return state(name);
    }
    // ---------- dev menu ----------
    if (p.startsWith('dev-')) {
      const me = await B.get(name);
      if (p === 'dev-reset-all') { for (const x of await B.list()) await B.remove(x.name); return { ok: true }; }
      if (p === 'dev-export') return { mode: B.demo ? 'demo' : 'firebase', people: await B.list() };
      if (!me) fail('Unknown name.', 404);
      if (p === 'dev-reset-timer') {
        // Move my latest check-in back 4 hours so I can check in again now.
        const entries = me.entries.slice();
        if (entries.length) entries[entries.length - 1] = { ...entries[entries.length - 1], at: entries[entries.length - 1].at - GAP_MS };
        await B.setField(name, 'entries', entries);
      }
      if (p === 'dev-clear-me') { await B.setField(name, 'entries', []); await B.setField(name, 'seen', null); await B.setField(name, 'granted', null); }
      if (p === 'dev-clear-social') { await B.setField(name, 'seen', null); await B.setField(name, 'granted', null); }
      if (p === 'dev-sample') {
        // A month of made-up check-ins, twice a day, ending 5 hours ago.
        const now = Date.now(), H = 3600e3, r = (lo, hi) => Math.round(lo + Math.random() * (hi - lo));
        const entries = Array.from({ length: 60 }, (_, i) => ({
          at: now - 5 * H - (59 - i) * 12 * H,
          sickness: r(0, 35), sleep: r(30, 90), stress: r(15, 75), affection: r(25, 90), wishes: [],
        }));
        await B.setField(name, 'entries', entries);
      }
      return state(name);
    }
    fail('Not found', 404);
  };
}
