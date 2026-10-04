// Writes test-pdfs/encrypted-password-test.pdf: a 1-page PDF protected with the
// Standard Security Handler (RC4 40-bit, revision 2). User password: "test".
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const PAD = Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A', 'hex');
const md5 = (...parts) => createHash('md5').update(Buffer.concat(parts)).digest();
const pad = (pw) => Buffer.concat([Buffer.from(pw, 'latin1'), PAD]).subarray(0, 32);

function rc4(key, data) {
  const s = [...Array(256).keys()];
  for (let i = 0, j = 0; i < 256; i += 1) {
    j = (j + s[i] + key[i % key.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = Buffer.alloc(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k += 1) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

const userPw = 'test';
const ownerPw = 'owner';
const P = -44; // print allowed, modify disallowed
const id = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
const O = rc4(md5(pad(ownerPw)).subarray(0, 5), pad(userPw));
const pBytes = Buffer.alloc(4);
pBytes.writeInt32LE(P);
const key = md5(pad(userPw), O, pBytes, id).subarray(0, 5);
const U = rc4(key, PAD);
const objKey = (num) => md5(key, Buffer.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, 0, 0])).subarray(0, 10);

const content = Buffer.from('BT /F1 28 Tf 72 700 Td (Unlocked! Password was "test") Tj ET\nBT /F1 14 Tf 72 660 Td (Encrypted PDF fixture) Tj ET\n');
const enc = rc4(objKey(4), content);

const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
  null,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  `<< /Filter /Standard /V 1 /R 2 /O <${O.toString('hex')}> /U <${U.toString('hex')}> /P ${P} >>`,
];

const chunks = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
const offsets = [];
let pos = chunks[0].length;
objects.forEach((body, i) => {
  const num = i + 1;
  offsets.push(pos);
  const buf =
    body === null
      ? Buffer.concat([Buffer.from(`${num} 0 obj\n<< /Length ${enc.length} >>\nstream\n`), enc, Buffer.from('\nendstream\nendobj\n')])
      : Buffer.from(`${num} 0 obj\n${body}\nendobj\n`);
  chunks.push(buf);
  pos += buf.length;
});
const xref = [`xref\n0 ${objects.length + 1}\n`, '0000000000 65535 f \n', ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
chunks.push(
  Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Encrypt 6 0 R /ID [<${id.toString('hex')}> <${id.toString('hex')}>] >>\nstartxref\n${pos}\n%%EOF\n`),
);

mkdirSync(new URL('../test-pdfs/', import.meta.url), { recursive: true });
writeFileSync(new URL('../test-pdfs/encrypted-password-test.pdf', import.meta.url), Buffer.concat(chunks));
console.log('Wrote test-pdfs/encrypted-password-test.pdf (password: test)');
