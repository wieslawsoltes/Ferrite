import {parentPort} from 'node:worker_threads';
import {CompilerSession} from '../../project/CompilerSession.js';
import {MirVirtualMachine} from '../../runtime/MirVirtualMachine.js';
const compiler = new CompilerSession();
const limits = {maxSteps: 2000000, maxTrace: 2000, maxDepth: 256, maxOutput: 1_000_000};
parentPort.on('message', ({id, files, command, options}) => {
  try {
    const execute = command.startsWith('agent-'), mode = command.slice(6);
    const build = compiler.compile(files, execute && mode === 'test' ? 'test' : execute ? 'build' : command, options);
    if (!execute || build.diagnostics.some(item => item.severity === 'error')) return parentPort.postMessage({id, build});
    if (mode === 'run') {
      const machine = new MirVirtualMachine(build.optimizedMir, {entry: build.entry, ...limits});
      const state = machine.run(); parentPort.postMessage({id, build: {backend: 'ferrite-mir', state, output: machine.runtime.output, diagnostics: build.diagnostics}});
    } else {
      const results = [];
      for (const test of build.tests) {
        if (test.ignore) { results.push({name: test.name, status: 'ignored'}); continue; }
        const machine = new MirVirtualMachine(build.optimizedMir, {entry: test.instance ?? test.key, ...limits});
        let error = null; try { machine.run(); } catch (failure) { error = {code: failure.code, message: failure.message}; }
        const panicked = !!error && !['R_BUDGET', 'R_STACK'].includes(error.code);
        const expected = test.shouldPanic ? panicked && (!test.expected || error.message.includes(test.expected)) : !error;
        results.push({name: test.name, status: expected ? 'passed' : 'failed', output: machine.runtime.output, error});
      }
      parentPort.postMessage({id, build: {backend: 'ferrite-mir', results, diagnostics: build.diagnostics}});
    }
  } catch (error) { parentPort.postMessage({id, error: {code: error.code ?? 'COMPILER_ERROR', message: error.message, span: error.span, notes: error.notes}}); }
});
