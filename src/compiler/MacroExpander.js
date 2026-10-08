import {Diagnostic} from './Diagnostic.js';

/** Built-in macro expansion to explicit intrinsics; no pretend macro_rules support. */
export class MacroExpander {
  static expand(ast) {
    const result = structuredClone(ast), expansions = [];
    const supported = new Set(['println', 'print', 'format', 'vec', 'assert', 'assert_eq', 'panic', 'dbg']);
    const visit = node => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(visit); return; }
      if (node.kind === 'call' && node.macro) {
        const name = node.callee.name;
        if (!supported.has(name)) throw new Diagnostic('F_MACRO', `Macro '${name}!' is not implemented by the browser backend`, node.span);
        node.kind = 'intrinsic'; node.name = name; delete node.callee; delete node.macro;
        expansions.push({name: `${name}!`, intrinsic: name, span: node.span, id: node.id});
      }
      for (const [key, value] of Object.entries(node)) if (!['span', 'loc'].includes(key)) visit(value);
    };
    visit(result);
    return {ast: result, expansions};
  }
}
