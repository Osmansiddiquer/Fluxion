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
        text: 'Use `time` (seconds) anywhere and the script animates. The play bar under the editor pauses, rewinds and scrubs the clock.',
        code: 'const a = time\npoint(3 * cos(a), 3 * sin(a), { size: 8, color: "crimson" })\ncircle(0, 0, 3, { color: "#999", dash: "dotted" })\n',
      },
      {
        name: 'When something goes wrong',
        text: 'Errors show under the editor with their line (click it to jump there), and the line is underlined. The last good drawing stays on screen while you fix it. `print(…)` writes to the **Console**. A script that runs too long (an endless loop) is stopped after a few seconds; fix it and press Run.',
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
        text: '(x, y) is the bottom-left corner. `radius` rounds the corners.',
        code: 'rect(-3, -1, 6, 2, { fill: "#2d70b3", radius: 0.4 })\n',
      },
      {
        name: 'polygon / polyline',
        sig: 'polygon(points, style?) · polyline(points, style?)',
        text: 'A list of `[x, y]` points. `polygon` closes the shape, `polyline` leaves it open. A point with `NaN` breaks the line.',
        code: 'polygon([[-2, -1], [2, -1], [0, 2]], { fill: "orange", color: "black" })\npolyline([[-3, -2], [-1, -1.5], [1, -2], [3, -1.5]], { width: 3 })\n',
      },
      { name: 'line', sig: 'line(x1, y1, x2, y2, style?)', text: 'A straight segment.', code: 'line(-3, -2, 3, 2, { color: "teal", width: 4 })\n' },
      {
        name: 'arrow',
        sig: 'arrow(x1, y1, x2, y2, style?)',
        text: 'A segment with a head at the end. `head` sets its size in pixels.',
        code: 'arrow(0, 0, 3, 2, { color: "crimson", width: 3 })\narrow(0, 0, -2, 2.5, { head: 18 })\n',
      },
      {
        name: 'point',
        sig: 'point(x, y, style?)',
        text: 'A dot that stays the same size on screen. `size` is its radius in pixels.',
        code: 'for (const x of range(-3, 4)) point(x, x * x / 3, { size: 6, color: "#c74440" })\n',
      },
      {
        name: 'arc',
        sig: 'arc(x, y, r, startAngle, endAngle, style?)',
        text: 'Part of a circle. Angles are in radians, counter-clockwise from the right.',
        code: 'arc(0, 0, 2, 0, PI, { width: 4, color: "green" })\narc(0, 0, 1, PI, 1.5 * PI, { width: 4 })\n',
      },
      {
        name: 'text / label',
        sig: 'text(string, x, y, style?) · label(string, x, y, style?)',
        text: '`text` is centred on (x, y); `size` is in pixels, plus `bold`, `align` (left / center / right) and `font` (sans / serif / mono). `label` is a small tag beside a point, with a halo so it reads over lines.',
        code: 'text("y = x²", 0, 3, { size: 22, bold: true })\npoint(1, 1)\nlabel("(1, 1)", 1, 1)\n',
      },
      {
        name: 'path',
        sig: 'path(style?).moveTo(x, y).lineTo(x, y).quadTo(cx, cy, x, y).bezierTo(…).arc(cx, cy, r, a0, a1).close()',
        text: 'Build any outline step by step. Calls chain; the path draws itself, in order with the other shapes.',
        code: 'path({ fill: "pink", color: "crimson", width: 2 })\n  .moveTo(0, -2)\n  .bezierTo(3, 0, 1.5, 2.5, 0, 1)\n  .bezierTo(-1.5, 2.5, -3, 0, 0, -2)\n  .close()\n',
      },
      {
        name: 'curve',
        sig: 'curve(t => [x, y], tFrom, tTo, style?)',
        text: 'A parametric curve: your function returns a point for each t. Give it a `fill` to close it. `samples` (default 240) sets the smoothness.',
        code: 'curve(t => [3 * cos(t), 2 * sin(2 * t)], 0, TAU, { color: "#6042a6", width: 3 })\n',
      },
      {
        name: 'plot',
        sig: 'plot(x => y, style?)',
        text: 'Graph a function across the visible x-range (it follows pan and zoom).',
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
        text: '`color` the outline colour · `fill` the inside (a colour, a gradient, or `true` for the outline colour) · `width` line width in pixels (default 2) · `dash` `"dashed"`, `"dotted"` or a pixel pattern like `[8, 4]` · `opacity` 0 to 1 · `cap` / `join` line ends and corners.\n\nGive only `fill` and the shape has no outline; give `color` too for both. With neither, you get an outline in the theme\'s ink colour.',
        code: 'circle(-3, 0, 1.2, { fill: "tomato" })\ncircle(0, 0, 1.2, { fill: "tomato", color: "black", width: 3 })\ncircle(3, 0, 1.2, { color: "tomato", width: 4, dash: "dashed", opacity: 0.6 })\n',
      },
      {
        name: 'Gradients',
        sig: 'linearGradient(x0, y0, x1, y1, colors) · radialGradient(x, y, r, colors)',
        text: 'Use as a `fill`. Colours are spread evenly, or give `[offset, color]` pairs.',
        code: 'circle(0, 0, 2.5, { fill: radialGradient(-0.8, 0.8, 3.5, ["white", "#ff8c00", "#7a1f00"]) })\nrect(-4, -3.6, 8, 0.6, { fill: linearGradient(-4, 0, 4, 0, ["#2d70b3", "#6042a6", "#c74440"]) })\n',
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
        text: '`mix` blends two colours (t = 0 → the first, 1 → the second). `alpha` gives a colour a new opacity.',
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
        sig: 'group({ translate: [x, y], rotate, scale, origin: [x, y] }, () => { … })',
        text: 'Draw inside a moved / turned / scaled frame; everything goes back to normal afterwards. `origin` is the point rotation and scaling happen around.',
        code: 'function petal() {\n  ellipse(1.2, 0, 1.2, 0.4, { fill: alpha("#c74440", 0.6) })\n}\nfor (const k of range(8)) group({ rotate: k * TAU / 8 + 0.3 * time }, petal)\n',
      },
      {
        name: 'push / pop, translate / rotate / scale',
        sig: 'push() · translate(x, y) · rotate(angle, cx?, cy?) · scale(sx, sy?) · pop()',
        text: 'The step-by-step form: `push()` saves the current frame, the others change it, `pop()` restores it.',
        code: 'push()\ntranslate(2, 1)\nrotate(PI / 6)\nrect(-1, -0.5, 2, 1, { fill: "#2d70b3" })\npop()\nrect(-1, -0.5, 2, 1, { color: "#999", dash: "dashed" })\n',
      },
    ],
  },
  {
    id: 'animation',
    title: 'Animation',
    intro: 'A script that reads the clock runs every frame (about 60 per second). Everything is recomputed from `time`, so scrubbing and looping just work.',
    entries: [
      { name: 'time / frame', sig: 'time · frame', text: '`time` is seconds since the clock started; `frame` counts 60 per second.', code: 'circle(2 * cos(time), 2 * sin(2 * time), 0.4, { fill: "crimson" })\ntext(`t = ${time.toFixed(1)} s`, 0, -3)\n' },
      {
        name: 'loop',
        sig: 'loop(seconds)',
        text: 'Make the clock wrap, for a seamless loop. Make everything return to where it started at the end.',
        code: 'loop(4)\nconst u = time / 4\ngroup({ rotate: u * TAU / 3 }, () => polygon([[0, 2], [-1.7, -1], [1.7, -1]], { fill: "#6042a6" }))\n',
      },
      {
        name: 'lerp / ease / smoothstep',
        sig: 'lerp(a, b, t) · ease(t, "inOut" | "in" | "out") · smoothstep(edge0, edge1, x)',
        text: '`lerp` goes from a to b as t goes 0 → 1. `ease` softens a 0–1 value. `smoothstep` is 0 before edge0, 1 after edge1, smooth between.',
        code: 'loop(3)\nconst u = ease(abs(1 - 2 * time / 3))\ncircle(lerp(-4, 4, u), 0, 0.6, { fill: "#388c46" })\n',
      },
      {
        name: 'keyframes',
        sig: 'keyframes(t, [[t0, v0], [t1, v1], …], { ease? })',
        text: 'A value that passes through (time, value) keys, held flat outside them. Values can be numbers, `[x, y]` arrays or colours. Spans are eased; pass `{ ease: false }` for straight lines.',
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
        sig: 'slider(name, min, max, value?, step?)',
        text: 'Returns the slider\'s current value. `value` is where it starts; `step` snaps it (e.g. 1 for whole numbers).',
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
        text: '`sin cos tan asin acos atan atan2 sinh cosh tanh sqrt cbrt abs sign floor ceil round trunc min max pow exp log log2 log10 hypot`, `mod(x, m)` (never negative), and `PI`, `TAU` (2π), `E`. Everything in JavaScript\'s `Math` works too.',
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
        sig: 'camera({ yaw, pitch, dist, scale }) → .line(a, b) .polygon(points) .point(p) .project(p) .depth(p)',
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
        sig: 'graph.value(name) · graph.fn(name)(…args)',
        text: '`graph.value("k")` reads a slider or a value like `b = 2a`. `graph.fn("f")` gives you a function defined in Graph mode, such as `f(x) = x^2 - k`. `graph.has(name)` checks first.',
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
        sig: 'clip(name) → .play(style?) .draw(frame, style?) .frameAt(seconds) .frames .fps .duration',
        text: '`play()` shows the frame for the current `time`. `draw(n)` shows frame n. The style takes `x`, `y` (the centre), `width` or `height`, plus `fill` / `color` as for shapes.',
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
        text: '`view` is the visible range (it follows pan and zoom). `theme` is `"light"` or `"dark"`, and `ink` is the default drawing colour for it. `print` and `console.log` write to the Console under the editor.',
        code: 'const { xmin, xmax, ymin, ymax } = view\nrect(xmin + 0.5, ymin + 0.5, 2, 1, { fill: theme === "dark" ? "#333" : "#eee", color: ink })\nconsole.log("view", xmin, xmax)\n',
      },
      {
        name: 'Layers',
        text: 'The script draws above Graph-mode curves and below markers, points and the cross-section cursors. Later shapes draw over earlier ones. In Graph mode a chip on the canvas shows or hides the script\'s drawing.',
      },
      {
        name: 'Speed',
        text: 'Each frame should take a few milliseconds (shown under the editor). Thousands of shapes are fine; for many points use one `polyline` or `path` instead of many `point`s. Lower `samples` on `curve` if it gets slow. A frame that takes too long stops the script.',
      },
      {
        name: 'Sharing',
        text: 'The script travels with the graph: share links, exported files and the JSON spec all carry it. Opening someone\'s link is safe — scripts run sandboxed, with no access to the page, your storage or the internet.',
      },
    ],
  },
];
