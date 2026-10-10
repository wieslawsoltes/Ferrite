#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {RustFormatter, rustSignature, viewSignature} from './sample-format/RustFormatter.mjs';
import {formatCss} from './sample-format/CssFormatter.mjs';
import {literals, template, isRust} from './sample-format/EmbeddedSamples.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const formatter = new RustFormatter();
const changes = new Map();
let rustCount = 0, cssCount = 0;

function rust(source, label) {
  const formatted = formatter.format(source);
  assert.deepEqual(viewSignature(formatted), viewSignature(source), `${label}: rendered text or view structure changed`);
  assert.deepEqual(rustSignature(formatted), rustSignature(source), `${label}: non-formatting Rust change`);
  assert.equal(formatter.format(formatted), formatted, `${label}: formatter must be idempotent`);
  rustCount++;
  return formatted;
}
function update(file, formatted) {
  if (fs.readFileSync(path.join(root, file), 'utf8') !== formatted) changes.set(file, formatted);
}
function walk(directory) {
  for (const entry of fs.readdirSync(path.join(root,directory), {withFileTypes:true}).sort((a,b) => a.name.localeCompare(b.name))) {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) walk(file);
    else if (file.endsWith('.rs')) update(file, rust(fs.readFileSync(path.join(root,file),'utf8'), file));
    else if (file.endsWith('.css')) { update(file, formatCss(fs.readFileSync(path.join(root,file),'utf8'))); cssCount++; }
  }
}
walk('examples');
walk('rust-ui/example/src');
for (const file of ['src/samples.js', 'src/ui/model/SampleCatalog.js', 'src/ui-framework/Samples.js', 'src/ui/controllers/ProjectController.js']) {
  const original = fs.readFileSync(path.join(root,file),'utf8'); let output = original;
  for (const literal of literals(original).reverse()) {
    let next;
    if (isRust(literal.value)) next = rust(literal.value, `${file}:${original.slice(0,literal.start).split('\n').length}`);
    else if (/\b(?:UI_SAMPLE_CSS|EMPTY_CSS)\s*=\s*$/.test(original.slice(0,literal.start))) { next = formatCss(literal.value); cssCount++; }
    if (next !== undefined) output = output.slice(0,literal.start) + template(next) + output.slice(literal.end);
  }
  update(file, output);
}
// The standalone embedding example contains the same Rust/view! and CSS languages.
{
  const file = 'examples/ui-embed.html'; let output = fs.readFileSync(path.join(root,file),'utf8');
  output = output.replace(/(<script\b[^>]*type="text\/rust"[^>]*>)[\s\S]*?(<\/script>)/g, (match,open,close) => {
    const content = match.slice(open.length, -close.length);
    return open + '\n' + rust(content, file) + close;
  });
  output = output.replace(/<style>([\s\S]*?)<\/style>/g, (_,css) => { cssCount++; return '<style>\n' + formatCss(css) + '</style>'; });
  output = output.replace(/<script>([\s\S]*?)<\/script>/g, (match, body) => {
    let formatted = body;
    for (const literal of literals(body).reverse()) if (isRust(literal.value)) {
      const value = rust(literal.value, file + ':Rust script');
      formatted = formatted.slice(0,literal.start) + template(value) + formatted.slice(literal.end);
    }
    return '<script>' + formatted + '</script>';
  });
  update(file, output);
}
if (check && changes.size) {
  console.error('Sample formatting drift:\n' + [...changes.keys()].join('\n'));
  process.exitCode = 1;
} else if (!check) {
  // Every input is parsed and verified before the first write; a formatter failure
  // cannot publish a partially transformed catalog or truncate a sample source.
  for (const [file, contents] of changes) fs.writeFileSync(path.join(root,file), contents);
  for (const script of ['tools/build-seven-guis.mjs','tools/bundle-workers.mjs','tools/bundle-sdk.mjs']) {
    const result = spawnSync(process.execPath,[script],{cwd:root,stdio:'inherit'});
    if (result.error || result.status !== 0) throw Error(`Regeneration failed: ${script}`);
  }
}
console.log(`${check ? 'Checked' : 'Formatted'} ${rustCount} Rust sources and ${cssCount} sample stylesheets; ${changes.size} files ${check ? 'need changes' : 'updated'}.`);
