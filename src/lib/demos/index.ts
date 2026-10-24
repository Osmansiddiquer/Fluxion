import type { GraphData } from '../graphFile';
import { sharinganDemo } from './sharingan';
import { cubeDemo } from './cube';
import { mangekyoDemo } from './mangekyo';
import { silhouetteDemo } from './silhouette';
import { mandalaDemo } from './mandala';
import { sunsetDemo } from './sunset';
import { impulseDemo } from './impulse';
import { springBallDemo } from './springBall';
import { cubeScript, mandalaScript, mangekyoScript, pendulumScript, sharinganScript, silhouetteScript } from './scripted';

export interface Demo {
  id: string;
  title: string;
  blurb: string;
  build: () => GraphData;
}

/** The examples (Script mode programs), opened from the graph menu, the
 * Script mode toolbar and \`#example=<id>\` links. */
export const DEMOS: Demo[] = [
  {
    id: 'sharingan',
    title: 'Rotating Sharingan',
    blurb: 'A tomoe() helper drawn three times with path() arcs, spun by the clock.',
    build: sharinganScript,
  },
  {
    id: 'cube',
    title: 'Rotating cube',
    blurb: 'A 3D camera(): corners, faces sorted back to front, see-through hsv colours.',
    build: cubeScript,
  },
  {
    id: 'mangekyo',
    title: 'Eye → Sharingan → Mangekyō',
    blurb: 'One 12 s clock and keyframes(): colour, growth, spin and a tomoe → blade morph.',
    build: mangekyoScript,
  },
  {
    id: 'mandala',
    title: 'Mandala bloom',
    blurb: 'A petal() helper in three counter-rotating rings; the bloom and the hues loop seamlessly.',
    build: mandalaScript,
  },
  {
    id: 'pendulum',
    title: 'Pendulum from an ODE',
    blurb: "graph.ode() reads the Graph-mode solution of θ'' = −(g/L)·sin θ − c·θ' to swing a pendulum along it.",
    build: pendulumScript,
  },
  {
    id: 'silhouette',
    title: 'Silhouette clip',
    blurb: 'A traced black-and-white video clip played with clip("apple").play() — the Bad Apple pipeline.',
    build: silhouetteScript,
  },
  {
    id: 'sunset',
    title: 'Cinematic sunset',
    blurb: 'Graph mode: a gradient sky, sun glow and god-rays, parallax layers, spline silhouettes, letterboxed at 24 fps.',
    build: sunsetDemo,
  },
  {
    id: 'impulse',
    title: 'Spring hit by a hammer',
    blurb: "Graph mode: m y'' + c y' + k y = J delta(t - T) with y(0) = 0, y'(0) = 0 typed inline: the impulse at t = T kicks the spring, which rings down.",
    build: impulseDemo,
  },
  {
    id: 'spring-ball',
    title: 'Ball on a spring',
    blurb: "Graph mode: the solution of y'' = -k y - c y' is called as y(T) to move a ball on a spring along its curve while the clock T plays.",
    build: springBallDemo,
  },
];

/**
 * The same showcases built from expression rows only (parametric curves, for
 * repeats, keyframes, colour expressions). Not in the menu any more; kept as
 * regression fixtures for the expression engine (demos.test.ts).
 */
export const EXPRESSION_DEMOS: Demo[] = [
  {
    id: 'sharingan',
    title: 'Rotating Sharingan',
    blurb: 'Parametric tomoe repeated with for k = 0..2, filled and spun by a slider.',
    build: sharinganDemo,
  },
  {
    id: 'cube',
    title: 'Rotating cube',
    blurb: '3D vertices projected with projx / projy; edges and faces from lookup tables.',
    build: cubeDemo,
  },
  {
    id: 'mangekyo',
    title: 'Eye → Sharingan → Mangekyō',
    blurb: 'One clock T, keyframed with skeys: colour, growth, spin and a shape morph.',
    build: mangekyoDemo,
  },
  {
    id: 'mandala',
    title: 'Mandala bloom',
    blurb: 'Three rings of repeated petals counter-rotate while one clock eases the bloom and cycles hsv colours.',
    build: mandalaDemo,
  },
  {
    id: 'silhouette',
    title: 'Silhouette clip',
    blurb: 'A traced black-and-white frame sequence — the Bad Apple pipeline.',
    build: silhouetteDemo,
  },
];
