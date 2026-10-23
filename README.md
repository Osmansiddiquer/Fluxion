# Fluxion

A Desmos-like grapher built for **ordinary differential equations**. Type ODEs (any
order, including coupled systems), functions, implicit curves, polar curves, points,
and variables; Fluxion **numerically** solves and plots everything — and lets you
*inspect* the curves: maxima, minima, endpoints, discontinuities, intercepts, and
intersections.

> The name is Newton's: a *fluxion* is his word for a derivative, written as a dotted
> letter (ẏ). The horizontal axis is `t` (independent), the vertical axis is `y`
> (dependent). The arbitrary integration constant *C* is expressed as the **initial
> conditions** you set with sliders.

## What you can type

| Input | Meaning |
| --- | --- |
| `y' = t*y` | First-order ODE, solved from an initial condition |
| `y'' = -y` | Higher-order ODE (reduced to a first-order system internally) |
| `x' = x - x*y`, `y' = x*y - y` | Coupled system (equations reference each other) |
| `y = sin(t)/t` or `sin(t)` | Plain function of `t` (holes/asymptotes handled) |
| `t^2 + y^2 = 9` | Implicit curve (marching squares) |
| `r = 1 + cos(theta)` | Polar curve, drawn as the (x, y) parametric overlay |
| `1 < y < sin(t)` | Inequality / shaded region (compound, strict vs inclusive) |
| `r < 2*theta` | Polar inequality with an editable θ-sweep (a spiral region) |
| `(1, 2)` | A single point |
| `((0,0),(1,1),(2,3))` | A connected polyline (a parens-tuple of points) |
| `[(0,0),(1,1),(2,3)]` | An array of scattered points |
| `A = (1, 2)` then `(A, B)` | Point-valued variables; a tuple of them draws a line |
| `a = 2` | A variable you can slide, animate, and reuse in other equations |

### Scripting & animation

| Input | Meaning |
| --- | --- |
| `(2cos(t), sin(t))` | Parametric curve over a t-range (default 0…2π, editable) |
| `b = 2a + 1` | Derived value (shown live, usable everywhere, any order) |
| `f(u, v) = u*cos(v)` | User function, callable from any expression; `f(x) = x^2` also plots |
| `(cos(t) + k, sin(t)) for k = 0..2` | Repeat any drawable entry (`for i = 0..3, j = i..3`, `step`) |
| `(t - 3k)^2 + y^2 < 1 for k = 0..2` | A repeated inequality is the union of its regions |
| `keys(T, 0, 0, 2, 5)`, `skeys(…)` | Keyframe tracks (linear / eased) of a clock `T` |
| `lerp`, `clamp`, `smoothstep`, `ease`, `step`, `pulse` | Interpolation / timing helpers |
| `rotx(x, y, a)`, `roty(x, y, a)` | 2D rotation |
| `projx(x, y, z, yaw, pitch, dist)`, `projy`, `projz` | 3D rotation + perspective projection |
| `frames(24 T)` | Frame *i* of an imported black-and-white clip (filled contours) |

Right-click an entry's colour dot for **style**: line width, solid / dashed / dotted,
fill + opacity for closed shapes (parametric, polar, polygons, frames), and colour
**expressions** for the line and fill — `hsv(360a, 0.8, 1)`, `rgba(0, 0, 0, keys(T, 0, 0, 1, 1))`,
`mixc(#ff0000, #0000ff, u)` — so colour and opacity animate with your variables.
Entries draw in list order (later rows on top). Variables can play together on one
clock (batched per frame), step frame-by-frame, and `autoplay` when a graph opens.
**Examples** (share menu): a rotating Sharingan, a rotating cube, an
eye → Sharingan → Mangekyō morph, a blooming mandala, and a traced silhouette clip.
Each also opens from a link, e.g.
[`#example=mandala`](https://osmansiddiquer.github.io/Fluxion/#example=mandala).

#### Playing a video ("Bad Apple!!")

```bash
ffmpeg -i clip.mp4 -vf "fps=30,scale=192:144" frames/%05d.pgm   # extract frames
npx vite-node scripts/frames-import.ts -- frames clip.json --fps 30
```

then **Import from file…** `clip.json`. Frames are traced into polygons and stored
compactly (≈150–500 bytes per frame); the graph carries the clip, which is kept in
browser storage separately from your per-tab graph state.

## Highlights

- **Numerical ODE engine** — any-order / coupled, RK4 with per-direction step budget.
- **Inline LaTeX editing** (MathLive) with friendly names (`arctan`, `ln`), Greek
  words (`alpha`→α), and symbol autocomplete.
- **Inspection markers** — extrema, roots, intercepts, intersections (works across
  functions, implicit, and polar curves), and accurate discontinuities (removable
  holes vs. asymptotes vs. domain edges).
- **Inequalities** — shaded regions, compound (`1 < y < sin(t)`, `&`-joined annuli),
  strict (dotted) vs inclusive (solid) boundaries, polar regions with a θ-sweep; shown
  in the projection panels and traceable.
- **Draggable points** with per-axis drag modes, sizes, and labels.
- **Animatable sliders** — play / loop / bounce / once with a speed control.
- **Linked projection panels** — per-curve cross-sections onto the y- and t-axes,
  with cut lines you drag on the graph (and that you can drive with a variable).
- **Share & save** — export/import a graph file, or copy a shareable link.
- **Built-in help** — the **?** button offers a short tour and full in-app
  documentation (every feature, searchable, with a *Try it* button on each example;
  deep-linkable as `#docs/<section>`, e.g. `#docs/odes`).
- **URL API for AI agents** — build a graph from a link (see below and `llms.txt`).
- **Polished UX** — light/dark/system themes, configurable significant figures,
  drag-to-reorder, resizable sidebar and panels, equal-aspect grid, power-notation
  axes, and **per-tab** persistence (two browser tabs stay independent; your work
  survives a refresh).

## Links for AI agents (URL API)

LLM agents (and scripts) can build a graph for their user with a link: no API key
or backend. The graph is carried in the URL fragment, and the link is the shareable
result:

```text
https://osmansiddiquer.github.io/Fluxion/#expr=y''=-0.3y'-sin(y)&ic=2,0&xmin=0&xmax=20
https://osmansiddiquer.github.io/Fluxion/#spec=<JSON spec, percent-encoded or base64url>
https://osmansiddiquer.github.io/Fluxion/#z=<compressed JSON spec>
```

- **[`llms.txt`](https://osmansiddiquer.github.io/Fluxion/llms.txt)** documents the
  URL forms, the full expression syntax, common mistakes, and Python/JS link builders.
  Every example in it is checked by the test suite.
- **[`fluxion-spec.schema.json`](https://osmansiddiquer.github.io/Fluxion/fluxion-spec.schema.json)**
  is the JSON Schema for the graph spec.
- **CLI** (uses the app's real parser): `npm run fluxion -- link --expr "y' = -y" --ic 1`,
  `npm run fluxion -- check spec.json` (a JSON report of how each expression parses
  and what's wrong), `npm run fluxion -- decode <link>`, `npm run fluxion -- examples`
  and `npm run fluxion -- example cube` (a demo's spec, to edit).
- **Scripting for agents**: the params form takes style options (`width`, `style`,
  `fill`, `opacity`, `colorexpr`, `fillcolor`, `autoplay`, `grid=off`), so an agent
  can hand-write an animated drawing; `#example=<id>` opens a built-in demo, and every
  demo is published as an editable JSON template under
  [`examples/`](https://osmansiddiquer.github.io/Fluxion/examples/index.json).
- In the app, **Share → Copy as JSON spec** copies the current graph in this format,
  ready to paste to an assistant.

## Tech

- **Vite + React + TypeScript** — static build, deployable to GitHub Pages.
- **mathjs** — expression parsing / simplification / compiled evaluation.
- **KaTeX + MathLive** — rendered and inline-editable math.
- **Custom `<canvas>` renderer** — grid, curves, feature markers, linked projections.
- **Zustand** (`persist`) — state + `localStorage` so your work survives a refresh.

## Develop

```bash
npm install
npm run dev        # local dev server
npm run build      # static production build into dist/
npm test           # Vitest suites (src/**/*.test.ts)
npm run preview    # serve the production build locally
```

> Note: build/run with a native (WSL/Linux) Node toolchain — not Windows Node over a
> `\\wsl.localhost` UNC path, which breaks esbuild.

## Deploy

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds the static
site and publishes `dist/` to GitHub Pages. Enable Pages → "GitHub Actions" in the
repository settings once. The build uses a relative base path, so it also works on
any other static host.
