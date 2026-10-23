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
| Demos | `lib/demos/*` (Sharingan, cube, Mangekyō morph, mandala, silhouette clip) → GraphMenu "Examples", `#example=<id>` links, and `public/examples/*.json` (via `lib/api/examples.ts`) |
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
  `src/docs-page/DocsPage.tsx`: the static HTML shows "Script mode is coming"; after
  hydration it mounts `src/components/Script/ScriptDocs.tsx` (default export, no props;
  built in `feat/script-mode`) client-side, if wired. To wire it, change the one line to
  `const SCRIPT_DOCS: (() => Promise<{ default: ComponentType }>) | null = () => import('../components/Script/ScriptDocs');`.

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
caches, and the scripting layer: parametric curves, derived values, user functions,
for-repeats, keyframes, 3D projection, styling/fills/colour expressions, shared
animation clock, frame sequences + importer, demo graphs). Open: full "Bad Apple!!"
playback needs the user's own frames via `scripts/frames-import.ts` (no copyrighted
frames are committed). The user commits/deploys themselves (push to `main`
triggers GitHub Pages). When picking up new work, re-read files before editing — the user
co-edits in parallel.
