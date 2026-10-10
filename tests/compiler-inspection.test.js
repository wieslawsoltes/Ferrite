import test from 'node:test';
import assert from 'node:assert/strict';
import {CompilerOperation} from '../src/agent/core/CompilerOperation.js';
import {CompilerSession} from '../src/project/CompilerSession.js';
import {UICompiler} from '../src/ui-framework/UICompiler.js';
import {MirVerifier} from '../src/compiler/MirVerifier.js';
import {SampleProjects} from '../src/ui/model/SampleProjects.js';

const samples = SampleProjects.all.filter(sample => sample.kind === 'ui');
const counter = samples.find(sample => sample.id === '7guis-counter');
const options = sample => ({file: sample.entry, inspection: true});

for (const sample of samples) test(`${sample.title}: inspector receives the actual linked preview program`, () => {
  const {build, artifact, html} = new CompilerOperation().perform(sample.files, 'ui-compile', options(sample));
  assert.equal(build.frontend, 'rust-ui');
  assert.equal(build.file, sample.entry);
  assert.equal(build.entry, artifact.entry);
  assert.equal(build.stages.length, 21);
  assert.equal(build.stages.find(stage => stage.kind === 'cfg').data, artifact.mir);
  assert.equal(build.stages.find(stage => stage.name === 'Optimized MIR').data, artifact.optimizedMir);
  assert.equal(build.stages.find(stage => stage.name === 'JavaScript').data.code, artifact.js);
  assert.equal(build.stages.find(stage => stage.name === 'WebAssembly').data, artifact.wasm);
  assert.deepEqual(build.verification, MirVerifier.verify(artifact.optimizedMir));
  assert.deepEqual(build.stages.find(stage => stage.kind === 'callgraph').data.roots, [artifact.entry]);
  assert.ok(artifact.mir.flatMap(fn => fn.blocks).flatMap(block => block.instructions).some(instruction => instruction.name === 'ferrite.ui.v1'));
  assert.equal(build.stages.some(stage => stage.kind === 'cargo'), false, 'do not invent a Cargo plan for a UI project');
  assert.ok(build.elapsedMs > 0);
  assert.ok(build.timings.some(pass => pass.name === 'Link UI ABI / verify'));
  assert.ok(build.timings.every(pass => Number.isFinite(pass.ms) && pass.ms >= 0));
  assert.equal(build.cache.parsedFiles, Object.keys(artifact.files).length);
  assert.ok(build.unit.files.every(unit => unit.source === sample.files[unit.file]));
  assert.ok(html.startsWith('<!doctype html>'));
  assert.equal(Object.hasOwn(artifact, 'inspection'), false, 'worker transport does not duplicate the inspection graph');
  const cloned = structuredClone({build, artifact});
  assert.equal(cloned.build.mir, cloned.artifact.mir, 'structured clone preserves shared artifact identity');
});

for (const command of ['ui-analyze', 'ui-export', 'ui-render']) test(`${command}: optional IDE results survive the worker operation without bloating exported HTML`, () => {
  const worker = new CompilerOperation();
  const result = worker.perform(counter.files, command, options(counter));
  const plain = worker.perform(counter.files, command, {file: counter.entry});
  assert.ok(result.build?.stages.length);
  assert.equal(plain.build, undefined);
  if (result.html) assert.equal(result.html, plain.html, 'inspector metadata is not shipped to the isolated app');
});

test('UI inspection uses all original module source maps and honors optimization settings', () => {
  const file = 'src/app.ui.rs', helper = 'src/components.rs';
  const files = {[file]: 'mod components; fn app() -> ui::Node { components::card() }',
    [helper]: 'pub fn card() -> ui::Node { view! { <button>Click</button> } }'};
  const {build} = new CompilerOperation().perform(files, 'ui-analyze', {file, inspection: true, optimize: false});
  assert.equal(build.optimize, false);
  assert.equal(build.optimizations.length, 0);
  assert.deepEqual(build.unit.modules.sort(), Object.keys(files).sort());
  assert.ok(build.tokens.some(token => token.span.file === helper));
  for (const token of build.tokens) {
    assert.ok(Object.hasOwn(files, token.span.file));
    assert.ok(token.span.start >= 0 && token.span.end <= files[token.span.file].length);
  }
  assert.ok(build.stages.find(stage => stage.name === 'UI source nodes').data.some(node => node.span.file === helper));
});

test('SDK callers do not pay for inspection unless requested', () => {
  const artifact = UICompiler.compile(counter.files[counter.entry], {file: counter.entry, files: counter.files});
  assert.equal(Object.hasOwn(artifact, 'inspection'), false);
});

test('the shared stage contract preserves ordinary Cargo compilation and exact-cache results', () => {
  const session = new CompilerSession(), files = {'Cargo.toml': '[package]\nname = "inspection"\nversion = "0.1.0"\nedition = "2021"\n', 'src/main.rs': 'fn main() { println!("ready"); }'};
  for (let i = 0; i < 2; i++) {
    const build = session.compile(files);
    assert.equal(build.stages.length, 21);
    assert.equal(build.stages[0].name, 'Cargo');
    assert.equal(build.stages.find(stage => stage.name === 'MIR / CFG').data, build.mir);
    assert.equal(build.stages.find(stage => stage.name === 'JavaScript').data.code, build.js);
    assert.equal(build.cacheHit, i === 1);
    assert.equal(build.stages.find(stage => stage.kind === 'queries').data.projectCacheHit === true, i === 1);
  }
});
