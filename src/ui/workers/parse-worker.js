import {Lexer} from '../../compiler/Lexer.js';
import {Parser} from '../../compiler/Parser.js';

self.onmessage = ({data}) => {
  const {id, file, source} = data;
  try {
    if (typeof file !== 'string' || typeof source !== 'string' || source.length > 10 * 1024 * 1024) throw Error('Invalid parse input');
    const start = performance.now(), tokens = Lexer.tokenize(source, {file}), lexMs = performance.now() - start;
    const parseStart = performance.now(), ast = Parser.parse(tokens), parseMs = performance.now() - parseStart;
    self.postMessage({id, file, tokens, ast, lexMs, parseMs});
  } catch (error) {
    self.postMessage({id, file, error: error.toJSON?.() ?? {message: error.message, code: error.code ?? 'PARSE', span: error.span ?? null}});
  }
};
