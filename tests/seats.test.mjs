// Seats check. Run from the repo:  node tests/seats.test.mjs   (add --html <file> to check another copy of index.html)
// Needs Playwright and Chrome; THREE_JS, CHROME and PLAYWRIGHT_DIR work as in staff-jobs.test.mjs. Takes under a minute.
//
// It builds every seat in the real page, sits an adult in it with each hairstyle, and measures the models themselves:
//  - the egg chair: no part of its stand inside the shell, its cushions inside the shell, and no part of any head through the shell wall;
//  - every other seat: how much of a sitter's head and chest ends up inside solid furniture (a back, an arm, a wing).
// Numbers cannot say whether a chair looks right; pictures for that are made separately. These catch a head or an arm going through something.
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
  return route.abort();
});
await page.addInitScript(() => {
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => cb && cb.name === 'frame' ? 0 : raf(cb);      // nothing needs to move
  window.AudioContext = window.webkitAudioContext = undefined;
  Storage.prototype.setItem = function () {};
  let a = 5; Math.random = function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
});
await page.goto('http://game.test/index.html?skip=all');
await page.waitForFunction(() => window.__shop && document.getElementById('loading').hidden, null, { timeout: 60000 });

let failed = 0, passed = 0;
function check(name, ok, detail) { if (ok) passed++; else failed++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '\n        ' + detail : '')); }
const J = x => JSON.stringify(x);
console.log('Checking ' + path.relative(process.cwd(), HTML) + ': seats\n');

// ---------- the egg chair ----------
const egg = await page.evaluate(() => {
  const S = window.__shop, P = S.peek, T = P('T');
  S.setLevelXP(9999999); P('level=levelFor(xpTotal())'); P('spawnTimer=1e9');
  const it = S.addItem('eggchair', { x: 3, z: 4, rot: 0 }, 0); it.group.updateMatrixWorld(true);
  // the shell is the wicker ball: one or more sphere pieces sharing a size and a middle
  const shells = [], solids = [];
  it.group.traverse(o => { if (!o.isMesh) return; if (o.geometry.type === 'SphereGeometry' && o.geometry.parameters.radius * o.scale.x > 0.3) shells.push(o); else solids.push(o); });
  const sh = shells[0], r = sh.geometry.parameters.radius, c = new T.Vector3(); sh.getWorldPosition(c);
  const A = r * sh.scale.x, B = r * sh.scale.y, val = v => ((v.x - c.x) / A) ** 2 + ((v.y - c.y) / B) ** 2 + ((v.z - c.z) / A) ** 2;
  // the stand, base and hook are the dark parts of the other mesh; the cushions are its light parts
  const dark = new T.Color('#3b2c40'), chain = new T.Color('#8d7f8c'), like = (col, i, k) => Math.abs(col.getX(i) - k.r) + Math.abs(col.getY(i) - k.g) + Math.abs(col.getZ(i) - k.b) < 0.03;
  let armIn = 0, armPts = 0, armDeepest = 9, cushOut = 0, cushPts = 0; const v = new T.Vector3();
  solids.forEach(m => {
    const pos = m.geometry.attributes.position, col = m.geometry.attributes.color;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); const q = val(v);
      if (col && like(col, i, dark)) { armPts++; armDeepest = Math.min(armDeepest, q); if (q < 0.98) armIn++; }
      else if (col && like(col, i, chain)) { /* the chain and ring meet the crown on purpose */ }
      else { cushPts++; if (q > 1.0) cushOut++; }
    }
  });
  // sit an adult in it with each hairstyle; a head point is through the wall if the shell lies between the egg's middle and that point
  shells.forEach(m => { m.material.side = T.DoubleSide; });
  const ray = new T.Raycaster(), up = new T.Vector3(0, 1, 0), styles = {}, to = P('seatSpot')(it, 0), f = P('frontOf')(it.rot);
  S.STYLES.forEach(style => {
    let through = 0, pts = 0, top = -9, gap = 9;
    for (let rep = 0; rep < 2; rep++) {
      const p = S.buildPerson({ style, neck: '', glasses: false, beard: rep === 1, dress: false });
      p.g.position.set(to.x, to.y, to.z); p.g.rotation.y = Math.atan2(f.dx, f.dz); S.peopleRoot.add(p.g); p.g.updateMatrixWorld(true);
      const pos = p.head.geometry.attributes.position, step = Math.max(1, Math.floor(pos.count / 400));
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i).applyMatrix4(p.head.matrixWorld); pts++; top = Math.max(top, v.y);
        const dir = v.clone().sub(c), dist = dir.length(); ray.set(c, dir.normalize());
        const hit = ray.intersectObjects(shells, false)[0];
        if (hit && hit.distance < dist - 0.004) through++;
        ray.set(v, up); const above = ray.intersectObjects(shells, false)[0]; if (above) gap = Math.min(gap, above.distance);
      }
      S.peopleRoot.remove(p.g);
    }
    styles[style] = { through, pts, top: +(top - 0).toFixed(3), gap: gap === 9 ? null : +gap.toFixed(3) };
  });
  P('removeItem')(it);
  return { shell: { halfWidth: +A.toFixed(3), halfHeight: +B.toFixed(3), middle: +c.y.toFixed(3), top: +(c.y + B).toFixed(3), pieces: shells.length }, armPts, armIn, armDeepest: +armDeepest.toFixed(3), cushPts, cushOut, styles, seatY: it.def.seatY };
});
console.log('1. The egg chair');
check('no part of the stand is inside the shell', egg.armPts > 100 && egg.armIn === 0, 'points of the stand and base: ' + egg.armPts + ', inside the shell: ' + egg.armIn + ' | closest any comes (1.00 is the shell wall, under 1 is inside): ' + egg.armDeepest);
check('the cushions are inside the shell', egg.cushPts > 100 && egg.cushOut === 0, 'cushion points: ' + egg.cushPts + ', outside the shell: ' + egg.cushOut);
const through = Object.entries(egg.styles).filter(([, s]) => s.through > 0).map(([k, s]) => k + ' ' + s.through + '/' + s.pts);
const gaps = Object.entries(egg.styles).map(([k, s]) => [k, s.gap]).filter(x => x[1] != null), tightest = gaps.sort((a, b) => a[1] - b[1])[0];
check('a seated adult, every one of the ' + Object.keys(egg.styles).length + ' hairstyles: no part of the head goes through the shell', Object.keys(egg.styles).length >= 17 && through.length === 0,
  through.length ? 'head points beyond the shell wall: ' + through.join(', ') : 'shell: ' + J(egg.shell) + ' | tallest head top: ' + Math.max(...Object.values(egg.styles).map(s => s.top)));
check('every head sits at least 5 cm under the shell above it', !!tightest && tightest[1] >= 0.05 && through.length === 0, tightest ? 'least room above a head: ' + tightest[1] + ' (' + tightest[0] + ')' : 'no head is under the shell at all');

// ---------- every other seat ----------
const others = await page.evaluate(() => {
  const S = window.__shop, P = S.peek, T = P('T'), ray = new T.Raycaster(), up = new T.Vector3(0, 1, 0), dn = new T.Vector3(0, -1, 0), v = new T.Vector3(), out = [];
  S.DEFS.filter(d => d.role === 'seat' && d.id !== 'eggchair').forEach(def => {
    const it = S.addItem(def.id, { x: 3, z: 4, rot: 0 }, 0); it.group.updateMatrixWorld(true);
    const meshes = []; it.group.traverse(o => { if (o.isMesh) meshes.push(o); });
    const sides = meshes.map(m => m.material.side); meshes.forEach(m => { m.material.side = T.DoubleSide; });
    const row = { id: def.id, name: def.name, head: 0, chest: 0 };
    for (let idx = 0; idx < (def.seats || 1); idx++) ['short', 'afro', 'pony', 'buns'].forEach(style => {
      const p = S.buildPerson({ style, neck: '', glasses: false, beard: false, dress: false }), to = P('seatSpot')(it, idx), f = P('frontOf')(it.rot);
      p.g.position.set(to.x, to.y, to.z); p.g.rotation.y = Math.atan2(f.dx, f.dz); S.peopleRoot.add(p.g); p.g.updateMatrixWorld(true);
      [['head', p.head], ['chest', p.rig.children[0]]].forEach(([part, mesh]) => {
        const pos = mesh.geometry.attributes.position, step = Math.max(1, Math.floor(pos.count / 160)); let inside = 0, tot = 0;
        for (let i = 0; i < pos.count; i += step) {
          v.fromBufferAttribute(pos, i); if (part === 'chest' && v.y < 0.26) continue;      // hips sink into a cushion: that is sitting
          v.applyMatrix4(mesh.matrixWorld); tot++;
          ray.set(v, up); if (ray.intersectObjects(meshes, false).length % 2 === 0) continue;      // inside a solid: an odd number of walls above and below
          ray.set(v, dn); if (ray.intersectObjects(meshes, false).length % 2 === 1) inside++;
        }
        row[part] = Math.max(row[part], tot ? Math.round(inside / tot * 100) : 0);
      });
      S.peopleRoot.remove(p.g);
    });
    meshes.forEach((m, i) => { m.material.side = sides[i]; });
    out.push(row); P('removeItem')(it);
  });
  return out.sort((a, b) => Math.max(b.head, b.chest) - Math.max(a.head, a.chest));
});
console.log('\n2. Every other seat (' + others.length + ')');
const LIMIT = 5, soft = { beanbag: 12 };      // a beanbag is sat into
const bad = others.filter(s => s.head > LIMIT || s.chest > (soft[s.id] || LIMIT));
check('no seat has more than ' + LIMIT + '% of a sitter\'s head or chest inside solid furniture (beanbag: chest up to 12%)', others.length >= 38 && bad.length === 0,
  (bad.length ? 'over the limit: ' + bad.map(s => s.name + ' head ' + s.head + '% chest ' + s.chest + '%').join('; ') + ' | ' : '') + 'highest: ' + others.slice(0, 6).map(s => s.name + ' ' + s.head + '/' + s.chest).join(', '));

console.log('');
check('no script errors on the page', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
