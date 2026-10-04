export const LARGE_FILE_BYTES = 50 * 1024 * 1024;
export const HUGE_FILE_BYTES = 200 * 1024 * 1024;
export const LARGE_PAGE_COUNT = 300;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

/** True if the bytes start with the `%PDF-` signature (allowing leading junk, as readers do). */
export function hasPdfSignature(bytes: Uint8Array): boolean {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return head.includes('%PDF-');
}

export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

export function editedFileName(original: string): string {
  const base = original.replace(/\.pdf$/i, '');
  return `${base}-edited.pdf`;
}

export function downloadBytes(bytes: Uint8Array, fileName: string, mime = 'application/pdf'): void {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give Safari/iOS time to start the download before revoking.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function readFileAsDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

export function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const comma = dataUrl.indexOf(',');
  const header = dataUrl.slice(0, comma);
  const mime = header.slice(5).split(';')[0] || 'application/octet-stream';
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return { bytes, mime };
}

const MAX_IMAGE_SIDE = 3000;

/**
 * Normalise a user image into a data URL pdf-lib can embed (PNG or JPEG),
 * downscaling very large photos so the editor stays responsive.
 */
export async function prepareImage(file: Blob): Promise<{ dataUrl: string; width: number; height: number }> {
  const original = await readFileAsDataURL(file);
  const img = await loadHtmlImage(original);
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  const isEmbeddable = file.type === 'image/png' || file.type === 'image/jpeg';
  if (isEmbeddable && longest <= MAX_IMAGE_SIDE) {
    return { dataUrl: original, width: img.naturalWidth, height: img.naturalHeight };
  }
  const scale = Math.min(1, MAX_IMAGE_SIDE / longest);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not supported');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const asJpeg = file.type === 'image/jpeg';
  const dataUrl = asJpeg ? canvas.toDataURL('image/jpeg', 0.92) : canvas.toDataURL('image/png');
  return { dataUrl, width: canvas.width, height: canvas.height };
}

export function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('This image format is not supported'));
    img.src = src;
  });
}
