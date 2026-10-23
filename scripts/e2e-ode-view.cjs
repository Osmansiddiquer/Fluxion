#!/usr/bin/env node
/**
 * Browser end-to-end checks for the ODE qualitative view (slope fields, phase
 * plane, equilibria, IC drag, shift-click extra solutions, families, the
 * numerical-vs-exact readout), in headless Chromium via playwright-core, with
 * interaction timings under a 4× CPU throttle. Not part of `npm test`.
 *
 *   npm run dev                       # or: npx vite --port 5173
 *   node scripts/e2e-ode-view.cjs [baseUrl] [--shots dir]
 *
 * playwright-core is resolved like scripts/e2e-script-mode.cjs (PLAYWRIGHT_CORE first).
 */
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

const F = { extrema: true, xIntercepts: true, yIntercept: true, endpoints: false, discontinuities: true, intersections: true };
const E = (id, raw, color, extra = {}) => ({ id, raw, color, visible: true, expanded: true, ...extra });
const SCENES = {
  slope: {
    entries: [E('s1', "y' = y*(1 - y)", '#c74440', { ic: [0.1], t0: 0 })],
    viewport: { tMin: -4, tMax: 6, yMin: -1.5, yMax: 2.5 },
  },
  lv: {
    entries: [E('l1', "x' = x*(1 - y)", '#2d70b3', { ic: [2], phase: true }), E('l2', "y' = y*(x - 1)", '#c74440', { ic: [1] })],
    viewport: { tMin: -1, tMax: 5, yMin: -1, yMax: 3.5 },
    projections: { rightOpen: true, bottomOpen: false, sliceT: 1, sliceY: 1 },
  },
  pendulum: {
    entries: [E('p1', "y'' = -sin(y) - 0.2y'", '#6042a6', { ic: [2, 0], phase: true })],
    viewport: { tMin: -7, tMax: 7, yMin: -3.5, yMax: 3.5 },
  },
  lorenz: {
    entries: [
      E('z1', "x' = 10*(y - x)", '#2d70b3', { ic: [1], phase: true }),
      E('z2', "y' = x*(28 - z) - y", '#c74440', { ic: [1], expanded: false }),
      E('z3', "z' = x*y - 8/3*z", '#388c46', { ic: [1], expanded: false }),
    ],
    viewport: { tMin: -30, tMax: 30, yMin: -5, yMax: 55 },
  },
  damping: {
    entries: [E('d1', 'c = 0.5', '#000000', { varMin: 0, varMax: 3, family: true }), E('d2', "y'' = -c*y' - y", '#c74440', { ic: [1, 0] })],
    viewport: { tMin: -1, tMax: 12, yMin: -1.5, yMax: 1.5 },
  },
  compare: {
    entries: [E('c1', "y' = -y", '#c74440', { ic: [1] }), E('c2', 'y = e^(-x)', '#2d70b3', { expanded: false })],
    viewport: { tMin: -1, tMax: 5, yMin: -0.5, yMax: 2.5 },
    projections: { rightOpen: true, bottomOpen: false, sliceT: 2, sliceY: 1 },
  },
};

async function seed(page, g, theme = 'light') {
  // Write storage from a same-origin page that isn't the app, so a running app
  // can't persist its own state over the seed before the reload.
  await page.goto(`${base}llms.txt`);
  await page.evaluate(
    ({ g, F, theme }) => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('fluxion-tour-seen', '1');
      const blob = JSON.stringify({
        state: { features: F, projections: { rightOpen: false, bottomOpen: false, sliceT: 1, sliceY: 1 }, sidebarWidth: 360, ...g, theme },
        version: 2,
      });
      localStorage.setItem('ode-plotter', blob);
      sessionStorage.setItem('ode-plotter', blob);
    },
    { g, F, theme },
  );
  await page.goto(base);
  await page.waitForTimeout(900);
}
const state = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('ode-plotter')).state);
async function toScreen(page, t, y) {
  const st = await state(page);
  const r = await page.evaluate(() => {
    const b = document.querySelector('.plot-canvas').getBoundingClientRect();
    return { x: b.left, y: b.top, w: b.width, h: b.height };
  });
  const v = st.viewport;
  return [r.x + ((t - v.tMin) / (v.tMax - v.tMin)) * r.w, r.y + r.h - ((y - v.yMin) / (v.yMax - v.yMin)) * r.h];
}
/** Drag, timing each move until two frames have painted. */
async function timedDrag(page, from, to, steps) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  const times = [];
  for (let i = 1; i <= steps; i++) {
    const t0 = Date.now();
    await page.mouse.move(from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    times.push(Date.now() - t0);
  }
  await page.mouse.up();
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}
async function shiftClick(page, p) {
  await page.keyboard.down('Shift');
  await page.mouse.click(p[0], p[1]);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(200);
}
const close = (a, b, eps = 0.05) => Math.abs(a - b) < eps;

(async () => {
  const browser = await chromium.launch(
    fs.existsSync('/home/nimda/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome')
      ? { executablePath: '/home/nimda/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome' }
      : {},
  );
  const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const cdp = await page.context().newCDPSession(page);
  const throttle = (rate) => cdp.send('Emulation.setCPUThrottlingRate', { rate });

  // Slope field: IC drag, shift-click, clear.
  await seed(page, SCENES.slope);
  check('slope field switch shown', await page.getByRole('switch', { name: 'Slope field' }).isVisible());
  await throttle(4);
  const icMs = await timedDrag(page, await toScreen(page, 0, 0.1), await toScreen(page, 1, 0.6), 20);
  await throttle(1);
  let st = await state(page);
  check('IC drag moves t0 and y0', close(st.entries[0].t0, 1) && close(st.entries[0].ic[0], 0.6), JSON.stringify([st.entries[0].t0, st.entries[0].ic]));
  check('IC drag values snap to the pixel grid', String(st.entries[0].ic[0]).length <= 5, String(st.entries[0].ic[0]));
  check(`IC drag under 4× throttle (median ${icMs} ms/move)`, icMs < 250);
  await shiftClick(page, await toScreen(page, -2, 1.8));
  await shiftClick(page, await toScreen(page, 2, -0.2));
  st = await state(page);
  check('shift-click adds extra solutions', (st.entries[0].extraICs ?? []).length === 2, JSON.stringify(st.entries[0].extraICs));
  const clear = page.getByText('Clear 2 extra solutions');
  check('clear control appears with extras', await clear.isVisible());
  await clear.click();
  await page.waitForTimeout(150);
  check('clear removes them and hides itself', !(await state(page)).entries[0].extraICs && (await page.getByText(/extra solution/).count()) === 0);
  await page.locator('.feat-btn').click();
  check('Points menu lists Equilibria for an ODE', await page.getByText('Equilibria', { exact: true }).isVisible());
  await page.locator('.feat-btn').click();

  // Lotka–Volterra phase plane.
  await seed(page, SCENES.lv);
  check('phase switch shown on the first row only', (await page.getByRole('radio', { name: 'phase' }).count()) === 1);
  check('second row explains where it went', await page.getByText(/Drawn in the phase plane/).isVisible());
  check('field & nullclines switch', await page.getByRole('switch', { name: 'Vector field and nullclines' }).isVisible());
  {
    const p = await toScreen(page, 1, 1);
    await page.mouse.move(p[0], p[1]);
    await page.waitForTimeout(200);
    const tip = await page.locator('.plot-tooltip').innerText();
    check('centre at (1, 1) with eigenvalues ±i', /Centre equilibrium/.test(tip) && /λ = 0 \+ 1i, 0 − 1i/.test(tip), tip.replace(/\n/g, ' | '));
    const q = await toScreen(page, 0, 0);
    await page.mouse.move(q[0], q[1]);
    await page.waitForTimeout(200);
    const tip2 = await page.locator('.plot-tooltip').innerText();
    check('saddle at the origin', /Saddle equilibrium/.test(tip2), tip2.replace(/\n/g, ' | '));
  }
  await page.getByRole('radio', { name: 'vs t' }).click();
  await page.waitForTimeout(200);
  check('vs t switch clears phase on the group', !(await state(page)).entries.some((e) => e.phase));
  await page.getByRole('radio', { name: 'phase' }).click();
  await page.waitForTimeout(200);
  check('phase switch sets it on the leader', (await state(page)).entries[0].phase === true);

  // Pendulum: phase IC drag + shift-click under throttle.
  await seed(page, SCENES.pendulum);
  await throttle(4);
  const phMs = await timedDrag(page, await toScreen(page, 2, 0), await toScreen(page, -1, 2.5), 20);
  await throttle(1);
  st = await state(page);
  check('phase IC drag edits (y, y′)', close(st.entries[0].ic[0], -1, 0.1) && close(st.entries[0].ic[1], 2.5, 0.1), JSON.stringify(st.entries[0].ic));
  check(`phase drag under 4× throttle (median ${phMs} ms/move)`, phMs < 250);
  await shiftClick(page, await toScreen(page, 3, 1));
  st = await state(page);
  const ex = st.entries[0].extraICs?.[0] ?? [];
  check('phase shift-click adds [t0, y, y′]', ex.length === 3 && close(ex[1], 3, 0.1) && close(ex[2], 1, 0.1), JSON.stringify(ex));

  // Lorenz: axes picker.
  await seed(page, SCENES.lorenz);
  const sel = page.getByLabel('Vertical axis');
  check('3-D system shows an axes picker', await sel.isVisible());
  await sel.selectOption({ label: 'z' });
  await page.waitForTimeout(200);
  check('axes picker writes phaseAxes', JSON.stringify((await state(page)).entries[0].phaseAxes) === JSON.stringify(['x', 'z']));

  // Family.
  await seed(page, SCENES.damping);
  check('family button shown for a slider an ODE uses', await page.locator('.family-btn').isVisible());
  await page.locator('.family-btn').click();
  await page.waitForTimeout(250);
  check('family button turns the family off', !(await state(page)).entries[0].family);
  await page.locator('.family-btn').click();
  await page.waitForTimeout(250);
  check('and on again', (await state(page)).entries[0].family === true);
  await throttle(4);
  const famMs = await timedDrag(page, await toScreen(page, 0, 1), await toScreen(page, 0, 0.5), 12);
  await throttle(1);
  check(`IC drag with a 7-curve family under 4× throttle (median ${famMs} ms/move)`, famMs < 300);

  // Numerical vs exact readout.
  await seed(page, SCENES.compare);
  const diff = page.locator('.proj-diff');
  check('right panel shows the ODE − function difference', (await diff.count()) === 1 && /=/.test(await diff.innerText()), await diff.innerText().catch(() => ''));

  // Screenshots: every scene, light + dark, desktop + 390 px.
  if (shots) {
    for (const [name, g] of Object.entries(SCENES)) {
      for (const theme of ['light', 'dark']) {
        for (const [w, h, tag] of [
          [1400, 860, 'desk'],
          [390, 844, 'phone'],
        ]) {
          await page.setViewportSize({ width: w, height: h });
          await seed(page, g, theme);
          await page.screenshot({ path: `${shots}/${name}-${tag}-${theme}.png` });
        }
      }
    }
  }

  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
