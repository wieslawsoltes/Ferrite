import test from 'node:test';
import assert from 'node:assert/strict';
import {literalTextValue} from '../src/ui/studio/DesignerLiterals.js';
import {SourceDesigner} from '../src/ui-framework/SourceDesigner.js';
import {rustString} from '../src/ui-framework/ViewSyntax.js';

test('inspector reads repeated safe text edits, including Rust-only escapes and markup', () => {
  const designer = new SourceDesigner('fn app() -> ui::Node { view! { <h1>Initial</h1> } }', {validate: false});
  for (const value of ['First edit', '<button>{not code}</button>', 'Unicode 🦀\n\t\0\x01', '']) {
    const child = designer.nodes.find(node => node.tag === 'h1').children[0];
    designer.apply({op: 'setText', node: child.id, value}, designer.revision);
    const edited = designer.nodes.find(node => node.tag === 'h1').children[0];
    assert.equal(literalTextValue(edited), value);
    assert.equal(designer.nodes.filter(node => node.kind === 'element').length, 1);
  }
});
test('literal projection shares the Rust lexer and accepts raw strings/comments without evaluation', () => {
  for (const [value, expected] of [[rustString('A\x01\u007fB'), 'A\x01\u007fB'], ['r#"<markup>"#', '<markup>'], ['/* comment */ "literal"', 'literal']])
    assert.equal(literalTextValue({kind: 'expression', value}), expected);
  assert.equal(literalTextValue({kind: 'text', value: 'Prose'}), 'Prose');
});
test('calls, concatenation, byte strings, malformed and over-budget inputs remain dynamic', () => {
  for (const value of ['ui::get(state)', '"x" + "y"', 'b"bytes"', '42', '"unterminated', '"\\q"', '"' + 'x'.repeat(64000) + '"'])
    assert.equal(literalTextValue({kind: 'expression', value}), undefined, value.slice(0, 30));
  assert.equal(literalTextValue(null), undefined);
});
