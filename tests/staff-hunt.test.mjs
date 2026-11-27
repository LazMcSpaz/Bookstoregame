// Staff hunt: random shops and days, checked against rules that must always hold.
// Run from the repo:  node tests/staff-hunt.test.mjs            short mode, about a minute (fixed seeds)
//                     node tests/staff-hunt.test.mjs --long     a hundred shops, about fifteen minutes
//                     node tests/staff-hunt.test.mjs --seed 37  one shop, with every finding spelled out (replay a failure)
//                     add --html <file> to hunt in another copy of index.html, --from N --count N to choose the seeds
// Needs Playwright and Chrome; THREE_JS, CHROME and PLAYWRIGHT_DIR work as in staff-jobs.test.mjs.
//
// Each seed makes one shop: 1 to 4 staff with any jobs in any order (or none), a random set of tills, café stations and shelves,
// a light or heavy stream of customers, and a day with things happening in it: jobs changed mid-task, someone hired, a staffed
// station moved or sold in build mode, the shop saved and reopened. Nothing here expects a particular outcome. The rules below
// are checked every twentieth of a second, and any break is reported with its seed and second so it can be replayed.
//
//  R1  Nobody does work from a job they have not ticked.
//  R2  Nobody stands about for more than 6 seconds while one of their ticked jobs has work nobody else is on.
//  R3  When two of a person's ticked jobs both have work, they do the higher one (allowing 6 seconds, and never breaking off a sale, a shelf run or an order being made).
//  R4  No customer waits more than 20 seconds at the front of a line, and no paid order waits more than 30 seconds, while someone who could serve them is free.
//  R5  Nobody flip-flops: a station changes hands between two staff at most 4 times in any minute.
//  R6  A job change takes effect within 2 seconds: a task from a job just switched off is dropped.
//  R7  One station, two people: someone who puts the job higher gets it within 8 seconds; someone who puts it no higher never takes it from a person minding it.
//  R8  Nothing throws, and nobody (staff or customer) is stuck with somewhere to go for more than 5 seconds.
//  R9  (added) Nobody standing still shares a tile with anyone else.
//  R10 (added) Nobody with nothing to do stands for more than 4 seconds on a tile a station is worked from.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const HTML = arg('--html') ? path.resolve(arg('--html')) : path.join(repo, 'index.html');
const LONG = argv.indexOf('--long') >= 0, ONE = arg('--seed');
const FROM = Number(arg('--from', ONE || 1)), COUNT = ONE ? 1 : Number(arg('--count', LONG ? 100 : 6));
const MINUTES = Number(arg('--minutes', LONG ? 3 : 2.5));
const THREE = process.env.THREE_JS || '';

function loadPlaywright() {
  for (const d of [here + '/', (process.env.PLAYWRIGHT_DIR || '/opt/npm-tools/node_modules') + '/']) { try { return createRequire(d)('playwright'); } catch (_) {} }
  throw new Error('Playwright not found. Install it (npm i -g playwright) or set PLAYWRIGHT_DIR.');
}
const { chromium } = loadPlaywright();
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const chromePath = process.env.CHROME || (fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);
const browser = await chromium.launch({ executablePath: chromePath, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

// ---------------- runs inside the page ----------------
function harness() {
  const S = window.__shop, P = S.peek, H = window.H = {};
  let a = 1; H.seed = n => { a = n | 0; };
  H.rnd = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const ri = n => Math.floor(H.rnd() * n), pick = l => l[ri(l.length)];
  const key = t => t.x + ',' + t.z, isStation = i => i.def.role === 'counter' || i.def.role === 'snack';
  const jobOf = i => P('jobOf')(i), who = x => S.workers.indexOf(x);
  const JOBLISTS = (() => { const all = [[]], base = ['till', 'stock', 'food'];
    const perm = (pre, rest) => { if (pre.length) all.push(pre.slice()); rest.forEach((k, i) => perm(pre.concat(k), rest.filter((_, j) => j !== i))); };
    perm([], base); return all; })();      // every subset of the three jobs in every order, and none: 16 lists
  H.JOBLISTS = JOBLISTS;

  // ---- building a random shop ----
  H.build = (seed, named) => {
    H.seed(seed * 7919 + 13);
    const [W, D] = S.room(), put = (id, x, z, rot, stock, genre) => S.addItem(id, { x, z, rot: rot || 0 }, 0, stock, genre), desc = [];
    S.setLevelXP(9999999); P('level=levelFor(xpTotal())');
    const free = (id, x, z, rot) => x >= 0 && z >= 1 && x < W && z < D - 1 && S.canPlace(S.DEF[id], { x, z, rot: rot || 0 });
    const counterWith = (id, x, z, rot) => { if (!free('counter', x, z)) return null; put('counter', x, z); const it = put(id, x, z, rot, 10); desc.push(id + '@' + x + ',' + z + 'r' + rot); return it; };
    if (named) named.forEach(q => counterWith(q[0], q[1], q[2], q[3]));
    else {
      const want = [];
      for (let k = ri(3); k > 0; k--) want.push('register');      // 0 to 2 cash registers
      if (H.rnd() < 0.45) want.push('orderpoint');
      for (let k = ri(3); k > 0; k--) want.push('espresso');      // 0 to 2 coffee machines
      if (H.rnd() < 0.35) want.push('croissants');
      if (H.rnd() < 0.25) want.push('pickup');
      // counters in rows of 1 to 3, anywhere in the middle of the room, facing any way
      let left = want.slice().sort(() => H.rnd() - 0.5);
      for (let tries = 0; tries < 60 && left.length; tries++) {
        const n = Math.min(left.length, 1 + ri(3)), x0 = 1 + ri(W - 2), z0 = 2 + ri(D - 5), horiz = H.rnd() < 0.6, rot = ri(4), row = [];
        for (let i = 0; i < n; i++) row.push(horiz ? { x: x0 + i, z: z0 } : { x: x0, z: z0 + i });
        if (!row.every(t => free('counter', t.x, t.z))) continue;
        row.forEach(t => { const id = left.shift(); counterWith(id, t.x, t.z, H.rnd() < 0.8 ? rot : ri(4)); });
      }
    }
    // shelves, mostly against the side walls; a few chairs
    const shelves = 2 + ri(4);
    for (let k = 0, n = 0; k < 80 && n < shelves; k++) {
      const side = H.rnd() < 0.8, x = side ? (H.rnd() < 0.5 ? 0 : W - 1) : 1 + ri(W - 2), z = 2 + ri(D - 4), rot = side ? (x === 0 ? 1 : 3) : ri(4);
      if (free('shelf', x, z, rot)) { put('shelf', x, z, rot, ri(7), 0); n++; }
    }
    for (let k = 0, n = 0; k < 40 && n < 2 + ri(3); k++) { const x = ri(W), z = 1 + ri(2); if (free('pouf', x, z)) { put('pouf', x, z, 0); n++; } }
    S.state.stock.romance = 400; S.state.stock.coffee = 400; S.state.stock.pastry = 400; S.state.coins = 99999;
    S.setBuild(false);
    // staff: 1 to 4, any jobs
    const staff = 1 + ri(4);
    for (let i = 1; i < staff; i++) { S.hire(); document.getElementById('mgmtClose').click(); }
    S.workers.forEach(w => { w.jobs = pick(JOBLISTS).slice(); P('setTask')(w, null); w.think = 0; });
    desc.push('staff:' + S.workers.map(w => w.jobs.join('>') || 'none').join('|'));
    const heavy = H.rnd() < 0.5; desc.push(heavy ? 'heavy' : 'light');
    return { desc: desc.join(' '), heavy };
  };

  // ---- what work there is right now ----
  const reach = (w, tiles) => { const c = P('curTile')(w), ok = tiles.filter(t => { const r = S.tileRes.get(key(t)); return !r || r === w; }); return ok.length && P('bfs')(c.x, c.z, new Set(ok.map(key))) !== null; };
  const spotsOf = it => { const sp = P('staffSpots')(it); return sp[0].concat(sp[1]); };
  const making = o => !!(o.w && o.w.task && o.w.task.order === o);
  const liveOrders = () => P('orders').filter(o => !o.done && !o.ready && o.c && S.customers.includes(o.c) && o.s && o.s.alive);
  // work in job k that w could do now and nobody is on: [{what, item}]
  H.workFor = (w, k) => {
    const out = [];
    if (k === 'till' || k === 'food') {
      S.items.filter(i => isStation(i) && jobOf(i) === k && i.queue.length && !i.worker && !P('blocked')(i) && !(i.def.cap && i.stock <= 0)).forEach(i => { if (reach(w, spotsOf(i))) out.push({ what: 'line', item: i }); });
    }
    if (k === 'food') liveOrders().filter(o => !making(o) && !o.w).forEach(o => { if (reach(w, spotsOf(o.s))) out.push({ what: 'order', item: o.s, order: o }); });
    if (k === 'stock') {
      const food = S.workers.some(x => x.jobs.indexOf('food') >= 0);
      S.items.filter(i => i.def.cap && !i.stocker && !P('blocked')(i) && P('backCount')(i) > 0 && P('isLow')(i) && (!isStation(i) || (i.def.role === 'snack' && !food)) && !(i.worker && i.worker !== w)).forEach(i => {
        const acc = P('accessSets')(i); if (reach(w, acc[0].concat(acc[1]).concat(spotsOf(i)))) out.push({ what: 'shelf', item: i });
      });
    }
    return out;
  };
  // which job a task belongs to, for this person (null: it belongs to none of theirs)
  H.jobOfTask = (w, t) => {
    if (!t) return null;
    if (t.type === 'make') return 'food';
    if (t.type === 'serve') return jobOf(t.item);
    if (t.type === 'stock') { if (!isStation(t.item)) return 'stock'; const j = jobOf(t.item); if (w.jobs.indexOf(j) >= 0) return j; if (t.item.def.role === 'snack' && w.jobs.indexOf('stock') >= 0) return 'stock'; return j; }
    return null;
  };
  const freeNow = w => !w.task || (w.task.type === 'serve' && !w.task.item.queue.length && w.state !== 'order');
  const workTiles = () => { const k = {}; S.items.filter(isStation).forEach(o => { const sp = P('staffSpots')(o); (sp[0].length ? sp[0] : sp[1]).forEach(t => { k[key(t)] = 1; }); }); return k; };

  // ---- the watcher ----
  H.start = (seed) => {
    H.v = { R1: [], R2: [], R3: [], R4: [], R5: [], R6: [], R7: [], R8: [], R9: [], R10: [] };
    H.t = 0; H.seedNo = seed;
    H.w = new Map(); H.st = new Map(); H.cu = new Map(); H.changes = [];
  };
  const note = (rule, text) => { const list = H.v[rule]; if (list.length < 20) list.push('t=' + H.t.toFixed(1) + ' ' + text); else list.n = (list.n || 20) + 1; };
  const desc = w => 'person ' + who(w) + ' (' + (w.jobs.join('>') || 'no jobs') + ')';
  const tdesc = t => t ? t.type + '@' + t.item.def.id + (t.item.x != null ? '(' + t.item.x + ',' + t.item.z + ')' : '') : 'nothing';
  H.step = dt => {
    H.t += dt;
    const wt = workTiles(), live = liveOrders();
    S.workers.forEach(w => {
      let m = H.w.get(w); if (!m) { m = { idle: 0, low: 0, off: 0, lastX: w.x, lastZ: w.z, still: 0, spot: 0, flagged: {} }; H.w.set(w, m); }
      const t = w.task, j = H.jobOfTask(w, t), free = freeNow(w);
      // R1 and R6: a task from a job not ticked (R6 when the job was just switched off)
      if (t && j && w.jobs.indexOf(j) < 0) {
        m.off += dt;
        const ch = H.changes.find(c => c.w === w && H.t - c.t < 10 && c.removed.indexOf(j) >= 0);
        if (ch && m.off > 2 && !m.flagged.r6) { m.flagged.r6 = 1; note('R6', desc(w) + ' still doing ' + tdesc(t) + ' (' + j + ') 2 s after that job was switched off'); }
        else if (!ch && m.off > 0.6 && !m.flagged.r1) { m.flagged.r1 = 1; note('R1', desc(w) + ' doing ' + tdesc(t) + ', which is ' + j + ' work'); }
      } else { m.off = 0; m.flagged.r1 = m.flagged.r6 = 0; }
      // R2: free while a ticked job has work nobody is on
      const avail = w.jobs.map(k => H.workFor(w, k));
      if (free && avail.some(l => l.length)) {
        m.idle += dt;
        if (m.idle > 6 && !m.flagged.r2) { const k = w.jobs[avail.findIndex(l => l.length)], x = avail.find(l => l.length)[0]; m.flagged.r2 = 1; note('R2', desc(w) + ' free (' + (t ? 'minding ' + t.item.def.id : 'no task') + ', "' + w.doing + '") for 6 s while ' + k + ' work waits: ' + x.what + ' at ' + x.item.def.id + '(' + x.item.x + ',' + x.item.z + ')'); }
      } else { m.idle = 0; m.flagged.r2 = 0; }
      // R3: serving a lower job while a higher one has work nobody is on
      const bi = j ? w.jobs.indexOf(j) : -1;
      if (t && t.type === 'serve' && t.item.queue.length && bi > 0 && avail.slice(0, bi).some(l => l.length)) {
        m.low += dt;
        if (m.low > 6 && !m.flagged.r3) { m.flagged.r3 = 1; const hi = w.jobs[avail.findIndex(l => l.length)]; note('R3', desc(w) + ' serving at ' + t.item.def.id + ' (' + j + ') for 6 s while higher job ' + hi + ' has work'); }
      } else { m.low = 0; m.flagged.r3 = 0; }
      // R8: stuck with somewhere to go
      const moved = Math.abs(w.x - m.lastX) + Math.abs(w.z - m.lastZ); m.lastX = w.x; m.lastZ = w.z;
      if (w.path.length && moved < 1e-4 && w.p.g.visible) { m.still += dt; if (m.still > 5 && !m.flagged.r8) { m.flagged.r8 = 1; note('R8', desc(w) + ' stuck walking for 5 s at ' + Math.floor(w.x) + ',' + Math.floor(w.z) + ' doing ' + tdesc(t)); } } else { m.still = 0; m.flagged.r8 = 0; }
      // R10: nothing to do, standing on a work tile
      const here = Math.floor(w.x) + ',' + Math.floor(w.z);
      if (!t && !w.path.length && wt[here]) { m.spot += dt; if (m.spot > 4 && !m.flagged.r10) { m.flagged.r10 = 1; note('R10', desc(w) + ' with nothing to do stands on a work tile at ' + here + ' for 4 s'); } } else { m.spot = 0; m.flagged.r10 = 0; }
    });
    // R5 and R7: stations changing hands
    S.items.filter(isStation).forEach(it => {
      let m = H.st.get(it); if (!m) { m = { holder: it.worker, minding: false, hands: [], want: 0, flagged: {} }; H.st.set(it, m); }
      if (it.worker !== m.holder) {
        if (m.holder && it.worker && S.workers.includes(m.holder)) {
          m.hands.push(H.t);
          const k = jobOf(it), a = it.worker.jobs.indexOf(k), b = m.holder.jobs.indexOf(k);
          if (m.minding && b >= 0 && !(a >= 0 && a < b) && !m.holder.task) note('R7', desc(it.worker) + ' took the ' + it.def.id + ' from ' + desc(m.holder) + ', who was minding it and puts ' + k + ' as high or higher');
        }
        m.holder = it.worker;
      }
      m.minding = !!(it.worker && it.worker.task && it.worker.task.item === it && it.worker.task.type === 'serve' && it.worker.state !== 'order' && !it.queue.length);
      m.hands = m.hands.filter(x => H.t - x <= 60);
      if (m.hands.length > 4 && !m.flagged.r5) { m.flagged.r5 = 1; note('R5', 'the ' + it.def.id + '(' + it.x + ',' + it.z + ') changed hands ' + m.hands.length + ' times in a minute'); }
      if (m.hands.length <= 2) m.flagged.r5 = 0;
      // R7 (higher rank waiting): someone free puts this job higher than the person minding it, and every station of the job is held
      const k = jobOf(it), x = it.worker;
      const allHeld = S.items.filter(i => isStation(i) && jobOf(i) === k).every(i => i.worker);
      const keen = x && m.minding && allHeld && S.workers.find(y => y !== x && freeNow(y) && y.jobs.indexOf(k) >= 0 && (x.jobs.indexOf(k) < 0 || y.jobs.indexOf(k) < x.jobs.indexOf(k)) && reach(y, spotsOf(it).concat([P('curTile')(x)])));
      if (keen) { m.want += dt; if (m.want > 8 && !m.flagged.r7) { m.flagged.r7 = 1; note('R7', desc(keen) + ' puts ' + k + ' higher but ' + desc(x) + ' has kept the ' + it.def.id + ' for 8 s'); } } else { m.want = 0; m.flagged.r7 = 0; }
    });
    // R4: customers waiting while someone who could serve them is free
    S.customers.forEach(c => {
      let m = H.cu.get(c); if (!m) { m = { front: 0, still: 0, lastX: c.x, lastZ: c.z, flagged: {} }; H.cu.set(c, m); }
      const it = c.state === 'queue' ? c.item : null;
      if (it && it.queue[0] === c && !it.worker && !c.path.length) {
        m.front += dt;
        const k = jobOf(it), helper = S.workers.find(w => w.jobs.indexOf(k) >= 0 && freeNow(w) && reach(w, spotsOf(it)));
        if (m.front > 20 && helper && !m.flagged.r4) { m.flagged.r4 = 1; note('R4', 'a customer waited 20 s at the front of the ' + it.def.id + ' line while ' + desc(helper) + ' was free'); }
      } else m.front = 0;
      const moved = Math.abs(c.x - m.lastX) + Math.abs(c.z - m.lastZ); m.lastX = c.x; m.lastZ = c.z;
      if (c.path.length && moved < 1e-4 && c.state !== 'sit') { m.still += dt; if (m.still > 5 && !m.flagged.r8) { m.flagged.r8 = 1; note('R8', 'a customer (' + c.state + ') stuck walking for 5 s at ' + Math.floor(c.x) + ',' + Math.floor(c.z)); } } else { m.still = 0; m.flagged.r8 = 0; }
    });
    live.forEach(o => {
      o.__age = (o.__age || 0) + dt;
      if (o.__age > 30 && !making(o) && !o.__flag) {
        const helper = S.workers.find(w => w.jobs.indexOf('food') >= 0 && freeNow(w) && reach(w, spotsOf(o.s)));
        if (helper) { o.__flag = 1; note('R4', 'a paid ' + o.s.def.id + ' order waited 30 s unmade while ' + desc(helper) + ' was free'); }
      }
    });
    // R9: two standing still on one tile
    const seen = {};
    S.workers.concat(S.customers).forEach(p => {
      if (p.path.length || (p.p && p.p.g && !p.p.g.visible) || p.state === 'sit' || p.state === 'hopOn' || p.state === 'hopOff' || p.kid || p.hop) return;
      const k = Math.floor(p.x) + ',' + Math.floor(p.z);
      if (seen[k]) { const kk = 'clash' + k; if (!H[kk] || H.t - H[kk] > 10) { H[kk] = H.t; note('R9', 'two people standing still on tile ' + k); } }
      seen[k] = 1;
    });
  };

  // ---- things a player does mid-day ----
  H.tapJob = (w, k) => { const before = w.jobs.slice(); P('toggleJob')(w, k); H.changes.push({ w, t: H.t, removed: before.filter(x => w.jobs.indexOf(x) < 0) }); return before.join('>') + ' -> ' + w.jobs.join('>'); };
  H.event = (kind) => {
    const [W, D] = S.room();
    if (kind === 'jobs') {      // tap one job on someone's jobs screen, as a player would; prefer someone in the middle of a task
      const busy = S.workers.filter(w => w.task), w = busy.length && H.rnd() < 0.7 ? pick(busy) : pick(S.workers), k = pick(['till', 'stock', 'food']);
      return 'tap ' + k + ' for person ' + who(w) + ': ' + H.tapJob(w, k);
    }
    if (kind === 'hire') {
      if (S.workers.length >= 4 || S.state.hired >= 3) return null;
      S.hire(); document.getElementById('mgmtClose').click(); const w = S.workers[S.workers.length - 1];
      return 'hired person ' + who(w) + ' (' + w.jobs.join('>') + ')';
    }
    if (kind === 'move' || kind === 'sell') {      // a station that someone is working, if any
      const st = S.items.filter(i => isStation(i) && i.worker); const it = st.length ? pick(st) : null; if (!it) return null;
      const host = S.items.find(h => h.layer === 'solid' && h.x === it.x && h.z === it.z && h !== it), id = it.def.id, rot = it.rot, where = it.x + ',' + it.z;
      S.setBuild(true);
      if (kind === 'sell') { P('removeItem')(it); S.setBuild(false); return 'sold the ' + id + ' at ' + where + ' while ' + desc(S.workers.find(w => w.task && w.task.item === it) || S.workers[0]) + ' worked it'; }
      for (let tries = 0; tries < 60; tries++) {
        const x = 1 + ri(W - 2), z = 2 + ri(D - 5);
        if (!S.canPlace(S.DEF.counter, { x, z, rot: 0 })) continue;
        P('removeItem')(it); if (host) P('removeItem')(host);
        S.addItem('counter', { x, z, rot: 0 }, 0); S.addItem(id, { x, z, rot }, 0, 10);
        S.setBuild(false); return 'moved the ' + id + ' from ' + where + ' to ' + x + ',' + z + ' while it was staffed';
      }
      S.setBuild(false); return null;
    }
    return null;
  };
  H.extraCustomer = () => { const c = P('spawnCustomer')(); if (H.rnd() < 0.5) c.after = cc => { cc.plan = ['snack']; P('nextIntent')(cc); }; };
  H.adults = () => S.customers.filter(c => !c.kid).length;
}

// ---------------- driving it ----------------
const STATIONS_NAMED = {      // the two shops that still stalled 4 to 6 s after the Part A fix (explorer seeds 107 and 140), run as seeds 1001 and 1002
  1001: { stations: [['espresso', 3, 2, 1], ['orderpoint', 3, 3, 2], ['register', 4, 3, 1], ['pickup', 3, 4, 0]], jobs: [['food', 'till', 'stock'], ['food', 'till'], ['food']] },
  1002: { stations: [['espresso', 1, 3, 0], ['register', 2, 3, 3], ['orderpoint', 2, 4, 2], ['pickup', 1, 6, 2]], jobs: [['till', 'stock'], ['food', 'till'], ['stock', 'till', 'food']] },
};
async function openPage(seed, saved) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await ctx.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.hostname === 'game.test') {
      const f = u.pathname === '/' || u.pathname === '/index.html' ? HTML : path.join(repo, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
    }
    if (/three(\.min)?\.js$/.test(u.pathname)) return THREE ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(THREE) }) : route.continue();
    return route.abort();
  });
  await page.addInitScript(([seed, saved]) => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = cb => cb && cb.name === 'frame' ? 0 : raf(cb);
    window.AudioContext = window.webkitAudioContext = undefined;
    let a = seed; Math.random = function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    if (saved != null) localStorage.setItem('bookstore-cafe-proto-v2', saved);
    else localStorage.removeItem('bookstore-cafe-proto-v2');
  }, [seed, saved == null ? null : saved]);
  await page.goto('http://game.test/index.html?skip=all');
  await page.waitForFunction(() => window.__shop && document.getElementById('loading').hidden, null, { timeout: 60000 });
  await page.evaluate(harness);
  return { ctx, page, errors };
}

async function huntOne(seed) {
  let g = await openPage(seed);
  const named = STATIONS_NAMED[seed];
  const shop = await g.page.evaluate(([seed, named]) => {
    const r = window.H.build(seed, named && named.stations);
    if (named) { const S = window.__shop; while (S.workers.length < named.jobs.length) { S.hire(); document.getElementById('mgmtClose').click(); } named.jobs.forEach((j, i) => { S.workers[i].jobs = j.slice(); S.peek('setTask')(S.workers[i], null); }); r.desc = r.desc.replace(/staff:\S+/, 'staff:' + named.jobs.map(j => j.join('>')).join('|')); }
    window.H.start(seed); return r;
  }, [seed, named || null]);
  // the day's plan: the seed picks when things happen
  const plan = await g.page.evaluate(([seed, secs]) => {
    const H = window.H; H.seed(seed * 31 + 7); const ev = [], kinds = ['jobs', 'jobs', 'jobs', 'hire', 'move', 'sell'];
    const n = 2 + Math.floor(H.rnd() * 4);
    for (let i = 0; i < n; i++) ev.push({ at: Math.round(10 + H.rnd() * (secs - 20)), kind: kinds[Math.floor(H.rnd() * kinds.length)] });
    const reload = H.rnd() < 0.3 ? Math.round(secs * (0.3 + H.rnd() * 0.4)) : null;
    return { ev: ev.sort((a, b) => a.at - b.at), reload };
  }, [seed, MINUTES * 60]);
  const log = [], secs = MINUTES * 60;
  let t = 0, next = 0, merged = null;
  const runTo = async until => {
    const done = await g.page.evaluate(([from, until, heavy, events]) => {
      const S = window.__shop, H = window.H, out = []; let t = from, e = 0, extra = 0;
      while (t < until) {
        while (e < events.length && events[e].at <= t) { const d = H.event(events[e].kind); if (d) out.push('t=' + t.toFixed(0) + ' ' + d); e++; }
        if (heavy && (extra -= 0.05) <= 0) { extra = 3 + H.rnd() * 2; if (H.adults() < 10) H.extraCustomer(); }
        S.simulate(0.05); H.step(0.05); t += 0.05;
      }
      return { t, out };
    }, [t, until, shop.heavy, plan.ev.filter(x => x.at >= t && x.at < until)]);
    t = done.t; log.push(...done.out);
  };
  if (plan.reload) {
    await runTo(plan.reload);
    // save mid-task, close, reopen from the save, carry on
    const saved = await g.page.evaluate(() => { window.__shop.peek('saveNow')(); return { raw: localStorage.getItem('bookstore-cafe-proto-v2'), v: window.H.v, jobs: window.__shop.workers.map(w => w.jobs.join('>')) }; });
    const errs = g.errors.slice(); await g.ctx.close();
    g = await openPage(seed + 500000, saved.raw); g.errors.push(...errs);
    const back = await g.page.evaluate(([seed, t]) => { const H = window.H; H.start(seed); H.t = t; window.__shop.setBuild(false); return window.__shop.workers.map(w => w.jobs.join('>')); }, [seed, t]);
    log.push('t=' + t.toFixed(0) + ' saved and reopened (jobs ' + saved.jobs.join('|') + (saved.jobs.join('|') === back.join('|') ? ', same after' : ', NOW ' + back.join('|')) + ')');
    merged = saved.v;
    if (saved.jobs.join('|') !== back.join('|')) { merged.R6 = merged.R6 || []; merged.R6.push('t=' + t.toFixed(1) + ' jobs changed on reopening: ' + saved.jobs.join('|') + ' -> ' + back.join('|')); }
  }
  await runTo(secs);
  const v = await g.page.evaluate(() => window.H.v);
  if (merged) for (const k in v) v[k] = (merged[k] || []).concat(v[k]);
  if (g.errors.length) v.R8 = v.R8.concat(g.errors.slice(0, 3).map(e => 'script error: ' + e.slice(0, 160)));
  await g.ctx.close();
  return { seed, desc: shop.desc, events: log, v, mins: secs / 60 };
}

const RULES = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10'];
const seeds = [];
for (let s = FROM; s < FROM + COUNT; s++) seeds.push(s);
if (!ONE && !arg('--from')) seeds.push(1001, 1002);
console.log('Hunting in ' + path.relative(process.cwd(), HTML) + ': ' + seeds.length + ' shops, ' + MINUTES + ' simulated minutes each\n');
const tally = Object.fromEntries(RULES.map(r => [r, 0])), hits = Object.fromEntries(RULES.map(r => [r, []]));
let minutes = 0;
for (const seed of seeds) {
  const r = await huntOne(seed);
  minutes += r.mins;
  const broke = RULES.filter(k => r.v[k] && r.v[k].length);
  broke.forEach(k => { tally[k] += r.v[k].length; hits[k].push(seed); });
  console.log((broke.length ? 'BROKE ' : 'ok    ') + 'seed ' + seed + '  ' + r.desc + (broke.length ? '  [' + broke.map(k => k + '×' + r.v[k].length).join(' ') + ']' : ''));
  if (ONE || (broke.length && argv.indexOf('--quiet') < 0)) {
    if (r.events.length) console.log('        day: ' + r.events.join(' | '));
    broke.forEach(k => r.v[k].slice(0, ONE ? 20 : 2).forEach(x => console.log('        ' + k + ' ' + x)));
  }
}
console.log('\n' + seeds.length + ' shops, ' + minutes + ' simulated minutes');
RULES.forEach(k => console.log('  ' + k.padEnd(4) + String(tally[k]).padStart(4) + ' breaks' + (hits[k].length ? '  seeds ' + hits[k].slice(0, 12).join(',') + (hits[k].length > 12 ? '…' : '') : '')));
await browser.close();
const total = RULES.reduce((n, k) => n + tally[k], 0);
console.log('\n' + (total ? total + ' breaks found' : 'no rule broken'));
process.exit(total ? 1 : 0);
