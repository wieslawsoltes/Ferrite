import {UIProject} from '../ui-framework/UIProject.js';
import {CanvasLayout} from '../ui-framework/CanvasLayout.js';
import {SourceDesigner} from '../ui-framework/SourceDesigner.js';
import {compile} from '../engine.js';
import {JavaScriptEmitter} from '../compiler/JavaScriptEmitter.js';
import {MirVirtualMachine} from '../runtime/MirVirtualMachine.js';
import {WebAssemblyRuntime} from '../runtime/WebAssemblyRuntime.js';
import {UICompiler} from '../ui-framework/UICompiler.js';
import {UISession} from '../ui-framework/UISession.js';
import {exportHTML} from '../ui-framework/Export.js';
import {UI, createUIRuntime} from '../ui-framework/Runtime.js';

/** Embeddable compiler API. Does not scan or execute page scripts implicitly. */
export function compileRust(source, options = {}) { return compile(source, options); }
export function compileUI(source, options = {}) { return UICompiler.compile(source, options); }
export function mountUI(sourceOrArtifact, container, options = {}) {
  const {runtime, backend, maxHandles, maxTrace, onError, ...compileOptions} = options;
  const artifact = typeof sourceOrArtifact === 'string' ? compileUI(sourceOrArtifact, compileOptions) : sourceOrArtifact;
  return new UISession(artifact, {runtime, backend, maxHandles, maxTrace, onError}).mount(container);
}
export function runRust(sourceOrArtifact, {backend = 'mir', entry, args = [], ...options} = {}) {
  const artifact = typeof sourceOrArtifact === 'string' ? compileRust(sourceOrArtifact, {...options, ...(entry ? {entry} : {})}) : sourceOrArtifact;
  const target = entry ? artifact.optimizedMir.find(fn => fn.instance === entry || fn.instance === `${entry}<>`)?.instance : artifact.entry;
  if (!target) throw Error('Missing Rust entry point');
  if (backend === 'mir') { const vm = new MirVirtualMachine(artifact.optimizedMir, {entry: target, args, ...options}); vm.run(); return {value: vm.result, output: vm.runtime.output, steps: vm.runtime.steps, debugger: vm}; }
  if (backend === 'wasm') return new WebAssemblyRuntime(artifact.wasm, options).run({entry: target, args});
  if (backend === 'javascript') {
    const program = new Function(new JavaScriptEmitter(artifact.optimizedMir, {entry: null, library: true, runtime: options}).build().code)();
    const value = program.functions[target](...args); return {value, output: program.runtime.output, steps: program.runtime.steps};
  }
  throw Error('Unknown Rust backend');
}
const executed = new WeakSet();
/** Explicit, inline-only scripts. Call after DOM construction; no network loads. */
export function runScripts({document: doc = globalThis.document, root = doc, onError = null, backend = 'javascript'} = {}) {
  if (!doc || !root?.querySelectorAll) throw Error('A DOM document is required');
  const results = [];
  for (const script of root.querySelectorAll('script[type="text/rust"],script[type="application/rust"]')) {
    if (executed.has(script)) continue;
    try {
      if (script.hasAttribute('src')) throw Error('Rust scripts are inline-only; fetch source explicitly in the embedding application');
      if (script.textContent.length > 512000) throw Error('Rust script exceeds its source budget');
      const targetId = script.dataset.target, source = script.textContent;
      let result;
      if (targetId) {
        const target = doc.getElementById(targetId); if (!target) throw Error(`Rust UI target ${targetId} does not exist`);
        result = mountUI(source, target, {backend: script.dataset.backend ?? backend, entry: script.dataset.entry ?? 'app'});
      } else result = runRust(source, {backend: script.dataset.backend ?? backend, entry: script.dataset.entry ?? 'main'});
      executed.add(script); results.push({script, result});
    } catch (error) { if (!onError) throw error; onError(error, script); results.push({script, error}); }
  }
  return results;
}
export const Ferrite = Object.freeze({version: '0.1.0', compileRust, compileUI, mountUI, runRust, runScripts, exportHTML, UI, createUIRuntime, SourceDesigner, UIProject, CanvasLayout});
export {exportHTML, UI, createUIRuntime, SourceDesigner, UICompiler, UISession, UIProject, CanvasLayout};
