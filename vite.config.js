import { defineConfig } from 'vite';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// copia le risorse di pdf.js (cmaps, font standard, wasm, profili ICC) e altre risorse statiche
function copyAssets() {
  return {
    name: 'leggio-copy-assets',
    writeBundle(opts) {
      const out = opts.dir || resolve('dist');
      const pdfjs = resolve('node_modules/pdfjs-dist');
      for (const d of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
        if (existsSync(resolve(pdfjs, d))) cpSync(resolve(pdfjs, d), resolve(out, 'pdfjs', d), { recursive: true });
      }
      // risorse aggiuntive delle feature (es. lingue OCR) in src/renderer/public-assets → dist/assets-extra
      const extra = resolve('src/renderer/public-assets');
      if (existsSync(extra)) { mkdirSync(resolve(out, 'assets-extra'), { recursive: true }); cpSync(extra, resolve(out, 'assets-extra'), { recursive: true }); }
    },
  };
}

export default defineConfig({
  root: 'src/renderer',
  base: './',
  build: { outDir: resolve('dist'), emptyOutDir: true, target: 'chrome130', chunkSizeWarningLimit: 4000, sourcemap: false },
  worker: { format: 'es' },
  plugins: [copyAssets()],
  server: { port: 5199, strictPort: true },
  test: { root: '.', include: ['test/**/*.test.js'], environment: 'node', setupFiles: ['test/setup.js'] },
});
