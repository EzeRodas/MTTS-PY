import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { resolve } from 'path';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/ui/main.ts')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/ui/preload.ts')
      }
    }
  },
  renderer: {
    root: 'src/ui',
    plugins: [tailwindcss()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/ui/index.html'),
          settings: resolve(__dirname, 'src/ui/settings.html')
        }
      }
    }
  }
});
