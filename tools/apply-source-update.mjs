// Temporary publication transport; removed when the current source batches finish.
import {readFile, writeFile, readdir, mkdir, rm, lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {resolve, dirname} from 'node:path';
const root = process.cwd(), directory = '.github/source-updates';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const names = (await readdir(directory)).filter(name => /^\d+-[a-z-]+\.b64$/.test(name)).sort();
if (!names.length) throw Error('No reviewed source update');
const messages = [];
for (const name of names) {
  const encoded = await readFile(`${directory}/${name}`, 'utf8');
  if (encoded.length > 2_000_000) throw Error('Oversized source update');
  const patch = encoded.trimStart().startsWith('{') ? JSON.parse(encoded) : JSON.parse(gunzipSync(Buffer.from(encoded, 'base64'), {maxOutputLength: 8_000_000}));
  if (patch.format !== 'ferrite-source-update-v1' || !Array.isArray(patch.files) || patch.files.length > 128) throw Error('Invalid update format');
  if (typeof patch.message !== 'string' || /[\r\n]/.test(patch.message)) throw Error('Invalid commit message');
  const prepared = [], seen = new Set();
  for (const file of patch.files) {
    if (typeof file.path !== 'string' || file.path.includes('..') || !/^(src\/|tests\/|tools\/|styles\/|docs\/|examples\/|README\.md$|index\.html$|package(?:-lock)?\.json$|\.gitignore$)/.test(file.path) || seen.has(file.path)) throw Error('Invalid source path');
    seen.add(file.path);
    const target = resolve(root, file.path);
    if (!target.startsWith(root + '/')) throw Error('Path escapes repository');
    for (let path = target; path !== root; path = dirname(path)) {
      try { if ((await lstat(path)).isSymbolicLink()) throw Error('Source symlink rejected'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    let original = null;
    try { original = await readFile(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if ((original === null ? null : hash(original)) !== file.before) throw Error(`Concurrent change: ${file.path}`);
    let output;
    if (file.edits !== undefined) {
      if (!original || !Array.isArray(file.edits)) throw Error('Invalid source edits');
      const chunks = []; let cursor = 0;
      for (const edit of file.edits) {
        if (!Number.isSafeInteger(edit.start) || !Number.isSafeInteger(edit.end) || edit.start < cursor || edit.end < edit.start || edit.end > original.length || typeof edit.text !== 'string') throw Error('Invalid source edit range');
        chunks.push(original.subarray(cursor, edit.start), Buffer.from(edit.text)); cursor = edit.end;
      }
      chunks.push(original.subarray(cursor)); output = Buffer.concat(chunks);
    } else {
      if (file.content !== null && typeof file.content !== 'string') throw Error('Invalid source content');
      output = file.content === null ? null : Buffer.from(file.content);
    }
    if ((output === null ? null : hash(output)) !== file.after) throw Error(`Output checksum mismatch: ${file.path}`);
    prepared.push({target, output});
  }
  for (const {target, output} of prepared) {
    if (output === null) await rm(target); else { await mkdir(dirname(target), {recursive: true}); await writeFile(target, output); }
  }
  await rm(`${directory}/${name}`); messages.push(patch.message);
  console.log(`Applied ${prepared.length} exact-content source updates`);
}
if (process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT, `message=${messages.join('; ')}\n`, {flag: 'a'});
