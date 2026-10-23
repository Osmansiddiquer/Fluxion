// Which docs section is "current" for the sidebar highlight and the phone menu
// label. Pure, so it is unit-tested (docs-page.test.ts).

export interface SectionTop {
  id: string;
  /** Viewport y of the section's top edge (getBoundingClientRect().top). */
  top: number;
}

/**
 * The active section is the last one whose top has reached the reading line: the
 * bottom of the sticky header plus `slack` px (so a section whose heading sits at
 * or just below the header, e.g. right after a #link jump with scroll-margin,
 * counts). Before the first section reaches it, the first is active. At the very
 * bottom of the page the last section is active, even if it is too short to ever
 * scroll its heading up to the header.
 */
export function activeSection(sections: SectionTop[], headerBottom: number, atBottom: boolean, slack = 48): string | null {
  if (!sections.length) return null;
  if (atBottom) return sections[sections.length - 1].id;
  const line = headerBottom + slack;
  let active = sections[0].id;
  for (const s of sections) {
    if (s.top <= line) active = s.id;
    else break;
  }
  return active;
}
