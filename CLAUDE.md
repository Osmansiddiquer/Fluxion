# CLAUDE.md — agent guide for Fluxion

Fluxion is a Desmos-like grapher specialised for **ordinary differential equations**,
built as a static site (Vite + React + TS) and deployed to GitHub Pages. It parses
ODEs / functions / implicit / polar / inequalities / points, **numerically** solves
and samples them on a custom canvas, and overlays inspection markers + linked
cross-section panels. State persists per browser tab.

## Build & run — READ THIS FIRST

**Always build/run with WSL-native Node**, never Windows Node over the `\\wsl.localhost`
UNC path (it breaks esbuild). From the Bash tool:

```bash
wsl -d Ubuntu -- bash -lc '. ~/.nvm/nvm.sh && cd /home/nimda/repos/ODE-plotter && npm run build'
```

- `npm run build` — typecheck + production build (the canonical "does it compile" check;
  ~5 s). Grep its output for `error TS` / `✓ built`.
- `npm run dev` — Vite dev server on `http://localhost:5173/` (HMR). Used for browser
  verification. Start detached: `(npm run dev &)`. The docs page is at `/docs/`.
- `npm run build` also builds the **docs page** (`npm run build:docs`: a second Vite build
  with `vite.docs.config.mjs` into `dist/docs/`, then `scripts/prerender-docs.ts`).
- The repo lives at `/home/nimda/repos/ODE-plotter` (WSL) = `\\wsl.localhost\Ubuntu\...`
  (Windows). Edit via the Windows path; run via WSL.

## Architecture & data flow

```
Entry.raw (string)  ──parse──▶  Parsed (discriminated union)  ──compute──▶  CurveResult
                                                                  │
   store (Zustand+persist, per-tab sessionStorage)                ▼
        │                                          analysis (features, intersections)
        ▼                                                          │
   ResultsProvider (one memo: computeAll + analysis) ──────────────┘
        │
        ▼
   PlotCanvas (canvas renderer) + Right/BottomPanel (cross-sections) + Sidebar (rows)
```

1. **`lib/math/parse.ts`** classifies `raw` → `Parsed` union: `function | ode | variable
   | implicit | polar | points | pointvar | inequality | parametric | fndef | repeat |
   frames | error | empty`. Normalisation
   (`normalize.ts`) and LaTeX↔text bridges (`fromlatex.ts` / `tolatex.ts`) wrap it.
2. **`lib/compute.ts` `computeAll(entries, viewport, samples)`** is the heart: builds the
   evaluation scope (`lib/scope.ts` `buildEvalContext`), groups + integrates coupled
   ODEs, and samples every curve → `Map<id, CurveResult>`. Caches live here (see
   Performance). `buildVarScope` (slices, singularities, colour expressions) shares
   the same scope builder, so helpers / derived values / user functions work everywhere.
3. **`state/results.tsx` `ResultsProvider`** runs `computeAll` + feature/intersection
   analysis inside one memo and shares it via context (`useResults`, `useEntryResult`,
   `useAnalysis`, `useSliceStatus`).
4. **`components/Plot/PlotCanvas.tsx`** draws everything (grid, curves, region fills,
   markers, cursors, trace, drag). **Right/BottomPanel** render linked cross-sections.

### Module map (where things live)

| Area | Files |
| --- | --- |
| Parsing | `lib/math/parse.ts` (central), `normalize.ts`, `fromlatex.ts`, `tolatex.ts`, `greek.ts`, `builtins.ts`, `points.ts`, `piFormat.ts`, `suggest.ts` (autocomplete), `compileCache.ts` |
| Reduce / solve | `lib/math/reduce.ts` (ODE→1st-order system), `lib/solver/rk4.ts`, `integrate.ts`, `sample.ts` (function sampling + domain-edge bisection), `implicit.ts` (marching squares), `curve.ts` |
| Compute orchestration | `lib/compute.ts`, `lib/analysis/eval.ts` |
| Analysis | `lib/analysis/features.ts` (extrema/roots/intercepts/endpoints), `singularities.ts` (removable holes vs asymptotes), `intersections.ts`, `types.ts` |
| Geometry / format | `lib/geom/transform.ts` (data↔screen), `lib/format.ts` (`fmtSig`), `lib/graphFile.ts` (export/share), `lib/math/resolveSlice.ts` (parametric cuts) |
| Scripting | `lib/scope.ts` (shared eval scope: helpers + sliders + derived values + user fns), `lib/math/helpers.ts` (`lerp`/`keys`/`skeys`/`rotx`/`projx`…), `lib/color.ts` (colour literals + `rgb/hsv/…` expressions), `lib/style.ts` (per-frame `resolveStyle`), `lib/raster.ts` (adaptive inequality shading), `lib/anim.ts` + `state/player.ts` + `state/animate.ts` + `components/AnimationLoop.tsx` (shared slider clock) |
| Frames ("Bad Apple") | `lib/frames/codec.ts` (FXF1 clip format), `trace.ts` (marching-squares contours + Douglas–Peucker), `assets.ts` (content-addressed asset store), `netpbm.ts`, `clipGraph.ts`; `scripts/frames-import.ts` (CLI, run with `npx vite-node`) |
| Demos | `lib/demos/scripted.ts` (Script mode programs: Sharingan, cube, Mangekyō, mandala, pendulum-from-ODE, silhouette clip) = `DEMOS` → GraphMenu "Examples", Script mode → Examples, `#example=<id>` links, `public/examples/*.json` (via `lib/api/examples.ts`). The older expression-row builders (`sharingan.ts`, `cube.ts`, …) are `EXPRESSION_DEMOS`, kept only as engine regression fixtures |
| Script mode | `lib/script/` — `api.ts` (names + signatures), `runtime.ts` (the drawing API + executor, pure), `protocol.ts` (wire format, `sanitizeFrame`, limits), `graphBridge.ts` (`graph.value/fn/ode`), `sandbox/worker.ts` (worker entry), `sandbox/host.ts` (iframe + watchdog), `testkit.ts` (headless runs); `state/scriptRuntime.ts` (live frame / clock); `components/Script/*` (lazy: `ScriptPanel`, `CodeEditor`, `ScriptEngine`, `ScriptDocs` + `docsContent.ts`, `ClipImporter`, `scriptBus`); `components/Plot/scriptLayer.ts` (renderer), `ScriptChip.tsx`; `components/ModeSwitch.tsx`; `cli/scriptCheck.ts` |
| Store | `store/useStore.ts` (Zustand+persist), `store/types.ts` (`Entry`, `Viewport`, …), `state/signature.ts` (`computeSignature`) |
| Sidebar | `components/Sidebar/*` — `EntryRow`, `MathField` (MathLive + autocomplete), `IVPControls`, `VariableSlider`, `PlayControls`, `PolarControls`, `ColorPopover` |
| Plot | `components/Plot/PlotCanvas.tsx` (+ `grid.ts`, `markers.ts`), `components/Projections/*` |
| Chrome | `App.tsx`, `Tutorial.tsx`, `HelpMenu.tsx` (the ? menu), `GraphMenu.tsx`, `ThemeToggle.tsx`, `SigFigs.tsx`, `Logo.tsx` |
| Docs content | `components/Docs/` — `content.ts` (all docs as data), `examples.ts` (example type + the tour's 4 examples), `search.ts`, `hash.ts` (legacy `#docs/<id>` redirect), `docs.test.ts` |
| Docs page | `src/docs-page/` — `index.html` (template), `DocsPage.tsx` (the page), `main.tsx` (hydrate), `prerender.ts` + `scripts/prerender-docs.ts` (static HTML), `links.ts` (Try links), `tex.ts`, `theme.ts`, `docs-page.css`, `docs-page.test.ts`; `vite.docs.config.mjs` |
| Tokens | `styles/theme.css` (all `--var`s, light+dark), `styles/global.css` |
| URL API (agents) | `lib/api/spec.ts` (FluxionSpec v1 + validation), `check.ts` (headless semantic check), `url.ts` (link encode/decode), `load.ts` (URL → graph, `sanitizeGraph`), `cli/fluxion.ts`; docs `public/llms.txt` + `public/fluxion-spec.schema.json` |

## Conventions & gotchas (hard-won — don't relearn these)

- **`hasSymbol(node, name)` vs `freeSymbols`** (`parse.ts`): `freeSymbols` STRIPS reserved
  names (`t`, `x`, `e`, `pi`, …), so to test whether a node *actually* contains `t`/`x`
  use the exported `hasSymbol` (full traverse). The x/t-independent-variable logic
  (`xIsIndependent`, `rewriteXtoT`) depends on this.
- **x and t are interchangeable** as the independent variable: x-only → x is rewritten to
  t; both present → t is independent and undefined `x` becomes a free variable. ODEs skip
  the rewrite (keep `x` as a dep var for systems).
- **Implicit-multiplication display**: `tolatex.ts` uses `TEX_OPTS = { implicit: 'hide' }`
  so `2t` renders as "2t" not "2·t" (explicit `pi*t` keeps the ·).
- **Polar / inequality θ-convention**: position angle is `atan2(y,t) ∈ [0,2π)`. Polar
  inequalities use a **swept** test (any θ ≡ φ mod 2π within `[thetaMin,thetaMax]`) so a
  spiral `r < 2θ` fills across turns; boundaries of `r OP f(θ)` are sampled as a real
  polar curve (solve linear-in-r), not marching squares. See the `inequality` branch in
  `compute.ts`.
- **Controlled `<input type=range>`**: React ignores a direct `.value` set. To drive a
  slider programmatically (and in automation) use the native setter
  `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set` then dispatch
  an `input` event.
- **rAF is throttled to ~0 in a hidden/background tab** — automation can't verify
  animation by waiting; drive motion via input dispatch instead. `PlayControls` uses a
  ref-based self-perpetuating rAF loop.
- **Browser automation coordinate mismatch**: the page viewport is wider than the
  1568-px screenshot, so DOM x ≠ screenshot x. Verify drags via JS
  (`getBoundingClientRect` / dispatched events), not guessed click coordinates.
- **mathjs parsing traps** (bit the demos): `2 mod(i, 2)` parses `mod` as the binary
  *operator* — write `2*mod(i, 2)`; `pi (u - 1)` is a *call* of `pi` — write
  `pi*(u - 1)`. `[a, b][k + 1]` indexing is 1-based. `i` is allowed as a loop variable /
  parameter (scope shadows the imaginary unit).
- **Grid toggle** lives in `FeatureToggles.grid` (optional, default shown; the Points
  menu) so it rides in `GraphData.features` with no store/graph-file change.
- **Per-tab state**: `useStore` persist uses `sessionStorage` (per tab) mirrored to
  `localStorage` (so a fresh tab inherits your last graph and work survives restart). Two
  open tabs are independent. Persist key `ode-plotter`, `version: 2`.

## Scripting layer (issue #2) — how it fits together

- **Syntax** (all in `parse.ts`): `(x(t), y(t))` = `parametric` (t-range reuses
  `thetaMin/thetaMax`, edited by `PolarControls` labelled `t`); `f(a, b) = body` =
  `fndef` (recognised *before* inequalities, so bodies may hold comparisons/ternaries;
  a `?` anywhere also skips inequality parsing); `body for k = a..b[, j = c..d step s]` =
  `repeat` (split first via `findFor`; body ∈ `REPEATABLE_KINDS`); `frames(expr)` =
  `frames`. `name = expr` without `y` is decided by `namedValue` (no symbolic
  differentiation): constant → variable, uses `t` → named function, else a **derived
  value** (`isDerived` in `scope.ts`) with no curve and a live `= value` badge.
- **Scope** (`scope.ts`): mathjs resolves a *called* name from the scope before its own
  namespace, so helpers and user functions are plain closures in the scope object (spread
  copies keep them). A user fn evaluates its body on `Object.create(globalScope)` +
  params — it sees globals, never the caller's `t`/`y`/loop vars. It has a **one-slot
  last-call memo** (valid because globals are fixed per scope build and derived values
  are assigned once); recursion is rejected at parse time and depth-capped at runtime.
- **Rendering** (`PlotCanvas`): entries draw in list order, each fill then stroke;
  `resolveStyle` (cosmetic fields + colour expressions evaluated against
  `analysis.scope`) decides stroke/dash/fill. Inequality shading is `rasterizeRegion`,
  cached per `CurveResult` + viewport in a `WeakMap`. Frames fill even-odd as one path
  (holes); other shapes fill per segment.
- **Animation**: variable sliders play through ONE rAF loop (`AnimationLoop` →
  `stepPlaying` → a single `useStore.setState` per frame). `autoplay` entries start once
  per id (new ids on every demo build). IVP sliders still use the self-contained
  `PlayButton`. Loop mode wraps the overshoot (seamless rotations); speed may go far
  below the UI slider's 0.1 (real-time clips use `4 / seconds`).
- **Frames**: clip payloads live in the asset store (`localStorage['fluxion-assets']`,
  written once on import), *not* in the per-tab persisted store, which is rewritten on
  every animation tick. Entries keep only the id (`Entry.frames`); `makeGraph` exports
  referenced assets in `GraphData.assets`; every graph load path must call
  `registerAssets(g.assets)` first (GraphMenu file/hash/examples do).

## Script mode (JavaScript, sandboxed)

- **UX**: header `ModeSwitch` sets `store.mode` (`graph` | `script`, optional, persisted).
  Script mode swaps the Sidebar for the lazy `ScriptPanel` (toolbar, CodeMirror editor,
  sliders, clock bar, console strip; the reference is a column beside the editor on
  windows ≥ `DOCS_SIDE_MIN` and a Code | Reference tab below that, so it never squeezes
  the graph). `ScriptEngine` (lazy, mounted whenever a script exists or Script mode is
  open) owns the sandbox and writes `useScriptRuntime` (frame, error, clock). The plot
  draws the frame **above Graph-mode curves, below markers / points / cursors**;
  `background()` replaces the grid. In Graph mode `ScriptChip` shows / hides the layer.
- **State**: `store.script?: ScriptDoc` (`code`, `sliders`, `clips` name → asset id,
  `visible`) — optional, persist version unchanged. Travels in `GraphData.script`
  (`makeGraph`; clip assets exported), `#g=` links (`sanitizeScript` caps it), the spec's
  top-level `"script"` string (`expressions` then optional; schema uses `anyOf`), and a
  `#script=` param. `loadGraph` replaces the script (none → cleared). A graph with a
  script opens in Script mode (`GraphMenu.applyGraph`) with a toast.
- **Runtime model**: a script is the body of `new Function(...API_NAMES, '"use strict"; {'
  + code + '}')` — API as parameters, body in its own block so user `const scale = …`
  shadows instead of colliding. Re-run per frame; `usesClock(code)` (or `loop()` /
  `clip().play()`) marks it animated. `loop(s)` can't rebind the `time` parameter, so the
  **host** wraps the clock by `frame.loop`. Error lines come from the stack
  (`, <anonymous>:L:C` / `> Function:L:C`, offset measured once); syntax-error lines
  come from the editor's lezer linter (engines don't report them).
- **Wire format** (`protocol.ts`): display items `path` (op-coded numbers + an affine
  matrix, built under `S·M` then stroked in screen space so widths are px), `point`,
  `arrow`, `text`, `clip` (asset id + frame + matrix; polygons come from the app's own
  `FrameSequence`). Everything returned is validated twice: in the worker (guarantees
  cloneable plain data) and by `parseRuntimeMessage` in the app.
- **Graph interop**: the app posts Graph-mode entries as data (`raw`, `ic`, `t0`,
  `varValue`) when `computeSignature` or the clip table changes; the worker parses them
  with the real parser (mathjs is in the worker bundle) and `graph.ode` integrates RK4
  on demand from t0 (`ODE_STEP`, cached, `|t − t0| ≤ ODE_MAX_SPAN`).
- **Build**: `vite.config.mjs` plugin `sandboxRuntime` bundles `sandbox/worker.ts` with
  esbuild into a string module `virtual:fluxion-sandbox-runtime` (an opaque-origin frame
  can't load a worker from the app's URL). The string escapes `import` so Vite's import
  analysis ignores it. Only the lazy ScriptEngine chunk imports it.

### Sandbox & threat model

Scripts arrive from share links, so treat them as hostile. Goal: a script can only
produce a drawing; it must not read or change the app's DOM, storage, cookies, other
tabs, or reach the network, and must not hang the page.

1. **Worker in an opaque-origin iframe**: `<iframe sandbox="allow-scripts" srcdoc>` (no
   `allow-same-origin`) → origin `null`: no access to `parent.document`,
   `localStorage`, cookies or IndexedDB of the app. User code runs in a blob: `Worker`
   inside it (no DOM at all) so an endless loop never blocks the page.
2. **CSP** in the srcdoc: `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'
   blob:; worker-src blob:; connect-src 'none'; img-src 'none'; …` — no fetch, XHR,
   WebSocket, EventSource, images, fonts, forms or frames; workers inherit it.
3. **Defence in depth** in `worker.ts`: `fetch`, `XMLHttpRequest`, `WebSocket`,
   `importScripts`, `indexedDB`, `caches`, `BroadcastChannel`, nested `Worker`,
   `navigator.sendBeacon`, … are redefined as non-configurable `undefined` before user
   code runs; `self.postMessage` is a no-op for user code.
4. **Only structured messages** cross: the app accepts messages only from that iframe's
   window (`e.source`), and `parseRuntimeMessage` / `sanitizeFrame` copy known fields,
   finite bounded numbers, capped strings (text 300, logs 100 × 1000), ≤ 20 000 items,
   ≤ 600 000 numbers, colours matching plain CSS syntax only, asset-id-shaped clip ids.
   Nothing received is evaluated; text goes to `fillText`, colours to `fillStyle`.
5. **Watchdog**: every run has a timeout (3 s for runs, 1.5 s per animation frame); on
   timeout the iframe (and worker) is removed and a fresh one started; the hung script
   is not re-run until it is edited or Run is pressed. Requests are coalesced (newest
   wins), so a slow animation drops frames instead of queueing.
6. **CLI** (`cli/scriptCheck.ts`) never runs scripts in Node's realm: the whole worker
   bundle runs inside a fresh `node:vm` context holding only context-created objects
   (no `process`/`require`/host functions), JSON strings in and out, with a timeout.

Not defended: a script can draw something misleading or heavy within the caps, and
`random()`/timing side channels inside its own sandbox — acceptable for a drawing tool.

### Script mode gotchas

- **Zustand selectors must not return fresh objects** (`s.script?.clips ?? {}` loops
  forever): select the field, default outside with a module constant.
- **`page.goto` to the same URL + `#hash`** doesn't reload — go via `about:blank` in
  automation, or the app keeps its previous state (tour, graph).
- **MediaRecorder WebM** reports `duration = Infinity` until you seek past the end
  (`ClipImporter.videoDuration`).
- Examples / docs / llms.txt scripts are executed by tests (`scripted.test.ts`,
  `docsContent.test.ts`, `docs.test.ts`); change the API → update them.
- **Browser e2e**: `node scripts/e2e-script-mode.cjs http://localhost:5173/ [--shots dir]`
  (playwright-core; set `PLAYWRIGHT_CORE` if it isn't resolvable) — sandbox isolation,
  runaway kill, every example light + dark, reference, sliders, clip import.
- The Scripting reference `ScriptDocs` is default-exported and prop-less and runs in two
  hosts. In Script mode (`ScriptPanel` calls `markScriptApp()`, `scriptHost.ts`) "Try it" /
  "Insert" drive the editor via `scriptBus` (imported lazily). On the docs page (no store,
  no editor) "Try it" is a `../#z=` link (`scriptLink`, opens the app in a new tab with the
  snippet as its script) and there is no Insert, search or inner scroll box. The panel's
  "Full docs ↗" link opens `docs/#scripting`.
- **One CodeMirror linter** reports both syntax errors and the runtime error; a separate
  `setDiagnostics` would be wiped by the linter's next run. The runtime error re-lints via
  a `StateEffect` + `needsRefresh` (`forceLinting` is a no-op without a pending change).
- Header on phones (≤ 480 px): the Graph | Script switch goes icon-only and the sig-figs
  selector and wordmark hide, so ?, the bug-report link and the rest keep their places.

## Performance — the compute caches (extend carefully)

Two layers keep recompute cheap (verified; required to stay smooth under 4× CPU throttle):

1. **Signature gating** (`state/results.tsx`): the analysis memo keys on
   `computeSignature(entries)` (`state/signature.ts`: only raw, visible, t0/ic, varValue,
   thetaMin/Max, frames), read via
   a ref — so **styling/UX-only edits** (colour, expanded, point size, anim speed, var
   bounds) don't recompute curves at all. If you add a new *compute-relevant* `Entry`
   field, **add it to `computeSignature`** or its changes won't take effect.
2. **Per-entry + per-ODE-group result cache** (`compute.ts`, module-level `RESULT_CACHE`
   / `ODE_GROUP_CACHE`): cacheable kinds (function/implicit/polar/inequality) are re-sampled
   only when their key changes (raw + viewport + samples + θ-range + `depKey(deps)` [values
   of the variables/pointvars they reference] + `definedKey` [the set of defined names]).
   ODE integration is cached per coupling group. If you add a new input that a curve
   depends on, **fold it into the cache key** (else you'll serve stale curves). Scripting
   additions to the key: `ectx.fnKey` (every fndef's raw + the values its body reads) for
   any entry/ODE group that calls a user function, derived + function names in
   `definedKey`, and the `frames` asset id. Cosmetic style fields (`lineWidth`,
   `lineStyle`, `fill*`, `colorExpr`, `fillColor`, `autoplay`) are deliberately NOT in
   the signature — colour expressions are re-evaluated at draw time.

## Verifying changes

1. `npm run build` (WSL) — must show `✓ built`, no `error TS`. `npm test` runs the Vitest
   suites (node env; `lib/demos/demos.test.ts` checks every shipped demo computes with no
   errors and non-empty curves — keep it green when touching the engine).
2. Browser check on `localhost:5173`: seed a known graph by writing `localStorage`
   `ode-plotter` (a `{state:{...},version:2}` blob) and reloading in one JS call, then
   screenshot. This is far more reliable than typing into the MathLive field (which races
   focus). The canonical seed + a full checklist live in **`docs/AGENTIC-TESTS.md`**
   ("run the agentic tests").
3. The user cares about aesthetics — verify look in **both light and dark** themes.

## Documentation page (`/docs/`)

The docs are a separate static page at `/Fluxion/docs/`, not part of the app. The header
**?** opens `HelpMenu`: *Take the tour* (`Tutorial.tsx`, the unchanged carousel; still
auto-opens on first visit, skipped for URL-payload links) and *Documentation*, a plain
`<a href="docs/" target="_blank">` (`DOCS_HREF` in `config.ts`); the tour's last card links
there too. The bug-report link sits next to ?, untouched. Old `#docs/<id>` app links
redirect to `docs/#<id>` (`main.tsx`); `?tour` opens the tour (the docs' "Take the tour").

- **Build**: `vite.docs.config.mjs` builds `src/docs-page/index.html` into `dist/docs/`
  (own bundle: React + content, no parser, no KaTeX JS; `publicDir: false`). Vite mirrors
  the source path, so `scripts/prerender-docs.ts` moves the page to `dist/docs/index.html`
  (rewriting `../../assets/` → `./assets/`), renders `DocsPage` with `renderToString`,
  and fills the template markers (`<!--docs-head-->`, `-body-`, `-data-`). In dev,
  `vite.config.mjs` serves the template at `/docs/` and `main.tsx` renders client-side.
- **Static first**: the page reads fine with JS off (search and the theme switch hide;
  the OS theme applies). The client hydrates using the embedded JSON (`#docs-data`: Try
  links + KaTeX HTML from `tex.ts`, so KaTeX's JS never ships). Anything rendered must be
  deterministic from `content.ts` + that data, or hydration breaks.
- **Try it** links are built at build time with the URL API (`links.ts`: `buildLink` →
  `../#z=…`, or `../#example=<id>` for demos) and open the app in a new tab.
- **Theme** follows the app: `theme.ts` reads `state.theme` from the persisted
  `ode-plotter` blob (inline script in `index.html` applies it before paint); the page's
  toggle writes it back (or `fluxion-docs-theme` when no app state exists).
- **Content is data**: `components/Docs/content.ts` `SECTIONS` (learning order) → blocks
  (`p`, `h`, `list`, `steps`, `syntax` rows, `table`, `example`, `math`, `tip`, `tour`,
  `script-docs`). Inline markup: `` `code` ``, `**bold**`, `$TeX$`, `[label](href)`; `#<id>`
  hrefs are in-page anchors, other hrefs are relative to `/docs/` (the app is `../`). Mark
  derived values (`b = 2a + 1`) with `derived: true`. **To add a section**: write a
  `DocSection`, add it to `SECTIONS`, run `npm test`.
- **Tests keep docs and app in sync**: `components/Docs/docs.test.ts`: every
  example/row parses as its documented kind and computes cleanly; the docs cover **every
  `Parsed` kind** (read from the union in `parse.ts`), **every `HELPER_NAMES` helper**,
  every colour function, demo, Points-menu toggle and share-menu item (a new kind or
  helper fails until documented); search; legacy hash parsing; the tour and docs share
  example objects. `src/docs-page/docs-page.test.ts`: the pre-render contains every
  section, heading and snippet; every Try link decodes (`readUrlPayload`/`loadFromUrl`) to
  a graph that computes with no errors; the build wiring; and, after `npm run build`, the
  real `dist/docs/index.html`.
- **Script mode hook**: the *Scripting* section renders `ScriptDocsSlot` in
  `src/docs-page/DocsPage.tsx`: the static HTML shows a short "Script mode reference"
  note (plus the section's prose); after hydration it mounts
  `src/components/Script/ScriptDocs.tsx` client-side (`SCRIPT_DOCS`), whose Try links open
  the app with the snippet.

## URL API for LLM agents (`src/lib/api`)

Static site, so the "API" is the link: `#expr=…&ic=…&xmin=…` (params; options attach to
the latest `expr`), `#spec=<JSON | base64url>`, `#z=<deflate-raw+base64url>`, plus
legacy `#g=` share links. `GraphMenu` loads them on mount *and* on `hashchange`, then
strips them; bad links show an error toast and keep the current graph.

- **FluxionSpec** (`spec.ts`) is the stable external format, decoupled from `Entry`.
  `validateSpec` is strict (unknown keys → did-you-mean errors, bounded numbers,
  constants like `"2pi"`); `specToGraph`/`graphToSpec` are the only bridges. If you add an
  `Entry` field users should be able to set from a link, add it to the spec, the schema
  (`public/fluxion-spec.schema.json`), the params table in `url.ts`, and `llms.txt`
  (`docs.test.ts` fails if the schema and validator drift).
- **Untrusted input**: specs never reach anything but the mathjs pipeline, and calls to
  functions outside `KNOWN_FUNCTIONS` are never *evaluated* (guards in `parse.ts`
  variable branch, `compute.ts` pointvar resolution, `evalConstant`). Legacy graphs go
  through `sanitizeGraph`. Limits live in `LIMITS` (100 exprs, θ-span ≤ 50 turns, …).
  The scripting layer follows the same rule: user-function bodies and derived values
  may only call `KNOWN_FUNCTIONS` + the graph's own functions (`scope.ts`), and colour
  expressions only built-ins, colour constructors and user functions (`evalColor`).
- **Scripting fields over links**: `sanitizeGraph` keeps the style fields (bounded),
  `autoplay`, `frames` (asset-id shaped), `features.grid`, and `GraphData.assets`
  (`sanitizeAssets`: referenced only, id must equal the content hash, must parse as a
  clip, size-capped). The spec exposes `lineWidth`, `lineStyle`, `fill`, `fillOpacity`,
  `colorExpr`, `fillColor`, `autoplay` and `features.grid` (not frames — clips come from
  files). **Every load path calls `registerAssets(g.assets)` before `loadGraph`**
  (`GraphMenu.applyGraph`).
- **`public/llms.txt` is tested**: every line of a `fluxion` code block (`expr  # kind`), pitfall
  (`wrong => right`), prose link, JSON block and the JS/Python snippets are executed by
  `src/lib/api/docs.test.ts`. Change syntax → update the examples.
- **CLI**: `npm run fluxion -- link|check|decode|examples|example <id>` (vite-node; I/O
  injected, tested in `src/cli/fluxion.test.ts` / `src/lib/api/examples.test.ts`).
- **Demos are agent templates**: adding or changing a demo in `lib/demos/` means running
  `npm run examples` to regenerate `public/examples/*.json` + `index.json`;
  `docs.test.ts` fails if they're stale or if `llms.txt` doesn't list every demo id/link.
  Demos carrying a frame clip get no spec (link only).
- **Point-group detection** (`math/points.ts` `isWrapped`): an element is a point only if
  its opening `(` closes at the very end, so `((a + b)*cos(t), (a + b)*sin(t))` is a
  parametric curve, not a broken polyline.
- The plot keeps a square grid: only xmin/xmax are exact; `checkSpec` warns when a
  requested y-range can't be honoured.

## Project state & backlog

All planned features are shipped (ODEs/systems, functions, implicit, polar, inequalities
incl. polar/compound, points/lines, animatable sliders, projection panels, trace,
discontinuities, sharing/export, per-tab state, x/t interchange, tutorial, docs page, compute
caches, Script mode (sandboxed JavaScript, reference, examples, clip importer), and the
scripting layer: parametric curves, derived values, user functions,
for-repeats, keyframes, 3D projection, styling/fills/colour expressions, shared
animation clock, frame sequences + importer, demo graphs). Open: full "Bad Apple!!"
playback needs the user's own frames via `scripts/frames-import.ts` (no copyrighted
frames are committed). The user commits/deploys themselves (push to `main`
triggers GitHub Pages). When picking up new work, re-read files before editing — the user
co-edits in parallel.
