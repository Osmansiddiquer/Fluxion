// Client-side search over the docs content: plain text per section (titles,
// prose, table cells, syntax rows, example titles), filtered by every query word.
import type { Block, DocSection } from './content';

/** Strip inline markup (`code`, **bold**, $tex$, [label](href)) to readable text. */
export function stripMarkup(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\$([^$]+)\$/g, (_, tex: string) =>
      tex
        .replace(/\\(?:theta)/g, 'θ')
        .replace(/\\[a-zA-Z]+/g, ' ')
        .replace(/[{}_^]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    );
}

function blockText(b: Block): string[] {
  switch (b.type) {
    case 'p':
    case 'h':
    case 'tip':
      return [b.text];
    case 'list':
    case 'steps':
      return b.items;
    case 'table':
      return [...b.head, ...b.rows.flat()];
    case 'syntax':
      return b.rows.flatMap((r) => [r.input, r.note, r.kind]);
    case 'example':
      return [b.example.title, b.example.blurb ?? '', ...b.example.lines.map((l) => l.raw)];
    case 'math':
      return [b.tex];
    case 'tour':
      return ['Replay the tour'];
    case 'script-docs':
      return ['Script mode JavaScript code editor'];
  }
}

/** All searchable text of a section, markup stripped, as separate passages. */
export function sectionPassages(s: DocSection): string[] {
  return [s.title, s.summary, ...s.blocks.flatMap(blockText)].map(stripMarkup).filter(Boolean);
}

export interface SearchHit {
  section: DocSection;
  /** The passage that best shows the match (title/summary if those match). */
  snippet: string;
  score: number;
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

/** Query words (lower-case, split on whitespace). */
export function queryTerms(query: string): string[] {
  return norm(query).split(/\s+/).filter(Boolean);
}

/**
 * Sections containing every query word (case- and accent-insensitive), best
 * first: title matches outrank summary matches outrank body matches. Empty
 * query → no hits.
 */
export function searchDocs(sections: DocSection[], query: string): SearchHit[] {
  const terms = queryTerms(query);
  if (!terms.length) return [];
  const hits: SearchHit[] = [];
  for (const section of sections) {
    const passages = sectionPassages(section);
    const all = norm(passages.join('\n'));
    if (!terms.every((t) => all.includes(t))) continue;
    const title = norm(section.title);
    const summary = norm(section.summary);
    let score = 0;
    for (const t of terms) score += title.includes(t) ? 10 : summary.includes(t) ? 4 : 1;
    // Snippet: the body passage matching the most terms (ties: the first).
    let snippet = section.summary;
    let best = 0;
    for (const p of passages.slice(2)) {
      const n = norm(p);
      const k = terms.filter((t) => n.includes(t)).length;
      if (k > best) {
        best = k;
        snippet = p;
      }
    }
    hits.push({ section, snippet: clip(snippet, terms[0]), score });
  }
  return hits.sort((a, b) => b.score - a.score);
}

/** Trim a long passage to ~140 chars around the first occurrence of `term`. */
function clip(text: string, term: string, max = 140): string {
  if (text.length <= max) return text;
  const at = Math.max(0, norm(text).indexOf(term));
  const start = Math.max(0, Math.min(at - 40, text.length - max));
  return (start > 0 ? '…' : '') + text.slice(start, start + max).trim() + (start + max < text.length ? '…' : '');
}
