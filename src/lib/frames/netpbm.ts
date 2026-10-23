/**
 * Minimal Netpbm reader (PBM P1/P4, PGM P2/P5) → 8-bit grayscale. Netpbm is
 * what ffmpeg writes with no extra libraries:
 *
 *   ffmpeg -i clip.mp4 -vf "fps=30,scale=192:144" frames/%05d.pgm
 *
 * so the frame importer needs no image-decoding dependency.
 */
export interface GrayImage {
  width: number;
  height: number;
  /** Row-major gray levels, 0 (black) … 255 (white). */
  data: Uint8Array;
}

export function parseNetpbm(bytes: Uint8Array): GrayImage {
  let pos = 0;
  const isSpace = (c: number) => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x0b || c === 0x0c;
  const skip = () => {
    for (;;) {
      while (pos < bytes.length && isSpace(bytes[pos])) pos++;
      if (bytes[pos] === 0x23) {
        while (pos < bytes.length && bytes[pos] !== 0x0a) pos++;
      } else return;
    }
  };
  const token = (): string => {
    skip();
    let s = '';
    while (pos < bytes.length && !isSpace(bytes[pos]) && bytes[pos] !== 0x23) s += String.fromCharCode(bytes[pos++]);
    if (!s) throw new Error('Truncated Netpbm header');
    return s;
  };
  const int = () => {
    const n = Number(token());
    if (!Number.isInteger(n) || n <= 0) throw new Error('Bad Netpbm header');
    return n;
  };

  const magic = token();
  if (!['P1', 'P2', 'P4', 'P5'].includes(magic)) throw new Error(`Unsupported Netpbm type ${magic}`);
  const width = int();
  const height = int();
  const maxval = magic === 'P1' || magic === 'P4' ? 1 : int();
  if (maxval > 65535) throw new Error('Bad Netpbm maxval');
  const n = width * height;
  const data = new Uint8Array(n);
  const scale = (v: number) => Math.round((Math.min(v, maxval) / maxval) * 255);

  if (magic === 'P1' || magic === 'P2') {
    for (let i = 0; i < n; i++) {
      if (magic === 'P1') {
        // Plain PBM digits may be packed without whitespace.
        skip();
        const c = bytes[pos++];
        if (c !== 0x30 && c !== 0x31) throw new Error('Bad PBM data');
        data[i] = c === 0x31 ? 0 : 255; // PBM: 1 = black
      } else {
        data[i] = scale(Number(token()));
      }
    }
    return { width, height, data };
  }

  pos++; // exactly one whitespace byte separates the header from raster data
  if (magic === 'P4') {
    const rowBytes = Math.ceil(width / 8);
    if (bytes.length - pos < rowBytes * height) throw new Error('Truncated PBM data');
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        const bit = (bytes[pos + j * rowBytes + (i >> 3)] >> (7 - (i & 7))) & 1;
        data[j * width + i] = bit ? 0 : 255;
      }
    }
    return { width, height, data };
  }
  // P5: 1 or 2 bytes per sample (big-endian when maxval > 255).
  const wide = maxval > 255;
  if (bytes.length - pos < n * (wide ? 2 : 1)) throw new Error('Truncated PGM data');
  for (let i = 0; i < n; i++) {
    const v = wide ? (bytes[pos + 2 * i] << 8) | bytes[pos + 2 * i + 1] : bytes[pos + i];
    data[i] = scale(v);
  }
  return { width, height, data };
}
