#!/usr/bin/env node
/**
 * Browser end-to-end checks for Script mode (sandbox isolation, runaway
 * scripts, examples, shared links), in headless Chromium via playwright-core.
 * Not part of `npm test` (no browser dependency in CI).
 *
 *   npm run dev                       # or: npx vite --port 5173
 *   node scripts/e2e-script-mode.cjs [baseUrl] [--shots dir]
 *
 * playwright-core is resolved from PLAYWRIGHT_CORE (a path), then the normal
 * module path. Browsers come from ~/.cache/ms-playwright (npx playwright install chromium).
 */
const path = require('node:path');
const fs = require('node:fs');

const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) ?? 'http://localhost:5173/').replace(/#.*$/, '');
const shotsIdx = args.indexOf('--shots');
const shots = shotsIdx >= 0 ? args[shotsIdx + 1] : null;
if (shots) fs.mkdirSync(shots, { recursive: true });

function loadPlaywright() {
  const tries = [process.env.PLAYWRIGHT_CORE, 'playwright-core', '/home/nimda/repos/ragdoll-sim/node_modules/playwright-core'].filter(Boolean);
  for (const t of tries) {
    try {
      return require(t);
    } catch {
      /* next */
    }
  }
  console.error('playwright-core not found: set PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core');
  process.exit(2);
}
const { chromium } = loadPlaywright();

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const specLink = (spec) => `${base}#spec=${encodeURIComponent(JSON.stringify(spec))}`;

async function open(page, url, theme = 'light') {
  await page.goto(base);
  await page.evaluate((theme) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('fluxion-tour-seen', '1');
    localStorage.setItem('ode-plotter', JSON.stringify({ state: { theme }, version: 2 }));
  }, theme);
  await page.goto('about:blank');
  await page.goto(url);
}

/** Wait until the console strip shows a result (shapes or an error). */
async function settle(page, ms = 8000, re = /\d+ shapes?|Line \d|Stopped|rejected|Error/) {
  await page.waitForFunction((src) => {
    const el = document.querySelector('.sp-console');
    return el && new RegExp(src).test(el.textContent || '');
  }, re.source, { timeout: ms });
  return page.evaluate(() => document.querySelector('.sp-console')?.textContent ?? '');
}

async function logs(page) {
  const btn = await page.$('.sp-console-toggle');
  if (btn && (await btn.getAttribute('aria-expanded')) !== 'true') await btn.click();
  await page.waitForTimeout(100);
  return page.evaluate(() => [...document.querySelectorAll('.sp-logs div')].map((d) => d.textContent));
}

/** Fraction of canvas pixels that differ from the corner (is anything drawn?). */
async function inked(page) {
  return page.evaluate(() => {
    const c = document.querySelector('.plot-canvas');
    const ctx = c.getContext('2d');
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    const [r0, g0, b0] = data;
    let n = 0;
    for (let i = 0; i < data.length; i += 16) if (Math.abs(data[i] - r0) + Math.abs(data[i + 1] - g0) + Math.abs(data[i + 2] - b0) > 30) n++;
    return n / (data.length / 16);
  });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  const requests = [];
  // Responses, not request attempts: a CSP-blocked load still fires 'request'.
  page.on('response', (r) => requests.push(r.url()));
  page.on('requestfailed', () => {});

  // 1. Isolation: the script can't reach the page, storage, cookies or network.
  const probe = [
    'const t = (f) => { try { return String(f()) } catch (e) { return "blocked:" + e.name } }',
    'const g = (0, eval)("this")',
    'print("parent.document", t(() => g.parent.document.title))',
    'print("document", t(() => g.document.cookie))',
    'print("localStorage", t(() => g.localStorage.getItem("ode-plotter")))',
    'print("fetch", typeof g.fetch)',
    'print("XMLHttpRequest", typeof g.XMLHttpRequest)',
    'print("importScripts", typeof g.importScripts)',
    'print("WebSocket", typeof g.WebSocket)',
    'print("indexedDB", typeof g.indexedDB)',
    'print("sendBeacon", typeof g.navigator.sendBeacon)',
    'print("origin", g.origin)',
    // Rebuild fetch from a fresh realm? There is none: no iframes / workers either.
    'print("Worker", typeof g.Worker)',
    'circle(0, 0, 1)',
  ].join('\n');
  await open(page, specLink({ script: probe }));
  const msg1 = await settle(page, 8000, /\d+ shapes?|Line \d/);
  const out = Object.fromEntries((await logs(page)).map((l) => [l.split(' ')[0], l.split(' ').slice(1).join(' ')]));
  check('script runs in the sandbox', /1 shape/.test(msg1), msg1.trim());
  check('no parent.document', /blocked|undefined/.test(out['parent.document'] ?? ''), out['parent.document']);
  check('no document / cookies', /blocked|undefined/.test(out.document ?? ''), out.document);
  check('no localStorage', /blocked|undefined/.test(out.localStorage ?? ''), out.localStorage);
  for (const k of ['fetch', 'XMLHttpRequest', 'importScripts', 'WebSocket', 'indexedDB', 'sendBeacon', 'Worker']) {
    check(`no ${k}`, out[k] === 'undefined', out[k]);
  }
  check('opaque origin', out.origin === 'null', out.origin);
  check('Script mode opened from the link', await page.$eval('.mode-seg-btn.active', (b) => b.textContent.trim() === 'Script'));
  const toast = await page.$('.graph-toast');
  check('link with a script says so', !!toast && /script/i.test(await toast.textContent()), toast ? await toast.textContent() : 'no toast');

  // Outer layers, assuming code escaped the worker into the iframe itself:
  // opaque origin (no parent DOM / storage) and a CSP that blocks all network.
  const sandbox = page.frames().find((f) => f !== page.mainFrame());
  check('sandbox iframe exists', !!sandbox);
  if (sandbox) {
    const r = await sandbox.evaluate(async () => {
      const t = async (f) => {
        try {
          return String(await f());
        } catch (e) {
          return 'blocked:' + (e && e.name);
        }
      };
      return {
        parentDoc: await t(() => parent.document.title),
        storage: await t(() => localStorage.length),
        cookie: await t(() => document.cookie),
        fetch: await t(() => fetch('https://example.com/x').then(() => 'ok')),
        img: await new Promise((res) => {
          const i = new Image();
          i.onload = () => res('loaded');
          i.onerror = () => res('blocked');
          i.src = 'https://example.com/pixel.png';
          setTimeout(() => res('timeout'), 3000);
        }),
        origin: location.origin,
      };
    });
    check('iframe: no parent DOM', /^blocked/.test(r.parentDoc), r.parentDoc);
    check('iframe: no storage', /^blocked/.test(r.storage), r.storage);
    check('iframe: no cookies', /^blocked/.test(r.cookie) || r.cookie === '', r.cookie);
    check('iframe CSP blocks fetch', /^blocked/.test(r.fetch), r.fetch);
    check('iframe CSP blocks images', r.img === 'blocked', r.img);
    check('iframe has an opaque origin', r.origin === 'null', r.origin);
  }
  const fromSandbox = requests.filter((u) => /example\.com/.test(u));
  check('nothing reached the network from the sandbox', fromSandbox.length === 0, fromSandbox.join(', '));

  // 2. Runaway scripts are killed; the app stays responsive.
  await open(page, specLink({ script: 'circle(0, 0, 1)\nwhile (true) {}' }));
  const t0 = Date.now();
  const killedMsg = await settle(page, 10000, /endless loop/);
  check('endless loop is stopped', /endless loop/i.test(killedMsg), `${killedMsg.trim()} after ${Date.now() - t0} ms`);
  const t1 = Date.now();
  await page.click('.mode-seg-btn:not(.active)');
  await page.waitForSelector('.sidebar-scroll', { timeout: 2000 });
  check('UI responsive after the kill', Date.now() - t1 < 1500, `${Date.now() - t1} ms to switch mode`);
  await page.click('.mode-seg-btn:not(.active)');
  await page.waitForSelector('.cm-content');
  // Fix the script by typing: replace the loop line.
  await page.click('.cm-content');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('circle(0, 0, 2, { fill: "tomato" })\n');
  const fixedMsg = await settle(page, 6000, /1 shape/).catch(() => page.evaluate(() => document.querySelector('.sp-console')?.textContent ?? ''));
  check('editing a killed script runs it again', /1 shape/.test(fixedMsg), fixedMsg.trim());

  // An animation that hangs mid-way is stopped by the per-frame budget.
  await open(page, specLink({ script: 'circle(cos(time), 0, 1)\nif (time > 0.5) while (true) {}' }));
  const hung = await settle(page, 12000, /endless loop/).then(
    () => true,
    () => false,
  );
  check('a frame that hangs during playback is stopped', hung);

  // 3. Errors are marked on their line.
  await open(page, specLink({ script: 'circle(0, 0, 1)\n\nnotAFunction()' }));
  const errMsg = await settle(page, 8000, /Line \d/);
  const marked = await page.waitForSelector('.cm-lintRange-error', { timeout: 3000 }).catch(() => null);
  check('runtime error reported with its line', /Line 3/.test(errMsg) && !!marked, errMsg.trim());

  // 4. Every example renders in Script mode, light and dark.
  const examples = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/examples/index.json'), 'utf8')).map((e) => e.id);
  for (const theme of ['light', 'dark']) {
    for (const id of examples) {
      await open(page, `${base}#example=${id}`, theme);
      const m = await settle(page);
      await page.waitForTimeout(700);
      const ink = await inked(page);
      check(`example ${id} (${theme}) renders`, /\d+ shapes?/.test(m) && !/Line|Error/.test(m) && ink > 0.01, `${m.trim()}, ${(ink * 100).toFixed(1)}% inked`);
      if (shots) await page.screenshot({ path: path.join(shots, `example-${id}-${theme}.png`) });
    }
  }

  // 5. The reference opens and "Try it" runs a snippet.
  await open(page, `${base}#example=cube`);
  await settle(page);
  await page.click('.sp-btn.ghost[aria-pressed]');
  await page.waitForSelector('.sd-entry');
  const first = await page.$$('.sd-entry .sd-btn.primary');
  await first[0].click();
  await page.waitForTimeout(800);
  const code = await page.$eval('.cm-content', (e) => e.textContent);
  check('reference "Try it" replaces the script', /Hello, Fluxion/.test(code));
  if (shots) await page.screenshot({ path: path.join(shots, 'reference-light.png') });

  // 6. Sliders from slider() appear and drive the drawing.
  await open(page, specLink({ script: 'const r = slider("radius", 0.5, 4, 1)\ncircle(0, 0, r, { fill: "teal" })\nprint(r)' }));
  await settle(page);
  await page.waitForSelector('.sp-slider input');
  await page.$eval('.sp-slider input', (el) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(el, '3');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(600);
  const sl = await logs(page);
  check('script slider drives the script', sl[0] === '3', JSON.stringify(sl));

  // 7. Share link round trip: the copied #g= link carries the script.
  await open(page, `${base}#example=mandala`);
  await settle(page);
  const shared = await page.evaluate(async () => {
    const state = JSON.parse(sessionStorage.getItem('ode-plotter'));
    return state.state.script.code.length;
  });
  check('script persisted per tab', shared > 100);

  // 8. In-app clip import: record a short WebM in the page (MediaRecorder),
  // import it through the Clips dialog, and play it from the script.
  await open(page, base);
  await page.click('.mode-seg-btn:not(.active)');
  await page.waitForSelector('.cm-content');
  const webm = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = 120;
    const ctx = c.getContext('2d');
    const rec = new MediaRecorder(c.captureStream(20), { mimeType: 'video/webm;codecs=vp8' });
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    let f = 0;
    const draw = () => {
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(0, 0, 160, 120);
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.arc(20 + (f % 40) * 3, 60 + 30 * Math.sin(f / 6), 16, 0, 7);
      ctx.fill();
      f++;
    };
    draw();
    const id = setInterval(draw, 50);
    rec.start(100);
    await new Promise((r) => setTimeout(r, 2500));
    clearInterval(id);
    await new Promise((r) => {
      rec.onstop = r;
      rec.stop();
    });
    const buf = new Uint8Array(await new Blob(chunks).arrayBuffer());
    let s = '';
    for (const b of buf) s += String.fromCharCode(b);
    return btoa(s);
  });
  const videoPath = path.join(require('node:os').tmpdir(), `fluxion-e2e-${Date.now()}.webm`);
  fs.writeFileSync(videoPath, Buffer.from(webm, 'base64'));
  await page.click('.sp-btn.ghost:has-text("Clips")');
  await page.waitForSelector('.ci');
  await page.setInputFiles('.ci input[type=file]', videoPath);
  await page.waitForSelector('.ci-preview canvas', { timeout: 10000 });
  await page.waitForTimeout(800);
  if (shots) await page.screenshot({ path: path.join(shots, 'clip-importer.png') });
  await page.click('.ci-foot .sp-btn.primary');
  const imported = await page
    .waitForSelector('.ci-msg', { timeout: 30000 })
    .then((el) => el.textContent());
  check('clip importer decodes, traces and stores a video', /Imported/.test(imported), imported);
  await page.keyboard.press('Escape');
  const clipRun = await settle(page, 8000, /\d+ shapes?|Line \d/);
  const usesClip = await page.$eval('.cm-content', (e) => /clip\("fluxion-e2e/.test(e.textContent));
  check('imported clip plays from the script', usesClip && /[23] shapes/.test(clipRun) && (await inked(page)) > 0.01, clipRun.trim());
  if (shots) await page.screenshot({ path: path.join(shots, 'clip-playing.png') });
  fs.unlinkSync(videoPath);

  check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
