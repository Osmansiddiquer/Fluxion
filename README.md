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
- **Share & save** — export/import a graph file, or copy a shareable link; plus a
  built-in getting-started tutorial.
- **Polished UX** — light/dark/system themes, configurable significant figures,
  drag-to-reorder, resizable sidebar and panels, equal-aspect grid, power-notation
  axes, and **per-tab** persistence (two browser tabs stay independent; your work
  survives a refresh).

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
npm run preview    # serve the production build locally
```

> Note: build/run with a native (WSL/Linux) Node toolchain — not Windows Node over a
> `\\wsl.localhost` UNC path, which breaks esbuild.

## Deploy

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds the static
site and publishes `dist/` to GitHub Pages. Enable Pages → "GitHub Actions" in the
repository settings once. The build uses a relative base path, so it also works on
any other static host.
