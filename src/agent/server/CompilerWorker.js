import {parentPort} from 'node:worker_threads';
import {CompilerOperation} from '../core/CompilerOperation.js';
const operation = new CompilerOperation();
parentPort.on('message', ({id, files, command, options}) => {
  try { parentPort.postMessage({id, build: operation.perform(files, command, options)}); }
  catch (error) { parentPort.postMessage({id, error: {code: error.code ?? 'COMPILER_ERROR', message: error.message, span: error.span, notes: error.notes}}); }
});
