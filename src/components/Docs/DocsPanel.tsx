import { Fragment, Suspense, lazy, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import katex from 'katex';
import { SECTIONS, findSection, rowExample, type Block, type DocSection, type SyntaxRow } from './content';
import { exampleGraph, type DocExample, type DocKind } from './examples';
import { searchDocs, queryTerms } from './search';
import { DEMOS } from '../../lib/demos';
import { openGraphWithUndo } from '../../lib/openGraph';
import { useStore } from '../../store/useStore';
import { parseEntry } from '../../lib/math/parse';
import { isDerived } from '../../lib/scope';
import './Docs.css';

// ── Script mode reference hook ──────────────────────────────────────────────
// Script mode (branch feat/script-mode) ships its own reference as a default-
// exported, prop-less component at src/components/Script/ScriptDocs.tsx. Until
// it lands, the Scripting section shows a "coming soon" note. To wire it in,
// replace the final `= null` on the next line with `= () => import('../Script/ScriptDocs')`.
const SCRIPT_DOCS: (() => Promise<{ default: ComponentType }>) | null = null;
const ScriptDocs = SCRIPT_DOCS ? lazy(SCRIPT_DOCS) : null;

/** Below this width, "Try it" closes the docs so the graph is visible. */
const NARROW = 900;

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
  frames: 'clip',
};

function tex(src: string, display = false): string {
  return katex.renderToString(src, { throwOnError: false, displayMode: display });
}

export interface DocsPanelProps {
  /** Section to show (undefined = home). */
  section?: string;
  onNavigate: (section?: string) => void;
  onClose: () => void;
  onTour: () => void;
}

export default function DocsPanel({ section, onNavigate, onClose, onTour }: DocsPanelProps) {
  const current: DocSection = findSection(section) ?? SECTIONS[0];
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const sigFigs = useStore((s) => s.sigFigs);
  const hits = useMemo(() => searchDocs(SECTIONS, query), [query]);
  const terms = useMemo(() => queryTerms(query), [query]);
  const searching = terms.length > 0;

  // Focus the panel on open (not the search box: on phones that pops the keyboard).
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  // New section → scroll to its top, and keep its nav entry in view (the nav is
  // a horizontal strip on phones).
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
    navRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [current.id]);

  // Esc closes (or clears an active search first); "/" jumps to search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable || t.tagName === 'MATH-FIELD');
      if (e.key === 'Escape') {
        if (t === searchRef.current && query) {
          setQuery('');
          return;
        }
        // Leave Esc alone inside the expression editor (autocomplete uses it).
        if (typing && !panelRef.current?.contains(t)) return;
        e.preventDefault();
        onClose();
      } else if (e.key === '/' && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, query]);

  const go = (id?: string) => {
    setQuery('');
    onNavigate(id === SECTIONS[0].id ? undefined : id);
  };

  const tryExample = (ex: DocExample) => {
    let graph;
    let title = ex.title;
    if (ex.demo) {
      const d = DEMOS.find((x) => x.id === ex.demo);
      if (!d) return;
      graph = d.build();
      title = d.title;
    } else {
      graph = exampleGraph(ex, sigFigs);
    }
    openGraphWithUndo(graph, title);
    if (window.innerWidth < NARROW) onClose();
  };

  const idx = SECTIONS.indexOf(current);
  const prev = SECTIONS[idx - 1];
  const next = SECTIONS[idx + 1];

  return (
    <div
      className="docs-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby="docs-heading"
      ref={panelRef}
      tabIndex={-1}
    >
      <header className="docs-head">
        <div className="docs-brand" id="docs-heading">
          <BookIcon /> Documentation
        </div>
        <label className="docs-search">
          <SearchIcon />
          <input
            ref={searchRef}
            type="search"
            placeholder="Search the docs"
            aria-label="Search the docs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && hits[0]) go(hits[0].section.id);
            }}
          />
          {!query && <kbd aria-hidden="true">/</kbd>}
        </label>
        <button className="docs-close" title="Close (Esc)" aria-label="Close documentation" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>

      <div className="docs-main">
        <nav className="docs-nav" aria-label="Documentation sections" ref={navRef}>
          <ol>
            {SECTIONS.map((s, i) => (
              <li key={s.id}>
                <button
                  className={s === current && !searching ? 'active' : undefined}
                  aria-current={s === current ? 'page' : undefined}
                  onClick={() => go(s.id)}
                >
                  <span className="docs-nav-num">{i + 1}</span>
                  {s.title}
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <div className="docs-body" ref={bodyRef}>
          {searching ? (
            <section className="docs-results" aria-live="polite">
              <h2 className="docs-title">Search</h2>
              <p className="docs-lede">
                {hits.length
                  ? `${hits.length} ${hits.length > 1 ? 'sections match' : 'section matches'} “${query.trim()}”`
                  : `Nothing matches “${query.trim()}”.`}
              </p>
              {hits.map((h) => (
                <button key={h.section.id} className="docs-hit" onClick={() => go(h.section.id)}>
                  <span className="docs-hit-title">{highlight(h.section.title, terms)}</span>
                  <span className="docs-hit-snip">{highlight(h.snippet, terms)}</span>
                </button>
              ))}
            </section>
          ) : (
            <article key={current.id} className="docs-article">
              <h2 className="docs-title">{current.title}</h2>
              <p className="docs-lede">{current.summary}</p>
              <Blocks section={current} onTry={tryExample} onTour={onTour} onLink={go} />
              {idx === 0 && <Contents onPick={go} />}
              <footer className="docs-pager">
                {prev ? (
                  <button onClick={() => go(prev.id)}>
                    <span className="docs-pager-dir">← Previous</span>
                    <span className="docs-pager-title">{prev.title}</span>
                  </button>
                ) : (
                  <span />
                )}
                {next && (
                  <button className="docs-pager-next" onClick={() => go(next.id)}>
                    <span className="docs-pager-dir">Next →</span>
                    <span className="docs-pager-title">{next.title}</span>
                  </button>
                )}
              </footer>
            </article>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Blocks ──────────────────────────────────────────────────────────────────

function Blocks({
  section,
  onTry,
  onTour,
  onLink,
}: {
  section: DocSection;
  onTry: (ex: DocExample) => void;
  onTour: () => void;
  onLink: (id: string) => void;
}) {
  let rowIndex = 0; // must number syntax rows exactly like content.allExamples()
  const inline = (t: string) => <Inline text={t} onLink={onLink} />;
  const render = (b: Block, i: number): ReactNode => {
    switch (b.type) {
      case 'p':
        return <p key={i}>{inline(b.text)}</p>;
      case 'h':
        return <h3 key={i}>{inline(b.text)}</h3>;
      case 'list':
        return (
          <ul key={i}>
            {b.items.map((it, j) => (
              <li key={j}>{inline(it)}</li>
            ))}
          </ul>
        );
      case 'steps':
        return (
          <ol key={i} className="docs-steps">
            {b.items.map((it, j) => (
              <li key={j}>{inline(it)}</li>
            ))}
          </ol>
        );
      case 'tip':
        return (
          <aside key={i} className="docs-tip">
            <span className="docs-tip-mark" aria-hidden="true">
              ✦
            </span>
            <div>{inline(b.text)}</div>
          </aside>
        );
      case 'math':
        return <div key={i} className="docs-math" dangerouslySetInnerHTML={{ __html: tex(b.tex, true) }} />;
      case 'table':
        return (
          <div key={i} className="docs-table-wrap">
            <table className="docs-table">
              <thead>
                <tr>
                  {b.head.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, j) => (
                  <tr key={j}>
                    {r.map((c, k) => (
                      <td key={k}>{inline(c)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'syntax':
        return (
          <div key={i} className="docs-syntax" role="table" aria-label="Syntax">
            {b.rows.map((r) => {
              const ex = rowExample(section.id, r, rowIndex++);
              return <SyntaxLine key={ex.id} row={r} onTry={() => onTry(ex)} />;
            })}
          </div>
        );
      case 'example':
        return <ExampleCard key={i} ex={b.example} onTry={() => onTry(b.example)} />;
      case 'tour':
        return (
          <div key={i} className="docs-tour">
            <div>
              <div className="docs-tour-title">New here?</div>
              <div className="docs-tour-sub">The tour shows the basics in four short cards.</div>
            </div>
            <button className="docs-btn" onClick={onTour}>
              Replay the tour
            </button>
          </div>
        );
      case 'script-docs':
        return <ScriptDocsSlot key={i} />;
    }
  };
  return <>{section.blocks.map(render)}</>;
}

function SyntaxLine({ row, onTry }: { row: SyntaxRow; onTry: () => void }) {
  return (
    <div className="docs-syn-row" role="row">
      <code className="docs-syn-input" role="cell">
        {row.input}
      </code>
      <span className="docs-syn-kind" role="cell">
        <KindTag kind={row.kind} raw={row.input} />
      </span>
      <span className="docs-syn-note" role="cell">
        <Inline text={row.note} />
      </span>
      <button className="docs-try-sm" role="cell" onClick={onTry} aria-label={`Try ${row.input}`} title="Load this in the graph (with Undo)">
        Try <span aria-hidden="true">▸</span>
      </button>
    </div>
  );
}

function ExampleCard({ ex, onTry }: { ex: DocExample; onTry: () => void }) {
  const demo = ex.demo ? DEMOS.find((d) => d.id === ex.demo) : undefined;
  return (
    <figure className="docs-example">
      <div className="docs-example-head">
        <div className="docs-example-meta">
          <figcaption className="docs-example-title">
            {ex.title}
            {demo && <span className="docs-example-badge">Example</span>}
          </figcaption>
          {(ex.blurb ?? demo?.blurb) && <div className="docs-example-blurb">{ex.blurb ?? demo?.blurb}</div>}
        </div>
        <button className="docs-btn" onClick={onTry} aria-label={`Try it: ${ex.title}`}>
          Try it <span aria-hidden="true">▸</span>
        </button>
      </div>
      {ex.tex && <div className="docs-example-tex" dangerouslySetInnerHTML={{ __html: tex(ex.tex) }} />}
      {ex.lines.length > 0 && (
        <div className="docs-code">
          {ex.lines.map((l, j) => (
            <div className="docs-code-line" key={j}>
              <span className="docs-code-swatch" style={l.opts?.color ? { background: l.opts.color } : undefined} />
              <code>{l.raw}</code>
              <KindTag kind={l.kind} raw={l.raw} />
            </div>
          ))}
        </div>
      )}
    </figure>
  );
}

/** A row's kind tag. A derived value (`b = 2a + 1`) parses as a function with no
 * curve, so it gets its own label rather than a misleading "function". */
function KindTag({ kind, raw }: { kind: DocKind; raw: string }) {
  if (kind === 'function' && isDerived(parseEntry(raw))) {
    return <span className="docs-kind docs-kind-derived">derived</span>;
  }
  return <span className={`docs-kind docs-kind-${kind}`}>{KIND_LABEL[kind]}</span>;
}

function Contents({ onPick }: { onPick: (id: string) => void }) {
  return (
    <>
      <h3>In these docs</h3>
      <div className="docs-contents">
        {SECTIONS.slice(1).map((s, i) => (
          <button key={s.id} onClick={() => onPick(s.id)}>
            <span className="docs-contents-num">{i + 2}</span>
            <span className="docs-contents-title">{s.title}</span>
            <span className="docs-contents-sub">{s.summary}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function ScriptDocsSlot() {
  if (ScriptDocs) {
    return (
      <Suspense fallback={<p className="docs-muted">Loading…</p>}>
        <ScriptDocs />
      </Suspense>
    );
  }
  return (
    <div className="docs-soon">
      <div className="docs-soon-mark" aria-hidden="true">
        {'{ }'}
      </div>
      <div>
        <div className="docs-soon-title">Script mode is coming</div>
        <p>
          A code editor for writing graphs in sandboxed JavaScript is on its way. Its reference will appear here. Until
          then, Graph mode already has functions, repeats and keyframes: see{' '}
          <a href="#docs/drawing">Drawing &amp; styling</a>.
        </p>
      </div>
    </div>
  );
}

// ── Inline markup ───────────────────────────────────────────────────────────

const INLINE_RE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\$[^$]+\$)|(\[[^\]]+\]\([^)]+\))/g;

function Inline({ text, onLink }: { text: string; onLink?: (id: string) => void }) {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (m[1]) out.push(<code key={k++}>{tok.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k++}>{tok.slice(2, -2)}</strong>);
    else if (m[3]) out.push(<span key={k++} className="docs-tex" dangerouslySetInnerHTML={{ __html: tex(tok.slice(1, -1)) }} />);
    else {
      const [, label, href] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)!;
      const doc = /^#docs\/([a-z0-9-]+)$/.exec(href);
      out.push(
        doc ? (
          <a
            key={k++}
            href={href}
            onClick={(e) => {
              e.preventDefault();
              onLink?.(doc[1]);
            }}
          >
            {label}
          </a>
        ) : (
          <a key={k++} href={href} target="_blank" rel="noopener noreferrer">
            {label}
          </a>
        ),
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

function BookIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 4.2C6.6 3.2 4.6 2.9 2.5 3.1v9.2c2.1-.2 4.1.1 5.5 1.1 1.4-1 3.4-1.3 5.5-1.1V3.1c-2.1-.2-4.1.1-5.5 1.1Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M8 4.2v9.2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
