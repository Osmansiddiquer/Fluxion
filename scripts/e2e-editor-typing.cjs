#!/usr/bin/env node
/**
 * Types a corpus of expressions into the expression rows' MathLive field the way
 * a person does — one key at a time, Shift held for ( ) ^ | { } : < > ? _ + *,
 * plus Backspace, arrows, Home/End, Tab/Enter on suggestions, select-all and
 * paste — then checks what was stored (the entry's raw text), how it parses and
 * that no error is shown. Not part of `npm test`.
 *
 *   npx vite --port 5160            # or npm run dev
 *   node scripts/e2e-editor-typing.cjs [baseUrl] [--dump] [--only regex] [--shots dir]
 *
 * --dump prints every row (field LaTeX, stored raw, kind, error) instead of
 * asserting only. playwright-core is resolved like scripts/e2e-ode-view.cjs.
 */
const fs = require('node:fs');

const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) ?? 'http://localhost:5173/').replace(/#.*$/, '').replace(/\/?$/, '/');
const dump = args.includes('--dump');
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? new RegExp(args[onlyIdx + 1]) : null;
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

// US layout: the characters a person types with Shift held.
const SHIFT = {
  '~': 'Backquote', '!': 'Digit1', '@': 'Digit2', '#': 'Digit3', $: 'Digit4', '%': 'Digit5', '^': 'Digit6',
  '&': 'Digit7', '*': 'Digit8', '(': 'Digit9', ')': 'Digit0', _: 'Minus', '+': 'Equal', '{': 'BracketLeft',
  '}': 'BracketRight', '|': 'Backslash', ':': 'Semicolon', '"': 'Quote', '<': 'Comma', '>': 'Period', '?': 'Slash',
};
async function typeHuman(page, text) {
  for (const ch of text) {
    if (SHIFT[ch]) await page.keyboard.press(`Shift+${SHIFT[ch]}`);
    else if (/^[A-Z]$/.test(ch)) await page.keyboard.press(`Shift+Key${ch}`);
    else if (ch === ' ') await page.keyboard.press('Space');
    else await page.keyboard.type(ch);
    await page.waitForTimeout(25);
  }
}

const L = { k: 'ArrowLeft' };
const R = { k: 'ArrowRight' };
const BS = { k: 'Backspace' };
const TAB = { k: 'Tab' };
const EN = { k: 'Enter' };
/** A case: keys typed, the raw text it must store, the kind it must parse as. */
const T = (text, raw, kind, extra = {}) => ({ name: text, steps: [text], raw, kind, ...extra });
const S = (name, steps, raw, kind, extra = {}) => ({ name, steps, raw, kind, ...extra });

const CASES = [
  // Brackets
  T('sin(x)', 'sin(x)', 'function'),
  T('(x+1)(x-1)', '(x+1)(x-1)', 'function'),
  T('2(x+3)^2', '2(x+3)^2', 'function'),
  T('f(x)=x^2', 'f(x)=x^2', 'fndef'),
  T('f(2)', 'f(2)', 'function', { pre: ['f(x)=x^2'] }),
  T('((x+1)/(x-1))', '((x+1)/(x-1))', 'function'),
  S(') over the auto-inserted one', ['y=(x+1', ')', '^2'], 'y=(x+1)^2', 'function'),
  S('( then Backspace', ['y=(', BS, 'x'], 'y=x', 'function'),
  S('Backspace the closing bracket', ['y=(x+1)', BS, BS, BS], 'y=(x)', 'function'),
  S('bracket inserted mid-expression', ['y=x+1', { k: 'Home' }, R, R, '(', { k: 'End' }, ')'], 'y=(x+1)', 'function'),
  T('y=|x|+1', 'y=abs(x)+1', 'function'),
  T('y=|x-1|+|x+1|', 'y=abs(x-1)+abs(x+1)', 'function'),
  T('[1,2,3]', '[1,2,3]', 'function'),
  T('y={x<0: -x, x}', 'y={ x<0: -x, x}', 'function'),
  T('y=x^2 {0<x<2}', 'y=x^2 {0<x<2}', 'function'),
  T('(1,2)', '(1,2)', 'points'),
  T('(cos(t), sin(t))', '(cos(t), sin(t))', 'parametric'),
  T('y=mod(x,3)', 'y=mod(x,3)', 'function'),
  // ODEs and primes
  T("y'=y", "y'=y", 'ode'),
  T("y''=-y", "y''=-y", 'ode'),
  T("y'=y(1-y)", "y'=y(1-y)", 'ode'),
  T('dy/dx = x*y', '((dy)/(dx))= x* y', 'ode'),
  T('dy/dt=-y', '((dy)/(dt))=-y', 'ode'),
  T("y'' + 2y' + y = 0", "y'' + 2y' + y = 0", 'ode'),
  T('y(0)=1', 'y(0)=1', 'condition', { pre: ["y'=y"] }),
  T("y''=-y, y(0)=1, y'(0)=0", "y''=-y, y(0)=1, y'(0)=0", 'ode'),
  T("X''=-ω_0 X - bX'", "X''=-omega_0 X - bX'", 'ode', {
    pre: ['omega_0=2', 'b=1'],
    // bX is one name (like ky): the row asks for bX′. Typing b X′ multiplies.
    allowErr: /bX′/,
  }),
  T("θ''=-sin(θ)", "theta''=-sin(theta)", 'ode'),
  T("theta''=-sin(theta)", "theta''=-sin(theta)", 'ode'),
  // Names, Greek, subscripts
  T('y=alpha x', 'y=alpha x', 'function', { pre: ['alpha=1'] }),
  T('r=theta', 'r=theta', 'polar'),
  T('y=a_1 x', 'y=a_1 x', 'function', { pre: ['a_1=3'] }),
  T('a_1=3', 'a_1=3', 'variable'),
  T('y=k x', 'y=k x', 'function', { pre: ['k=2'] }),
  // Fractions, powers, roots
  T('y=1/(x+1)', 'y=((1)/(x+1))', 'function'),
  T('y=e^(-x^2)', 'y=e^(-x^2)', 'function'),
  T('y=e^(-x)sin(x)', 'y=e^(-x)sin(x)', 'function'),
  T('y=x^2y', 'y=x^2y', 'function'),
  S('^ then → leaves the exponent', ['y=x^2', R, '+1'], 'y=x^2+1', 'function'),
  T('y=x^12', 'y=x^12', 'function'),
  T('y=sin^2(x)+cos^2(x)', 'y=sin^2(x)+cos^2(x)', 'function'),
  T('y=sqrt(x^2+1)', 'y=sqrt(x^2+1)', 'function'),
  T('y=nthroot(x,3)', 'y=nthroot(x,3)', 'function'),
  T('y=2pi x', 'y=2pi x', 'function'),
  T('y=2sin(x)', 'y=2sin(x)', 'function'),
  T('y=x(x+1)', 'y=x(x+1)', 'function'),
  T('y=a(x+1)', 'y=a(x+1)', 'function', { pre: ['a=2'] }),
  T('y=log(x)', 'y=log(x)', 'function'),
  T('y=log_2(x)', 'y=log(x, 2)', 'function'),
  T('y=floor(x)+ceil(x)', 'y=floor(x)+ceil(x)', 'function'),
  T('y=abs(x)+sign(x)', 'y=abs(x)+sign(x)', 'function'),
  // Relations, sliders, functions, misc
  T('y<=x^2', 'y<= x^2', 'inequality'),
  T('x^2+y^2<4', 'x^2+y^2<4', 'inequality'),
  T('a=2', 'a=2', 'variable'),
  T('g(u)=u^2+1', 'g(u)=u^2+1', 'fndef'),
  T('y=x<0?-x:x', 'y=x<0?-x:x', 'function'),
  T('y(2)', 'y(2)', 'function', { pre: ["y'=y"] }),
  T('y=1e-3x', 'y=1*10^(-3)x', 'function'),
  T('y=.5x', 'y=.5x', 'function'),
  T('y=-x^2', 'y=-x^2', 'function'),
  // Editing
  S('select all and retype', ['y=x', { k: 'Control+A' }, 'y=sin(x)'], 'y=sin(x)', 'function'),
  S('paste', [{ paste: 'y=sin(x)+(x-1)^2' }], 'y=sin(x)+(x-1)^2', 'function'),
  S('Backspace through a fraction', ['y=1/x', BS, BS, '2'], 'y=12', 'function'),
  S('Backspace through an exponent', ['y=x^2', BS, BS, BS, '+1'], 'y=x+1', 'function'),
  // Autocomplete
  S('suggestion with Tab', ['y=si', TAB, '(x)'], 'y=sin(x)', 'function'),
  S('suggestion with Enter', ['y=sq', EN, 'x'], 'y=sqrt(x)', 'function'),
  S('variable suggestion', ['y=am', TAB, 'x'], 'y=amp x', 'function', { pre: ['amp=2'] }),
];

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function runCase(page, c, n) {
  const id = `case${n}`;
  const pre = (c.pre ?? []).map((raw, i) => ({ id: `${id}p${i}`, raw, color: '#2d70b3', visible: true, expanded: false }));
  await page.evaluate(
    async ({ id, pre }) => {
      const { useStore } = await import('/src/store/useStore.ts');
      useStore.setState({ entries: [...pre, { id, raw: '', color: '#c74440', visible: true, expanded: false }] });
    },
    { id, pre },
  );
  await page.waitForTimeout(150);
  const mf = page.locator('math-field').last();
  await mf.click();
  await page.waitForTimeout(300);
  for (const s of c.steps) {
    if (typeof s === 'string') await typeHuman(page, s);
    else if (s.k) await page.keyboard.press(s.k);
    else if (s.paste != null) {
      await page.evaluate((t) => navigator.clipboard.writeText(t), s.paste);
      await page.keyboard.press('Control+V');
    }
  }
  await page.waitForTimeout(100);
  const latex = await mf.evaluate((el) => el.value);
  // While typing, no error yet (it waits for a pause).
  const errWhileTyping = await page.locator('.entry').last().locator('.entry-error').count();
  await mf.evaluate((el) => el.blur());
  await page.waitForTimeout(800);
  const out = await page.evaluate(async (id) => {
    const { useStore } = await import('/src/store/useStore.ts');
    const { parseEntry } = await import('/src/lib/math/parse.ts');
    const e = useStore.getState().entries.find((x) => x.id === id);
    const p = parseEntry(e.raw);
    const rows = document.querySelectorAll('.entry');
    const row = rows[rows.length - 1];
    const err = row.querySelector('.entry-error')?.textContent || row.querySelector('.entry-define')?.textContent || '';
    return { raw: e.raw, kind: p.kind, err, shown: row.querySelector('math-field').value };
  }, id);
  return { latex, errWhileTyping, ...out };
}

(async () => {
  const exe = '/home/nimda/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
  const browser = await chromium.launch(fs.existsSync(exe) ? { executablePath: exe } : {});
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.replace(/\/$/, '') });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${base}llms.txt`);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('fluxion-tour-seen', '1');
  });
  await page.goto(base);
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelectorAll('[class*=tour]').forEach((e) => e.remove()));

  let n = 0;
  for (const c of CASES) {
    if (only && !only.test(c.name)) continue;
    const r = await runCase(page, c, n++);
    if (dump) console.log(JSON.stringify({ name: c.name, ...r }));
    const ok = r.raw === c.raw && r.kind === c.kind && (!r.err || (c.allowErr && c.allowErr.test(r.err)));
    check(c.name, ok, ok ? '' : `stored ${JSON.stringify(r.raw)} (${r.kind}${r.err ? `; ${r.err}` : ''}), want ${JSON.stringify(c.raw)} (${c.kind}); field ${r.latex}`);
  }

  // A half-typed expression shows no error until typing pauses.
  {
    await page.evaluate(async () => {
      const { useStore } = await import('/src/store/useStore.ts');
      useStore.setState({ entries: [{ id: 'mid', raw: '', color: '#c74440', visible: true, expanded: false }] });
    });
    await page.waitForTimeout(150);
    await page.locator('math-field').last().click();
    await page.waitForTimeout(300);
    await typeHuman(page, 'y=');
    const early = await page.locator('.entry-error').count();
    await page.waitForTimeout(900);
    const late = await page.locator('.entry-error').count();
    check('mid-typing error waits for a pause', early === 0 && late === 1, `early ${early}, after pause ${late}`);
    await page.locator('math-field').last().evaluate((el) => el.blur());
  }

  if (shots) {
    const rows = ["y'=y(1-y)", '(cos(t), sin(t))', 'y={x<0: -x, x^2}', 'y=|x|+1', 'y=1/(x+1)', 'y=e^(-x)sin(x)', 'y=log_2(x)'];
    for (const theme of ['light', 'dark']) {
      await page.evaluate(
        async ({ theme }) => {
          const { useStore } = await import('/src/store/useStore.ts');
          useStore.setState({ entries: [{ id: 's0', raw: '', color: '#c74440', visible: true, expanded: false }], theme });
        },
        { theme },
      );
      await page.waitForTimeout(200);
      for (let i = 0; i < rows.length; i++) {
        if (i > 0) {
          await page.evaluate(async () => (await import('/src/store/useStore.ts')).useStore.getState().addEntry());
          await page.waitForTimeout(150);
        }
        await page.locator('math-field').nth(i).click();
        await page.waitForTimeout(300);
        await typeHuman(page, rows[i]);
        await page.locator('math-field').nth(i).evaluate((el) => el.blur());
        await page.waitForTimeout(200);
      }
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${shots}/editor-${theme}.png` });
    }
  }

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
