/**
 * Frame-sequence importer: a folder of black-and-white video frames → a Fluxion
 * graph file that plays them as filled contours (the "Bad Apple!!" pipeline).
 *
 *   # 1. Extract frames with ffmpeg (Netpbm needs no decoder library):
 *   ffmpeg -i clip.mp4 -vf "fps=30,scale=192:144" frames/%05d.pgm
 *
 *   # 2. Trace + encode them into a graph file:
 *   npx vite-node scripts/frames-import.ts -- frames clip.fluxion.json --fps 30
 *
 *   # 3. In Fluxion: Share menu → Import from file… → clip.fluxion.json
 *   #    It opens in Script mode, playing clip("<name>").play(). (Short clips
 *   #    can also be imported right in the app: Script mode → Clips.)
 *
 * Options:
 *   --fps <n>         playback rate (default 30; match ffmpeg's fps filter)
 *   --threshold <n>   gray level 0–255 splitting ink from paper (default 128)
 *   --invert          treat light pixels as ink
 *   --tol <n>         simplification tolerance in half-pixels (default 1.1;
 *                     larger = smaller file, blockier shapes)
 *   --min-area <n>    drop specks smaller than this (half-pixels², default 4)
 *   --every <n>       keep every n-th frame (fps is divided accordingly)
 *   --width <n>       data-space width of the clip (default 8, centred)
 *   --name <name>     the clip's name in the script (default: from the output file)
 *
 * Reads .pgm / .pbm (P1/P2/P4/P5) files in name order. Nothing is uploaded or
 * fetched; copyrighted footage stays on your machine.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNetpbm } from '../src/lib/frames/netpbm';
import { threshold, vectorize } from '../src/lib/frames/trace';
import { encodeClip, type IPoly } from '../src/lib/frames/codec';
import { clipScriptGraph } from '../src/lib/frames/clipScript';
import { cleanClipName } from '../src/lib/frames/videoImport';

function usage(msg?: string): never {
  if (msg) console.error(`error: ${msg}\n`);
  console.error('usage: npx vite-node scripts/frames-import.ts -- <frames-dir> <out.json> [--fps 30] [--threshold 128] [--invert] [--tol 1.1] [--min-area 4] [--every 1] [--width 8] [--name clip]');
  process.exit(1);
}

const args = process.argv.slice(2).filter((a) => a !== '--');
const pos: string[] = [];
const opt: Record<string, string | boolean> = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    if (key === 'invert') opt.invert = true;
    else opt[key] = args[++i] ?? usage(`missing value for ${a}`);
  } else pos.push(a);
}
if (pos.length !== 2) usage();
const [dir, out] = pos;
const num = (k: string, d: number) => {
  const v = opt[k] === undefined ? d : Number(opt[k]);
  if (!Number.isFinite(v)) usage(`--${k} must be a number`);
  return v;
};
const every = Math.max(1, Math.round(num('every', 1)));
const fps = num('fps', 30) / every;
const level = num('threshold', 128);
const tol = num('tol', 1.1);
const minArea = num('min-area', 4);
const widthData = num('width', 8);

const files = readdirSync(dir)
  .filter((f) => /\.(pgm|pbm)$/i.test(f))
  .sort()
  .filter((_, i) => i % every === 0);
if (!files.length) usage(`no .pgm/.pbm frames in ${dir}`);

let W = 0;
let H = 0;
const frames: IPoly[][] = [];
const t0 = Date.now();
for (const [i, f] of files.entries()) {
  const img = parseNetpbm(new Uint8Array(readFileSync(join(dir, f))));
  if (!W) {
    W = img.width;
    H = img.height;
  } else if (img.width !== W || img.height !== H) {
    usage(`${f} is ${img.width}×${img.height}, expected ${W}×${H}`);
  }
  frames.push(vectorize(threshold(img.data, W, H, level, !opt.invert), tol, minArea));
  if (i % 200 === 0) process.stderr.write(`\rtraced ${i + 1}/${files.length}`);
}
const halfW = widthData / 2;
const halfH = (widthData * H) / W / 2;
const data = encodeClip({ w: 2 * W, h: 2 * H, fps, box: [-halfW, -halfH, halfW, halfH], frames });
// Opens in Script mode, playing the clip with clip(name).play().
const name = cleanClipName(typeof opt.name === 'string' ? opt.name : out.replace(/^.*[\\/]/, '').replace(/\..*$/, ''));
const graph = clipScriptGraph(data, name);
writeFileSync(out, JSON.stringify(graph));
const pts = frames.reduce((s, fr) => s + fr.reduce((t, p) => t + p.length, 0), 0);
process.stderr.write(
  `\rtraced ${files.length} frames (${W}×${H}) in ${((Date.now() - t0) / 1000).toFixed(1)} s — ` +
    `${pts} points, ${(data.length / 1024).toFixed(0)} KiB → ${out}\n`,
);
