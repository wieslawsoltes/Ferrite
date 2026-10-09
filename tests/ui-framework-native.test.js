import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeWasmHost, exportNativeHTML} from '../src/ui-framework/NativeWasm.js';
import {createUIRuntime} from '../src/ui-framework/Runtime.js';
import {createDocument} from './fixtures/ui-dom.js';
const header = [0,97,115,109,1,0,0,0];
const host = () => createNativeWasmHost(createUIRuntime());
const bounded = () => Uint8Array.from([...header,5,4,1,1,1,2]);
test('native wasm validates explicit memory maxima before instantiation', () => {
  const h = host(), bytes = bounded(); assert.deepEqual(h.validate(bytes), bytes); assert.notEqual(h.validate(bytes), bytes);
  for (const tail of [[],[5,3,1,0,1],[5,4,1,3,1,2],[5,5,1,1,1,0xff,0x7f],[8,1,0],[5,4,1,1,2,1]]) assert.throws(() => h.validate(Uint8Array.from([...header,...tail])));
  assert.throws(() => h.validate(new Uint8Array(9*1024*1024))); assert.throws(() => h.validate([1,2,3]));
});
test('native host rejects a non-UI wasm module and closes partial mounting', async () => {
  const h = host(); const doc = createDocument();
  await assert.rejects(h.mount(bounded(), doc.createElement('main')), /Unsupported native UI ABI/);
  assert.equal(h.inspect().disposed, true); h.dispose(); assert.throws(() => h.flush(), /disposed/);
});
test('native html is independent and escapes script/title/style terminators', () => {
  const html = exportNativeHTML(bounded(), {title: '</title><script>x</script>', css: '</script>bad'});
  assert.equal((html.match(/<script>/g) ?? []).length, 1);
  assert.equal((html.match(/<\/script>/g) ?? []).length, 1);
  assert.match(html, /&lt;\/title&gt;/); assert.match(html, /connect-src 'none'/);
  assert.match(html, /wasm-unsafe-eval/); assert.doesNotMatch(html, /script src=/);
  assert.throws(() => exportNativeHTML(bounded(), {channel: 'bad'}));
});
test('native SDK functions are available in the ESM and standalone surfaces', async () => {
  const {Ferrite} = await import('../src/sdk/Ferrite.js');
  for (const name of ['mountNativeUI','exportNativeHTML','createNativeWasmHost']) assert.equal(typeof Ferrite[name], 'function');
});
