// First steps check. Run from the repo:  node tests/tutorial-from-title.test.mjs   (add --html <file> to check another copy of index.html)
// Needs Playwright and Chrome; THREE_JS, CHROME and PLAYWRIGHT_DIR work as in staff-jobs.test.mjs. Takes about a minute and a half.
//
// It starts a brand-new game at the title screen on a phone-sized touch screen and plays it with real taps, with the game running
// in real time: Start, the character screens, the opening lines, building the first shop, opening it, and the jobs lesson.
// It follows the game's own pointer, and in the jobs lesson it also does what a new player might do instead.
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

function loadPlaywright() {
  for (const d of [here + '/', (process.env.PLAYWRIGHT_DIR || '/opt/npm-tools/node_modules') + '/']) { try { return createRequire(d)('playwright'); } catch (_) {} }
  throw new Error('Playwright not found. Install it (npm i -g playwright) or set PLAYWRIGHT_DIR.');
}
const { chromium } = loadPlaywright();
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const chromePath = process.env.CHROME || (fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);
const browser = await chromium.launch({ executablePath: chromePath, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

// what the game is showing right now, and where its pointer points on the screen
function look() {
  const S = window.__shop, c = S.cue();
  let at = null;
  if (c && c.p) { const e = S.peek('specEl')(c.p); if (e) { const r = e.getBoundingClientRect(); if (r.width > 5) at = [r.left + r.width / 2, r.top + r.height / 2]; } }
  if (!at) { const m = S.peek('goalMark'); if (m) { const q = S.toScreen(m.x, (m.y || 0) + 0.5, m.z); at = [q.x, q.y]; } }
  const row = k => { const e = document.querySelector('#mgmtBody .jrow[data-k="' + k + '"]'); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  const close = (() => { const r = document.getElementById('mgmtClose').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })();
  return {
    title: document.getElementById('title').classList.contains('on'), creator: document.getElementById('creator').classList.contains('on'),
    phase: S.tutPhase(), goal: S.state.goal, name: (S.goals[S.state.goal] || {}).name, says: c ? c.s : '', todo: c ? c.d : '', p: c ? c.p : null, at,
    jobs: S.workers[0].jobs.join('>'), open: S.jobsOpen(), rows: { till: row('till'), stock: row('stock'), food: row('food') }, close,
  };
}

// One new game. `how` says what to do in the jobs lesson instead of simply following the pointer.
async function play(how) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
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
    return route.abort();
  });
  await page.addInitScript(() => { window.AudioContext = window.webkitAudioContext = undefined; });      // no sound: headless Chrome has no speaker
  await page.goto('http://game.test/index.html');
  await page.waitForFunction(() => window.__shop && document.getElementById('loading').hidden, null, { timeout: 60000 });
  const tap = async at => { await page.touchscreen.tap(at[0], at[1]); };
  const tapSel = async sel => { const b = await page.evaluate(q => { const r = document.querySelector(q).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, sel); await tap(b); };
  const see = () => page.evaluate(look);
  const key = s => [s.title, s.creator, s.phase, s.goal, s.todo, s.p, s.jobs, s.open].join('|');
  // after a tap, wait until the game shows something new (or a second and a half passes)
  const settle = async before => { for (let i = 0; i < 10; i++) { await page.waitForTimeout(150); if (key(await see()) !== before) break; } await page.waitForTimeout(250); };

  const said = [], trail = [];      // what the pointer asked for, and each state of my jobs during the lesson
  let s = await see(), stuck = '', extra = { other: false, twice: {}, closed: false, random: 0 };
  let seed = 7; const dice = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let n = 0; n < 140; n++) {
    s = await see();
    const k = key(s);
    if (process.env.TRACE) console.log(n, k);
    if (s.goal > 4 && s.name !== 'Give yourself jobs') break;      // past the jobs lesson
    if (s.todo && said[said.length - 1] !== s.todo) said.push(s.todo);
    if (s.name === 'Give yourself jobs' && trail[trail.length - 1] !== (s.jobs || 'none') + (s.open ? '' : ' (sheet closed)')) trail.push((s.jobs || 'none') + (s.open ? '' : ' (sheet closed)'));
    let at = s.at;
    if (s.creator) await tapSel('#crNext');      // the character screens sit on top of the title
    else if (s.title) await tapSel('#titleGo');
    else if (s.phase === 'intro') await tapSel('#guideNext');
    else {
      const job = s.p && s.p.indexOf('job:') === 0 ? s.p.slice(4) : null;
      if (s.name === 'Give yourself jobs' && s.open) {
        if (how === 'other order' && job && !extra.other) { extra.other = true; at = s.rows[job === 'till' ? 'stock' : 'till']; }      // taps the other job first
        else if (how === 'each job twice' && job && !extra.twice[job]) { extra.twice[job] = true; await tap(s.rows[job]); await page.waitForTimeout(200); at = s.rows[job]; }      // taps it on, then off again
        else if (how === 'closes early' && job && !extra.closed) { extra.closed = true; at = s.close; }      // closes the sheet before finishing
        else if (how === 'taps at random' && extra.random < 14) { extra.random++; at = [s.rows.till, s.rows.stock, s.rows.food, s.rows.stock, s.rows.till, s.close][dice(6)]; }      // fourteen taps anywhere on the sheet, then follows the pointer
      }
      if (!at) { await page.waitForTimeout(400); if (n > 120) stuck = 'nothing to tap: ' + k; continue; }
      await tap(at);
    }
    await settle(k);
    if (n === 139) stuck = 'still at: ' + k;
  }
  s = await see();
  const done = s.goal > 4 && s.name !== 'Give yourself jobs';
  await ctx.close();
  return { done, jobs: s.jobs, goal: s.name, said, trail, stuck, errors };
}

let failed = 0, passed = 0;
function check(name, ok, detail) { if (ok) passed++; else failed++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '\n        ' + detail : '')); }
console.log('Checking ' + path.relative(process.cwd(), HTML) + ': a new game from the title screen, real taps\n');

const ways = [
  ['follows the pointer', 'till>stock'],
  ['other order', 'till>stock'],
  ['each job twice', 'till>stock'],
  ['closes early', 'till>stock'],
  ['taps at random', null],      // any jobs will do: the point is that the lesson can still be finished
];
for (const [how, want] of ways) {
  const r = await play(how);
  check('new game, player ' + (how === 'follows the pointer' ? how : 'in the jobs lesson: ' + how) + ': gets past the jobs lesson' + (want ? ' with Cash register first, Restocking second' : ''),
    r.done && !r.errors.length && (want ? r.jobs === want : /till/.test(r.jobs) && /stock/.test(r.jobs)),
    'ended at "' + r.goal + '" with jobs ' + (r.jobs || '(none)') + (r.stuck ? ' | ' + r.stuck : '') + (r.errors.length ? ' | errors: ' + r.errors[0] : '') + '\n        pointer said: ' + JSON.stringify(r.said) + '\n        my jobs during the lesson: ' + r.trail.join('  ->  '));
}
await browser.close();
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
