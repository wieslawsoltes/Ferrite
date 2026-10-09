import test from 'node:test';
import assert from 'node:assert/strict';
import {UIProject} from '../src/ui-framework/UIProject.js';
import {CanvasLayout} from '../src/ui-framework/CanvasLayout.js';
import {SourceDesigner} from '../src/ui-framework/SourceDesigner.js';
import {WorkspaceModel} from '../src/ui/model/WorkspaceModel.js';

const source = 'fn app() -> ui::Node { view! { <div style="position: relative"><button style="color:red; --text: \'a;b:c\'; width:20px;">Hello</button></div> } }';
test('UI sidecars and CSS persist with workspace reload and undo atomically', () => {
  const storage = new Map(), adapter = {setItem: (k, v) => storage.set(k, v), getItem: k => storage.get(k)};
  const model = new WorkspaceModel({'src/app.ui.rs': source}, {storage: adapter});
  const project = UIProject.load(model.files, 'src/app.ui.rs', {css: 'button { color: red; }'});
  const changes = project.changes({entry: 'app', backend: 'wasm', viewport: '375px', grid: 16}, 'button{color:blue}');
  model.applyWorkspaceTransaction(changes); model.save();
  const restored = new WorkspaceModel({'main.rs': 'fn main() {}'}, {storage: adapter}); assert.equal(restored.restore(), true);
  const loaded = UIProject.load(restored.files, 'src/app.ui.rs');
  assert.equal(loaded.settings.backend, 'wasm'); assert.equal(loaded.settings.viewport, '375px'); assert.equal(loaded.settings.grid, 16); assert.equal(loaded.css, 'button{color:blue}');
  assert.equal(model.undoTransaction(), true); assert.deepEqual(Object.keys(model.files), ['src/app.ui.rs']);
});
test('invalid manifests and stylesheet paths cannot overwrite source or bypass limits', () => {
  const files = {'src/app.rs': source}, project = UIProject.load(files, 'src/app.rs');
  for (const settings of [{version: 2}, {stylesheet: '../outside.css'}, {stylesheet: 'src/app.rs'}, {entryFile: 'other.rs'}, {backend: 'eval'}, {grid: 0}, {unknown: 1}]) assert.throws(() => project.changes(settings));
  assert.throws(() => project.changes({}, 'x'.repeat(500001)));
  assert.throws(() => UIProject.load({...files, 'src/app.ui.json': '{bad json'}, 'src/app.rs'));
  assert.throws(() => UIProject.load({}, 'missing.rs'));
});
test('source canvas rectangles snap, preserve unrelated declarations and round-trip through typed compilation', () => {
  const designer = new SourceDesigner(source), button = designer.nodes.find(node => node.tag === 'button');
  const result = designer.apply({op: 'setLayout', node: button.id, rectangle: {x: 13, y: 19, width: 81, height: 23}, grid: 8, snap: true}, 0);
  assert.match(result.source, /left: 16px; top: 16px; width: 80px; height: 24px;/);
  assert.match(result.source, /color:red; --text: 'a;b:c';/);
  assert.equal(result.source.includes('width:20px'), false); assert.ok(result.dependencies.includes('src/app.ui.rs'));
  assert.equal(designer.undo(1).source, source); assert.equal(designer.redo(2).source, result.source);
});
test('CSS scanner handles comments, function semicolons, escapes, empty declarations and duplicates', () => {
  const css = String.raw`;color: red; /* note */ --x: "a;\"b:c"; background: fn(a;b); left:1px;left:2px;;`;
  const result = CanvasLayout.style(css, {x: -1.25, y: 2, width: 5, height: 6});
  assert.match(result, /color: red/); assert.match(result, /fn\(a;b\)/); assert.equal((result.match(/left:/g) ?? []).length, 1);
  for (const css of ['width', 'color:"broken', '/* open', 'transform: scale(2);', 'inset-inline:10px;', 'a{color:red}']) assert.throws(() => CanvasLayout.style(css, {x: 0, y: 0, width: 1, height: 1}));
});
test('canvas rejects invalid geometry and dynamic Rust styles without editing source', () => {
  const dynamic = 'fn app() -> ui::Node { let style = "width:1px"; view! { <div style={style} /> } }', designer = new SourceDesigner(dynamic);
  assert.throws(() => designer.apply({op: 'setLayout', node: designer.nodes[0].id, rectangle: {x: 0, y: 0, width: 10, height: 10}}, 0), /Dynamic/); assert.equal(designer.source, dynamic);
  for (const value of [{x: NaN, y: 0, width: 1, height: 1}, {x: 0, y: 0, width: 0, height: 1}, {x: 1, y: 2, width: 1, height: 1, z: 2}]) assert.throws(() => CanvasLayout.geometry(value));
});
