/**
 * The names and signatures of the Script mode API — dependency-free, so the
 * editor (autocomplete) can load it without the runtime.
 */

/** Every name a script can use without declaring it. Order = parameter order. */
export const API_NAMES = [
  // shapes
  'circle', 'ellipse', 'rect', 'polygon', 'polyline', 'line', 'arrow', 'point', 'arc',
  'text', 'label', 'path', 'curve', 'plot', 'background',
  // transforms
  'push', 'pop', 'translate', 'rotate', 'scale', 'group',
  // colour
  'rgb', 'hsv', 'hsl', 'mix', 'alpha', 'linearGradient', 'radialGradient',
  // maths & animation
  'lerp', 'clamp', 'smoothstep', 'ease', 'keyframes', 'map', 'range', 'rand',
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh',
  'sqrt', 'cbrt', 'abs', 'sign', 'floor', 'ceil', 'round', 'trunc', 'min', 'max',
  'pow', 'exp', 'log', 'log2', 'log10', 'hypot', 'random', 'mod',
  'PI', 'TAU', 'E',
  // 3D
  'project3d', 'camera',
  // clock & inputs
  'time', 'frame', 'loop', 'slider',
  // grapher, clips, environment
  'graph', 'clip', 'view', 'theme', 'ink', 'print', 'console',
] as const;

/** Short signatures for autocomplete (editor) — kept next to the names. */
export const API_SIGNATURES: Record<(typeof API_NAMES)[number], string> = {
  circle: 'circle(x, y, r, style?)',
  ellipse: 'ellipse(x, y, rx, ry, style?)',
  rect: 'rect(x, y, width, height, style?)',
  polygon: 'polygon(points, style?)',
  polyline: 'polyline(points, style?)',
  line: 'line(x1, y1, x2, y2, style?)',
  arrow: 'arrow(x1, y1, x2, y2, style?)',
  point: 'point(x, y, style?)',
  arc: 'arc(x, y, r, startAngle, endAngle, style?)',
  text: 'text(string, x, y, style?)',
  label: 'label(string, x, y, style?)',
  path: 'path(style?) → .moveTo(x, y) .lineTo(x, y) .arc(cx, cy, r, a0, a1, ccw?) .quadTo .bezierTo .close()',
  curve: 'curve(t => [x, y], tFrom = 0, tTo = 2π, style?)  { samples, closed }',
  plot: 'plot(x => y, style?)  { samples = 600 }',
  background: 'background(color)',
  push: 'push()',
  pop: 'pop()',
  translate: 'translate(x, y)',
  rotate: 'rotate(angle, cx?, cy?)',
  scale: 'scale(sx, sy?)',
  group: 'group({ translate, rotate, scale, origin }?, () => { … })',
  rgb: 'rgb(r, g, b, a?)  0–255',
  hsv: 'hsv(h, s, v, a?)  h in degrees',
  hsl: 'hsl(h, s, l, a?)  h in degrees',
  mix: 'mix(color1, color2, t)',
  alpha: 'alpha(color, a)',
  linearGradient: 'linearGradient(x0, y0, x1, y1, colors | [[offset, color], …])',
  radialGradient: 'radialGradient(x, y, r, colors | [[offset, color], …])',
  lerp: 'lerp(a, b, t)',
  clamp: 'clamp(x, lo = 0, hi = 1)',
  smoothstep: 'smoothstep(edge0, edge1, x)',
  ease: "ease(t, 'inOut' | 'in' | 'out' | 'linear')",
  keyframes: "keyframes(t, [[t0, v0], [t1, v1], …], { ease: 'smooth' | 'linear' })",
  map: 'map(x, inLo, inHi, outLo, outHi)',
  range: 'range(n) or range(from, to, step?)',
  rand: 'rand(seed) → 0…1, the same every frame',
  sin: 'sin(x)', cos: 'cos(x)', tan: 'tan(x)', asin: 'asin(x)', acos: 'acos(x)', atan: 'atan(x)',
  atan2: 'atan2(y, x)', sinh: 'sinh(x)', cosh: 'cosh(x)', tanh: 'tanh(x)', sqrt: 'sqrt(x)',
  cbrt: 'cbrt(x)', abs: 'abs(x)', sign: 'sign(x)', floor: 'floor(x)', ceil: 'ceil(x)',
  round: 'round(x)', trunc: 'trunc(x)', min: 'min(a, b, …)', max: 'max(a, b, …)',
  pow: 'pow(x, y)', exp: 'exp(x)', log: 'log(x)  natural', log2: 'log2(x)', log10: 'log10(x)',
  hypot: 'hypot(x, y)', random: 'random() → 0…1 (changes every frame)', mod: 'mod(x, m) ≥ 0',
  PI: 'π', TAU: '2π', E: 'e',
  project3d: 'project3d([x, y, z], { yaw, pitch, dist, scale }) → [x, y]',
  camera: 'camera({ yaw, pitch, dist, scale }) → .project .line .polyline .polygon .point .depth',
  time: 'seconds since play started',
  frame: 'frame number (60 per second)',
  loop: 'loop(seconds) — wrap the clock',
  slider: 'slider(name, min = 0, max = 1, value = min, step?)',
  graph: 'graph.value(name) · graph.fn(name) · graph.ode(name, derivative?) · graph.has(name) · graph.names()',
  clip: 'clip(name) → .draw(frame, style?) .play(style?) .frameAt(t) .name .frames .fps .duration .box',
  view: '{ xmin, xmax, ymin, ymax }',
  theme: "'light' or 'dark'",
  ink: 'default drawing colour for the theme',
  print: 'print(...values)',
  console: 'console.log / info / warn / error / debug(...values)',
};

