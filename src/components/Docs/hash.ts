// Legacy deep links from the short-lived in-app docs panel: `#docs` or
// `#docs/<section-id>`. main.tsx redirects them to the docs page (docs/#<id>);
// the tour is skipped for them. Deliberately
// a path-style fragment with no `=`, so it can never be mistaken for the URL API's
// `key=value` payloads (`#expr=`, `#spec=`, `#z=`, `#g=`, `#example=`; see
// lib/api/url.ts `hasUrlPayload`), and the API's fragments never parse as docs.
// Main-bundle code uses this, so it must stay tiny and import nothing heavy.

export interface DocsRoute {
  /** Section id, or undefined for the docs home page. */
  section?: string;
}

const DOCS_RE = /^#docs(?:\/([a-z0-9][a-z0-9-]*))?\/?$/i;

/** `#docs/odes` → { section: 'odes' }; `#docs` → {}; anything else → null. */
export function parseDocsHash(hash: string): DocsRoute | null {
  const m = DOCS_RE.exec(hash.trim());
  if (!m) return null;
  return m[1] ? { section: m[1].toLowerCase() } : {};
}

/** The fragment for a docs route (`#docs` for home). */
export function docsHash(section?: string): string {
  return section ? `#docs/${section}` : '#docs';
}
