import type { GraphData } from '../graphFile';
import { sharinganDemo } from './sharingan';
import { cubeDemo } from './cube';
import { mangekyoDemo } from './mangekyo';
import { silhouetteDemo } from './silhouette';

export interface Demo {
  id: string;
  title: string;
  blurb: string;
  build: () => GraphData;
}

/** Scripting showcase graphs, opened from the graph menu. */
export const DEMOS: Demo[] = [
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
    id: 'silhouette',
    title: 'Silhouette clip',
    blurb: 'A traced black-and-white frame sequence — the Bad Apple pipeline.',
    build: silhouetteDemo,
  },
];
