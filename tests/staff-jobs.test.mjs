// Staff jobs check. Run from the repo:  node tests/staff-jobs.test.mjs   (add --html <file> to check another copy of index.html)
// Needs Playwright and Chrome. With no internet, point THREE_JS at a local copy of three.js r128 (three.min.js).
//
// It opens the real page in headless Chrome, builds a small shop, changes jobs by tapping the rows of the jobs screen,
// steps the game's own clock, and records what each member of staff does. Nothing here is loaded by the game or its service worker.
// Other settings: CHROME (path to the browser), PLAYWRIGHT_DIR (a node_modules folder that holds playwright).
// fixtures/save-4dedba2.json is a save written by the game as it was at commit 4dedba2, before the jobs change.
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

  // and in the shop: helper 1 (Food chosen last) is the one at the coffee machine, ahead of helper 2 who also has Food first
  const r = await g.ev(() => window.T.run(150));
  const hold = r.hold.espresso || [0, 0, 0];
  check('after choosing Food for helper 1, helper 1 minds the coffee machine', hold[1] > 75 && hold[1] > hold[2] * 2, 'seconds holding the coffee machine [owner, helper 1, helper 2]: ' + J(hold) + ' of ' + r.secs);
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

  // the owner minds the only register. The player taps Cash register for helper 1: both now have it first, the last chosen gets it.
  const hadTill = await g.ev(() => window.T.holder('register'));
  const rows = await tapJob(g, 1, 'till');
  const t15 = await g.ev(() => window.T.run(15));
  check('tap Cash register for helper 1 while the owner minds the only register: helper 1 takes it over', hadTill === 0 && (t15.hold.register || [])[1] >= 12, 'register held by person ' + hadTill + ' before; next 15 seconds held [owner, helper 1, helper 2]: ' + J(t15.hold.register) + ' | rows: ' + rows);
  check('the owner steps out of the staff spot', t15.staffSpotIdle[0] <= 1, 'seconds idle in a staff spot: ' + J(t15.staffSpotIdle));

  // that choice survives closing and reopening the game, even when the owner gets to the register first
  const saved = await g.ev(() => { window.__shop.peek('saveNow')(); return window.T.jobs(); });
  await g.reload();
  const back = await g.ev(() => window.T.jobs());
  check('jobs come back in the same order after a reload', J(back) === J(saved), 'saved ' + J(saved) + ' | loaded ' + J(back));
  await g.ev(() => { window.T.doors(false); window.__shop.workers[1].think = 4; return window.T.run(3); });      // helper 1 is slow off the mark
  const first = await g.ev(() => window.T.holder('register'));
  const r3 = await g.ev(() => window.T.run(10));
  const then = await g.ev(() => window.T.holder('register'));
  check('after the reload the last-chosen person still gets the register from the owner', first === 0 && then === 1, 'register held by person ' + first + ' at first, then by person ' + then + ' | seconds held: ' + J(r3.hold.register));

  // doors open: a busy shop for two and a half minutes
  const r = await g.ev(() => { window.T.doors(true); return window.T.run(150); });
  check('with customers: helper 2 (Food first) makes more of the orders than helper 1 (Food third)', r.made[2] > r.made[1], 'orders made [owner, helper 1, helper 2]: ' + J(r.made) + ' | coffee machine held: ' + J(r.hold.espresso));
  check('with customers: helper 1 holds the register more than the owner', (r.hold.register || [])[1] > r.hold.register[0], 'seconds holding the register [owner, helper 1, helper 2]: ' + J(r.hold.register) + ' of ' + r.secs + ' | activity: ' + J(r.act));
  check('nobody with nothing to do stands in a staff spot', r.staffSpotIdle.every(x => x <= 1), 'seconds idle in a staff spot: ' + J(r.staffSpotIdle));
  check('nobody standing still shares a tile', r.clash === 0, 'clashes: ' + r.clash);
  errorsSeen.push(...g.errors); await g.close();
}

/* ---------- 2b. two registers, two people on Cash register: nobody takes a register someone else is working ---------- */
{
  const g = await shop();
  await g.ev(() => {
    const T = window.T;
    T.build({ espresso: false }); T.put('counter', 5, 4); T.put('register', 5, 4, 0);      // books only, so nobody leaves a register to make coffee
  });
  await hireTwo(g);
  await g.ev(() => { window.T.setJobs([['till'], ['till'], []]); window.__shop.workers[1].pick = 9; });      // helper 1 was chosen last
  const r = await g.ev(() => {
    const S = window.__shop, regs = S.items.filter(i => i.def.id === 'register'), held = regs.map(() => [0, 0, 0]);
    for (let k = 0; k < 20; k++) S.simulate(0.05);      // a second to walk over
    let swaps = 0; const at = regs.map(q => q.worker);
    for (let k = 0; k < 150 / 0.05; k++) {
      S.simulate(0.05);
      regs.forEach((q, i) => { if (q.worker) { held[i][S.workers.indexOf(q.worker)] += 0.05; if (at[i] && q.worker !== at[i]) swaps++; at[i] = q.worker; } });
    }
    return { held: held.map(h => h.map(Math.round)), swaps, books: S.state.stats.books };
  });
  check('two registers, two people on Cash register: each keeps their own', r.swaps === 0 && r.books > 0, 'changes of hands: ' + r.swaps + ' | seconds held per register [owner, helper 1, helper 2]: ' + J(r.held) + ' | books sold: ' + r.books);
  errorsSeen.push(...g.errors); await g.close();
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

/* ---------- 4. the jobs lesson in the first steps ---------- */
{
  console.log('\n4. The jobs lesson in the first steps');
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
