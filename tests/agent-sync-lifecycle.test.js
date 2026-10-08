import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceModel} from '../src/ui/model/WorkspaceModel.js';
import {WorkspaceSynchronizer} from '../src/ui/agent/WorkspaceSynchronizer.js';
const model=()=>new WorkspaceModel({'Cargo.toml':'[package]\nname="test"\nversion="0.1.0"\n','src/main.rs':'fn main() {}\n','data.txt':'beta\nalpha\nalpha\n'});
function syncFixture(){const m=model();let remote={root:'/workspace',files:{...m.files},hashes:Object.fromEntries(Object.keys(m.files).map(key=>[key,'hash:'+m.files[key]]))};const writes=[];const client={url:'http://127.0.0.1',request:async(path,data)=>{if(!data)return structuredClone(remote);writes.push(data);const changes=[];for(const edit of data.changes){assert.equal(edit.expectedHash,remote.hashes[edit.path]??null);if(edit.text===null){delete remote.files[edit.path];delete remote.hashes[edit.path];}else{remote.files[edit.path]=edit.text;remote.hashes[edit.path]='hash:'+edit.text;}changes.push({path:edit.path,afterHash:remote.hashes[edit.path]??null});}return {changes};}};const sync=new WorkspaceSynchronizer(m,client);return {m,remote,writes,sync,client};}

test('workspace import refuses edits made while native files are loading', async () => {
  const f = syncFixture(), request = f.client.request;
  f.client.request = async (...args) => {
    const result = await request(...args);
    f.m.update('data.txt', 'typed while importing');
    return result;
  };
  await assert.rejects(f.sync.import(), /changed during import/);
  assert.equal(f.m.files['data.txt'], 'typed while importing');
  assert.equal(f.sync.enabled, false);
  f.sync.disconnect();
});

test('disconnect invalidates an in-flight workspace import', async () => {
  const f = syncFixture(), request = f.client.request;
  f.client.request = async (...args) => {
    const result = await request(...args);
    f.sync.disconnect();
    return result;
  };
  assert.equal(await f.sync.import(), null);
  assert.equal(f.sync.enabled, false);
  assert.equal(f.sync.baseline, null);
});

test('disconnect invalidates incoming sync reads without stale workspace mutations', async () => {
  const f = syncFixture();
  await f.sync.import();
  f.remote.files['data.txt'] = 'remote change';
  const request = f.client.request;
  f.client.request = async (...args) => {
    const result = await request(...args);
    f.sync.disconnect();
    return result;
  };
  await f.sync.sync();
  assert.equal(f.m.files['data.txt'], 'beta\nalpha\nalpha\n');
  assert.equal(f.sync.baseline, null);
});

test('disconnect during native write never installs incoming files in another editor workspace', async () => {
  const f = syncFixture();
  await f.sync.import();
  f.m.update('src/main.rs', 'outgoing');
  f.remote.files['data.txt'] = 'remote change';
  const request = f.client.request;
  f.client.request = async (...args) => {
    const result = await request(...args);
    if (args[1]) { f.sync.disconnect(); f.m.replace({'different.txt': 'other project'}); }
    return result;
  };
  await f.sync.sync();
  assert.deepEqual({...f.m.files}, {'different.txt': 'other project'});
  assert.equal(f.remote.files['src/main.rs'], 'outgoing'); // Already committed, not blindly retried.
  assert.equal(f.writes.length, 1);
  assert.equal(f.sync.baseline, null);
});


test('replacing a browser project detaches agent sync instead of writing into the old checkout', async () => {
  const f = syncFixture();
  await f.sync.import();
  const original = structuredClone(f.remote.files);
  f.m.replace({'src/main.rs': 'fn main() { /* unrelated project */ }'});
  await f.sync.sync();
  assert.equal(f.sync.enabled, false);
  assert.deepEqual(f.remote.files, original);
  assert.equal(f.writes.length, 0);
  f.sync.dispose();
});
