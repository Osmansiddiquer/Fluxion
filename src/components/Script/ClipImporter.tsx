import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../store/useStore';
import { getFrameSequence, putAsset } from '../../lib/frames/assets';
import type { IPoly } from '../../lib/frames/codec';
import {
  DEFAULT_TRACE,
  IMPORT_LIMITS,
  buildClip,
  cleanClipName,
  frameTimes,
  grayFromRGBA,
  inkMask,
  scaledSize,
  traceGray,
} from '../../lib/frames/videoImport';
import { insertSnippet } from './scriptBus';
import './ClipImporter.css';

/**
 * Import a video, GIF or image sequence as a clip, entirely in the browser:
 * frames are decoded (seeking an off-screen <video>, or ImageDecoder for GIFs),
 * scaled onto a canvas, thresholded to black and white, traced into outlines
 * and encoded — one frame at a time, so the page stays responsive.
 */

type Source =
  | { kind: 'video'; url: string; video: HTMLVideoElement; duration: number; w: number; h: number; name: string }
  | { kind: 'images'; bitmaps: (ImageBitmap | VideoFrame)[]; w: number; h: number; name: string; animated: boolean };

interface Opts {
  name: string;
  fps: number;
  width: number;
  threshold: number;
  invert: boolean;
  start: number;
  end: number;
}

export default function ClipImporter({ onClose }: { onClose: () => void }) {
  const clips = useStore((s) => s.script?.clips ?? {});
  const removeClip = useStore((s) => s.removeScriptClip);
  const addClip = useStore((s) => s.addScriptClip);
  const [src, setSrc] = useState<Source | null>(null);
  const [opts, setOpts] = useState<Opts>({ name: '', fps: 15, width: 160, threshold: 128, invert: false, start: 0, end: 10 });
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean; name?: string } | null>(null);
  const [previewAt, setPreviewAt] = useState(0);
  const cancel = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const work = useMemo(() => document.createElement('canvas'), []);

  // Esc closes (unless importing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && progress === null && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, progress]);

  useEffect(
    () => () => {
      if (src?.kind === 'video') URL.revokeObjectURL(src.url);
      if (src?.kind === 'images') src.bitmaps.forEach((b) => b.close());
    },
    [src],
  );

  const size = src ? scaledSize(src.w, src.h, opts.width) : null;
  const times = src?.kind === 'video' ? frameTimes(src.duration, opts.fps, opts.start, opts.end) : null;
  const frameCount = src ? (src.kind === 'video' ? times!.length : Math.min(src.bitmaps.length, IMPORT_LIMITS.maxFrames)) : 0;

  async function grab(i: number): Promise<Uint8Array | null> {
    if (!src || !size) return null;
    work.width = size.w;
    work.height = size.h;
    const ctx = work.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size.w, size.h);
    if (src.kind === 'video') {
      const t = (times ?? [0])[Math.min(i, (times?.length ?? 1) - 1)];
      await seek(src.video, t);
      ctx.drawImage(src.video, 0, 0, size.w, size.h);
    } else {
      const b = src.bitmaps[Math.min(i, src.bitmaps.length - 1)];
      ctx.drawImage(b as CanvasImageSource, 0, 0, size.w, size.h);
    }
    return grayFromRGBA(ctx.getImageData(0, 0, size.w, size.h).data, size.w, size.h);
  }

  // Live preview of one frame in black and white.
  useEffect(() => {
    let live = true;
    if (!src || !size || progress !== null) return;
    const idx = Math.round(previewAt * Math.max(0, frameCount - 1));
    grab(idx).then((gray) => {
      const c = preview.current;
      if (!live || !gray || !c) return;
      c.width = size.w;
      c.height = size.h;
      const ctx = c.getContext('2d')!;
      const img = ctx.createImageData(size.w, size.h);
      const ink = inkMask(gray, size.w, size.h, opts);
      for (let p = 0; p < ink.length; p++) {
        const v = ink[p] ? 17 : 246;
        img.data[p * 4] = v;
        img.data[p * 4 + 1] = v;
        img.data[p * 4 + 2] = ink[p] ? 17 : 239;
        img.data[p * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, size?.w, size?.h, opts.threshold, opts.invert, previewAt, opts.fps, opts.start, opts.end, progress]);

  async function choose(files: FileList | null) {
    setMessage(null);
    if (!files?.length) return;
    try {
      const list = [...files];
      const taken = Object.keys(clips);
      const first = list[0];
      if (list.length === 1 && first.type.startsWith('video/')) {
        const url = URL.createObjectURL(first);
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.src = url;
        await new Promise<void>((res, rej) => {
          video.onloadeddata = () => res();
          video.onerror = () => rej(new Error("This browser can't play that video file. Try an .mp4 or .webm."));
        });
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        if (!(duration > 0)) throw new Error("Couldn't read the video's length.");
        setSrc({ kind: 'video', url, video, duration, w: video.videoWidth, h: video.videoHeight, name: first.name });
        setOpts((o) => ({ ...o, name: cleanClipName(first.name, taken), start: 0, end: Math.min(duration, IMPORT_LIMITS.maxSeconds) }));
      } else if (list.length === 1 && first.type === 'image/gif' && 'ImageDecoder' in window) {
        const frames = await decodeGif(first);
        setSrc({ kind: 'images', bitmaps: frames, w: frames[0].displayWidth, h: frames[0].displayHeight, name: first.name, animated: true });
        setOpts((o) => ({ ...o, name: cleanClipName(first.name, taken) }));
      } else {
        const imgs = list.filter((f) => f.type.startsWith('image/')).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        if (!imgs.length) throw new Error('Pick a video, a GIF, or one or more images.');
        const bitmaps = await Promise.all(imgs.slice(0, IMPORT_LIMITS.maxFrames).map((f) => createImageBitmap(f)));
        setSrc({ kind: 'images', bitmaps, w: bitmaps[0].width, h: bitmaps[0].height, name: imgs[0].name, animated: bitmaps.length > 1 });
        setOpts((o) => ({ ...o, name: cleanClipName(imgs.length > 1 ? imgs[0].name.replace(/[-_ ]?\d+(\.\w+)$/, '$1') : imgs[0].name, taken) }));
      }
      setPreviewAt(0.35);
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : String(err), error: true });
    }
  }

  async function runImport() {
    if (!src || !size) return;
    const name = cleanClipName(opts.name || src.name, Object.keys(clips).filter((n) => n !== opts.name));
    cancel.current = false;
    setProgress(0);
    setMessage(null);
    try {
      const frames: IPoly[][] = [];
      for (let i = 0; i < frameCount; i++) {
        if (cancel.current) throw new Error('Import cancelled.');
        const gray = await grab(i);
        if (!gray) break;
        frames.push(traceGray(gray, size.w, size.h, { ...DEFAULT_TRACE, threshold: opts.threshold, invert: opts.invert }));
        setProgress((i + 1) / frameCount);
        // Let the page breathe between frames (images decode synchronously).
        if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
      }
      const fps = src.kind === 'video' || src.animated ? opts.fps : 1;
      const data = buildClip(frames, size.w, size.h, fps);
      if (data.length > IMPORT_LIMITS.maxChars) {
        throw new Error(`That clip is too big (${(data.length / 1e6).toFixed(1)} MB). Lower the width or frame rate, or shorten it.`);
      }
      const id = putAsset(data);
      addClip(name, id);
      const kb = Math.round(data.length / 1024);
      setMessage({ text: `Imported “${name}”: ${frames.length} frames, ${kb} KB.`, name });
      const code = useStore.getState().script?.code ?? '';
      if (!code.trim()) {
        useStore.getState().setScriptCode(`// ${name}: ${frames.length} frames at ${fps} fps\nbackground("#f6f4ef")\nclip("${name}").play({ fill: "#111" })\n`);
      }
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : String(err), error: true });
    } finally {
      setProgress(null);
    }
  }

  const set = <K extends keyof Opts>(k: K, v: Opts[K]) => setOpts((o) => ({ ...o, [k]: v }));
  const existing = Object.entries(clips);

  return (
    <div className="ci-backdrop" onMouseDown={(e) => e.target === e.currentTarget && progress === null && onClose()}>
      <div className="ci" role="dialog" aria-modal="true" aria-labelledby="ci-title">
        <header className="ci-head">
          <h2 id="ci-title">Clips</h2>
          <button className="icon-btn" onClick={onClose} disabled={progress !== null} aria-label="Close">
            ✕
          </button>
        </header>
        <p className="ci-lead">
          A clip turns a short black-and-white video into shapes you can play from a script with{' '}
          <code>clip("name").play()</code>. Everything happens in your browser; nothing is uploaded.
        </p>

        {existing.length > 0 && (
          <ul className="ci-list">
            {existing.map(([name, id]) => {
              const seq = getFrameSequence(id);
              const info = seq instanceof Error ? 'missing data' : `${seq.count} frames · ${seq.header.fps} fps`;
              return (
                <li key={name}>
                  <code>{name}</code>
                  <span className="ci-info">{info}</span>
                  <button className="ci-link" onClick={() => insertSnippet(`clip("${name}").play()`)}>
                    Insert
                  </button>
                  <button className="ci-link dim" onClick={() => removeClip(name)} aria-label={`Remove ${name}`}>
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {!src ? (
          <button className="ci-drop" onClick={() => fileRef.current?.click()}>
            <strong>Choose a video, GIF or images…</strong>
            <span>
              Up to {IMPORT_LIMITS.maxSeconds} s · works best with high-contrast footage (silhouettes, line art)
            </span>
          </button>
        ) : (
          <div className="ci-body">
            <div className="ci-preview">
              <canvas ref={preview} aria-label="Black-and-white preview" />
              {frameCount > 1 && (
                <input
                  className="range"
                  type="range"
                  min={0}
                  max={1}
                  step={0.001}
                  value={previewAt}
                  onChange={(e) => setPreviewAt(Number(e.target.value))}
                  aria-label="Preview position"
                />
              )}
            </div>
            <div className="ci-opts">
              <label>
                <span>Name</span>
                <input value={opts.name} onChange={(e) => set('name', e.target.value)} maxLength={32} spellCheck={false} />
              </label>
              {(src.kind === 'video' || src.animated) && (
                <label>
                  <span>Frame rate</span>
                  <select value={opts.fps} onChange={(e) => set('fps', Number(e.target.value))}>
                    {[6, 8, 10, 12, 15, 20, 24, 30].map((f) => (
                      <option key={f} value={f}>
                        {f} fps
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                <span>Width</span>
                <select value={opts.width} onChange={(e) => set('width', Number(e.target.value))}>
                  {[96, 128, 160, 192, 240, 320].map((w) => (
                    <option key={w} value={w}>
                      {w} px{w === 160 ? ' (default)' : w >= 240 ? ' (big file)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ci-wide">
                <span>
                  Threshold <em>{opts.threshold}</em>
                </span>
                <input className="range" type="range" min={1} max={254} value={opts.threshold} onChange={(e) => set('threshold', Number(e.target.value))} />
              </label>
              <label className="ci-check">
                <input type="checkbox" checked={opts.invert} onChange={(e) => set('invert', e.target.checked)} />
                <span>Invert (light shapes on dark)</span>
              </label>
              {src.kind === 'video' && (
                <div className="ci-range">
                  <label>
                    <span>From (s)</span>
                    <input type="number" min={0} max={src.duration} step={0.1} value={+opts.start.toFixed(2)} onChange={(e) => set('start', Number(e.target.value))} />
                  </label>
                  <label>
                    <span>To (s)</span>
                    <input type="number" min={0} max={src.duration} step={0.1} value={+opts.end.toFixed(2)} onChange={(e) => set('end', Number(e.target.value))} />
                  </label>
                </div>
              )}
              <div className="ci-summary">
                {frameCount} frame{frameCount === 1 ? '' : 's'}
                {size ? ` · ${size.w}×${size.h}` : ''}
                {src.kind === 'video' && src.duration > IMPORT_LIMITS.maxSeconds ? ` · first ${IMPORT_LIMITS.maxSeconds} s max (use the CLI importer for longer)` : ''}
              </div>
            </div>
          </div>
        )}

        {progress !== null && (
          <div className="ci-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
            <div style={{ width: `${progress * 100}%` }} />
          </div>
        )}
        {message && (
          <div className={`ci-msg${message.error ? ' error' : ''}`} role={message.error ? 'alert' : 'status'}>
            {message.text}
            {message.name && (
              <button className="ci-link" onClick={() => insertSnippet(`clip("${message.name}").play()`)}>
                Insert clip("{message.name}").play()
              </button>
            )}
          </div>
        )}

        <footer className="ci-foot">
          {src && progress === null && (
            <button className="sp-btn ghost" onClick={() => fileRef.current?.click()}>
              Choose another…
            </button>
          )}
          <div className="sp-spacer" />
          {progress !== null ? (
            <button className="sp-btn ghost" onClick={() => (cancel.current = true)}>
              Cancel
            </button>
          ) : (
            src && (
              <button className="sp-btn primary" onClick={runImport} disabled={!frameCount}>
                Import {frameCount} frame{frameCount === 1 ? '' : 's'}
              </button>
            )
          )}
        </footer>
        <input
          ref={fileRef}
          type="file"
          accept="video/*,image/gif,image/png,image/jpeg,image/webp,image/bmp"
          multiple
          hidden
          onChange={(e) => {
            choose(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((res) => {
    const target = Math.min(Math.max(0, t), Math.max(0, video.duration - 1e-3));
    if (Math.abs(video.currentTime - target) < 1e-4 && video.readyState >= 2) return res();
    const done = () => {
      video.removeEventListener('seeked', done);
      res();
    };
    video.addEventListener('seeked', done);
    video.currentTime = target;
  });
}

/** Decode every frame of an animated GIF (WebCodecs ImageDecoder). */
async function decodeGif(file: File): Promise<VideoFrame[]> {
  const Dec = (window as unknown as { ImageDecoder: new (o: { data: ReadableStream | ArrayBuffer; type: string }) => {
    tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null };
    decode: (o: { frameIndex: number }) => Promise<{ image: VideoFrame }>;
    close: () => void;
  } }).ImageDecoder;
  const dec = new Dec({ data: await file.arrayBuffer(), type: file.type });
  await dec.tracks.ready;
  const n = Math.min(IMPORT_LIMITS.maxFrames, dec.tracks.selectedTrack?.frameCount ?? 1);
  const out: VideoFrame[] = [];
  for (let i = 0; i < n; i++) out.push((await dec.decode({ frameIndex: i })).image);
  dec.close();
  return out;
}
