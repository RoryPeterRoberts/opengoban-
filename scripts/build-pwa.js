#!/usr/bin/env node
/**
 * Build script for Cell Protocol PWA
 *
 * Compiles TypeScript Cell Protocol into browser-compatible JavaScript
 */

const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const isWatch = process.argv.includes('--watch');

async function build() {
  const outdir = path.join(__dirname, '../pwa/js');

  // Ensure output directory exists
  if (!fs.existsSync(outdir)) {
    fs.mkdirSync(outdir, { recursive: true });
  }

  const buildOptions = {
    entryPoints: [path.join(__dirname, '../src/cell-protocol/browser.ts')],
    bundle: true,
    outfile: path.join(outdir, 'cell-protocol.js'),
    format: 'iife',
    globalName: 'CellProtocol',
    platform: 'browser',
    target: ['es2020'],
    sourcemap: true,
    minify: !isWatch,
    define: {
      'process.env.NODE_ENV': isWatch ? '"development"' : '"production"',
    },
    external: ['pouchdb'], // PouchDB loaded separately
  };

  if (isWatch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log('Watching for changes...');
  } else {
    const result = await esbuild.build(buildOptions);
    console.log('Build complete!');
    console.log(`Output: ${buildOptions.outfile}`);

    // Report size
    const stats = fs.statSync(buildOptions.outfile);
    console.log(`Size: ${(stats.size / 1024).toFixed(1)} KB`);
  }
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
