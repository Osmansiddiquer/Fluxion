import type { GraphData } from '../graphFile';
import { parseHeader } from './codec';
import { assetId } from './assets';
import { NO_FEATURES, PANELS_OFF } from '../demos/common';

/** The Script mode program that plays a clip on a light "screen". */
export function clipPlayerScript(name: string): string {
  return `// A traced black-and-white clip, played from the clock in real time.
const film = clip("${name}")
loop(film.duration)                       // the play bar spans the whole clip

const [x0, y0, x1, y1] = film.box
rect(x0, y0, x1 - x0, y1 - y0, { fill: "#f6f4ef", color: "#3a3f47", width: 2 })   // the screen
film.play({ fill: "#111" })
text(\`\${film.frameAt(time) + 1} / \${film.frames}\`, x1, y0 - 0.35, { size: 12, align: "right", color: "#8a8f98" })
`;
}

/**
 * A ready-to-open Script mode graph playing an encoded clip (FXF1) under the
 * name `name`. Used by the CLI importer and the built-in silhouette example.
 */
export function clipScriptGraph(data: string, name = 'clip'): GraphData {
  const { box } = parseHeader(data);
  const id = assetId(data);
  const [x0, y0, x1, y1] = box;
  const w = x1 - x0;
  const h = y1 - y0;
  return {
    v: 1,
    entries: [],
    viewport: { tMin: x0 - w * 0.19, tMax: x1 + w * 0.19, yMin: y0 - h * 0.12, yMax: y1 + h * 0.1 },
    features: NO_FEATURES,
    projections: PANELS_OFF,
    sigFigs: 3,
    assets: { [id]: data },
    script: { code: clipPlayerScript(name), clips: { [name]: id } },
  };
}
