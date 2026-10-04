// Generates fixtures in test-pdfs/ for manual QA (see README "Testing checklist").
import { mkdirSync, writeFileSync } from 'node:fs';
import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib';

const out = new URL('../test-pdfs/', import.meta.url);
mkdirSync(out, { recursive: true });

async function drawGrid(page, font, label) {
  const { width, height } = page.getSize();
  const box = page.getMediaBox();
  for (let x = 0; x <= width; x += 72) {
    page.drawLine({ start: { x: box.x + x, y: box.y }, end: { x: box.x + x, y: box.y + height }, thickness: 0.5, color: rgb(0.8, 0.85, 0.95) });
  }
  for (let y = 0; y <= height; y += 72) {
    page.drawLine({ start: { x: box.x, y: box.y + y }, end: { x: box.x + width, y: box.y + y }, thickness: 0.5, color: rgb(0.8, 0.85, 0.95) });
  }
  page.drawText(label, { x: box.x + 72, y: box.y + height - 72, size: 24, font, color: rgb(0.1, 0.1, 0.2) });
  page.drawText('The quick brown fox jumps over the lazy dog.', { x: box.x + 72, y: box.y + height - 144, size: 14, font });
}

async function sample() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 3; i += 1) {
    const page = doc.addPage([612, 792]);
    await drawGrid(page, font, `Sample page ${i} (Letter)`);
  }
  const a4 = doc.addPage([595.28, 841.89]);
  await drawGrid(a4, font, 'Page 4 (A4)');
  writeFileSync(new URL('sample.pdf', out), await doc.save());
}

async function rotated() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([612, 792]);
  await drawGrid(p1, font, 'Rotate 90');
  p1.setRotation(degrees(90));
  const p2 = doc.addPage([612, 792]);
  await drawGrid(p2, font, 'Rotate 180');
  p2.setRotation(degrees(180));
  const p3 = doc.addPage([612, 792]);
  p3.setMediaBox(100, 100, 612, 792);
  await drawGrid(p3, font, 'MediaBox origin (100,100)');
  const p4 = doc.addPage([612, 792]);
  await drawGrid(p4, font, 'Rotate 270');
  p4.setRotation(degrees(270));
  writeFileSync(new URL('rotated.pdf', out), await doc.save());
}

async function large() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 500; i += 1) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Page ${i} of 500`, { x: 72, y: 700, size: 36, font });
  }
  writeFileSync(new URL('large-500-pages.pdf', out), await doc.save());
}

function corrupted() {
  writeFileSync(new URL('corrupted.pdf', out), '%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R >>\nthis is not really a pdf\n%%EOF');
  writeFileSync(new URL('not-a-pdf.pdf', out), 'Hello, I am a text file pretending to be a PDF.');
}

await sample();
await rotated();
await large();
corrupted();
console.log('Wrote fixtures to test-pdfs/');
