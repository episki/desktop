import { build } from 'esbuild'

// Build main process (CommonJS)
await build({
  entryPoints: ['src/main.ts'],
  bundle: false,  // Don't bundle, just transpile
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/main.js',
  sourcemap: true,
})

// Build preload script (CommonJS)
await build({
  entryPoints: ['src/preload.ts'],
  bundle: false,  // Don't bundle, just transpile
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/preload.js',
  sourcemap: true,
})

console.log('✓ Build complete')
