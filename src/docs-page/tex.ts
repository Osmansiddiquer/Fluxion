// TeX → HTML for the docs page without shipping KaTeX's JavaScript to readers.
// At build time (prerender.ts) and in dev, KaTeX renders and every result is
// cached; the build embeds the cache in the page, and the client reads it back
// (loadTexMap) so hydration produces identical markup. Only KaTeX's CSS/fonts
// load in the browser.
type Renderer = (src: string, display: boolean) => string;

let renderer: Renderer | null = null;
const cache = new Map<string, string>();

const keyOf = (src: string, display: boolean) => `${display ? 'D' : 'I'}|${src}`;

export function setTexRenderer(r: Renderer): void {
  renderer = r;
}

export function loadTexMap(map: Record<string, string>): void {
  for (const [k, v] of Object.entries(map)) cache.set(k, v);
}

/** Everything rendered so far (embedded into the built page). */
export function texMap(): Record<string, string> {
  return Object.fromEntries(cache);
}

export function texHtml(src: string, display = false): string {
  const key = keyOf(src, display);
  let html = cache.get(key);
  if (html === undefined) {
    html = renderer ? renderer(src, display) : src;
    if (renderer) cache.set(key, html);
  }
  return html;
}
