import {Lexer} from '../../compiler/Lexer.js';

/** Decode only a literal; never evaluate Rust expressions to populate an inspector. */
export function literalTextValue(node) {
  if (node?.kind === 'text') return node.value;
  if (node?.kind !== 'expression' || typeof node.value !== 'string' || node.value.length > 64000) return undefined;
  try {
    const tokens = Lexer.tokenize(node.value, {maxTokens: 3});
    if (tokens.length === 2 && tokens[0].kind === 'string' && tokens[1].kind === 'eof')
      return Lexer.decode(tokens[0].value);
  } catch { /* Dynamic, incomplete and invalid expressions remain source-authored. */ }
  return undefined;
}
