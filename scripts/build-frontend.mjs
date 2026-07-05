import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'dist', 'frontend');
const assetsDir = join(outDir, 'assets');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(assetsDir, { recursive: true });

const tscBin = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const tsc = spawnSync(process.execPath, [tscBin, '-p', join(root, 'tsconfig.frontend.json')], {
  cwd: root,
  stdio: 'inherit',
});
if (tsc.status !== 0) process.exit(tsc.status ?? 1);

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path);
    else if (extname(path) === '.js') rewriteImports(path);
  }
}

function rewriteImports(file) {
  let source = readFileSync(file, 'utf8');
  source = source.replace(/(from\s+['"])(\.{1,2}\/[^'"]+)(['"])/g, (_match, start, spec, end) => {
    if (/\.(js|css|json)$/.test(spec)) return `${start}${spec}${end}`;
    return `${start}${spec}.js${end}`;
  });
  source = source.replace(/(import\s*\(\s*['"])(\.{1,2}\/[^'"]+)(['"]\s*\))/g, (_match, start, spec, end) => {
    if (/\.(js|css|json)$/.test(spec)) return `${start}${spec}${end}`;
    return `${start}${spec}.js${end}`;
  });
  writeFileSync(file, source);
}

walk(assetsDir);

copyFileSync(join(root, 'frontend', 'app', 'styles.css'), join(outDir, 'styles.css'));
const html = readFileSync(join(root, 'index.html'), 'utf8')
  .replace('/frontend/app/styles.css', './styles.css')
  .replace('/frontend/app/main.ts', './assets/frontend/app/main.js');
writeFileSync(join(outDir, 'index.html'), html);

console.log(`Frontend build written to ${relative(root, outDir)}`);
