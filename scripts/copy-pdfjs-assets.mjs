// Copies PDF.js runtime assets (CMaps for CJK text, standard font data for
// non-embedded base-14 fonts, WASM image decoders, ICC profiles) into
// public/pdfjs so they are served from our own origin. Nothing is fetched
// from a CDN at runtime, keeping the app fully self-contained and private.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'node_modules/pdfjs-dist');
const dest = resolve(root, 'public/pdfjs');

mkdirSync(dest, { recursive: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  const from = resolve(src, dir);
  if (existsSync(from)) cpSync(from, resolve(dest, dir), { recursive: true });
}
console.log('[copy-pdfjs-assets] copied PDF.js assets to public/pdfjs');
