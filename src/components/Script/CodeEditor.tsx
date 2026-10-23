import { useEffect, useRef } from 'react';
import { EditorState, StateEffect, type Extension } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  placeholder as cmPlaceholder,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
  syntaxTree,
  HighlightStyle,
  foldGutter,
} from '@codemirror/language';
import { javascript, javascriptLanguage, localCompletionSource } from '@codemirror/lang-javascript';
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  type Completion,
  type CompletionContext,
} from '@codemirror/autocomplete';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';
import { API_NAMES, API_SIGNATURES } from '../../lib/script/api';
import { registerEditor } from './scriptBus';

/** Syntax colours from the theme tokens (so light / dark just work). */
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword], color: 'var(--code-keyword)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--code-number)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--code-string)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--code-fn)' },
  { tag: [t.definition(t.variableName)], color: 'var(--code-def)' },
  { tag: [t.propertyName], color: 'var(--code-prop)' },
  { tag: [t.operator, t.punctuation, t.bracket], color: 'var(--code-punct)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px', backgroundColor: 'var(--surface)', color: 'var(--text)' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.6' },
  '.cm-content': { padding: '10px 0', caretColor: 'var(--accent)' },
  '.cm-gutters': { backgroundColor: 'var(--surface)', color: 'var(--text-faint)', border: 'none' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 12px', minWidth: '28px' },
  '.cm-activeLine': { backgroundColor: 'var(--code-active-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text-muted)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--code-selection) !important' },
  '.cm-matchingBracket': { backgroundColor: 'var(--accent-soft)', outline: '1px solid var(--border-strong)' },
  '.cm-tooltip': { backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', boxShadow: 'var(--shadow)' },
  '.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--mono)', fontSize: '12.5px' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent-soft)', color: 'var(--text)' },
  '.cm-completionDetail': { color: 'var(--text-muted)', fontStyle: 'normal', marginLeft: '10px' },
  '.cm-completionInfo': { padding: '6px 9px', fontFamily: 'var(--font)', fontSize: '12px' },
  '.cm-diagnostic-error': { borderLeft: '3px solid var(--danger)' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--danger)', textUnderlineOffset: '3px' },
  '.cm-lint-marker-error': { content: 'none' },
  '.cm-foldGutter .cm-gutterElement': { color: 'var(--text-faint)' },
  '.cm-panels': { backgroundColor: 'var(--surface-2)', color: 'var(--text)' },
  '.cm-placeholder': { color: 'var(--text-faint)', fontStyle: 'italic' },
});

const KIND: Record<string, Completion['type']> = { PI: 'constant', TAU: 'constant', E: 'constant', time: 'variable', frame: 'variable', view: 'variable', theme: 'variable', ink: 'variable', graph: 'namespace', console: 'namespace' };

const API_OPTIONS: Completion[] = API_NAMES.map((n) => ({
  label: n,
  type: KIND[n] ?? 'function',
  detail: API_SIGNATURES[n].replace(/^[\w$]+/, '').slice(0, 60) || undefined,
  info: API_SIGNATURES[n],
  boost: 1,
}));

const MEMBERS: Record<string, Completion[]> = {
  graph: [
    { label: 'value', type: 'method', detail: '(name) → number', info: 'A slider or value from Graph mode, e.g. graph.value("k")' },
    { label: 'fn', type: 'method', detail: '(name) → function', info: 'A Graph-mode function, e.g. graph.fn("f")(2)' },
    { label: 'ode', type: 'method', detail: '(name, derivative?) → t => value', info: 'A Graph-mode ODE solution, e.g. graph.ode("theta")(time)' },
    { label: 'has', type: 'method', detail: '(name) → boolean' },
    { label: 'names', type: 'method', detail: '() → string[]' },
  ],
  view: ['xmin', 'xmax', 'ymin', 'ymax'].map((label) => ({ label, type: 'property' })),
  console: [{ label: 'log', type: 'method' }],
};
const PATH_METHODS: Completion[] = ['moveTo(x, y)', 'lineTo(x, y)', 'quadTo(cx, cy, x, y)', 'bezierTo(c1x, c1y, c2x, c2y, x, y)', 'arc(cx, cy, r, a0, a1)', 'close()'].map((s) => ({
  label: s.replace(/\(.*/, ''),
  type: 'method',
  detail: s.replace(/^\w+/, ''),
}));
const CLIP_MEMBERS: Completion[] = [
  { label: 'draw', type: 'method', detail: '(frame, { x, y, width })' },
  { label: 'play', type: 'method', detail: '({ x, y, width })' },
  { label: 'frameAt', type: 'method', detail: '(seconds) → frame' },
  { label: 'frames', type: 'property' },
  { label: 'fps', type: 'property' },
  { label: 'duration', type: 'property' },
];
const CAMERA_MEMBERS: Completion[] = ['project', 'point', 'line', 'polyline', 'polygon', 'depth'].map((label) => ({ label, type: 'method' }));

function fluxionCompletions(ctx: CompletionContext) {
  const member = ctx.matchBefore(/([\w$]+)(\([^()]*\))?\.\w*$/);
  if (member) {
    const obj = member.text.replace(/\.\w*$/, '');
    const dot = member.from + member.text.lastIndexOf('.') + 1;
    const head = obj.replace(/\(.*$/, '');
    // Chained path calls: path(...).moveTo(...).| — look at the whole line.
    const line = ctx.state.doc.lineAt(ctx.pos).text;
    let options: Completion[] | undefined = MEMBERS[head];
    if (!options && /\bpath\(/.test(line)) options = PATH_METHODS;
    if (!options && (head === 'clip' || /\bclip\(/.test(line))) options = CLIP_MEMBERS;
    if (!options && (head === 'camera' || /cam/i.test(head))) options = CAMERA_MEMBERS;
    if (options) return { from: dot, options, validFor: /^\w*$/ };
    return null;
  }
  const word = ctx.matchBefore(/[\w$]+/);
  if (!word || (word.from === word.to && !ctx.explicit)) return null;
  return { from: word.from, options: API_OPTIONS, validFor: /^[\w$]*$/ };
}

/** The runtime error currently shown (1-based line), per editor view. */
type RuntimeError = { line?: number; message: string } | null;
/** Dispatched when the runtime error changes, to re-run the linter. */
const runtimeErrorChanged = StateEffect.define<null>();

/**
 * One linter for both kinds of error, so neither clears the other: syntax
 * errors from the editor's own parser (engines don't report where), and the
 * script's last runtime error on its line.
 */
function makeLinter(runtime: { current: RuntimeError }) {
  return linter(
    (view) => {
      const out: Diagnostic[] = [];
      syntaxTree(view.state).iterate({
        enter(n) {
          if (n.type.isError && out.length < 1) {
            const from = Math.max(0, Math.min(n.from, view.state.doc.length));
            const to = Math.min(view.state.doc.length, Math.max(from + 1, n.to));
            out.push({ from, to, severity: 'error', message: 'Syntax error: check the brackets, commas and quotes here.' });
          }
        },
      });
      const err = runtime.current;
      if (err?.line && err.line <= view.state.doc.lines) {
        const line = view.state.doc.line(err.line);
        const indent = line.text.length - line.text.trimStart().length;
        out.push({ from: line.from + indent, to: Math.max(line.from + indent + 1, line.to), severity: 'error', message: err.message });
      }
      return out;
    },
    {
      delay: 400,
      needsRefresh: (u) => u.transactions.some((tr) => tr.effects.some((e) => e.is(runtimeErrorChanged))),
    },
  );
}

export interface CodeEditorProps {
  value: string;
  onChange: (code: string) => void;
  onRun: () => void;
  /** Runtime error to mark (1-based line). */
  error: { line?: number; message: string } | null;
  ariaLabel?: string;
}

export default function CodeEditor({ value, onChange, onRun, error, ariaLabel = 'Script editor' }: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const runtimeError = useRef<RuntimeError>(error);
  const cb = useRef({ onChange, onRun });
  cb.current = { onChange, onRun };

  useEffect(() => {
    const exts: Extension[] = [
      lineNumbers(),
      foldGutter({ openText: '▾', closedText: '▸' }),
      lintGutter(),
      highlightActiveLineGutter(),
      history(),
      drawSelection(),
      dropCursor(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      javascript(),
      javascriptLanguage.data.of({ autocomplete: localCompletionSource }),
      autocompletion({ override: [fluxionCompletions, localCompletionSource], icons: true, activateOnTypingDelay: 80 }),
      syntaxHighlighting(highlight),
      makeLinter(runtimeError),
      theme,
      EditorState.tabSize.of(2),
      EditorView.lineWrapping,
      cmPlaceholder('// Draw something, e.g.\ncircle(0, 0, 2, { fill: "tomato" })'),
      EditorView.contentAttributes.of({ 'aria-label': ariaLabel, spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
      keymap.of([
        { key: 'Mod-Enter', run: () => (cb.current.onRun(), true) },
        { key: 'Shift-Enter', run: () => (cb.current.onRun(), true) },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...completionKeymap,
        indentWithTab,
      ]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) cb.current.onChange(u.state.doc.toString());
      }),
    ];
    const v = new EditorView({ state: EditorState.create({ doc: value, extensions: exts }), parent: host.current! });
    view.current = v;
    const unregister = registerEditor({
      replace: (code) => {
        v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: code }, selection: { anchor: 0 }, scrollIntoView: true });
        v.focus();
      },
      insert: (code) => {
        const sel = v.state.selection.main;
        const line = v.state.doc.lineAt(sel.head);
        // Insert snippets on their own line.
        const atLineStart = sel.head === line.from && line.length === 0;
        const text = (atLineStart ? '' : '\n') + code.replace(/\n$/, '') + '\n';
        const pos = atLineStart ? sel.head : line.to;
        v.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length }, scrollIntoView: true });
        v.focus();
      },
      focusLine: (n) => {
        const line = v.state.doc.line(Math.max(1, Math.min(n, v.state.doc.lines)));
        v.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
        v.focus();
      },
    });
    return () => {
      unregister();
      v.destroy();
      view.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External changes (examples, links, undo of "Try it") replace the document.
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    }
  }, [value]);

  // Runtime error marker on its line (through the shared linter).
  useEffect(() => {
    runtimeError.current = error;
    view.current?.dispatch({ effects: runtimeErrorChanged.of(null) });
  }, [error]);

  return <div className="code-editor" ref={host} />;
}
