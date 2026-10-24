# Fluxion — Agentic Test Plan

A checklist the assistant can execute end-to-end in a browser (Chrome MCP) to
verify every feature. Ask: **"run the agentic tests"**.

## How to run

1. Ensure the dev server is up: `wsl -d Ubuntu -- bash -lc '. ~/.nvm/nvm.sh && cd /home/nimda/repos/ODE-plotter && (npm run dev &)'` then open `http://localhost:5173/`.
2. Seed a known state by running this in the page console (`javascript_tool`), which
   sets `localStorage` and reloads in one call (so the live store can't overwrite it):

```js
const st={state:{entries:[
 {id:'1',raw:"y' = y",color:'#c74440',visible:true,expanded:true,t0:0,ic:[1]},
 {id:'2',raw:"y'' = -y",color:'#2d70b3',visible:true,expanded:false,t0:0,ic:[0,1]},
 {id:'3',raw:'t^2+y^2=9',color:'#388c46',visible:true,expanded:false},
 {id:'4',raw:'y = k*sin(t)',color:'#6042a6',visible:true,expanded:false},
 {id:'5',raw:'k=3',color:'#fa7e19',visible:true,expanded:false},
 {id:'6',raw:'y = arctan(t)',color:'#000000',visible:true,expanded:false},
 {id:'7',raw:'a=1',color:'#cf2e6b',visible:true,expanded:false},
 {id:'8',raw:'b=2',color:'#0d9488',visible:true,expanded:false},
 {id:'9',raw:'A=(a,b)',color:'#c74440',visible:true,expanded:false,pointLabel:'A',pointLabelDir:'nw'},
 {id:'10',raw:'B=(3,-1)',color:'#2d70b3',visible:true,expanded:false},
 {id:'11',raw:'(A,B)',color:'#388c46',visible:true,expanded:false},
 {id:'12',raw:'(2,-3)',color:'#fa7e19',visible:true,expanded:false,pointDrag:'both',pointSize:8},
 {id:'13',raw:'polyline((-4,1),(-1,3),(2,-2))',color:'#6042a6',visible:true,expanded:false},
 {id:'14',raw:'k*w',color:'#cf2e6b',visible:true,expanded:false}
],viewport:{tMin:-6,tMax:6,yMin:-4,yMax:4},
features:{extrema:true,xIntercepts:true,yIntercept:true,endpoints:false,discontinuities:true,intersections:true},
projections:{rightOpen:true,bottomOpen:true,sliceT:1,sliceY:1},theme:'light',sidebarWidth:340},version:2};
localStorage.setItem('ode-plotter',JSON.stringify(st));location.reload();
```

> Note: typing into the MathLive field via the automation races its focus — click,
> wait ~0.4s, then type. To set raw text reliably, prefer the `localStorage` seed
> above, or focus the empty `math-field` via JS before typing.

## Checklist (verify by screenshot)

### Engine / parsing
- [ ] `y' = y` plots an exponential through (0,1); IVP sliders `t₀`, `y(t₀)` present.
- [ ] `y'' = -y` plots a sine; badge **ODE·2**; `t₀, y(t₀), y'(t₀)` shown.
- [ ] `t²+y²=9` plots a **round** circle (equal aspect), badge **implicit**.
- [ ] `y = k·sin(t)` renders KaTeX; changing `k` slider rescales it live.
- [ ] `y = arctan(t)` works (friendly name → atan).
- [ ] Non-isolated ODE forms: edit one row to `y' + y = sin(t)` → still ODE, plots.
- [ ] Zoom out far → axis labels use power notation (`2×10⁵`, `10⁶`), not `1e5`.
- [ ] `k*w` (w undefined) shows a red `!` on the colour dot + a **Define ω** button
      (ω because `w`… actually `w` stays `w`; use `k*omega` to test Greek-define).

### Inline math (MathLive)
- [ ] Each row renders as typeset math; click a row → edit in place, renders as you type.
- [ ] Type `y''` → double prime renders cleanly (no tiny raised marks).
- [ ] Type `omega` → shows `ω`; `pi` → `π`; `/` makes a fraction.
- [ ] Type `polyline(...)` → the word is NOT mangled (no ∈ from the "in").

### Points
- [ ] `(2,-3)` with Drag=Both, size 8 → big dot with 4-way SVG arrows; drag moves it.
- [ ] `A=(a,b)` → draggable point (4-way), label "A" to NW; dragging updates `a,b`.
- [ ] `B=(3,-1)` literal → plain static dot (Auto), no arrows.
- [ ] `(A,B)` → a **line** between A and B; sidebar badge says **line**.
- [ ] `(A,B,C)` (need a `C=` pointvar) → polyline through A,B,C.
- [ ] `polyline((-4,1),(-1,3),(2,-2))` → connected polyline.
- [ ] `[(1,1),(2,4),(3,9)]` → 3 scattered (unconnected) dots.
- [ ] Right-click a point's colour dot → popover with Size / Drag (Auto/Off/↔/↕/✛
      SVG icons) / label + 8-direction grid (label only for single points).
- [ ] Drag setting `↔` → only horizontal; `↕` → only vertical; `Off` → not draggable.
- [ ] Point coordinates: with `A=(a,b)`, add `B=(A.x+1,A.y)`, `(A.x+cos(t),A.y+sin(t))`,
      `y=A.y` and `d=sqrt(A.x^2+A.y^2)` → B sits right of A, a unit circle around A, a
      horizontal line through A, and a live `= …` badge on d. Drag A → all of them follow.
- [ ] Rows render `A.x` as A.x (typeset); typing `y = center.y` in the editor keeps `center.y`.
- [ ] Errors: `y=k.x` on a slider k → "k is a number, not a point"; `y=A.z` → "a point has
      .x and .y"; `y=Q.x` with no Q → "Define Q = (…, …)" button (adds `Q = (0, 0)`);
      `A=(B.x,0)` + `B=(A.x,1)` → "Circular definition" on both rows.
- [ ] ODE point: `#expr=X''=-1.8X-0.5X'&ic=4,0&expr=T=0&min=0&max=20&autoplay=1&expr=center=(X(T)+4,2)&expr=(center.x+0.5cos(t),center.y+0.5sin(t))&xmin=-2&xmax=12`
      → the circle rides on center as T plays (smooth under 4× CPU throttle).

### Inspection
- [ ] Maxima/minima dots on `y''=-y`; zeros on the t-axis; y-intercept at t=0.
- [ ] Intersections between curves shown (e.g. the sine and the arctan).
- [ ] Hover a marker → tooltip with label + coords.
- [ ] Click a curve → pins a trace point; drag along it; it snaps to features.
- [ ] "Points" toggle menu (top-left of plot) shows/hides each family.

### ODE qualitative view
Automated: `node scripts/e2e-ode-view.cjs http://localhost:5173/ [--shots dir]`
(IC drag, shift-click, clear, phase switch, equilibrium tooltips, Lorenz axes, family,
the exact-difference footer, timings under a 4× CPU throttle; light + dark, desktop +
390 px shots). By eye: In the seed above, `y' = y` shows a dashed unstable
equilibrium line y = 0 and no slope field (fields are opt-in).
- [ ] `y' = y*(1 - y)`: dashed lines y = 0 (hollow tab, unstable) and y = 1
      (filled, stable); row switch **Slope field** shows the field.
- [ ] Drag the ring at (t₀, y₀) → the IC sliders follow; shift-click the plot → a thinner
      extra solution; **Clear N extra solutions** removes them.
- [ ] `x' = x*(1 - y)`, `y' = y*(x - 1)`, **Plot → phase** on the first row: closed
      orbits, axes labelled x / y, arrows, dashed nullclines, half-filled saddle at the
      origin, centre ring at (1, 1); hover a marker → type, λ, J. The second row says
      "Drawn in the phase plane…". Right panel still shows x(t), y(t) and a dot marks the
      cut time on the orbit.
- [ ] `y'' = -sin(y)` phase: centres at 2kπ, saddles at odd π; Lorenz with **Axes** x, z.
- [ ] `c = 0.5` (0…3) + `y'' = -c*y' - y`: the fan button under the slider draws 7 ghost
      curves (pale → full colour).
- [ ] `y' = -y` + `y = e^(-x)` with the right panel open: a small "● − ● = …" footer.
- [ ] Points menu shows **Equilibria** only when there is an ODE.

### Projections
- [ ] Right panel shows `y(sliceT)` for each curve; editable `t` field in header.
- [ ] Bottom panel shows `t` where `y = sliceY`; editable `y` field.
- [ ] Collapse + reopen each panel → content still renders (not blank).
- [ ] Right reopen tab arrow points left (‹); bottom panel aligns with the plot.

### Chrome / UX
- [ ] Theme toggle (Light/Dark/System) recolours the **whole** app incl. the graph
      immediately (no stale dark graph).
- [ ] Drag a row's grip (appears on hover) → reorders entries.
- [ ] Drag the divider between sidebar and plot → resizes the sidebar.
- [ ] Reload the page → all entries / view / theme restored (localStorage).

### Polar & inequalities
- [ ] `r = 3sin(3θ)` → 3-petal rose; expand row → editable `θ [0]→[2π]` π-aware fields.
- [ ] `r < 3` with `θ [0]→[π]` → upper half-disk, **dotted** boundary (strict `<`).
- [ ] `r < 2θ` with `θ [0]→[4π]` → two-turn spiral region (boundary spirals across turns).
- [ ] `1 < y < sin(t)` → two dotted boundaries, region only where satisfiable.

### Piecewise & restrictions
Seed with a link, e.g.
`#expr=y%20%3D%20%7Bx%20%3C%200%3A%20-x%2C%20x%20%3C%202%3A%20x%5E2%7D&expr=y%20%3D%20t%20%3E%203%20%3F%20-t%20%3A%20t&xmin=-5&xmax=8`.
- [ ] `y = {x < 0: -x, x < 2: x^2}` → V-then-parabola, exact corner at 0, nothing past
      x = 2 (endpoint marker at (2, 4)). Badge says function, not implicit.
- [ ] `y = t > 3 ? -t : t` (and `{x > 3: -x, x}`) → a function with a clean jump at 3:
      no vertical line joining y = 3 to y = −3; open/closed discontinuity markers.
- [ ] `y = x^2 {0 < x < 2}` ends exactly at x = 0 and x = 2; `y = x {x < a}` with a
      slider `a`: dragging moves the end.
- [ ] `r = θ {0 < θ < pi}` half-spiral; `(cos(t), sin(t)) {t < pi}` upper semicircle;
      `x^2 + y^2 = 4 {y > 0}` upper half circle ending on the x-axis;
      `x^2 + y^2 < 9 {x > 0}` right half-disc only.
- [ ] Editor: type `y=` then `{x<0:-x,x^2}` in a MathLive row (keyboard) → braces render
      as `{x < 0: −x, x²}`, the row is a function; blur and re-focus → unchanged.
      Restrictions display as trailing braces. Ordinary rows show no braces.
- [ ] Malformed braces (`y = x^2 {`, `y = {5}`) → a red ! with a clear message.

### Scripting & animation
- [ ] Share menu → **Examples** → each of the 4 demos opens on a clean canvas (no grid,
      no markers), starts animating by itself, and shows an **Undo** toast that restores
      the previous graph. Check light and dark.
- [ ] Rotating Sharingan: red iris, black pupil, three filled tomoe orbit seamlessly
      (no jump when `a` wraps at 2π/3).
- [ ] Rotating cube: 12 edges, 8 vertex dots, tinted translucent faces; `b`/`d`
      sliders tilt / change perspective.
- [ ] Eye → Sharingan → Mangekyō: brown iris turns red, tomoe grow and spin, morph into
      three curved blades, then back to a plain eye; `T` loops every 12 s.
- [ ] Silhouette clip: black-and-white frames play in real time; the ‹ › step buttons
      move exactly one frame; Export to file → Import from file → still plays.
- [ ] Right-click a colour dot → Line width / dashed / dotted, Fill toggle + opacity
      (closed shapes & inequalities only), Colour expression (`hsv(360a,1,1)` animates
      with `a`; invalid text gets a red border and falls back to the swatch colour).
- [ ] `b = 2a` shows a live `= value` badge and no colour dot; `f(x) = x^2` plots;
      `(t, k) for k = 0..3` shows a `×4` badge; Points menu → **Grid & axes** toggles
      the grid.
- [ ] ODE solutions as functions: Examples → **Ball on a spring** (`#example=spring-ball`)
      autoplays; the ball on the coil spring (its mount sliding along the ceiling) rides
      exactly on the drawn curve of `y'' = -k*y - c*y', y(0) = 3, y'(0) = 0`; the `E = …` badge falls
      as the damping drains energy (constant with `c = 0`). Drag `k` → curve, ball and
      spring all follow. Typing `y'' = -y + y(1)` shows "An ODE's equation can't use a
      solution value"; `(1, z(1))` with no ODE in z shows "Unknown function: z". Nothing
      new appears in graphs that don't call a solution.

### Script mode
Automated: `node scripts/e2e-script-mode.cjs http://localhost:5173/ --shots /tmp/shots`
(sandbox isolation, runaway kill, every example light + dark, reference, sliders, clip
import). By eye:
- [ ] Header **Graph | Script** switch; Script mode shows the editor, the canvas keeps
      pan / zoom; Graph mode shows a "Script layer · Hide · Edit" chip.
- [ ] Typing re-runs (Auto-run); an error underlines its line and the console line
      jumps there; `while (true) {}` is stopped after ~3 s with a clear message.
- [ ] Reference: beside the editor on wide windows, a Code | Reference tab on narrow
      ones; Try it / Insert work; both themes readable.
- [ ] Clips: import a short video, preview threshold, import → `clip("name").play()`.

### Performance (4× CPU throttle)
- [ ] Styling-only edits (colour, expanded, point size, anim speed) don't recompute curves.
- [ ] Dragging/animating a variable re-samples only the curves that depend on it; an
      independent implicit/inequality curve is reused (no marching-squares re-run).
- [ ] Pan/zoom + a playing slider together stay smooth.
- [ ] Ball on a spring playing T: smooth (the ODE isn't re-integrated per frame; the
      y(T) solution is cached per group key and only extended).

## All core features shipped
Animatable sliders, implicit intersections/trace, projection redesign, accurate
discontinuities, polar, inequalities, sharing/export, x/t interchange, tutorial, and the
compute caches are all in. There is no longer a known-absent feature in this checklist.
