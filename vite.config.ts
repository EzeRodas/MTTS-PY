import { defineConfig } from 'vite';
import { resolve } from 'path';
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: 'src/ui',
  base: './', // Use relative paths for Electron
  build: {
    outDir: '../../dist/ui',
    emptyOutDir: false, // Don't wipe dist/ui completely, we still need preload.cjs there
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/ui/index.html'),
        settings: resolve(__dirname, 'src/ui/settings.html')
      }
    }
  },
  plugins: [
    tailwindcss(),
  ],
  server: {
    port: 5173,
    strictPort: true
  }
});
