import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    target: 'es2022',
    // pdf.js and Fabric are large by nature; the editor is code-split via
    // React.lazy so the landing page stays light.
    chunkSizeWarningLimit: 2000,
  },
  worker: { format: 'es' },
});
