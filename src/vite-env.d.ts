/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ALLOWED_ORIGINS?: string;
  /** "true" shows a Download button next to Save & Continue inside the iframe. */
  readonly VITE_EMBED_SHOW_DOWNLOAD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
