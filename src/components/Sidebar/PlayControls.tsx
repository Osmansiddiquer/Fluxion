import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AnimMode } from '../../store/types';

const NEXT: Record<AnimMode, AnimMode> = { loop: 'bounce', bounce: 'once', once: 'loop' };
const MODE_TITLE: Record<AnimMode, string> = {
  loop: 'Loop (jump back to start)',
  bounce: 'Bounce (reverse at ends)',
  once: 'Once (stop at end)',
};

const SVG = { viewBox: '0 0 16 16', width: 13, height: 13 } as const;
const STROKE = { stroke: 'currentColor', strokeWidth: 1.5, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const PlayIcon = (
  <svg {...SVG}>
    <path d="M5 3.5 L12.5 8 L5 12.5 Z" fill="currentColor" stroke="none" />
  </svg>
);
const PauseIcon = (
  <svg {...SVG}>
    <path d="M5.5 3.5 V12.5 M10.5 3.5 V12.5" {...STROKE} strokeWidth={2} />
  </svg>
);
const ModeIcon: Record<AnimMode, ReactNode> = {
  loop: (
    <svg {...SVG}>
      <path d="M4 8 a4 4 0 1 1 1.2 2.8" {...STROKE} />
      <path d="M3.4 8 L4 6.2 L5.6 7" {...STROKE} />
    </svg>
  ),
  bounce: (
    <svg {...SVG}>
      <path d="M3 6 H13 M3 10 H13 M3 6 L5 4.3 M3 6 L5 7.7 M13 10 L11 8.3 M13 10 L11 11.7" {...STROKE} />
    </svg>
  ),
  once: (
    <svg {...SVG}>
      <path d="M3 8 H12.5 M12.5 8 L10 5.7 M12.5 8 L10 10.3" {...STROKE} />
    </svg>
  ),
};

/**
 * Play / pause button that animates a slider value across [min, max]. Owns a
 * self-perpetuating rAF loop that reads the latest props from a ref, so it isn't
 * torn down by React effect re-runs. Mode and speed live in sibling controls.
 */
export function PlayButton({
  value,
  min,
  max,
  mode,
  speed = 1,
  onValue,
}: {
  value: number;
  min: number;
  max: number;
  mode: AnimMode;
  speed?: number;
  onValue: (v: number) => void;
}) {
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);
  const lastTs = useRef(0);
  const dir = useRef(1);
  const st = useRef({ value, min, max, mode, onValue, speed });
  st.current = { value, min, max, mode, onValue, speed };

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const stop = () => {
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    setPlaying(false);
  };

  const start = () => {
    lastTs.current = 0;
    setPlaying(true);
    const tick = (now: number) => {
      const s = st.current;
      if (!lastTs.current) lastTs.current = now;
      const dt = Math.min(0.25, (now - lastTs.current) / 1000);
      lastTs.current = now;
      const span = Math.max(1e-9, s.max - s.min);
      const rate = (span * Math.max(0.05, s.speed)) / 4; // full sweep in ~4s at 1×
      let v = s.value + dir.current * rate * dt;
      let finished = false;
      if (v >= s.max) {
        if (s.mode === 'loop') v = s.min;
        else if (s.mode === 'bounce') {
          v = s.max;
          dir.current = -1;
        } else {
          v = s.max;
          finished = true;
        }
      } else if (v <= s.min) {
        if (s.mode === 'loop') v = s.max;
        else if (s.mode === 'bounce') {
          v = s.min;
          dir.current = 1;
        } else {
          v = s.min;
          finished = true;
        }
      }
      s.onValue(v);
      if (finished) {
        stop();
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  return (
    <button
      className={`play-btn${playing ? ' playing' : ''}`}
      onClick={() => (raf.current ? stop() : start())}
      title={playing ? 'Pause' : 'Play'}
      aria-label={playing ? 'Pause' : 'Play'}
    >
      {playing ? PauseIcon : PlayIcon}
    </button>
  );
}

/** Cycles the animation mode (loop → bounce → once). */
export function ModeButton({ mode, onMode }: { mode: AnimMode; onMode: (m: AnimMode) => void }) {
  return (
    <button
      className="play-mode"
      onClick={() => onMode(NEXT[mode])}
      title={MODE_TITLE[mode]}
      aria-label={`Animation mode: ${mode}`}
    >
      {ModeIcon[mode]}
    </button>
  );
}

/** Compact speed slider. Styled distinctly (short, thin, labelled) so it doesn't
 * read as a second value control. */
export function SpeedSlider({ speed, onSpeed }: { speed: number; onSpeed: (n: number) => void }) {
  return (
    <label className="speed-slider" title="Animation speed">
      <svg viewBox="0 0 16 16" width="13" height="13" className="speed-ico" aria-hidden="true">
        {/* a small gauge / speedometer */}
        <path d="M3 12 a5 5 0 0 1 10 0" {...STROKE} />
        <path d="M8 12 L11 7.5" {...STROKE} />
      </svg>
      <input
        className="speed-range"
        type="range"
        min={0.1}
        max={5}
        step={0.1}
        value={speed}
        onChange={(e) => onSpeed(Number(e.target.value))}
      />
      <span className="speed-val">{speed}×</span>
    </label>
  );
}
