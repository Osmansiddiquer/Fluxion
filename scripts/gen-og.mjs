// Generates the social/share assets in public/ from inline SVG.
// One-off generator — needs sharp:  npm i -D sharp  &&  node scripts/gen-og.mjs
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const INK = '#222a35';
const MUTED = '#5d6877';
const ACCENT = '#2d70b3';
const CURSOR = '#f0a000';

// The Ḟ mark (ink F + accent overdot), matching src/components/Logo.tsx.
const mark = (x, y, s) => `
  <g transform="translate(${x} ${y}) scale(${s})">
    <path d="M8.5 10 H20 M8.5 10 V23.5 M8.5 16 H17"
      fill="none" stroke="${INK}" stroke-width="2.9"
      stroke-linecap="round" stroke-linejoin="round" />
    <circle cx="11.8" cy="4.9" r="2.5" fill="${ACCENT}" />
  </g>`;

// The share card, parameterised by size so OG (1200×630) and the GitHub social
// preview (1280×640) come from one design. A rising exponential solution curve
// sits low on the left so it clears the text block.
const Y0 = 524;
const A = 15;
function card(W, H) {
  const xEnd = W - 70;
  const scale = (xEnd - 70) / 3.43; // keep the curve shape consistent across sizes
  const yAt = (x) => Y0 - A * Math.exp((x - 70) / scale);
  const pts = [];
  for (let x = 70; x <= xEnd; x += 6) pts.push(`${x},${yAt(x).toFixed(1)}`);
  const curve = 'M' + pts.join(' L');
  const traceX = xEnd - 150;
  const traceY = yAt(traceX).toFixed(1);
  const vCols = Math.ceil(W / 40);
  const vRows = Math.ceil(H / 40);

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0.35" stop-color="#ffffff" stop-opacity="1"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="#ffffff"/>

  <!-- faint grapher grid -->
  <g stroke="#eef1f5" stroke-width="1">
    ${Array.from({ length: vCols }, (_, i) => `<line x1="${i * 40}" y1="0" x2="${i * 40}" y2="${H}"/>`).join('')}
    ${Array.from({ length: vRows }, (_, i) => `<line x1="0" y1="${i * 40}" x2="${W}" y2="${i * 40}"/>`).join('')}
  </g>

  <!-- axis + solution curve -->
  <line x1="0" y1="${Y0}" x2="${W}" y2="${Y0}" stroke="#cfd6e0" stroke-width="2"/>
  <path d="${curve}" fill="none" stroke="${ACCENT}" stroke-width="7"
    stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="${traceX}" cy="${traceY}" r="13" fill="${CURSOR}" stroke="#ffffff" stroke-width="4"/>

  <!-- white fade so the text block stays crisp over the grid/curve -->
  <rect width="760" height="${H}" fill="url(#fade)"/>

  <!-- brand lockup -->
  ${mark(70, 150, 4.2)}
  <text x="196" y="252" font-family="'Inter','DejaVu Sans',sans-serif" font-size="96"
    font-weight="700" letter-spacing="-3" fill="${INK}">Fluxion</text>

  <text x="74" y="340" font-family="'Inter','DejaVu Sans',sans-serif" font-size="40"
    font-weight="500" fill="${MUTED}">Plot &amp; explore differential equations</text>
  <text x="74" y="394" font-family="'Inter','DejaVu Sans',sans-serif" font-size="26"
    font-weight="400" fill="#8a94a3">Numerical ODE grapher · RK4 · slope fields · implicit curves</text>

  <text x="74" y="${H - 58}" font-family="'DejaVu Sans Mono',monospace" font-size="24"
    font-weight="400" fill="#9aa4b2">osmansiddiquer.github.io/Fluxion</text>
</svg>`;
}

const og = card(1200, 630);
const githubCard = card(1280, 640);

// Opaque brand badge for raster app icons (Apple masks its own corners).
const badge = (px) => `<svg width="${px}" height="${px}" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <rect width="32" height="32" fill="${ACCENT}"/>
  <path d="M11 11 H22 M11 11 V24 M11 17 H19" fill="none" stroke="#fff"
    stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="13" cy="6" r="2.3" fill="#fff"/>
</svg>`;

await sharp(Buffer.from(og)).png().toFile(join(out, 'og.png'));
await sharp(Buffer.from(githubCard)).png().toFile(join(out, 'github-card.png'));
await sharp(Buffer.from(badge(180))).png().toFile(join(out, 'apple-touch-icon.png'));
await sharp(Buffer.from(badge(32))).png().toFile(join(out, 'favicon-32.png'));
console.log('wrote og.png, github-card.png, apple-touch-icon.png, favicon-32.png');
