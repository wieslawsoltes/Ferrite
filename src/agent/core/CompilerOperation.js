import {CompilerSession} from '../../project/CompilerSession.js';
import {MirVirtualMachine} from '../../runtime/MirVirtualMachine.js';

/** Pure compiler operation shared by Node worker_threads and isolated browser workers. */
export class CompilerOperation {
  constructor() { this.compiler = new CompilerSession(); }
  perform(files, command, options = {}) {
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
