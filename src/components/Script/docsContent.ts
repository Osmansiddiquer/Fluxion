/**
 * The in-app Scripting reference, as data. Every `code` snippet is run by
 * docs.script.test.ts (with its `needs`), so the reference can't drift from
 * the API. Text uses `backticks` for code and blank lines for paragraphs.
 */
import type { SnippetNeeds } from './scriptBus';

export interface DocEntry {
  /** Function / topic name shown as the entry title. */
  name: string;
  /** Signature line (monospace). */
  sig?: string;
  text: string;
  /** A small reference table under the text (cells use the same markup). */
  table?: { head: string[]; rows: string[][] };
  code?: string;
  /** Graph-mode expressions the snippet reads ("Try it" adds them). */
  needs?: SnippetNeeds;
  /** The snippet plays an imported clip called "apple". */
  clip?: boolean;
}

export interface DocSection {
  id: string;
  title: string;
  intro?: string;
  entries: DocEntry[];
}

const PENDULUM = { entries: [{ raw: "theta'' = -sin(theta) - 0.15theta'", ic: [2, 0] }] };

export const DOCS: DocSection[] = [
  {
    id: 'start',
    title: 'Getting started',
    intro:
      'A script is JavaScript that draws on the graph. It runs top to bottom, and again for every frame when it animates. Shapes use the same coordinates as the graph, so `circle(0, 0, 1)` is the unit circle and pan / zoom just work. Scripts run in a sandbox: they can draw, but they can\'t reach the page, your files or the network.',
    entries: [
      {
        name: 'Your first script',
        text: 'Call a shape function with numbers. The last argument is an optional style. With **Auto-run** on, the drawing updates as you type; otherwise press **Run** (Ctrl + Enter).',
        code: 'circle(0, 0, 2, { fill: "gold", color: "black", width: 3 })\ntext("Hello, Fluxion", 0, -3, { size: 20 })\n',
      },
      {
        name: 'Loops and variables',
        text: 'It\'s plain JavaScript: `const`, `for`, functions, arrays. `range(n)` gives `0 … n−1`.',
        code: 'for (const i of range(7)) {\n  const x = i - 3\n  circle(x, sin(x), 0.35, { fill: hsv(50 * i, 0.7, 0.95) })\n}\n',
      },
      {
        name: 'Make it move',
        text: 'Use `time` (seconds) anywhere and the script animates. The play bar under the editor pauses, rewinds and scrubs the clock. (Exactly when a script animates is under **Animation**.)',
        code: 'const a = time\npoint(3 * cos(a), 3 * sin(a), { size: 8, color: "crimson" })\ncircle(0, 0, 3, { color: "#999", dash: "dotted" })\n',
      },
      {
        name: 'When something goes wrong',
        text: 'Errors show under the editor with their line (click it to jump there), and the line is underlined. The last good drawing stays on screen while you fix it. `print(…)` (or `console.log`) writes to the **Console**. A script that runs too long (an endless loop) is stopped: after 3 seconds for a run or an edit, 1.5 seconds for one animation frame. Fix it and press Run. All the limits are under **Limits**.',
        code: 'const r = 2\nprint("radius is", r)\ncircle(0, 0, r)\n',
      },
    ],
  },
  {
    id: 'shapes',
    title: 'Shapes',
    intro: 'Coordinates and sizes are in graph units unless noted. Every shape takes a style as its last argument (next section).',
    entries: [
      { name: 'circle', sig: 'circle(x, y, r, style?)', text: 'A circle centred at (x, y).', code: 'circle(0, 0, 2, { fill: "skyblue" })\n' },
      { name: 'ellipse', sig: 'ellipse(x, y, rx, ry, style?)', text: 'Radii `rx` across and `ry` up. Turn it with `group({ rotate })`.', code: 'ellipse(0, 0, 3, 1.5, { color: "purple", width: 3 })\n' },
      {
        name: 'rect',
        sig: 'rect(x, y, width, height, style?)',
        text: '(x, y) is the bottom-left corner. `radius` rounds the corners (graph units, at most half a side).',
        code: 'rect(-3, -1, 6, 2, { fill: "#2d70b3", radius: 0.4 })\n',
      },
      {
        name: 'polygon / polyline',
        sig: 'polygon(points, style?) · polyline(points, style?)',
        text: 'A list of `[x, y]` points (a flat `[x0, y0, x1, y1, …]` list or `{ x, y }` objects work too). `polygon` closes the shape, `polyline` leaves it open. A point with `NaN` breaks the line.',
        code: 'polygon([[-2, -1], [2, -1], [0, 2]], { fill: "orange", color: "black" })\npolyline([[-3, -2], [-1, -1.5], [1, -2], [3, -1.5]], { width: 3 })\n',
      },
      { name: 'line', sig: 'line(x1, y1, x2, y2, style?)', text: 'A straight segment.', code: 'line(-3, -2, 3, 2, { color: "teal", width: 4 })\n' },
      {
        name: 'arrow',
        sig: 'arrow(x1, y1, x2, y2, style?)',
        text: 'A segment with a head at the end. `head` sets its size in pixels (default 10 + 1.5 × `width`).',
        code: 'arrow(0, 0, 3, 2, { color: "crimson", width: 3 })\narrow(0, 0, -2, 2.5, { head: 18 })\n',
      },
      {
        name: 'point',
        sig: 'point(x, y, style?)',
        text: 'A dot that stays the same size on screen. `size` is its radius in pixels (default 4). `color` (or `fill`) colours the dot; `stroke` adds an outline.',
        code: 'for (const x of range(-3, 4)) point(x, x * x / 3, { size: 6, color: "#c74440" })\n',
      },
      {
        name: 'arc',
        sig: 'arc(x, y, r, startAngle, endAngle, style?)',
        text: 'Part of a circle. Angles are in radians, counter-clockwise from the right. If `endAngle` is less than `startAngle` the arc goes clockwise.',
        code: 'arc(0, 0, 2, 0, PI, { width: 4, color: "green" })\narc(0, 0, 1, PI, 1.5 * PI, { width: 4 })\n',
      },
      {
        name: 'text / label',
        sig: 'text(string, x, y, style?) · label(string, x, y, style?)',
        text: '`text` is centred on (x, y), 16 px. `label` is a small tag beside a point: 13 px, to the upper right of (x, y), with a halo so it reads over lines. Both take `size` (pixels), `bold: true`, `align` (left / center / right), `baseline` (top / middle / bottom / alphabetic), `font` (sans / serif / mono) and `halo: true`; `color` is the text colour. Numbers print to 6 significant figures, and text turns with `rotate`.',
        code: 'text("y = x²", 0, 3, { size: 22, bold: true })\ntext(PI, 0, 2, { font: "mono", halo: true })\npoint(1, 1)\nlabel("(1, 1)", 1, 1)\n',
      },
      {
        name: 'path',
        sig: 'path(style?).moveTo(x, y).lineTo(x, y).quadTo(cx, cy, x, y).bezierTo(c1x, c1y, c2x, c2y, x, y).arc(cx, cy, r, a0, a1, ccw?).close()',
        text: 'Build any outline step by step. Calls chain; the path draws itself, in order with the other shapes. A first `lineTo` acts as `moveTo`. `arc` joins the pen to the arc\'s start; it runs counter-clockwise unless `a1 < a0` (pass `ccw` to choose).',
        code: 'path({ fill: "pink", color: "crimson", width: 2 })\n  .moveTo(0, -2)\n  .bezierTo(3, 0, 1.5, 2.5, 0, 1)\n  .bezierTo(-1.5, 2.5, -3, 0, 0, -2)\n  .close()\n',
      },
      {
        name: 'curve',
        sig: 'curve(t => [x, y], tFrom = 0, tTo = 2π, style?)',
        text: 'A parametric curve: your function returns `[x, y]` (or `{ x, y }`) for each t. Give it a `fill`, or `closed: true`, to close it. `samples` (default 240, 2 to 5000) sets the smoothness. To pass a style, give the t-range too.',
        code: 'curve(t => [3 * cos(t), 2 * sin(2 * t)], 0, TAU, { color: "#6042a6", width: 3 })\n',
      },
      {
        name: 'plot',
        sig: 'plot(x => y, style?)',
        text: 'Graph a function across the visible x-range (it follows pan and zoom). `samples` defaults to 600. Values more than 50 view-heights off screen (and `NaN`) leave a gap, which breaks the line at most asymptotes.',
        code: 'plot(x => sin(x) + 0.3 * sin(3 * x), { color: "#388c46", width: 3 })\n',
      },
      {
        name: 'background',
        sig: 'background(color)',
        text: 'Paint the whole canvas (hides the grid). Good for drawings and animations.',
        code: 'background("#101418")\ncircle(0, 0, 2, { fill: "#f6d860" })\n',
      },
    ],
  },
  {
    id: 'style',
    title: 'Style',
    intro: 'The last argument of every shape: an object with any of these keys.',
    entries: [
      {
        name: 'Options',
        text: '`color` the outline colour (`stroke` is another name for it; `null`, `false` or `"none"` for no outline) · `fill` the inside (a colour, a gradient, `true` for the outline colour, or `"none"`) · `width` line width in pixels (default 2) · `dash` `"dashed"`, `"dotted"` or a pixel pattern like `[8, 4]` · `opacity` 0 to 1 · `cap` line ends: `"round"` (default), `"butt"`, `"square"` · `join` corners: `"round"` (default), `"miter"`, `"bevel"`.\n\nGive only `fill` and the shape has no outline; give `color` too for both. With neither, you get an outline in the theme\'s ink colour.',
        code: 'circle(-3, 0, 1.2, { fill: "tomato" })\ncircle(0, 0, 1.2, { fill: "tomato", color: "black", width: 3 })\ncircle(3, 0, 1.2, { color: "tomato", width: 4, dash: "dashed", opacity: 0.6 })\npolyline([[-4, -2.5], [-2, -1.8], [0, -2.5]], { width: 8, cap: "butt", join: "miter" })\n',
      },
      {
        name: 'Keys for some shapes',
        text: 'A few keys only mean something to certain shapes. Unknown keys are ignored.',
        table: {
          head: ['Key', 'Shape', 'Meaning'],
          rows: [
            ['`radius`', '`rect`', 'Corner radius, graph units'],
            ['`head`', '`arrow`', 'Head size in px (default 10 + 1.5 × width)'],
            ['`size`', '`point` · `text` / `label`', 'Dot radius (default 4) · font size (16 / 13), px'],
            ['`stroke`', '`point`', 'Outline round the dot'],
            ['`bold` `align` `baseline` `font` `halo`', '`text` / `label`', 'Text options (see **text / label**)'],
            ['`samples`', '`curve` · `plot`', 'Smoothness (default 240 · 600; 2 to 5000)'],
            ['`closed`', '`curve`', '`true` joins the end to the start'],
            ['`x` `y` `width` `height`', 'clip `draw` / `play`', 'Centre and size in graph units (here `width` is not the line width)'],
          ],
        },
      },
      {
        name: 'Gradients',
        sig: 'linearGradient(x0, y0, x1, y1, colors) · radialGradient(x, y, r, colors)',
        text: 'Use as a `fill`. Colours are spread evenly, or give `[offset, color]` pairs (offset 0 to 1), up to 16 stops. The coordinates follow the current transform, as shapes do.',
        code: 'circle(0, 0, 2.5, { fill: radialGradient(-0.8, 0.8, 3.5, ["white", "#ff8c00", "#7a1f00"]) })\nrect(-4, -3.6, 8, 0.6, { fill: linearGradient(-4, 0, 4, 0, [[0, "#2d70b3"], [0.7, "#6042a6"], [1, "#c74440"]]) })\n',
      },
    ],
  },
  {
    id: 'color',
    title: 'Colour',
    intro: 'Anywhere a colour goes you can write a CSS colour (`"red"`, `"#c74440"`) or use these helpers.',
    entries: [
      { name: 'rgb', sig: 'rgb(r, g, b, a?)', text: 'Channels 0–255, alpha 0–1.', code: 'circle(0, 0, 2, { fill: rgb(40, 160, 120, 0.8) })\n' },
      {
        name: 'hsv / hsl',
        sig: 'hsv(h, s, v, a?) · hsl(h, s, l, a?)',
        text: 'Hue in degrees (wraps round), the rest 0–1. Animate the hue for rainbows.',
        code: 'for (const k of range(12)) {\n  const q = k * TAU / 12\n  circle(3 * cos(q), 3 * sin(q), 0.6, { fill: hsv(30 * k + 40 * time, 0.75, 0.95) })\n}\n',
      },
      {
        name: 'mix / alpha',
        sig: 'mix(color1, color2, t) · alpha(color, a)',
        text: '`mix` blends two colours (t = 0 → the first, 1 → the second). `alpha` gives a colour a new opacity. Both read CSS names, `#hex`, and `rgb(…)`, `hsl(…)` or `hsv(…)` strings.',
        code: 'for (const i of range(6)) rect(i - 3, -0.5, 1, 1, { fill: mix("#2d70b3", "#f6d860", i / 5) })\ncircle(0, 0, 2.5, { fill: alpha("crimson", 0.2) })\n',
      },
    ],
  },
  {
    id: 'transforms',
    title: 'Transforms',
    intro: 'Move, turn and scale whole groups of shapes. Angles are radians, counter-clockwise.',
    entries: [
      {
        name: 'group',
        sig: 'group({ translate: [x, y], rotate, scale, origin: [x, y] }, () => { … }) · group(() => { … })',
        text: 'Draw inside a moved / turned / scaled frame; everything goes back to normal afterwards. `scale` is a number or `[sx, sy]`. `origin` is the point rotation and scaling happen around. Shapes are scaled first, then rotated, then translated. Without options, `group(fn)` just keeps transforms made inside it from leaking out.',
        code: 'function petal() {\n  ellipse(1.2, 0, 1.2, 0.4, { fill: alpha("#c74440", 0.6) })\n}\nfor (const k of range(8)) group({ rotate: k * TAU / 8 + 0.3 * time }, petal)\n',
      },
      {
        name: 'push / pop, translate / rotate / scale',
        sig: 'push() · translate(x, y) · rotate(angle, cx?, cy?) · scale(sx, sy?) · pop()',
        text: 'The step-by-step form: `push()` saves the current frame, the others change it, `pop()` restores it. Each call applies to shapes drawn after it, inside what came before. `rotate` turns around (cx, cy), default the origin; `scale(s)` scales both ways.',
        code: 'push()\ntranslate(2, 1)\nrotate(PI / 6)\nrect(-1, -0.5, 2, 1, { fill: "#2d70b3" })\npop()\nrect(-1, -0.5, 2, 1, { color: "#999", dash: "dashed" })\n',
      },
    ],
  },
  {
    id: 'animation',
    title: 'Animation',
    intro: 'A script animates (runs every frame, about 60 per second) when its code mentions `time` or `frame` outside comments and quoted strings, or when it calls `loop()` or a clip\'s `play()`. Otherwise it runs once per edit. Everything is recomputed from `time`, so scrubbing and looping just work.',
    entries: [
      { name: 'time / frame', sig: 'time · frame', text: '`time` is seconds since the clock started; `frame` is `floor(time × 60)`.', code: 'circle(2 * cos(time), 2 * sin(2 * time), 0.4, { fill: "crimson" })\ntext(`t = ${time.toFixed(1)} s`, 0, -3)\n' },
      {
        name: 'loop',
        sig: 'loop(seconds)',
        text: 'Make the clock wrap, for a seamless loop. Make everything return to where it started at the end.',
        code: 'loop(4)\nconst u = time / 4\ngroup({ rotate: u * TAU / 3 }, () => polygon([[0, 2], [-1.7, -1], [1.7, -1]], { fill: "#6042a6" }))\n',
      },
      {
        name: 'lerp / ease / smoothstep',
        sig: 'lerp(a, b, t) · ease(t, "inOut" | "in" | "out" | "linear") · smoothstep(edge0, edge1, x)',
        text: '`lerp` goes from a to b as t goes 0 → 1. `ease` softens a 0–1 value (cubic; `"inOut"` is the default, `"linear"` only clamps to 0–1). `smoothstep` is 0 before edge0, 1 after edge1, smooth between.',
        code: 'loop(3)\nconst u = ease(abs(1 - 2 * time / 3))\ncircle(lerp(-4, 4, u), 0, 0.6, { fill: "#388c46" })\n',
      },
      {
        name: 'keyframes',
        sig: 'keyframes(t, [[t0, v0], [t1, v1], …], { ease? })',
        text: 'A value that passes through (time, value) keys, held flat outside them. Values can be numbers, `[x, y]` arrays or colours. Spans are eased (`{ ease: "smooth" }`, the default); pass `{ ease: "linear" }` or `{ ease: false }` for straight lines.',
        code: 'loop(6)\nconst [x, y] = keyframes(time, [[0, [-3, -2]], [2, [3, -2]], [4, [0, 2.5]], [6, [-3, -2]]])\nconst c = keyframes(time, [[0, "#2d70b3"], [3, "#c74440"], [6, "#2d70b3"]])\ncircle(x, y, 0.6, { fill: c })\n',
      },
      {
        name: 'clamp / map',
        sig: 'clamp(x, lo = 0, hi = 1) · map(x, inLo, inHi, outLo, outHi)',
        text: 'Keep a value in range; rescale one range onto another.',
        code: 'const s = clamp(map(sin(time), -1, 1, 0.5, 2.5), 1, 2)\ncircle(0, 0, s, { fill: "gold" })\n',
      },
    ],
  },
  {
    id: 'sliders',
    title: 'Sliders',
    intro: 'Real slider controls appear under the editor. Their values are saved with the graph and travel in share links.',
    entries: [
      {
        name: 'slider',
        sig: 'slider(name, min = 0, max = 1, value = min, step?)',
        text: 'Returns the slider\'s current value. `value` is where it starts (default `min`); `step` snaps it (e.g. 1 for whole numbers). The name is the slider\'s label and key: it starts with a letter, `_` or `$`, then letters, digits, `_`, `$` or spaces, up to 32 characters. Calling `slider` again with the same name returns the same slider. Up to 32 sliders.',
        code: 'const n = slider("sides", 3, 12, 5, 1)\nconst r = slider("radius", 0.5, 4, 2.5)\npolygon(range(n).map(k => [r * cos(k * TAU / n), r * sin(k * TAU / n)]), { fill: "#e8a33d", color: "#7a4a00" })\n',
      },
    ],
  },
  {
    id: 'maths',
    title: 'Maths',
    entries: [
      {
        name: 'Built in',
        text: '`sin cos tan asin acos atan atan2 sinh cosh tanh sqrt cbrt abs sign floor ceil round trunc min max pow exp log log2 log10 hypot`, `mod(x, m)` (never negative), and `PI`, `TAU` (2π), `E`. `log` is the natural log (`print` is for output). Everything in JavaScript\'s `Math` works too, as `Math.…`.',
        code: 'print(sqrt(2), atan2(1, 1), mod(-1, 3), TAU)\n',
      },
      {
        name: 'range / rand / random',
        sig: 'range(n) · range(from, to, step?) · rand(seed) · random()',
        text: '`rand(seed)` is a random-looking number 0–1 that stays the same every frame (good for star fields). `random()` changes every frame.',
        code: 'background("#0b1020")\nfor (const i of range(150)) {\n  const x = lerp(-8, 8, rand(i)), y = lerp(-5, 5, rand(i + 0.5))\n  point(x, y, { size: 1 + 2 * rand(i + 0.7), color: alpha("white", 0.4 + 0.6 * abs(sin(time + 9 * i))) })\n}\n',
      },
    ],
  },
  {
    id: '3d',
    title: '3D',
    intro: 'Project 3D points onto the graph with a simple camera.',
    entries: [
      {
        name: 'camera',
        sig: 'camera({ yaw, pitch, dist, scale }) → .line(a, b) .polyline(points) .polygon(points) .point(p) .project(p) .depth(p)',
        text: '`yaw` turns around the vertical axis, `pitch` tilts, `dist` is the camera distance (0 = no perspective), `scale` zooms. Points are `[x, y, z]`. Sort faces by `depth` (bigger = nearer) to draw back to front.',
        code: 'const cam = camera({ yaw: time * 0.6, pitch: 0.45, dist: 7, scale: 1.6 })\nconst V = [[-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1], [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1]]\nconst E = [[0,1],[1,3],[3,2],[2,0],[4,5],[5,7],[7,6],[6,4],[0,4],[1,5],[2,6],[3,7]]\nfor (const [a, b] of E) cam.line(V[a], V[b], { color: "#2d70b3", width: 3 })\nfor (const v of V) cam.point(v, { size: 4 })\n',
      },
      {
        name: 'project3d',
        sig: 'project3d([x, y, z], { yaw, pitch, dist, scale }) → [x, y]',
        text: 'The same projection as a plain function, for building your own shapes.',
        code: 'const pts = range(200).map(i => project3d([cos(i / 8), i / 60 - 1.6, sin(i / 8)], { yaw: time, pitch: 0.3, scale: 2 }))\npolyline(pts, { color: "#c74440", width: 2 })\n',
      },
    ],
  },
  {
    id: 'graph',
    title: 'Reading Graph mode',
    intro: 'Scripts can use what you typed in Graph mode: slider values, functions and — Fluxion\'s speciality — solutions of differential equations, solved on demand at any time t.',
    entries: [
      {
        name: 'graph.ode',
        sig: 'graph.ode(name, derivative = 0) → t => value',
        text: 'The solution of the Graph-mode ODE for `name`, with its initial conditions. `graph.ode("theta", 1)` is θ′. This draws the pendulum whose angle obeys θ″ = −sin θ − 0.15 θ′ (Try it adds that equation for you).',
        code: 'const theta = graph.ode("theta")\nconst a = theta(time)\nconst [bx, by] = [3 * sin(a), 2 - 3 * cos(a)]\nline(0, 2, bx, by, { width: 3 })\ncircle(bx, by, 0.35, { fill: "#c74440", color: "black" })\npoint(0, 2, { size: 5 })\n',
        needs: PENDULUM,
      },
      {
        name: 'graph.value / graph.fn',
        sig: 'graph.value(name) · graph.fn(name)(…args) · graph.has(name) · graph.names()',
        text: '`graph.value("k")` reads a slider or a value like `b = 2a`. `graph.fn("f")` gives you a function defined in Graph mode, such as `f(x) = x^2 - k`. `graph.has(name)` checks first; `graph.names()` lists every name a script can read.',
        code: 'const k = graph.has("k") ? graph.value("k") : 1\nconst f = graph.fn("f")\nfor (const x of range(-2, 2.01, 0.5)) point(x, f(x), { size: 5, color: hsv(60 * x + 180, 0.8, 0.85) })\ntext(`k = ${k}`, 0, 3)\n',
        needs: { entries: [{ raw: 'k = 1' }, { raw: 'f(x) = x^2 - k' }] },
      },
    ],
  },
  {
    id: 'clips',
    title: 'Clips (video)',
    intro:
      'A clip is a short black-and-white video turned into shapes, frame by frame — the "Bad Apple!!" trick. Each frame becomes filled outlines, so a clip plays crisply at any zoom and can be coloured, moved and scaled like any shape.',
    entries: [
      {
        name: 'Importing a clip',
        text: 'Press **Clips** in the toolbar, pick a video (or a GIF, or a set of images) and a name. Choose the frame rate, size and the light / dark threshold while watching the preview, then import. It\'s all done in your browser; nothing is uploaded. Clips are saved with the graph file and share link (up to a few MB). For long videos, the command-line importer (`scripts/frames-import.ts`) is faster.',
      },
      {
        name: 'clip',
        sig: 'clip(name) → .play(style?) .draw(frame, style?) .frameAt(seconds) .name .frames .fps .duration .box',
        text: '`play()` shows the frame for the current `time` (and makes the script animate). `draw(n)` shows frame n, wrapping round. `frameAt(t)` is the frame number at t seconds; `duration` is in seconds; `box` is the clip\'s own `[xmin, ymin, xmax, ymax]`. The style takes `x`, `y` (the centre), `width` or `height` (give one to keep the shape), plus `fill` / `color` as for shapes; with neither, it fills in the ink colour. A script can use up to 8 clips.',
        code: 'const c = clip("apple")\nbackground("#f6f4ef")\nc.play({ fill: "#111" })\ntext(`frame ${c.frameAt(time)} of ${c.frames}`, 0, -4, { size: 13 })\n',
        clip: true,
      },
    ],
  },
  {
    id: 'tips',
    title: 'Tips',
    entries: [
      {
        name: 'Name your shapes',
        text: 'Put a shape in a function and draw it many times: `function tomoe(angle) { … }`. Combine with `group` to place and turn it. The examples (toolbar → Examples) are built this way — open one and read it.',
        code: 'function star(x, y, r, color) {\n  const pts = range(10).map(k => {\n    const q = PI / 2 + k * PI / 5, s = k % 2 ? r * 0.45 : r\n    return [x + s * cos(q), y + s * sin(q)]\n  })\n  polygon(pts, { fill: color })\n}\nstar(-2, 0, 1.5, "gold")\nstar(2, 0, 1, "orange")\n',
      },
      {
        name: 'view, theme, ink, print',
        sig: 'view.xmin · view.xmax · view.ymin · view.ymax · theme · ink · print(…) · console.log(…)',
        text: '`view` is the visible range (it follows pan and zoom). `theme` is `"light"` or `"dark"`, and `ink` is the default drawing colour for it. `print` and `console.log` (also `.info`, `.warn`, `.error`, `.debug`) write to the Console under the editor; numbers show 8 significant figures, arrays and objects as JSON.',
        code: 'const { xmin, xmax, ymin, ymax } = view\nrect(xmin + 0.5, ymin + 0.5, 2, 1, { fill: theme === "dark" ? "#333" : "#eee", color: ink })\nconsole.log("view", xmin, xmax)\n',
      },
      {
        name: 'Layers',
        text: 'The script draws above Graph-mode curves and below markers, points and the cross-section cursors. Later shapes draw over earlier ones. In Graph mode a chip on the canvas shows or hides the script\'s drawing.',
      },
      {
        name: 'Speed',
        text: 'Each frame should take a few milliseconds (shown under the editor). Thousands of shapes are fine; for many points use one `polyline` or `path` instead of many `point`s. Lower `samples` on `curve` if it gets slow. A frame over 40 ms gets a **slow** badge; one over 1.5 s stops the script.',
      },
      {
        name: 'Sharing',
        text: 'The script travels with the graph: share links, exported files and the JSON spec all carry it. Imported clips go in share links and files, but not in a JSON spec. Opening someone\'s link is safe — scripts run sandboxed, with no access to the page, your storage or the internet.',
      },
    ],
  },
  {
    id: 'limits',
    title: 'Limits',
    intro: 'Scripts run in a sandbox with fixed budgets, so a mistake can\'t freeze the page.',
    entries: [
      {
        name: 'Budgets',
        text: 'Going over a limit stops the frame with an error, except where noted.',
        table: {
          head: ['What', 'Limit'],
          rows: [
            ['Run time', '3 s for a run or an edit, 1.5 s for one animation frame, then the script is stopped. Frames over 40 ms show **slow**.'],
            ['Shapes', '20,000 per frame'],
            ['Points', 'About 300,000 per frame (600,000 numbers)'],
            ['Script', '100,000 characters'],
            ['Text', '300 characters per `text` / `label` (cut off)'],
            ['Console', '100 lines per run, 1,000 characters each (the rest is dropped)'],
            ['Sliders', '32, with names up to 32 characters'],
            ['Clips', '8 per script'],
            ['Style', '16 gradient stops, 8 dash entries; `width`, `size` and `head` at most 400 px (extra is cut off)'],
            ['Numbers', 'Coordinates beyond ±1e9 (or `NaN`) are dropped silently: the shape is skipped, or the line gets a gap'],
            ['Nesting', '256 levels of `push()`; `range` up to 1,000,000 values'],
          ],
        },
      },
    ],
  },
];
