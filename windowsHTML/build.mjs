import { build } from 'esbuild';
import { resolve } from 'node:path';
await build({
  absWorkingDir: import.meta.dirname,
  entryPoints: ['src/main.tsx'],
  outfile: 'app.js',
  bundle: true, minify: true, format: 'iife',
  platform: 'browser', target: ['es2020'], jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  nodePaths: [resolve(import.meta.dirname, 'node_modules')],
  alias: { react: resolve(import.meta.dirname, 'node_modules/react'), 'react-dom': resolve(import.meta.dirname, 'node_modules/react-dom') },
});
