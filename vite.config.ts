import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'grapesjsPluginsManager',
      fileName: (format) =>
        format === 'umd' ? 'grapesjs-plugins-manager.umd.cjs' : 'grapesjs-plugins-manager.js',
      formats: ['es', 'umd'],
    },
    rollupOptions: {
      // GrapesJS itself is never bundled: the plugin runs against
      // whatever grapesjs instance the host page already loaded.
      // fflate (zip reader, ~8 KB) IS bundled, so no CDN script is needed.
      external: ['grapesjs'],
      output: {
        exports: 'named',
        globals: {
          grapesjs: 'grapesjs',
        },
      },
    },
    sourcemap: true,
  },
});
