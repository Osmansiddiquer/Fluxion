import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { highlightCode, classHighlighter } from '@lezer/highlight';
import { javascriptLanguage } from '@codemirror/lang-javascript';
import type { DocEntry, DocSection } from './docsContent';
import { APP_FROM_DOCS, isScriptApp } from './scriptHost';
import './ScriptDocs.css';

/**
 * The Scripting reference: getting started, every API function with a
 * runnable snippet, animation, sliders, reading ODE solutions, clips and tips.
 * Self-contained (no props) and loads its content lazily, so it can be mounted
 * anywhere:
 * - in Script mode, "Try it" replaces the script (Ctrl+Z undoes it) and "Insert"
 *   adds the snippet at the cursor;
 * - on the standalone docs page (no app store or editor), "Try it" is a link that
 *   opens the app in a new tab with the snippet as its script, and there is no
 *   "Insert".
 */
export default function ScriptDocs() {
  const [docs, setDocs] = useState<DocSection[] | null>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<string>('start');
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    import('./docsContent').then((m) => live && setDocs(m.DOCS));
    return () => {
      live = false;
    };
  }, []);

  const shown = useMemo(() => {
    if (!docs) return [];
    const q = query.trim().toLowerCase();
    if (!q) return docs;
    return docs
      .map((s) => ({
        ...s,
        intro: undefined,
        entries: s.entries.filter((e) => `${e.name} ${e.sig ?? ''} ${e.text}`.toLowerCase().includes(q)),
      }))
      .filter((s) => s.entries.length);
  }, [docs, query]);

  // Highlight the section being read in the nav.
  useEffect(() => {
    const root = scroller.current;
    if (!root || !docs) return;
    const io = new IntersectionObserver(
      (obs) => {
        const vis = obs.filter((o) => o.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive((vis[0].target as HTMLElement).dataset.section ?? 'start');
      },
      { root, rootMargin: '0px 0px -70% 0px' },
    );
    root.querySelectorAll('[data-section]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [docs, shown]);

  const jump = (id: string) => {
    setQuery('');
    requestAnimationFrame(() => {
      const el = scroller.current?.querySelector(`[data-section="${id}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  if (!docs) return <div className="sd-loading">Loading the reference…</div>;

  // On the docs page, the page has its own search and navigation: just flow.
  const standalone = !isScriptApp();

  return (
    <div className={`sd${standalone ? ' sd-standalone' : ''}`}>
      {!standalone && (
      <div className="sd-top">
        <input
          className="sd-search"
          type="search"
          placeholder="Search functions…  (circle, ode, gradient)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search the scripting reference"
        />
        <nav className="sd-nav" aria-label="Sections">
          {docs.map((s) => (
            <button key={s.id} className={`sd-nav-btn${active === s.id && !query ? ' on' : ''}`} onClick={() => jump(s.id)}>
              {s.title}
            </button>
          ))}
        </nav>
      </div>
      )}
      <div className="sd-scroll" ref={scroller}>
        {shown.length === 0 && <p className="sd-empty">Nothing matches “{query}”.</p>}
        {shown.map((s) => (
          <section key={s.id} className="sd-section" data-section={s.id}>
            <h3 className="sd-h">{s.title}</h3>
            {s.intro && <Rich text={s.intro} className="sd-intro" />}
            {s.entries.map((e) => (
              <Entry key={e.name} e={e} />
            ))}
          </section>
        ))}
        <p className="sd-foot">
          Scripts are JavaScript with these functions built in. Everything runs in a sandbox in your browser.
        </p>
      </div>
    </div>
  );
}

function Entry({ e }: { e: DocEntry }) {
  const [done, setDone] = useState<'try' | 'insert' | null>(null);
  useEffect(() => {
    if (!done) return;
    const id = window.setTimeout(() => setDone(null), 1400);
    return () => window.clearTimeout(id);
  }, [done]);
  return (
    <article className="sd-entry">
      <h4 className="sd-name">{e.name}</h4>
      {e.sig && <code className="sd-sig">{e.sig}</code>}
      <Rich text={e.text} className="sd-text" />
      {e.code && (
        <div className="sd-code">
          <Code code={e.code} />
          <div className="sd-actions">
            {e.needs?.entries?.length ? (
              <span className="sd-needs" title="Try it adds these to Graph mode if they're missing">
                uses {e.needs.entries.map((n) => n.raw).join(', ')}
              </span>
            ) : e.clip ? (
              <span className="sd-needs">needs a clip named “apple”</span>
            ) : null}
            {isScriptApp() ? (
              <>
                <button
                  className="sd-btn"
                  onClick={() => {
                    void import('./scriptBus').then((m) => m.insertSnippet(e.code!, e.needs));
                    setDone('insert');
                  }}
                  title="Insert at the cursor"
                >
                  {done === 'insert' ? 'Inserted' : 'Insert'}
                </button>
                <button
                  className="sd-btn primary"
                  onClick={() => {
                    void import('./scriptBus').then((m) => m.trySnippet(e.code!, e.needs));
                    setDone('try');
                  }}
                  title="Replace the script with this example and run it (Ctrl+Z in the editor undoes it)"
                >
                  {done === 'try' ? 'Running' : 'Try it'}
                </button>
              </>
            ) : (
              <TryLink e={e} />
            )}
          </div>
        </div>
      )}
    </article>
  );
}

/** Outside the app: a link that opens Fluxion in Script mode with this snippet. */
function TryLink({ e }: { e: DocEntry }) {
  const [href, setHref] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void scriptLink(e).then((h) => live && setHref(h));
    return () => {
      live = false;
    };
  }, [e]);
  return (
    <a
      className="sd-btn primary"
      href={href ?? APP_FROM_DOCS}
      target="_blank"
      rel="noopener"
      title="Open this example in Fluxion (Script mode) in a new tab"
      aria-disabled={!href}
    >
      Try it ↗
    </a>
  );
}

/** A `#z=` link to the app with the snippet as its script (plus the Graph-mode
 * expressions it reads). */
export async function scriptLink(e: Pick<DocEntry, 'code' | 'needs'>, base = APP_FROM_DOCS): Promise<string> {
  const { buildLink } = await import('../../lib/api/url');
  const expressions = (e.needs?.entries ?? []).map((n) => (n.ic ? { expr: n.raw, ic: n.ic } : n.raw));
  return buildLink({ expressions, script: e.code ?? '' }, { base, format: 'z' });
}

/** Syntax-highlighted, read-only code (lezer classes styled in ScriptDocs.css). */
function Code({ code }: { code: string }) {
  const parts = useMemo(() => {
    const out: ReactNode[] = [];
    const tree = javascriptLanguage.parser.parse(code);
    let key = 0;
    highlightCode(
      code.replace(/\n$/, ''),
      tree,
      classHighlighter,
      (text, classes) => out.push(classes ? <span key={key++} className={classes}>{text}</span> : <Fragment key={key++}>{text}</Fragment>),
      () => out.push('\n'),
    );
    return out;
  }, [code]);
  return <pre className="sd-pre">{parts}</pre>;
}

/** `code`, **bold** and blank-line paragraphs. */
function Rich({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className}>
      {text.split(/\n\n+/).map((para, i) => (
        <p key={i}>
          {para.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((bit, j) =>
            bit.startsWith('`') ? (
              <code key={j}>{bit.slice(1, -1)}</code>
            ) : bit.startsWith('**') ? (
              <strong key={j}>{bit.slice(2, -2)}</strong>
            ) : (
              <Fragment key={j}>{bit}</Fragment>
            ),
          )}
        </p>
      ))}
    </div>
  );
}
