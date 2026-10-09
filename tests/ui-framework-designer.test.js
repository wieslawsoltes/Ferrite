import test from 'node:test';
import assert from 'node:assert/strict';
import {SourceDesigner} from '../src/ui-framework/SourceDesigner.js';
import {CompilerOperation} from '../src/agent/core/CompilerOperation.js';
const source = '// preserve this comment\nfn app() -> ui::Node { view! { <div className="old"><p>A</p><section><b>B</b></section><input /></div> } }\n// keep trailing trivia\n';
const find = (designer, tag) => designer.nodes.find(node => node.tag === tag).id;

test('attribute edits preserve unrelated source and maintain undo/redo revisions', () => {
  const designer = new SourceDesigner(source), id = find(designer, 'div');
  const result = designer.apply({op: 'setAttribute', node: id, name: 'className', value: 'new'}, 0);
  assert.equal(result.source, source.replace('className="old"', 'className="new"')); assert.equal(result.revision, 1);
  assert.equal(designer.undo(1).source, source); assert.equal(designer.redo(2).source, result.source);
  assert.throws(() => designer.apply({op: 'remove', node: id}, 0), e => e.code === 'F_UI_REVISION');
});
test('invalid typed edits are atomic and root deletion is forbidden', () => {
  const designer = new SourceDesigner(source);
  assert.throws(() => designer.apply({op: 'setAttribute', node: find(designer, 'p'), name: 'on:click', kind: 'expression', value: '123'}, 0));
  assert.equal(designer.source, source); assert.equal(designer.revision, 0);
  assert.throws(() => designer.apply({op: 'remove', node: find(designer, 'div')}, 0), /root/);
});
test('insert expands self-closing elements and reparent preserves exact child text', () => {
  const designer = new SourceDesigner(source.replace('<input />', '<aside />'));
  designer.apply({op: 'insert', node: find(designer, 'aside'), markup: '<p>C</p>'}, 0);
  assert.ok(designer.source.includes('<aside ><p>C</p></aside>'));
  designer.apply({op: 'move', node: find(designer, 'b'), parent: find(designer, 'div'), before: find(designer, 'p')}, 1);
  assert.ok(designer.source.includes('<div className="old"><b>B</b><p>A</p><section></section>')); assert.ok(designer.source.endsWith('// keep trailing trivia\n'));
});
test('cycles, cross-parent anchors and stale node IDs reject without mutation', () => {
  const designer = new SourceDesigner(source);
  assert.throws(() => designer.apply({op: 'move', node: find(designer, 'section'), parent: find(designer, 'b')}, 0), /descendant/);
  assert.throws(() => designer.apply({op: 'insert', node: find(designer, 'p'), before: find(designer, 'b'), markup: 'x'}, 0), /direct child/);
  assert.throws(() => designer.apply({op: 'remove', node: 'v999999'}, 0), /stale/); assert.equal(designer.source, source);
});
test('text edits quote markup-like content as Rust strings; tag edits change both delimiters', () => {
  const designer = new SourceDesigner(source), text = designer.nodes.find(node => node.kind === 'text' && node.value === 'A');
  designer.apply({op: 'setText', node: text.id, value: '<x>{evil}\n"hi"'}, 0);
  assert.ok(designer.source.includes('{"<x>{evil}\\n\\"hi\\""}'));
  designer.apply({op: 'setTag', node: find(designer, 'p'), value: 'h2'}, 1); assert.ok(designer.source.includes('<h2>')); assert.ok(designer.source.includes('</h2>'));
});
test('duplicate, removeAttribute and delete produce valid source', () => {
  const designer = new SourceDesigner(source);
  designer.apply({op: 'duplicate', node: find(designer, 'p')}, 0); assert.ok(designer.source.includes('<p>A</p><p>A</p>'));
  designer.apply({op: 'removeAttribute', node: find(designer, 'div'), name: 'className'}, 1);
  designer.apply({op: 'remove', node: find(designer, 'section')}, 2); assert.ok(!designer.source.includes('className')); assert.ok(!designer.source.includes('<section>'));
});
test('UI compiler operations share deterministic analysis/design/export implementations', () => {
  const operation = new CompilerOperation(), files = {'src/app.ui.rs': source};
  assert.equal(operation.perform(files, 'ui-analyze').entry, 'app<>');
  const tree = operation.perform(files, 'ui-design'); assert.equal(tree.source, source);
  assert.ok(operation.perform(files, 'ui-export').html.startsWith('<!doctype html>'));
  assert.throws(() => operation.perform(files, 'ui-unknown'));
});
