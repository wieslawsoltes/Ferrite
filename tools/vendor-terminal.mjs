/** Reproduce the vendored xterm distributions, or verify them without network access.
 * No package lifecycle scripts execute. Tarball SRI and every retained byte are pinned.
 */
import {readFile, writeFile, mkdtemp, rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const directory = fileURLToPath(new URL('../src/vendor/xterm/', import.meta.url));
const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
const check = process.argv.includes('--check');
if (process.argv.slice(2).some(arg => !['--check', '--fetch'].includes(arg)) || !check && !process.argv.includes('--fetch')) throw Error('Usage: node tools/vendor-terminal.mjs --check | --fetch');
const temporary = check ? null : await mkdtemp(join(tmpdir(), 'ferrite-terminal-vendor-'));
let count = 0;
try {
  for (const entry of manifest.packages) {
    let archive;
    if (!check) {
      const result = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', `${entry.name}@${entry.version}`], {cwd: temporary, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024}));
      archive = join(temporary, result[0].filename);
      const actual = 'sha512-' + createHash('sha512').update(await readFile(archive)).digest('base64');
      if (actual !== entry.integrity) throw Error('Upstream tarball integrity mismatch: ' + entry.name);
    }
    for (const file of entry.files) {
      if (!/^[a-zA-Z0-9.-]+$/.test(file.path) || file.source.includes('..') || file.source.startsWith('/')) throw Error('Unsafe vendor manifest path');
      const bytes = check ? await readFile(join(directory, file.path)) : execFileSync('tar', ['-xOf', archive, 'package/' + file.source], {maxBuffer: 8 * 1024 * 1024});
      if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw Error('Vendored file integrity mismatch: ' + file.path);
      if (!check) await writeFile(join(directory, file.path), bytes);
      count++;
    }
  }
} finally { if (temporary) await rm(temporary, {recursive: true, force: true}); }
console.log(`Verified ${count} vendored terminal files from ${manifest.packages.length} pinned MIT packages.`);
