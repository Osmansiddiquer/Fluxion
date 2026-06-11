import { useStore } from '../store/useStore';
import type { ThemeMode } from '../store/types';

const OPTIONS: { mode: ThemeMode; label: string; icon: string }[] = [
  { mode: 'light', label: 'Light', icon: '☀' },
  { mode: 'dark', label: 'Dark', icon: '☾' },
  { mode: 'system', label: 'System', icon: '◐' },
];

export default function ThemeToggle() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  return (
    <div className="theme-seg" role="group" aria-label="Theme">
      {OPTIONS.map((o) => (
        <button
          key={o.mode}
          className={`theme-seg-btn${theme === o.mode ? ' active' : ''}`}
          title={o.label}
          aria-pressed={theme === o.mode}
          onClick={() => setTheme(o.mode)}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}
