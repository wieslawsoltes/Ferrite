import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceSearch} from '../src/ui/services/WorkspaceSearch.js';
import {FileMask} from '../src/ui/services/FileMask.js';
import {ReplacePlan} from '../src/ui/model/ReplacePlan.js';
import {WorkspaceModel} from '../src/ui/model/WorkspaceModel.js';

const files = {'src/main.rs': 'fn main() { let value = 7; println!("{}", value); }', 'src/math.rs': 'pub fn value() -> u32 { 7 }', 'Cargo.toml': '[package]\nname="value"'};
const search = new WorkspaceSearch();
test('Find in Files returns deterministic source-spanned results across masks', async () => {
  const result = await search.find(files, 'value', {include: '**/*.rs', revision: 12});
  assert.equal(result.matches.length, 3); assert.equal(result.scannedFiles, 2); assert.equal(result.revision, 12);
  for (const m of result.matches) assert.equal(files[m.span.file].slice(m.span.start, m.span.end), 'value');
  const excluded = await search.find(files, 'value', {exclude: '**/math.rs', file: 'src/main.rs'});
  assert.equal(excluded.matches.length, 2);
});
test('Directory masks accept zero folders without matching suffixes inside a filename', () => {
  for (const [mask,path,expected] of [['**/*.rs','main.rs',true],['**/main.rs','src/main.rs',true],['**/main.rs','notmain.rs',false],['src/*','src/dir/a',false],['src/**','src/dir/a',true],['**/**/x','x',true],['**/a?c.rs','foo/abc.rs',true],['**/😀.rs','src/😀.rs',true]]) assert.equal(new FileMask(mask).test(path), expected, `${mask} matches ${path}`);
  assert.equal(new FileMask('*a'.repeat(100) + 'z').test('a'.repeat(1000)), false);
});
test('Unicode case-insensitive search preserves original UTF-16 spans', async () => {
  const text = '😀 İx Kelvin K abc ABC abc_ 𝒂abc';
  const result = await search.find({'main.rs': text}, 'abc', {wholeWord: true});
  assert.equal(result.matches.length, 2); assert.deepEqual(result.matches.map(m => m.text), ['abc', 'ABC']);
  for (const m of result.matches) assert.equal(text.slice(m.span.start, m.span.end), m.text);
  const kelvin = await search.find({'main.rs': text}, 'k'); assert.deepEqual(kelvin.matches.map(m => m.text), ['K','K']);
});
test('Search is literal, supports multiline text, and empty queries have no matches', async () => {
  const text = '[x].*\na\nb';
  assert.equal((await search.find({'a.rs': text}, '[x].*')).matches[0].text, '[x].*');
  const m = (await search.find({'a.rs': text}, 'a\nb')).matches[0]; assert.equal(m.span.line, 2); assert.equal(m.span.endLine, 3);
  assert.equal((await search.find(files, '')).matches.length, 0);
});
test('Search cancellation and truncation cannot produce a partial replace-all', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(search.find(files, 'value', {signal: controller.signal}), {name:'AbortError'});
  const result = await new WorkspaceSearch({maxResults:2}).find(files, 'value'); assert.equal(result.truncated,true); assert.equal(result.matches.length,2);
  assert.throws(() => new ReplacePlan(result,'renamed'), /truncated/);
});
test('Literal replacement previews do not mutate files and apply as one undoable transaction', async () => {
  const model = new WorkspaceModel(files);
  const result = await search.find(model.files,'value',{revision:model.revision,include:'**/*.rs'});
  const plan = new ReplacePlan(result,'$& renamed'); assert.deepEqual({...model.files},files);
  const revision = model.revision; assert.equal(plan.apply(model).length,2); assert.equal(model.revision,revision+1);
  assert.match(model.read('src/main.rs'),/\$& renamed/); assert.equal(model.read('Cargo.toml'),files['Cargo.toml']);
  assert.equal(model.undoTransaction(),true); assert.deepEqual({...model.files},files);
});
test('Replacement refuses intervening edits in any file, with no partial mutations', async () => {
  const model = new WorkspaceModel(files), result = await search.find(model.files,'value',{revision:model.revision});
  const plan = new ReplacePlan(result,'replacement'); model.update('Cargo.toml', '[package]\nname="changed"');
  assert.throws(() => plan.apply(model),/stale/); assert.equal(model.read('src/main.rs'),files['src/main.rs']);
});
test('Duplicate/overlapping spans and out-of-range replacement offsets are rejected', async () => {
  const result = await search.find(files,'value'); result.matches.splice(1,0,result.matches[0]); assert.throws(() => new ReplacePlan(result,'x'),/overlapping/);
});
test('Result-limit boundary is only truncated when an extra match actually exists', async () => {
  const result = await new WorkspaceSearch({maxResults:2}).find({'a.rs':'x x'},'x'); assert.equal(result.truncated,false);
  assert.equal(new ReplacePlan(result,'').after['a.rs'],' ');
});

test('Replacement growth is rejected before constructing an amplified output', async () => {
  const result = await new WorkspaceSearch().find({'a.rs':'x'.repeat(2000)},'x');
  assert.throws(() => new ReplacePlan(result,'a'.repeat(100000)), /text limit/);
  assert.equal(result.sources['a.rs'].length,2000);
});
