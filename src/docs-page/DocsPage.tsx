// The documentation page (dist/docs/index.html). Rendered to static HTML at build
// time (scripts/prerender-docs.ts → prerender.ts) and hydrated by main.tsx, so it
// reads fine with JavaScript off, for search engines and for LLM fetchers. Content
// comes from components/Docs/content.ts. Keep this module free of heavy imports
// (no mathjs / parser / KaTeX JS): it ships in the docs page's own small bundle.
import { Fragment, Suspense, lazy, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { SECTIONS, rowExample, type Block, type DocSection, type SyntaxRow } from '../components/Docs/content';
import type { DocExample, DocKind, ExampleLine } from '../components/Docs/examples';
import { queryTerms, searchDocs } from '../components/Docs/search';
import Logo from '../components/Logo';
import type { ThemeMode } from '../store/types';
import { readTheme, writeTheme } from './theme';
import { texHtml } from './tex';
import { activeSection } from './scrollspy';

// ── Script mode reference hook ──────────────────────────────────────────────
// Script mode's reference is a default-exported, prop-less component
// (src/components/Script/ScriptDocs.tsx). Here, outside the app, its "Try it"
// buttons are links that open the app with the snippet (#z= links). Set this to
// null to show the "coming soon" note instead.
const SCRIPT_DOCS: (() => Promise<{ default: ComponentType }>) | null = () => import('../components/Script/ScriptDocs');
// Mounted on the client only (after hydration), so it may use editors etc.
const ScriptDocs = SCRIPT_DOCS ? lazy(SCRIPT_DOCS) : null;

/** The app, relative to the docs page. */
export const APP_HREF = '../';

const KIND_LABEL: Record<DocKind, string> = {
  function: 'function',
  ode: 'ODE',
  variable: 'slider',
  implicit: 'implicit',
  polar: 'polar',
  points: 'points',
  pointvar: 'point',
  inequality: 'region',
  parametric: 'parametric',
  fndef: 'definition',
  repeat: 'repeat',
  layer: 'layer',
  frames: 'clip',
};

/** The tag text shown for a line (derived values get their own label). */
export function kindLabel(kind: DocKind, derived?: boolean): string {
  return derived && kind === 'function' ? 'derived' : KIND_LABEL[kind];
}

/** Heading anchor inside a section: `odes--systems`. */
export function headingId(sectionId: string, text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[`*$\\]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${sectionId}--${slug}`;
}

const tex = texHtml;

export interface DocsPageProps {
  /** Example id → "Try it" href (built at build time from the URL API). */
  links: Record<string, string>;
}

export default function DocsPage({ links }: DocsPageProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeMode | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const terms = useMemo(() => queryTerms(query), [query]);
  const hits = useMemo(() => searchDocs(SECTIONS, query), [query]);

  // After hydration: theme state, scrollspy, and the "/" + Esc shortcuts.
  useEffect(() => {
    setTheme(readTheme());
    // Scroll-spy: on every scroll/resize/hash jump (one rAF per frame), measure
    // the sections against the sticky header (and the phone menu bar below it).
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter((e): e is HTMLElement => !!e);
    let raf = 0;
    const update = () => {
      raf = 0;
      let headerBottom = 0;
      for (const sel of ['.dp-top', '.dp-menu']) {
        const el = document.querySelector(sel);
        if (el && getComputedStyle(el).display !== 'none') headerBottom = Math.max(headerBottom, el.getBoundingClientRect().bottom);
      }
      const doc = document.documentElement;
      const atBottom = window.scrollY > 0 && window.innerHeight + window.scrollY >= doc.scrollHeight - 2;
      setActive(activeSection(els.map((el) => ({ id: el.id, top: el.getBoundingClientRect().top })), headerBottom, atBottom));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('hashchange', schedule);
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'Escape') {
        setQuery('');
        if (menuRef.current) menuRef.current.open = false;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('hashchange', schedule);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const closeMenus = () => {
    setQuery('');
    if (menuRef.current) menuRef.current.open = false;
  };

  const nav = (
    <ol className="dp-nav">
      {SECTIONS.map((s, i) => (
        <li key={s.id}>
          <a href={`#${s.id}`} aria-current={active === s.id ? 'true' : undefined} onClick={closeMenus}>
            <span className="dp-nav-num">{i + 1}</span>
            {s.title}
          </a>
        </li>
      ))}
    </ol>
  );

  return (
    <div className="dp">
      <a className="dp-skip" href="#getting-started">
        Skip to content
      </a>
      <header className="dp-top">
        <a className="dp-brand" href={APP_HREF} title="Open Fluxion">
          <Logo size={26} />
          <span className="dp-brand-name">Fluxion</span>
          <span className="dp-brand-tag">Docs</span>
        </a>
        <div className="dp-search" role="search">
          <SearchIcon />
          <input
            ref={searchRef}
            type="search"
            placeholder="Search the docs"
            aria-label="Search the docs"
            aria-controls="dp-results"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && hits[0]) {
                location.hash = hits[0].section.id;
                closeMenus();
              }
            }}
          />
          {!query && <kbd aria-hidden="true">/</kbd>}
          {terms.length > 0 && (
            <div className="dp-results" id="dp-results" aria-live="polite">
              <div className="dp-results-count">
                {hits.length
                  ? `${hits.length} ${hits.length > 1 ? 'sections match' : 'section matches'}`
                  : `Nothing matches “${query.trim()}”`}
              </div>
              {hits.map((h) => (
                <a key={h.section.id} className="dp-hit" href={`#${h.section.id}`} onClick={closeMenus}>
                  <span className="dp-hit-title">{highlight(h.section.title, terms)}</span>
                  <span className="dp-hit-snip">{highlight(h.snippet, terms)}</span>
                </a>
              ))}
            </div>
          )}
        </div>
        <div className="dp-top-end">
          <div className="dp-theme" role="group" aria-label="Theme">
            {(
              [
                ['light', '☀', 'Light'],
                ['dark', '☾', 'Dark'],
                ['system', '◐', 'System'],
              ] as const
            ).map(([mode, icon, label]) => (
              <button
                key={mode}
                type="button"
                title={label}
                aria-label={`${label} theme`}
                aria-pressed={theme === mode}
                className={theme === mode ? 'active' : undefined}
                onClick={() => {
                  writeTheme(mode);
                  setTheme(mode);
                }}
              >
                {icon}
              </button>
            ))}
          </div>
          <a className="dp-open" href={APP_HREF}>
            Open Fluxion <span aria-hidden="true">→</span>
          </a>
        </div>
      </header>

      <details className="dp-menu" ref={menuRef}>
        <summary>
          <MenuIcon />
          <span className="dp-menu-label">
            {(active && SECTIONS.find((s) => s.id === active)?.title) || 'Sections'}
          </span>
        </summary>
        <nav aria-label="Sections">{nav}</nav>
      </details>

      <div className="dp-layout">
        <aside className="dp-side">
          <nav aria-label="Documentation sections">
            <div className="dp-side-label">Documentation</div>
            {nav}
          </nav>
        </aside>

        <main className="dp-main">
          {SECTIONS.map((s, i) => (
            <Section key={s.id} section={s} index={i} links={links} />
          ))}
          <footer className="dp-foot">
            <p>
              <strong>For AI agents:</strong> <a href="../llms.txt">llms.txt</a> explains how to build Fluxion graph
              links; the spec schema is <a href="../fluxion-spec.schema.json">fluxion-spec.schema.json</a>.
            </p>
            <p>
              <a href={APP_HREF}>Open Fluxion</a> · <a href="https://github.com/Osmansiddiquer/Fluxion">Source on GitHub</a> ·{' '}
              <a href="https://github.com/Osmansiddiquer/Fluxion/issues">Report a bug</a>
            </p>
          </footer>
        </main>
      </div>
    </div>
  );
}

// ── Sections & blocks ───────────────────────────────────────────────────────

function Section({ section, index, links }: { section: DocSection; index: number; links: Record<string, string> }) {
  let rowIndex = 0; // numbered exactly like content.allExamples()
  const render = (b: Block, i: number): ReactNode => {
    switch (b.type) {
      case 'p':
        return (
          <p key={i}>
            <Inline text={b.text} />
          </p>
        );
      case 'h':
        return (
          <h3 key={i} id={headingId(section.id, b.text)}>
            <Inline text={b.text} />
          </h3>
        );
      case 'list':
        return (
          <ul key={i}>
            {b.items.map((it, j) => (
              <li key={j}>
                <Inline text={it} />
              </li>
            ))}
          </ul>
        );
      case 'steps':
        return (
          <ol key={i} className="dp-steps">
            {b.items.map((it, j) => (
              <li key={j}>
                <Inline text={it} />
              </li>
            ))}
          </ol>
        );
      case 'tip':
        return (
          <aside key={i} className="dp-tip">
            <span className="dp-tip-mark" aria-hidden="true">
              ✦
            </span>
            <div>
              <Inline text={b.text} />
            </div>
          </aside>
        );
      case 'math':
        return <div key={i} className="dp-math" dangerouslySetInnerHTML={{ __html: tex(b.tex, true) }} />;
      case 'table':
        return (
          <div key={i} className="dp-table-wrap">
            <table className={`dp-table dp-cols-${b.head.length}`}>
              <thead>
                <tr>
                  {b.head.map((h) => (
                    <th key={h} scope="col">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, j) => (
                  <tr key={j}>
                    {r.map((c, k) => (
                      <td key={k} data-label={b.head[k]}>
                        <Inline text={c} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'syntax':
        return (
          <div key={i} className="dp-table-wrap">
            <table className="dp-syntax">
              <thead>
                <tr>
                  <th scope="col">You type</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Meaning</th>
                  <th scope="col">
                    <span className="dp-sr">Try it</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r) => {
                  const ex = rowExample(section.id, r, rowIndex++);
                  return <SyntaxLine key={ex.id} row={r} href={links[ex.id]} />;
                })}
              </tbody>
            </table>
          </div>
        );
      case 'example':
        return <ExampleCard key={i} ex={b.example} href={links[b.example.id]} />;
      case 'tour':
        return (
          <div key={i} className="dp-cta">
            <div>
              <div className="dp-cta-title">New to Fluxion?</div>
              <div className="dp-cta-sub">Open the app, or start with the one-minute tour.</div>
            </div>
            <div className="dp-cta-actions">
              <a className="dp-btn dp-btn-ghost" href={`${APP_HREF}?tour`}>
                Take the tour
              </a>
              <a className="dp-btn" href={APP_HREF}>
                Open Fluxion
              </a>
            </div>
          </div>
        );
      case 'script-docs':
        return <ScriptDocsSlot key={i} />;
    }
  };
  return (
    <section id={section.id} className="dp-section" aria-labelledby={`${section.id}-title`}>
      <div className="dp-eyebrow">
        {String(index + 1).padStart(2, '0')} / {String(SECTIONS.length).padStart(2, '0')}
      </div>
      <h2 id={`${section.id}-title`}>
        <a href={`#${section.id}`}>{section.title}</a>
      </h2>
      <p className="dp-lede">{section.summary}</p>
      {section.blocks.map(render)}
    </section>
  );
}

function TryLink({ href, label }: { href: string | undefined; label: string }) {
  return (
    <a
      className="dp-try"
      href={href ?? APP_HREF}
      target="_blank"
      rel="noopener"
      aria-label={label}
      title="Opens in Fluxion, in a new tab"
    >
      Try it <span aria-hidden="true">↗</span>
    </a>
  );
}

function SyntaxLine({ row, href }: { row: SyntaxRow; href: string | undefined }) {
  return (
    <tr>
      <td className="dp-syn-input">
        <code>{row.input}</code>
      </td>
      <td className="dp-syn-kind">
        <KindTag kind={row.kind} derived={row.derived} />
      </td>
      <td className="dp-syn-note">
        <Inline text={row.note} />
      </td>
      <td className="dp-syn-try">
        <TryLink href={href} label={`Try ${row.input} in Fluxion`} />
      </td>
    </tr>
  );
}

function ExampleCard({ ex, href }: { ex: DocExample; href: string | undefined }) {
  const blurb = ex.blurb;
  return (
    <figure className="dp-example">
      <div className="dp-example-head">
        <div className="dp-example-meta">
          <figcaption className="dp-example-title">
            {ex.title}
            {ex.demo && <span className="dp-example-badge">Built-in example</span>}
          </figcaption>
          {blurb && <div className="dp-example-blurb">{blurb}</div>}
        </div>
        <TryLink href={href} label={`Try “${ex.title}” in Fluxion`} />
      </div>
      {ex.tex && <div className="dp-example-tex" dangerouslySetInnerHTML={{ __html: tex(ex.tex) }} />}
      {ex.lines.length > 0 && (
        <div className="dp-code">
          {ex.lines.map((l: ExampleLine, j) => (
            <div className="dp-code-line" key={j}>
              <span className="dp-code-swatch" style={l.opts?.color ? { background: l.opts.color } : undefined} />
              <code>{l.raw}</code>
              <KindTag kind={l.kind} derived={l.derived} />
            </div>
          ))}
        </div>
      )}
    </figure>
  );
}

function KindTag({ kind, derived }: { kind: DocKind; derived?: boolean }) {
  const label = kindLabel(kind, derived);
  return <span className={`dp-kind dp-kind-${label === 'derived' ? 'derived' : kind}`}>{label}</span>;
}

function ScriptDocsSlot() {
  // Client-only: the slot renders the placeholder in the static HTML (and on the
  // hydration pass), then swaps in Script mode's reference once mounted.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (ScriptDocs && mounted) {
    return (
      <Suspense fallback={<p className="dp-muted">Loading the Script mode reference…</p>}>
        <ScriptDocs />
      </Suspense>
    );
  }
  if (ScriptDocs) {
    // Static HTML / before hydration: say what loads here.
    return (
      <div className="dp-soon">
        <div className="dp-soon-mark" aria-hidden="true">
          {'{ }'}
        </div>
        <div>
          <div className="dp-soon-title">Script mode reference</div>
          <p>
            Every Script mode function, with an example you can open in the app. It needs JavaScript to load; you can
            also open it inside the app: switch to <a href={`${APP_HREF}`}>Script</a> mode and press Reference.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="dp-soon">
      <div className="dp-soon-mark" aria-hidden="true">
        {'{ }'}
      </div>
      <div>
        <div className="dp-soon-title">Script mode is coming</div>
        <p>
          A code editor for writing graphs in sandboxed JavaScript is on its way, and its reference will appear here.
          Until then, Graph mode already has functions, repeats and keyframes: see <a href="#drawing">Drawing &amp; styling</a>.
        </p>
      </div>
    </div>
  );
}

// ── Inline markup ───────────────────────────────────────────────────────────

const INLINE_RE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\$[^$]+\$)|(\[[^\]]+\]\([^)]+\))/g;

function Inline({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (m[1]) out.push(<code key={k++}>{tok.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k++}>{tok.slice(2, -2)}</strong>);
    else if (m[3]) out.push(<span key={k++} className="dp-tex" dangerouslySetInnerHTML={{ __html: tex(tok.slice(1, -1)) }} />);
    else {
      const [, label, href] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)!;
      out.push(
        <a key={k++} href={href}>
          {label}
        </a>,
      );
    }
    last = m.index! + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

function highlight(text: string, terms: string[]): ReactNode {
  if (!terms.length) return text;
  const esc = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const parts = text.split(new RegExp(`(${esc.join('|')})`, 'gi'));
  return parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : <Fragment key={i}>{p}</Fragment>));
}

// ── Icons ───────────────────────────────────────────────────────────────────

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function MenuIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M2.5 5h13M2.5 9h13M2.5 13h13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
