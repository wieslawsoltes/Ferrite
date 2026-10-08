import {CompilerOperation} from '../../agent/core/CompilerOperation.js';
const operation = new CompilerOperation();
self.onmessage = ({data: {id, files, command, options}}) => {
  try { self.postMessage({id, build: operation.perform(files, command, options)}); }
  catch (error) { self.postMessage({id, error: {code: error.code ?? 'COMPILER_ERROR', message: error.message, span: error.span, notes: error.notes}}); }
};
