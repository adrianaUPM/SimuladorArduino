import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base relativa: funciona tanto en https://<usuario>.github.io/<repo>/ como en local
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
  },
});
