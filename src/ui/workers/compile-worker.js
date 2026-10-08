import {CompilerSession} from '../../project/CompilerSession.js';
const session = new CompilerSession();
self.onmessage = ({data}) => {
  try { self.postMessage({id: data.id, build: session.compile(data.files, data.command, data.options), revision: data.revision}); }
  catch (error) { self.postMessage({id: data.id, error: error.toJSON?.() ?? {message: error.message, code: error.code ?? 'COMPILER', span: error.span ?? null}}); }
};
