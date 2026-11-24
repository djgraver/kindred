// Storage for Kindred. Uses Firebase Firestore when config.js is filled in,
// otherwise a demo store in this browser only.
import config from './config.js';

export const GAP_MS = 4 * 60 * 60 * 1000; // one check-in per 4 hours
const HISTORY = 12;
const key = (n) => String(n || '').trim().toLowerCase();
export const cleanName = (n) => String(n || '').trim().replace(/\s+/g, ' ').slice(0, 30);

function fail(msg, status, data) { const e = new Error(msg); e.status = status; e.data = data; throw e; }

export async function makeBackend() {
  return config && config.apiKey ? firebaseStore(config) : demoStore();
}

// Each person is one document: { name, partner, entries: [{at, sickness, sleep, stress, affection}], lastAt }
async function firebaseStore(cfg) {
  const V = '10.12.2';
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
    watch() { return () => {}; },
  };
}

// The same small API the page used to call on the server.
export function makeApi(B) {
  const view = (p) => p && { name: p.name, latest: p.entries[p.entries.length - 1] || null, history: p.entries };
  async function state(name) {
    const me = await B.get(name);
    if (!me) fail('Unknown name. Please sign in again.', 404);
    const partner = me.partner ? await B.get(me.partner) : null;
    const mutual = !!(partner && key(partner.partner) === key(me.name));
    const last = me.entries[me.entries.length - 1];
    return {
      me: view(me),
      // Only show a partner's levels once they have picked you back.
      partner: partner ? (mutual ? view(partner) : { name: partner.name, latest: null, history: [] }) : null,
      partnerPicksYou: mutual,
      nextCheckInAt: last ? last.at + GAP_MS : 0,
    };
  }
  return async function api(path, body = {}) {
    const [p, q] = path.split('?');
    const name = cleanName(body.name || new URLSearchParams(q).get('name'));
    if (p === 'people') return { people: (await B.list()).map((x) => x.name).sort((a, b) => a.localeCompare(b)) };
    if (p === 'login') {
      if (!name) fail('Please type a name.', 400);
      if (!(await B.get(name))) await B.create(name);
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
      const wishes = Array.isArray(body.wishes) ? body.wishes : [];
      entry.wishes = wishes.map((w) => String(w).trim().slice(0, 40)).filter(Boolean).slice(0, 3);
      await B.addEntry(name, [...me.entries, entry].slice(-HISTORY));
      return state(name);
    }
    fail('Not found', 404);
  };
}
