import {exportHydratedHTML} from '../../ui-framework/ServerRenderer.js';
import {UICompiler} from '../../ui-framework/UICompiler.js';
import {SourceDesigner} from '../../ui-framework/SourceDesigner.js';
import {exportHTML} from '../../ui-framework/Export.js';
import {CompilerSession} from '../../project/CompilerSession.js';
import {MirVirtualMachine} from '../../runtime/MirVirtualMachine.js';

/** Pure compiler operation shared by Node worker_threads and isolated browser workers. */
export class CompilerOperation {
  constructor() { this.compiler = new CompilerSession(); }
  perform(files, command, options = {}) {
    if (command.startsWith('ui-')) {
      const {file = 'src/app.ui.rs', entry = 'app', backend = 'javascript', title, css, channel, operation, entryFile = file, revision = 0} = options;
      if (!Object.hasOwn(files, file)) throw Error('UI source file does not exist');
      const source = files[file];
      if (command === 'ui-design') {
        const designer = new SourceDesigner(source, {file, entry, entryFile, revision, files});
        return operation ? designer.apply(operation, revision) : designer.snapshot();
      }
      if (!['ui-compile', 'ui-export', 'ui-analyze', 'ui-render'].includes(command)) throw Error('Unknown UI compiler operation');
      const {inspection: build, ...artifact} = UICompiler.compile(source, {file, entry, files,
        optimize: options.optimize !== false, inspection: options.inspection === true, maxSteps: options.maxSteps ?? 250000});
      const results = build ? {build} : {};
      if (command === 'ui-render') return {...results, html: exportHydratedHTML(artifact, {backend, title, css, identifierPrefix: options.identifierPrefix ?? ''}), file, entry: artifact.entry, execution: 'server-rendered Rust; effects and refs suppressed'};
      if (command === 'ui-export') return {...results, html: exportHTML(artifact, {backend, title, css, channel}), file, entry: artifact.entry};
      if (command === 'ui-analyze') return {...results, file, entry: artifact.entry, nodes: artifact.nodes, diagnostics: artifact.diagnostics,
        verification: artifact.verification, timings: artifact.timings, backends: ['javascript', 'wasm', 'mir'],
        compatibility: 'Ferrite Rust subset and independent React-shaped runtime; not rustc or complete React compatibility'};
      return {...results, artifact, html: exportHTML(artifact, {backend, title, css, channel})};
    }
    const execute = command.startsWith('agent-'), mode = command.slice(6);
    if (execute && !['run', 'test'].includes(mode)) throw Error('Unknown compiler execution command');
    const build = this.compiler.compile(files, execute ? mode === 'test' ? 'test' : 'build' : command, options);
    if (!execute || build.diagnostics.some(item => item.severity === 'error')) return build;
    const limits = {maxSteps: 2000000, maxTrace: 2000, maxDepth: 256, maxOutput: 1_000_000};
    if (mode === 'run') {
      const machine = new MirVirtualMachine(build.optimizedMir, {entry: build.entry, ...limits});
      const state = machine.run();
      return {backend: 'ferrite-mir', state, output: machine.runtime.output, diagnostics: build.diagnostics};
    }
    const results = [];
    for (const test of build.tests) {
      if (test.ignore) { results.push({name: test.name, status: 'ignored'}); continue; }
      const machine = new MirVirtualMachine(build.optimizedMir, {entry: test.instance ?? test.key, ...limits});
      let error = null; try { machine.run(); } catch (failure) { error = {code: failure.code, message: failure.message}; }
      const panicked = !!error && !['R_BUDGET', 'R_STACK'].includes(error.code);
      const expected = test.shouldPanic ? panicked && (!test.expected || error.message.includes(test.expected)) : !error;
      results.push({name: test.name, status: expected ? 'passed' : 'failed', output: machine.runtime.output, error});
    }
    return {backend: 'ferrite-mir', results, diagnostics: build.diagnostics};
  }
}
