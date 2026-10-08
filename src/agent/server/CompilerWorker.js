import {parentPort} from 'node:worker_threads';
import {CompilerSession} from '../../project/CompilerSession.js';
const compiler = new CompilerSession();
parentPort.on('message', ({id, files, command, options}) => {
  try { parentPort.postMessage({id, build: compiler.compile(files, command, options)}); }
  catch (error) { parentPort.postMessage({id, error: {code: error.code ?? 'COMPILER_ERROR', message: error.message, span: error.span, notes: error.notes}}); }
});
