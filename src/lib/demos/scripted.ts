import type { GraphData } from '../graphFile';
import type { Entry, Viewport } from '../../store/types';
import { NO_FEATURES, PANELS_OFF } from './common';
import { buildSilhouetteClip } from './silhouette';
import { clipScriptGraph } from '../frames/clipScript';

/**
 * The built-in examples, written as Script mode programs: short, commented,
 * with named helpers — meant to be read and changed. (The older expression-row
 * versions live on in sharingan.ts etc. as regression fixtures for the
 * expression engine; see EXPRESSION_DEMOS.)
 */

export const SHARINGAN = `// Sharingan: three tomoe orbit the pupil.
loop(4)                          // seconds per loop
const spin = -time / 4 * TAU / 3 // a third of a turn per loop: the pattern looks the same

// One tomoe ("comma"): a round back, then in under the head and out round the tail.
// It sits on the ring at \`angle\`, turned to follow it.
function tomoe(angle, size) {
  const [x, y] = [1.25 * cos(angle), 1.25 * sin(angle)]
  group({ translate: [x, y], rotate: angle }, () => {
    path({ fill: "#120a0a" })
      .arc(0, 0, 2 * size, PI / 2, -PI / 2)
      .arc(0, -size, size, -PI / 2, PI / 2)
      .arc(0, size, size, -PI / 2, -3 * PI / 2)
      .close()
  })
}

circle(0, 0, 2, { fill: "#b3121b", color: "#2a0505", width: 3 })   // iris
circle(0, 0, 1.55, { fill: alpha("#e0393f", 0.5) })                 // inner glow
circle(0, 0, 1.25, { color: "rgba(60, 8, 8, 0.85)", width: 1.6 })   // the ring the tomoe ride on
circle(0, 0, 0.42, { fill: "#0b0b0b" })                             // pupil
for (const k of range(3)) tomoe(spin + k * TAU / 3, 0.22)
ellipse(-0.8, 0.9, 0.24, 0.15, { fill: alpha("white", 0.7) })       // highlight
`;

export const CUBE = `// A rotating cube: 3D points through a camera, faces drawn back to front.
const cam = camera({ yaw: 0.6 * time, pitch: 0.45, dist: 6, scale: 1.7 })

// The 8 corners (±1, ±1, ±1) and the 6 faces as corner lists.
const V = [[-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1], [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1]]
const faces = [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]]

const centre = face => face.map(i => V[i]).reduce((c, p) => [c[0] + p[0] / 4, c[1] + p[1] / 4, c[2] + p[2] / 4], [0, 0, 0])
const order = range(6).sort((a, b) => cam.depth(centre(faces[a])) - cam.depth(centre(faces[b])))  // far → near

for (const k of order) {
  cam.polygon(faces[k].map(i => V[i]), { fill: hsv(60 * k + 20 * time, 0.55, 0.95, 0.28), color: "#2d70b3", width: 2.5 })
}
for (const v of V) cam.point(v, { size: 4.5, color: "#2d70b3" })
`;

export const MANGEKYO = `// An eye opens into a Sharingan, spins, becomes a Mangekyō Sharingan, then closes back.
// One 12-second clock; every change is a keyframe track.
loop(12)
const T = time
const red   = keyframes(T, [[1, 0], [2.5, 1], [10.6, 1], [11.8, 0]])     // iris brown → red
const grow  = keyframes(T, [[2, 0], [3.2, 1], [10.4, 1], [11.4, 0]])     // tomoe appear
const morph = keyframes(T, [[6.2, 0], [7.8, 1], [9.6, 1], [10.4, 0]])    // tomoe → blades
const spin  = keyframes(T, [[2, 0], [12, -15]], { ease: false })
const pupil = lerp(lerp(0.55, 0.42, red), 0.66, morph)

const polar = (r, a) => [r * cos(a), r * sin(a)]
const turn = ([x, y], a) => [x * cos(a) - y * sin(a), x * sin(a) + y * cos(a)]

// Tomoe outline for u in 0…3: round back, in under the head, out round the tail.
function tomoePoint(u, s) {
  if (u < 1) return polar(2 * s, PI / 2 - PI * u)
  if (u < 2) { const [x, y] = polar(s, PI * (u - 1) - PI / 2); return [x, y - s] }
  const [x, y] = polar(s, -PI / 2 - PI * (u - 2)); return [x, y + s]
}
// Mangekyō blade for u in 0…3: leading spiral edge, along the rim, trailing edge.
function bladePoint(u) {
  const r = u < 1 ? lerp(0.6, 1.95, u) : u < 2 ? 1.95 : lerp(1.95, 0.6, u - 2)
  const q = u < 1 ? 1.1 * u * u : u < 2 ? 1.1 + 0.5 * (u - 1) : 0.55 + 1.05 * (3 - u) ** 2
  return polar(r, q)
}
// The k-th shape, somewhere between a tomoe on the ring and a blade.
function mark(k) {
  const p = spin + k * TAU / 3
  const [rx, ry] = polar(1.25, p)
  curve(u => {
    const [ax, ay] = turn(tomoePoint(u, 0.22 * grow), p)
    const [bx, by] = turn(bladePoint(u), p)
    return [lerp(rx + ax, bx, morph), lerp(ry + ay, by, morph)]
  }, 0, 3, { fill: alpha("#0d0909", clamp(1.5 * grow)), samples: 180 })
}

// The eye.
curve(t => [5 * cos(t), 2.6 * sin(t) * abs(sin(t))], 0, TAU, { fill: "#f3ede4", color: "#6e4a34", width: 3.5 })
curve(t => [5.3 * cos(t), 3.15 * sin(t) * abs(sin(t))], 0.35, PI - 0.35, { color: "rgba(138, 106, 85, 0.75)", width: 2 })
// Iris, glow, ring, pupil, the three marks, highlight.
circle(0, 0, 2, { fill: mix("#5c3a24", "#b5121b", red), color: "#1d0d08", width: 2.5 })
circle(0, 0, 1.55, { fill: alpha(mix("#8c5c3c", "#e02c2c", red), 0.55) })
circle(0, 0, 1.25, { color: alpha("#3c0808", 0.85 * grow), width: 1.6 })
circle(0, 0, pupil, { fill: "#0d0909" })
for (const k of range(3)) mark(k)
ellipse(-0.8, 0.92, 0.26, 0.16, { fill: alpha("white", 0.72) })
`;

export const MANDALA = `// Mandala bloom: three rings of petals counter-rotate while one clock
// opens and closes the bloom and walks every hue round the colour wheel.
loop(12)
const bloom = keyframes(time, [[0, 0.35], [4, 1], [8, 1], [12, 0.35]])
const w = time * PI / 6          // a full turn per loop
const hue = 30 * time            // and a full trip round the colour wheel

// A petal pointing along +x, turned to angle q.
function petal(length, width, q, h, opacity) {
  group({ rotate: q }, () => {
    curve(u => [length * (1 - cos(u)) / 2, width * sin(u) * (1 - cos(u)) / 2], 0, TAU, {
      color: hsv(h, 0.75, 0.8), fill: hsv(h, 0.6, 1, opacity), width: 1.5, samples: 90,
    })
  })
}

circle(0, 0, 4.4 * bloom, { color: hsv(hue + 200, 0.5, 0.75), width: 1.5, dash: "dotted" })
for (const k of range(12)) petal(3.9 * bloom, 1.5 * bloom, w + k * PI / 6, hue, 0.32)
for (const k of range(12)) petal(2.7 * bloom, 1.1 * bloom, -w + PI / 12 + k * PI / 6, hue + 120, 0.45)
for (const k of range(6))  petal(1.7 * bloom, 0.7 * bloom, 2 * w + k * PI / 3, hue + 240, 0.7)
for (const k of range(24)) {
  const q = -w / 2 + k * PI / 12
  point(4.4 * bloom * cos(q), 4.4 * bloom * sin(q), { size: 3, color: hsv(hue + 40, 0.8, 0.9) })
}
circle(0, 0, 0.55 + 0.08 * sin(2 * w), { fill: hsv(42, 0.75, 1), color: hsv(hue + 300, 0.7, 0.8) })
circle(0, 0, 0.22, { fill: hsv(30, 0.9, 0.55, 0.85) })
`;

export const PENDULUM = `// A pendulum driven by the ODE in Graph mode:  θ'' = −(g/L)·sin θ − c·θ'
// graph.ode("theta") solves it (from its initial conditions) at any time.
const theta = graph.ode("theta")
const omega = graph.ode("theta", 1)          // θ'
loop(20)
const t = time
const a = theta(t)

// The pendulum hangs from a pivot that rides along the time axis, so the bob
// sits right above the point (t, θ(t)) of the solution curve.
const L = graph.value("L")
const pivot = [t, 5.5]
const bob = [pivot[0] + L * sin(a), pivot[1] - L * cos(a)]
line(pivot[0] - 0.7, pivot[1], pivot[0] + 0.7, pivot[1], { color: ink, width: 4 })
line(...pivot, ...bob, { color: ink, width: 2.5 })
circle(...bob, 0.32, { fill: "#c74440", color: ink, width: 2 })
arrow(...bob, bob[0] + 0.6 * omega(t) * cos(a), bob[1] + 0.6 * omega(t) * sin(a), { color: "#2d70b3", width: 2 })

// Where we are on the solution: a cursor and a dot on the curve θ(t).
line(t, -3.2, t, pivot[1], { color: alpha(ink, 0.25), dash: "dashed", width: 1.5 })
point(t, a, { size: 6, color: "#c74440" })
label(\`θ = \${a.toFixed(2)}\`, t, a)
text("θ(t)", 19.2, theta(19.2) + 0.6, { color: "#c74440", size: 14 })
`;

let seq = 0;
const stamp = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

function scriptGraph(code: string, viewport: Viewport, entries: Entry[] = [], extra: Partial<GraphData> = {}): GraphData {
  return {
    v: 1,
    entries,
    viewport,
    features: NO_FEATURES,
    projections: PANELS_OFF,
    sigFigs: 3,
    script: { code },
    ...extra,
  };
}

export const sharinganScript = () => scriptGraph(SHARINGAN, { tMin: -4.5, tMax: 4.5, yMin: -3, yMax: 3 });
export const cubeScript = () => scriptGraph(CUBE, { tMin: -5, tMax: 5, yMin: -3.2, yMax: 3.2 });
export const mangekyoScript = () => scriptGraph(MANGEKYO, { tMin: -6.5, tMax: 6.5, yMin: -4, yMax: 4 });
export const mandalaScript = () => scriptGraph(MANDALA, { tMin: -6, tMax: 6, yMin: -5, yMax: 5 });

export function pendulumScript(): GraphData {
  const id = stamp('pnd');
  const entries: Entry[] = [
    { id: `${id}-0`, raw: "theta'' = -g/L*sin(theta) - c*theta'", color: '#c74440', visible: true, expanded: true, t0: 0, ic: [2.2, 0] },
    { id: `${id}-1`, raw: 'g = 9.81', color: '#2d70b3', visible: true, expanded: false, varMin: 1, varMax: 20 },
    { id: `${id}-2`, raw: 'L = 3', color: '#388c46', visible: true, expanded: false, varMin: 0.5, varMax: 6 },
    { id: `${id}-3`, raw: 'c = 0.15', color: '#6042a6', visible: true, expanded: false, varMin: 0, varMax: 1 },
  ];
  return scriptGraph(PENDULUM, { tMin: -1, tMax: 21, yMin: -4, yMax: 9 }, entries, {
    features: { ...NO_FEATURES, grid: true },
  });
}

let clip: string | null = null;
export function silhouetteScript(): GraphData {
  clip ??= buildSilhouetteClip();
  return clipScriptGraph(clip, 'apple');
}
