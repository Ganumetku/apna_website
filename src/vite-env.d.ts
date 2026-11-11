/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ALLOWED_ORIGINS?: string;
  /** "true" shows a Download button next to Save & Continue inside the iframe. */
  readonly VITE_EMBED_SHOW_DOWNLOAD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module 'pako' {
  export function inflate(data: Uint8Array | ArrayBuffer, options?: { to?: 'string' }): string | Uint8Array;
  export function deflate(data: Uint8Array | ArrayBuffer | string): Uint8Array;
}
