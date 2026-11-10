import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineConfig, type Plugin} from 'vite';
import {spawnSync} from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));

function backendCodePlugin(): Plugin {
  return {
    name: 'generate-backend-code',
    buildStart() {
      const script = path.join(here, 'scripts', 'generate-backend-code.mjs');
      const r = spawnSync(process.execPath, [script], {stdio: 'inherit'});
      if (r.status !== 0) {
        throw new Error('generate-backend-code failed');
      }
    },
  };
}

export default defineConfig({
  plugins: [backendCodePlugin(), react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.join(here, 'src'),
    },
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
});
