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

### Inspection
- [ ] Maxima/minima dots on `y''=-y`; zeros on the t-axis; y-intercept at t=0.
- [ ] Intersections between curves shown (e.g. the sine and the arctan).
- [ ] Hover a marker → tooltip with label + coords.
- [ ] Click a curve → pins a trace point; drag along it; it snaps to features.
- [ ] "Points" toggle menu (top-left of plot) shows/hides each family.

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

### Performance (4× CPU throttle)
- [ ] Styling-only edits (colour, expanded, point size, anim speed) don't recompute curves.
- [ ] Dragging/animating a variable re-samples only the curves that depend on it; an
      independent implicit/inequality curve is reused (no marching-squares re-run).
- [ ] Pan/zoom + a playing slider together stay smooth.

## All core features shipped
Animatable sliders, implicit intersections/trace, projection redesign, accurate
discontinuities, polar, inequalities, sharing/export, x/t interchange, tutorial, and the
compute caches are all in. There is no longer a known-absent feature in this checklist.
