// Staff jobs check. Run from the repo:  node tests/staff-jobs.test.mjs   (add --html <file> to check another copy of index.html)
// Needs Playwright and Chrome. With no internet, point THREE_JS at a local copy of three.js r128 (three.min.js).
//
// It opens the real page in headless Chrome, builds a small shop, changes jobs by tapping the rows of the jobs screen,
// steps the game's own clock, and records what each member of staff does. Nothing here is loaded by the game or its service worker.
// Other settings: CHROME (path to the browser), PLAYWRIGHT_DIR (a node_modules folder that holds playwright).
// The saves in fixtures/ were written by the game as it was at commit 4dedba2, before the jobs change.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const argv = process.argv.slice(2);
const htmlArg = argv.indexOf('--html');
const HTML = htmlArg >= 0 ? path.resolve(argv[htmlArg + 1]) : path.join(repo, 'index.html');
const THREE = process.env.THREE_JS || '';
const SAVE_KEY = 'bookstore-cafe-proto-v2';

function loadPlaywright() {
  const dirs = [here + '/', (process.env.PLAYWRIGHT_DIR || '/opt/npm-tools/node_modules') + '/'];
  for (const d of dirs) { try { return createRequire(d)('playwright'); } catch (_) {} }
  throw new Error('Playwright not found. Install it (npm i -g playwright) or set PLAYWRIGHT_DIR.');
}
const { chromium } = loadPlaywright();
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const chromePath = process.env.CHROME || (fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);
const browser = await chromium.launch({ executablePath: chromePath, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

// A fresh browser profile with the game loaded, its frame loop held still and its dice seeded, so every run is the same.
async function shop(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await ctx.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.hostname === 'game.test') {
      const f = u.pathname === '/' || u.pathname === '/index.html' ? HTML : path.join(repo, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
    }
    if (/three(\.min)?\.js$/.test(u.pathname)) return THREE ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(THREE) }) : route.continue();
    return route.abort();      // fonts and anything else off-site: not needed
  });
  await page.addInitScript(([key, save, seed]) => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = cb => cb && cb.name === 'frame' ? 0 : raf(cb);      // the game's own frame loop never starts: the test steps the game itself
    window.AudioContext = window.webkitAudioContext = undefined;      // no sound: headless Chrome has no speaker, and the game then simply stays silent
    let a = seed;
    Math.random = function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    if (save != null && !sessionStorage.getItem('seeded')) { localStorage.setItem(key, save); sessionStorage.setItem('seeded', '1'); }
  }, [SAVE_KEY, opts.save == null ? null : opts.save, opts.seed || 12345]);
  const go = async () => {
    await page.goto('http://game.test/index.html?' + (opts.tutorial ? 'skip' : 'skip=all'));      // skip=all: straight into a full-size shop, past the first steps; skip: the first steps still to do
    await page.waitForFunction(() => window.__shop && document.getElementById('loading').hidden, null, { timeout: 60000 });
    await page.evaluate(helpers);
  };
  await go();
  return { page, errors, reload: go, close: () => ctx.close(), ev: (f, a) => page.evaluate(f, a) };
}

// Runs inside the page: small tools on top of the game's own test hook (window.__shop).
function helpers() {
  const S = window.__shop, P = S.peek;
  const T = window.T = {};
  T.put = (id, x, z, rot, stock, genre) => S.addItem(id, { x, z, rot: rot || 0 }, 0, stock, genre);
  T.find = id => S.items.filter(i => i.def.id === id)[0];
  // the test shop: a register and a coffee machine on counters, four shelves, two chairs
  T.build = o => {
    o = o || {};
    if (o.register !== false) { T.put('counter', 1, 4); T.put('register', 1, 4, 0); }
    if (o.espresso !== false) { T.put('counter', 2, 4); T.put('espresso', 2, 4, 0, 10); }
    if (o.orderpoint) { T.put('counter', 5, 4); T.put('orderpoint', 5, 4, 0); }
    [[0, 6, 1], [0, 7, 1], [7, 6, 3], [7, 7, 3]].forEach(q => T.put('shelf', q[0], q[1], q[2], o.shelfStock == null ? 6 : o.shelfStock, 0));
    T.put('chair', 6, 1, 0); T.put('chair', 7, 1, 0);
    S.state.stock.romance = 400; S.state.stock.coffee = 400; S.state.coins = 5000; S.setLevelXP(999999); P('level=levelFor(xpTotal())');
    S.setBuild(false);
  };
  T.jobs = () => S.workers.map(w => w.jobs.join('>'));
  T.doors = open => P('spawnTimer=' + (open ? 1 : 1e9));      // closed: no new customers walk in
  T.setJobs = list => { list.forEach((j, i) => { S.workers[i].jobs = j.slice(); P('setTask')(S.workers[i], null); S.workers[i].think = 0; }); };      // test setup only: as if loaded from a save
  T.jobOfItem = d => d.role === 'counter' ? (d.cafeOnly ? 'orderpoint' : 'till') : d.role === 'snack' ? 'food' : 'stock';
  T.kind = w => { const t = w.task; if (!t) return 'idle'; if (t.type === 'make') return 'food'; return (t.type === 'serve' && !t.item.queue.length ? 'wait@' : '') + T.jobOfItem(t.item.def); };
  // step the game's clock and record, for each person: seconds in each activity, orders made, and seconds holding each station
  T.run = secs => {
    const dt = 0.05, n = S.workers.length, out = { secs, act: S.workers.map(() => ({})), made: new Array(n).fill(0), hold: {}, clash: 0, staffSpotIdle: new Array(n).fill(0) };
    const last = S.workers.map(w => w.task), staffTiles = P('staffTiles');
    for (let k = 0; k < secs / dt; k++) {
      S.simulate(dt);
      const seen = {};
      S.workers.forEach((w, i) => {
        const a = T.kind(w); out.act[i][a] = (out.act[i][a] || 0) + dt;
        if (w.task !== last[i]) { if (w.task && w.task.type === 'make') out.made[i]++; last[i] = w.task; }
        if (!w.task && !w.path.length && staffTiles()[Math.floor(w.x) + ',' + Math.floor(w.z)]) out.staffSpotIdle[i] += dt;
      });
      S.items.forEach(it => { if (it.worker && (it.def.role === 'counter' || it.def.role === 'snack')) { const h = out.hold[it.def.id] = out.hold[it.def.id] || new Array(n).fill(0); h[S.workers.indexOf(it.worker)] += dt; } });
      S.workers.concat(S.customers).forEach(p => {      // nobody standing still shares a tile
        if (p.path.length || (p.p && p.p.g && !p.p.g.visible) || p.state === 'sit' || p.kid) return;
        const key = Math.floor(p.x) + ',' + Math.floor(p.z); if (seen[key]) out.clash++; seen[key] = 1;
      });
    }
    const r = o => { const q = {}; for (const k in o) q[k] = Math.round(o[k]); return q; };
    out.act = out.act.map(r); for (const k in out.hold) out.hold[k] = out.hold[k].map(Math.round); out.staffSpotIdle = out.staffSpotIdle.map(Math.round);
    out.sold = { books: S.state.stats.books, coffee: S.state.stats.coffee };
    return out;
  };
  T.holder = id => { const it = T.find(id); return it && it.worker ? S.workers.indexOf(it.worker) : -1; };
  T.rows = () => [...document.querySelectorAll('#mgmtBody .jrow')].map(r => r.dataset.k + ':' + (r.querySelector('.jbox').textContent || '-')).join(' ');
  T.rowNotes = () => { const o = {}; document.querySelectorAll('#mgmtBody .jrow').forEach(r => { const i = r.querySelector('.info i'); o[r.dataset.k] = i ? i.textContent : ''; }); return o; };
}

// A tap: the element must be on screen with nothing over its middle, then it gets the same click a finger gives it.
// (Playwright's own click waits on animation frames, which stall while the game's loop is held.)
async function tap(g, sel) {
  const why = await g.ev(q => {
    const el = document.querySelector(q); if (!el) return 'not found';
    el.scrollIntoView({ block: 'nearest' });
    const b = el.getBoundingClientRect(); if (b.width < 20 || b.height < 20) return 'not visible';
    const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    if (!top || !(top === el || el.contains(top))) return 'covered by ' + (top && (top.id || top.className));
    el.click(); return '';
  }, sel);
  if (why) throw new Error('could not tap ' + sel + ': ' + why);
}
// what a player does: open someone's jobs screen, tap a row, close
async function tapJob(g, who, job) {
  await g.ev(i => window.__shop.openJobs(i), who);
  await tap(g, '#mgmtBody .jrow[data-k="' + job + '"]');
  const rows = await g.ev(() => window.T.rows());
  await tap(g, '#mgmtClose');
  return rows;
}
async function hireTwo(g) {      // hire() is what the Hire button calls; it opens the new person's jobs screen
  for (let i = 0; i < 2; i++) { await g.ev(() => window.__shop.hire()); await tap(g, '#mgmtClose'); }
}

let failed = 0, passed = 0;
function check(name, ok, detail) {
  if (ok) passed++; else failed++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '\n        ' + detail : ''));
}
const J = x => JSON.stringify(x);
const errorsSeen = [];

console.log('Checking ' + path.relative(process.cwd(), HTML) + '\n');

/* ---------- 1. the job a player taps is the job that person does first ---------- */
{
  console.log('1. Tapping a job on the jobs screen');
  const g = await shop();
  await g.ev(() => window.T.build({ shelfStock: 1 }));
  await hireTwo(g);
  const start = await g.ev(() => window.T.jobs());
  check('setup: new hires start on what nobody covers (register, then restocking, then food)', J(start) === J(['till>stock', 'stock>till>food', 'food>till>stock']), 'jobs: ' + J(start));

  // helper 1 has all three ticked with Food third. The player wants them on Food and taps Food.
  let rows = await tapJob(g, 1, 'food');
  let jobs = await g.ev(() => window.T.jobs());
  check('tap Food on a helper who has it third: Food is now their first job', jobs[1].split('>')[0] === 'food' && jobs[1].split('>').length === 3, 'helper 1: ' + jobs[1] + ' | rows: ' + rows);
  check('the Food row shows number 1', /food:1\b/.test(rows), 'rows: ' + rows);

  // the owner has Cash register and Restocking; the player ticks Food for them.
  rows = await tapJob(g, 0, 'food');
  jobs = await g.ev(() => window.T.jobs());
  check('tap Food on the owner, who did not have it: Food is now their first job', jobs[0] === 'food>till>stock', 'owner: ' + jobs[0] + ' | rows: ' + rows);
  rows = await tapJob(g, 0, 'food');
  jobs = await g.ev(() => window.T.jobs());
  check('tap the number 1 job: it is switched off and the rest keep their order', jobs[0] === 'till>stock', 'owner: ' + jobs[0] + ' | rows: ' + rows);

  // and in the shop. Helper 2 also had Food first; the player taps Restocking for them, so helper 1 is now the only one with Food first.
  rows = await tapJob(g, 2, 'stock');
  jobs = await g.ev(() => window.T.jobs());
  check('tap Restocking for helper 2: Restocking first, Food second', jobs[2] === 'stock>food>till', 'helper 2: ' + jobs[2] + ' | rows: ' + rows);
  const r = await g.ev(() => window.T.run(150));
  const hold = r.hold.espresso || [0, 0, 0];
  check('helper 1 (Food first) is the one at the coffee machine, not helper 2 (Food second)', hold[1] > 75 && hold[1] > hold[2] * 2, 'seconds holding the coffee machine [owner, helper 1, helper 2]: ' + J(hold) + ' of ' + r.secs);
  check('helper 1 makes more of the orders than helper 2', r.made[1] > 0 && r.made[1] >= r.made[2], 'orders made [owner, helper 1, helper 2]: ' + J(r.made) + ' | activity: ' + J(r.act));
  check('nobody standing still shares a tile', r.clash === 0, 'clashes: ' + r.clash);
  errorsSeen.push(...g.errors); await g.close();
}

/* ---------- 2. the order of jobs decides who gets a station, not who got there first ---------- */
{
  console.log('\n2. Who gets the coffee machine and the register');
  const g = await shop();
  await g.ev(() => { window.T.build(); window.T.doors(false); });      // shelves full and no customers yet: nothing to do but wait at a station
  await hireTwo(g);
  // helper 1 has Food last and reaches the coffee machine first; helper 2 has no jobs yet
  await g.ev(() => window.T.setJobs([['till', 'stock'], ['stock', 'till', 'food'], []]));
  await g.ev(() => window.T.run(8));
  const before = await g.ev(() => window.T.holder('espresso'));
  check('setup: helper 1 (Food third) is waiting at the coffee machine', before === 1, 'coffee machine held by person ' + before);
  await g.ev(() => { const S = window.__shop; S.workers[2].jobs = ['food', 'till', 'stock']; S.workers[2].think = 0; });      // helper 2 gets Food first
  const q = await g.ev(() => window.T.run(10));
  const after = await g.ev(() => window.T.holder('espresso'));
  check('helper 2 (Food first) takes the coffee machine from helper 1 (Food third)', after === 2, 'coffee machine held by person ' + after + ' | seconds held [owner, helper 1, helper 2]: ' + J(q.hold.espresso));
  check('helper 1 steps out of the staff spot instead of standing there', q.staffSpotIdle[1] <= 1, 'seconds idle in a staff spot: ' + J(q.staffSpotIdle));

  // the owner minds the only register. The player taps Cash register for helper 1: both now have it first. The owner was there first and keeps it.
  const hadTill = await g.ev(() => window.T.holder('register'));
  const rows = await tapJob(g, 1, 'till');
  const tie = await g.ev(() => window.T.jobs());
  const t15 = await g.ev(() => window.T.run(15));
  check('setup: the owner and helper 1 both have Cash register first, and there is one register', tie[0].split('>')[0] === 'till' && tie[1].split('>')[0] === 'till' && hadTill === 0, 'jobs: ' + J(tie) + ' | rows: ' + rows);
  check('a tie for one register: the owner, who was there first, keeps it', (t15.hold.register || [])[0] >= 14 && !t15.hold.register[1], 'next 15 seconds, register held [owner, helper 1, helper 2]: ' + J(t15.hold.register));
  check('helper 1 waits out of the staff spot', t15.staffSpotIdle[1] <= 1, 'seconds idle in a staff spot: ' + J(t15.staffSpotIdle));

  // it is whoever gets there first, either way round. Reload the shop twice: once with the owner slow off the mark, once with helper 1 slow.
  const saved = await g.ev(() => { window.__shop.peek('saveNow')(); return window.T.jobs(); });
  await g.reload();
  const back = await g.ev(() => window.T.jobs());
  check('jobs come back in the same order after a reload', J(back) === J(saved), 'saved ' + J(saved) + ' | loaded ' + J(back));
  const race = async slow => {
    await g.reload();
    await g.ev(slow => { window.T.doors(false); window.__shop.workers[slow].think = 4; }, slow);
    await g.ev(() => window.T.run(3));
    const first = await g.ev(() => window.T.holder('register'));
    const rr = await g.ev(() => window.T.run(12));
    return { first, then: await g.ev(() => window.T.holder('register')), held: rr.hold.register };
  };
  let rc = await race(0);
  check('helper 1 reaches the register first: helper 1 keeps it when the owner turns up', rc.first === 1 && rc.then === 1 && !rc.held[0], 'held by person ' + rc.first + ' at first, person ' + rc.then + ' twelve seconds later | seconds held: ' + J(rc.held));
  rc = await race(1);
  check('the owner reaches the register first: the owner keeps it when helper 1 turns up', rc.first === 0 && rc.then === 0 && !rc.held[1], 'held by person ' + rc.first + ' at first, person ' + rc.then + ' twelve seconds later | seconds held: ' + J(rc.held));

  // doors open: a busy shop for two and a half minutes
  const r = await g.ev(() => { window.T.doors(true); return window.T.run(150); });
  check('with customers: helper 2 (Food first) makes more of the orders than helper 1 (Food third)', r.made[2] > r.made[1], 'orders made [owner, helper 1, helper 2]: ' + J(r.made) + ' | coffee machine held: ' + J(r.hold.espresso));
  check('nobody with nothing to do stands in a staff spot', r.staffSpotIdle.every(x => x <= 1), 'seconds idle in a staff spot: ' + J(r.staffSpotIdle));
  check('nobody standing still shares a tile', r.clash === 0, 'clashes: ' + r.clash);
  errorsSeen.push(...g.errors); await g.close();
}

/* ---------- 2b. people on the same job spread out over its stations ---------- */
{
  console.log('\n2b. Two people on one job');
  // counts the seconds each person holds each station, how often a station changes hands, and how often someone minding one is pushed off it by a colleague
  const watch = (g, ids, secs) => g.ev(([ids, secs]) => {
    const S = window.__shop, sts = S.items.filter(i => ids.indexOf(i.def.id) >= 0), held = sts.map(() => S.workers.map(() => 0)), at = sts.map(q => q.worker);
    let hands = 0, both = 0, pushed = 0;
    for (let k = 0; k < secs / 0.05; k++) {
      const was = sts.map(q => (q.worker && q.worker.task && q.worker.task.type === 'serve' && q.worker.task.item === q) ? q.worker : null);
      S.simulate(0.05);
      sts.forEach((q, i) => { if (was[i] && q.worker && q.worker !== was[i] && !was[i].task) pushed++; });
      sts.forEach((q, i) => { if (q.worker) { held[i][S.workers.indexOf(q.worker)] += 0.05; if (at[i] && q.worker !== at[i]) hands++; at[i] = q.worker; } });
      if (sts.every(q => q.worker) && new Set(sts.map(q => q.worker)).size === sts.length) both += 0.05;
    }
    return { names: sts.map(q => q.def.id), held: held.map(h => h.map(Math.round)), hands, pushed, both: Math.round(both), books: S.state.stats.books, coffee: S.state.stats.coffee };
  }, [ids, secs]);

  // two registers, two people on Cash register only (books only, so nobody leaves a register to make coffee)
  let g = await shop();
  await g.ev(() => { const T = window.T; T.build({ espresso: false }); T.put('counter', 5, 4); T.put('register', 5, 4, 0); T.doors(false); });
  await hireTwo(g);
  await g.ev(() => window.T.setJobs([['till'], ['till'], []]));
  let q = await watch(g, ['register'], 8);
  check('two registers, two people on Cash register, empty shop: one at each', q.both >= 6, 'seconds with a different person at each register: ' + q.both + ' of 8 | seconds held per register [owner, helper 1, helper 2]: ' + J(q.held));
  await g.ev(() => window.T.doors(true));
  q = await watch(g, ['register'], 150);
  check('with customers: each keeps their own register', q.hands === 0 && q.books > 0, 'changes of hands: ' + q.hands + ' | seconds held per register: ' + J(q.held) + ' | books sold: ' + q.books);
  errorsSeen.push(...g.errors); await g.close();

  // two registers again: helper 1 has Cash register second (after Food, which has nothing to do here) and is working one; the owner has it first and turns up later
  g = await shop();
  await g.ev(() => { const T = window.T; T.build({ espresso: false }); T.put('counter', 5, 4); T.put('register', 5, 4, 0); });
  await hireTwo(g);
  await g.ev(() => window.T.setJobs([[], ['food', 'till'], []]));
  const alone = await watch(g, ['register'], 20);      // helper 1 has a register to themselves for twenty seconds
  await g.ev(() => { window.__shop.workers[0].jobs = ['till']; });
  q = await watch(g, ['register'], 170);
  check('someone who puts Cash register higher takes the free register, and never pushes a colleague off theirs', alone.held.some(h => h[1] >= 15) && q.pushed === 0 && q.hands === 0 && q.both >= 120 && q.books > 0,
    'first 20 seconds, held per register: ' + J(alone.held) + ' | then: times someone was pushed off a register: ' + q.pushed + ' | changes of hands: ' + q.hands + ' | seconds with a different person at each register: ' + q.both + ' of 170 | seconds held per register [owner, helper 1, helper 2]: ' + J(q.held) + ' | books sold: ' + q.books);
  errorsSeen.push(...g.errors); await g.close();

  // an order point and a coffee machine, two people on Food only (and one on Cash register)
  g = await shop();
  await g.ev(() => { window.T.build({ orderpoint: true }); window.T.doors(false); });
  await hireTwo(g);
  await g.ev(() => window.T.setJobs([['till'], ['food'], ['food']]));
  q = await watch(g, ['orderpoint', 'espresso'], 8);
  check('an order point and a coffee machine, two people on Food, empty shop: one at each', q.both >= 6, 'seconds with a different person at each: ' + q.both + ' of 8 | seconds held ' + J(q.names) + ' [owner, helper 1, helper 2]: ' + J(q.held));
  // doors open: the first coffee is paid for at the order point and made by whoever is standing at the machine (three shops, different dice)
  const firstOrder = () => g.ev(() => {
    const S = window.__shop, T = window.T, op = T.find('orderpoint'), esp = T.find('espresso'), who = x => S.workers.indexOf(x);
    const before = { point: who(op.worker), machine: who(esp.worker) };
    T.doors(true);
    for (let k = 0; k < 150 / 0.05; k++) {
      S.simulate(0.05);
      const m = S.workers.filter(w => w.task && w.task.type === 'make')[0];
      if (m) return { before, maker: who(m), pointNow: who(op.worker), secs: Math.round(k * 0.05) };
    }
    return { before, maker: -1 };
  });
  const firsts = [await firstOrder()];
  // and then a busy three minutes: nobody on Food stands about with no station while a food station is empty
  const busy = await g.ev(() => {
    const S = window.__shop, T = window.T, sts = [T.find('orderpoint'), T.find('espresso')], held = sts.map(() => [0, 0, 0]); let wasted = 0;
    for (let k = 0; k < 180 / 0.05; k++) {
      S.simulate(0.05);
      sts.forEach((q, i) => { if (q.worker) held[i][S.workers.indexOf(q.worker)] += 0.05; });
      if (sts.some(q => !q.worker) && S.workers.some(w => w.jobs[0] === 'food' && !w.task && !w.path.length)) wasted += 0.05;
    }
    return { held: held.map(h => h.map(Math.round)), wasted: Math.round(wasted), coffee: S.state.stats.coffee };
  });
  errorsSeen.push(...g.errors); await g.close();
  for (const seed of [777, 4242]) {
    g = await shop({ seed });
    await g.ev(() => { window.T.build({ orderpoint: true }); window.T.doors(false); });
    await hireTwo(g);
    await g.ev(() => { window.T.setJobs([['till'], ['food'], ['food']]); window.T.run(8); });
    firsts.push(await firstOrder());
    errorsSeen.push(...g.errors); await g.close();
  }
  check('the first coffee is made by the person at the machine, and the person at the order point stays there',
    firsts.every(f => f.before.point >= 1 && f.before.machine >= 1 && f.before.point !== f.before.machine && f.maker === f.before.machine && f.pointNow === f.before.point),
    'per shop: ' + J(firsts.map(f => ({ atOrderPoint: f.before.point, atMachine: f.before.machine, madeBy: f.maker }))));
  check('with customers: nobody on Food stands idle while a food station is empty', busy.wasted <= 6 && busy.coffee > 0,
    'seconds like that: ' + busy.wasted + ' of 180 | seconds held [order point, coffee machine] by [owner, helper 1, helper 2]: ' + J(busy.held) + ' | coffee sold: ' + busy.coffee);
}

/* ---------- 3. a save made before this change still loads ---------- */
{
  console.log('\n3. A save written by the old version (commit 4dedba2)');
  const raw = fs.readFileSync(path.join(here, 'fixtures', 'save-4dedba2.json'), 'utf8');
  const old = JSON.parse(raw);
  const g = await shop({ save: raw });
  const got = await g.ev(() => ({ jobs: window.__shop.workers.map(w => w.jobs), items: window.__shop.items.map(i => i.def.id).sort(), coins: window.__shop.state.coins, staff: window.__shop.workers.length }));
  check('every person has the same jobs in the same order', J(got.jobs) === J(old.s.jobs), 'saved ' + J(old.s.jobs) + ' | loaded ' + J(got.jobs));
  check('the furniture, coins and staff are all there', J(got.items) === J(old.i.map(a => a[0]).sort()) && got.coins === old.s.coins && got.staff === old.s.hired + 1, got.items.length + ' pieces, ' + got.coins + ' coins, ' + got.staff + ' staff');
  const r = await g.ev(() => { window.__shop.setBuild(false); return window.T.run(120); });
  check('the shop runs and sells from that save', r.sold.books + r.sold.coffee > old.s.stats.books + old.s.stats.coffee, 'sold ' + J(r.sold) + ' (was ' + J({ books: old.s.stats.books, coffee: old.s.stats.coffee }) + ') | activity: ' + J(r.act));
  const again = await g.ev(() => { window.__shop.peek('saveNow')(); return window.T.jobs(); });
  await g.reload();
  check('saved again and reloaded: still the same jobs', J(await g.ev(() => window.T.jobs())) === J(again) && J(again) === J(old.s.jobs.map(j => j.join('>'))), J(again));
  errorsSeen.push(...g.errors); await g.close();
}

/* ---------- 3b. an older shop where Cash register covered the order point and nobody had Food ---------- */
{
  console.log('\n3b. An old save with an order point and nobody on Food');
  const raw = fs.readFileSync(path.join(here, 'fixtures', 'save-4dedba2-orderpoint-no-food.json'), 'utf8');
  const old = JSON.parse(raw);
  const savedJobs = old.s.jobs.map(j => j.join('>'));
  let g = await shop({ save: raw });
  const got = await g.ev(() => window.T.jobs());
  check('setup: the old save has an order point, people on Cash register, and nobody on Food', old.i.some(a => a[0] === 'orderpoint') && J(savedJobs) === J(['till>stock', 'stock', 'till']) && !('jv' in old.s), 'saved jobs: ' + J(savedJobs));
  check('on loading, everyone with Cash register gets Food right after it; nobody else changes', J(got) === J(['till>food>stock', 'stock', 'till>food']), 'loaded jobs: ' + J(got));
  // it happens once: the game writes the shop back as a new save straight away, and a new save is left alone
  await g.page.waitForTimeout(600);
  const kept = JSON.parse(await g.ev(k => localStorage.getItem(k), SAVE_KEY));
  check('the shop is written back as a new save without waiting for the player', kept.s.jv >= 1 && J(kept.s.jobs.map(j => j.join('>'))) === J(got), 'stored jobs: ' + J(kept.s.jobs) + ' | new-save marker (jv): ' + kept.s.jv);
  const r = await g.ev(() => { window.__shop.setBuild(false); return window.T.run(120); });
  check('the café keeps selling in that shop', r.sold.coffee > old.s.stats.coffee && (r.hold.orderpoint || []).some(x => x > 0), 'coffee sold ' + r.sold.coffee + ' (was ' + old.s.stats.coffee + ') | seconds holding the order point: ' + J(r.hold.orderpoint));
  await g.ev(() => { window.T.setJobs([['till', 'stock'], ['stock'], ['till']]); window.__shop.peek('saveNow')(); });      // the player takes Food off everyone again
  await g.reload();
  const again = await g.ev(() => window.T.jobs());
  check('a shop saved after the change is left alone, even with nobody on Food', J(again) === J(['till>stock', 'stock', 'till']), 'jobs after the player removed Food, saved and reloaded: ' + J(again));
  errorsSeen.push(...g.errors); await g.close();

  // the same old save with the order point taken out: nothing to fix, so nothing changes
  const plain = JSON.parse(raw); plain.i = plain.i.filter(a => a[0] !== 'orderpoint');
  g = await shop({ save: JSON.stringify(plain) });
  const same = await g.ev(() => window.T.jobs());
  check('an old save with no order point keeps its jobs exactly', J(same) === J(savedJobs), 'loaded jobs: ' + J(same));
  errorsSeen.push(...g.errors); await g.close();
}

/* ---------- 4. the Café Order Point belongs to the Food job ---------- */
{
  console.log('\n4. The Caf\u00e9 Order Point is part of the Food job');
  // a cash register and an order point: one person on Cash register only, one on Food only, one restocking
  let g = await shop();
  await g.ev(() => window.T.build({ orderpoint: true }));
  await hireTwo(g);
  await g.ev(() => window.T.setJobs([['till'], ['food'], ['stock']]));
  let r = await g.ev(() => window.T.run(180));
  const op = r.hold.orderpoint || [0, 0, 0], reg = r.hold.register || [0, 0, 0];
  check('the person with Food staffs the order point', op[1] > 30, 'seconds holding the order point [Cash register only, Food only, Restocking only]: ' + J(op) + ' of ' + r.secs);
  check('the person with only Cash register never does', op[0] === 0 && op[2] === 0, 'seconds holding the order point: ' + J(op));
  check('the person with only Cash register stays on the cash register', reg[0] > 150 && reg[1] === 0, 'seconds holding the cash register: ' + J(reg));
  check('books and coffee both sell', r.sold.books > 0 && r.sold.coffee > 0, 'sold ' + J(r.sold) + ' | activity: ' + J(r.act));
  check('nobody standing still shares a tile', r.clash === 0, 'clashes: ' + r.clash);
  errorsSeen.push(...g.errors); await g.close();

  // a shop whose only till is the order point
  g = await shop();
  await g.ev(() => { window.T.build({ register: false, orderpoint: true }); window.T.doors(false); window.T.setJobs([['food']]); });
  r = await g.ev(() => window.T.run(8));
  check('with nobody in the shop, the person on Food waits at the order point', (r.hold.orderpoint || [0])[0] >= 4 && !(r.hold.espresso || [0])[0], 'seconds held: order point ' + J(r.hold.orderpoint) + ', coffee machine ' + J(r.hold.espresso));
  r = await g.ev(() => { window.T.doors(true); return window.T.run(180); });
  check('order point only, one person on Food: payment is taken and coffee is made', r.sold.coffee > 0 && (r.hold.orderpoint || [0])[0] > 0, 'sold ' + J(r.sold) + ' | activity: ' + J(r.act));
  await g.ev(() => window.__shop.openJobs(0));
  const notes = await g.ev(() => window.T.rowNotes());
  await tap(g, '#mgmtClose');
  check('the jobs screen says there is no cash register, and does not warn about Food', /No cash register/.test(notes.till) && notes.food === '', 'notes beside the jobs: ' + J(notes));
  const soldBefore = r.sold.coffee;
  await g.ev(() => window.T.setJobs([['till']]));
  r = await g.ev(() => window.T.run(120));
  const alert = await g.ev(() => window.__shop.peek('alertText(false)'));
  check('order point only, one person on Cash register only: nobody staffs it', r.sold.coffee === soldBefore && !(r.hold.orderpoint || [0])[0], 'coffee sold before ' + soldBefore + ', after ' + r.sold.coffee + ' | activity: ' + J(r.act));
  check('and the game says to use Food', /order point/.test(alert) && /Food/.test(alert), 'banner: ' + alert);
  errorsSeen.push(...g.errors); await g.close();
}

/* ---------- 5. the jobs lesson in the first steps ---------- */
{
  console.log('\n5. The jobs lesson in the first steps');
  // follow the pointer the way a new player does; with swap, tap the two jobs the other way round
  const lesson = async swap => {
    const g = await shop({ tutorial: true });
    const out = await g.ev(swap => {
      const S = window.__shop, said = [];
      S.addItem('counter', { x: 1, z: 3, rot: 0 }, 0); S.addItem('register', { x: 1, z: 3, rot: 0 }, 0); S.addItem('shelf', { x: 0, z: 5, rot: 1 }, 0, 6, 0);
      const step = S.goals.map(q => q.name).indexOf('Give yourself jobs');
      S.state.goal = step; S.setBuild(false);
      for (let n = 0; n < 12; n++) {
        S.tick(); const c = S.cue(); if (!c) break;
        said.push(c.d);
        if (c.p && c.p.indexOf('job:') === 0) { let k = c.p.slice(4); if (swap && n === 1) k = k === 'till' ? 'stock' : 'till'; document.querySelector('#mgmtBody .jrow[data-k="' + k + '"]').click(); }
        else if (c.p === '#mgmtClose') document.getElementById('mgmtClose').click();
        else if (/Tap me/.test(c.d)) S.openJobs(0);
        else break;
      }
      S.tick();
      return { jobs: S.workers[0].jobs.join('>'), past: S.state.goal > step, said };
    }, swap);
    errorsSeen.push(...g.errors); await g.close();
    return out;
  };
  let o = await lesson(false);
  check('following the pointer ends with Cash register first, Restocking second, and the lesson done', o.jobs === 'till>stock' && o.past, 'jobs: ' + o.jobs + ' | pointer said: ' + J(o.said));
  o = await lesson(true);
  check('tapping the two the other way round still ends with Cash register first', o.jobs === 'till>stock' && o.past, 'jobs: ' + o.jobs + ' | pointer said: ' + J(o.said));
}

console.log('');
check('no script errors on the page in any run', errorsSeen.length === 0, errorsSeen.slice(0, 3).join(' | '));
await browser.close();
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
