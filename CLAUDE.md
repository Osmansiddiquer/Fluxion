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
  verification. Start detached: `(npm run dev &)`.
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
   | implicit | polar | points | pointvar | inequality | error | empty`. Normalisation
   (`normalize.ts`) and LaTeX↔text bridges (`fromlatex.ts` / `tolatex.ts`) wrap it.
2. **`lib/compute.ts` `computeAll(entries, viewport, samples)`** is the heart: builds the
   variable scope, groups + integrates coupled ODEs, and samples every curve →
   `Map<id, CurveResult>`. Caches live here (see Performance).
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
| Store | `store/useStore.ts` (Zustand+persist), `store/types.ts` (`Entry`, `Viewport`, …) |
| Sidebar | `components/Sidebar/*` — `EntryRow`, `MathField` (MathLive + autocomplete), `IVPControls`, `VariableSlider`, `PlayControls`, `PolarControls`, `ColorPopover` |
| Plot | `components/Plot/PlotCanvas.tsx` (+ `grid.ts`, `markers.ts`), `components/Projections/*` |
| Chrome | `App.tsx`, `Tutorial.tsx`, `GraphMenu.tsx`, `ThemeToggle.tsx`, `SigFigs.tsx`, `Logo.tsx` |
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
- **Per-tab state**: `useStore` persist uses `sessionStorage` (per tab) mirrored to
  `localStorage` (so a fresh tab inherits your last graph and work survives restart). Two
  open tabs are independent. Persist key `ode-plotter`, `version: 2`.

## Performance — the compute caches (extend carefully)

Two layers keep recompute cheap (verified; required to stay smooth under 4× CPU throttle):

1. **Signature gating** (`state/results.tsx`): the analysis memo keys on
   `computeSignature(entries)` (only raw, visible, t0/ic, varValue, thetaMin/Max), read via
   a ref — so **styling/UX-only edits** (colour, expanded, point size, anim speed, var
   bounds) don't recompute curves at all. If you add a new *compute-relevant* `Entry`
   field, **add it to `computeSignature`** or its changes won't take effect.
2. **Per-entry + per-ODE-group result cache** (`compute.ts`, module-level `RESULT_CACHE`
   / `ODE_GROUP_CACHE`): cacheable kinds (function/implicit/polar/inequality) are re-sampled
   only when their key changes (raw + viewport + samples + θ-range + `depKey(deps)` [values
   of the variables/pointvars they reference] + `definedKey` [the set of defined names]).
   ODE integration is cached per coupling group. If you add a new input that a curve
   depends on, **fold it into the cache key** (else you'll serve stale curves).

## Verifying changes

1. `npm run build` (WSL) — must show `✓ built`, no `error TS`.
2. Browser check on `localhost:5173`: seed a known graph by writing `localStorage`
   `ode-plotter` (a `{state:{...},version:2}` blob) and reloading in one JS call, then
   screenshot. This is far more reliable than typing into the MathLive field (which races
   focus). The canonical seed + a full checklist live in **`docs/AGENTIC-TESTS.md`**
   ("run the agentic tests").
3. The user cares about aesthetics — verify look in **both light and dark** themes.

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
- **`public/llms.txt` is tested**: every line of a `fluxion` code block (`expr  # kind`), pitfall
  (`wrong => right`), prose link, JSON block and the JS/Python snippets are executed by
  `src/lib/api/docs.test.ts`. Change syntax → update the examples.
- **CLI**: `npm run fluxion -- link|check|decode` (vite-node; I/O injected, tested in
  `src/cli/fluxion.test.ts`).
- The plot keeps a square grid: only xmin/xmax are exact; `checkSpec` warns when a
  requested y-range can't be honoured.

## Project state & backlog

All planned features are shipped (ODEs/systems, functions, implicit, polar, inequalities
incl. polar/compound, points/lines, animatable sliders, projection panels, trace,
discontinuities, sharing/export, per-tab state, x/t interchange, tutorial, compute
caches). There is no open backlog. The user commits/deploys themselves (push to `main`
triggers GitHub Pages). When picking up new work, re-read files before editing — the user
co-edits in parallel.
