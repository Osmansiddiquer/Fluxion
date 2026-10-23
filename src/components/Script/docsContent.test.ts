import { describe, expect, it } from 'vitest';
import { DOCS } from './docsContent';
import { runHeadless } from '../../lib/script/testkit';
import { API_NAMES } from '../../lib/script/api';

const CLIP = [{ name: 'apple', id: 'fx0123abcd1a', frames: 48, fps: 24, box: [-4, -3, 4, 3] as [number, number, number, number] }];

describe('Scripting reference', () => {
  const entries = DOCS.flatMap((s) => s.entries.map((e) => ({ section: s.title, ...e })));

  it('has unique section ids and a snippet for most entries', () => {
    expect(new Set(DOCS.map((s) => s.id)).size).toBe(DOCS.length);
    expect(entries.filter((e) => e.code).length).toBeGreaterThan(30);
  });

  it('documents every API name somewhere', () => {
    const text = JSON.stringify(DOCS);
    const missing = API_NAMES.filter((n) => !new RegExp(`\\b${n}\\b`).test(text));
    expect(missing).toEqual([]);
  });

  for (const e of entries.filter((x) => x.code)) {
    it(`snippet runs: ${e.section} › ${e.name}`, () => {
      for (const time of [0, 1.3, 7]) {
        const r = runHeadless(e.code!, {
          time,
          entries: (e.needs?.entries ?? []).map((n) => ({ raw: n.raw, visible: true, ic: n.ic })),
          clips: e.clip ? CLIP : [],
        });
        expect(r.error, `${e.name} at t=${time}: ${r.error?.message}`).toBeUndefined();
        expect(r.frame.items.length + r.frame.logs.length).toBeGreaterThan(0);
      }
    });
  }
});
