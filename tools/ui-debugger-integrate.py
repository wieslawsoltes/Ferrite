"""One-time, exact-tree-verified merge resolution; removed before committing."""
from pathlib import Path
import os
import re
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
def run(*args, **kwargs):
    return subprocess.run(args, cwd=root, check=True, **kwargs)

base = 'dad648747175bb5a04c8419704741738ae4bcc88'
merged = subprocess.run(['git', 'merge', '--no-commit', '--no-ff', base], cwd=root)
conflicts = set(run('git', 'diff', '--name-only', '--diff-filter=U', capture_output=True, text=True).stdout.splitlines())
expected = {'src/ui/IdeApplication.js', 'src/ui/controllers/UICommandController.js', 'src/ui/studio/StudioPreview.js', 'src/ui/studio/StudioProject.js', 'src/sdk/ferrite.bundle.js', 'src/ui/workers/agent-compiler-worker.bundle.js', 'src/ui/workers/compile-worker.bundle.js'}
if merged.returncode != 1 or conflicts != expected:
    raise SystemExit(f'Unexpected merge conflict set: {conflicts}')

def conflict(path, combine, count):
    p = root / path
    s = p.read_text()
    pattern = r'<<<<<<< HEAD\n(.*?)=======\n(.*?)>>>>>>>[^\n]*\n'
    found = list(re.finditer(pattern, s, re.S))
    if len(found) != count:
        raise SystemExit(f'Unexpected conflict structure in {path}')
    for n, match in reversed(list(enumerate(found))):
        s = s[:match.start()] + combine(match.group(1), match.group(2), n) + s[match.end():]
    p.write_text(s)

conflict('src/ui/IdeApplication.js', lambda a,b,n: b.replace("}}else if(event.kind==='saved')", "}if(this.studio.current)this.studio.current.renderState();else if(!this.execution.worker)this.debugger.render(null);}else if(event.kind==='saved')"), 1)
conflict('src/ui/controllers/UICommandController.js', lambda a,b,n: a.replace('session.compiledBackend === options.backend;', 'session.compiledBackend === options.backend && session.compiledOptimize === optimize;').replace("          if(command==='debug')", "          if(session.inspection && app.buildRevision === model.revision) app.uiBuildOutput(command,session.inspection,'Build succeeded. The UI runs in its isolated live preview; no terminal stdout is expected.');\n          if(command==='debug')"), 1)
conflict('src/ui/studio/StudioPreview.js', lambda a,b,n: b.replace('this.compiledGeneration = generation;', 'this.compiledGeneration = generation; this.compiledBackend = this.backend; this.compiledOptimize = optimize;') if n == 0 else '\n'.join(line for line in b.split('\n') if 'armOnReady' not in line), 2)
p = root / 'src/ui/studio/StudioPreview.js'
p.write_text(p.read_text().replace('this.artifact = null; this.snapshot = null;', 'this.artifact = null; this.inspection = null; this.snapshot = null;'))
conflict('src/ui/studio/StudioProject.js', lambda a,b,n: a.replace('this.artifact = null;', 'this.artifact = null; this.inspection = null;'), 1)
p = root / 'src/ui/controllers/UICommandController.js'
p.write_text(p.read_text().replace("if(command==='debug') { session.dock.open('debug'); app.dock.open('debugger'); }", "if(command==='debug') {\n            // The main debugger owns inspection when the retained designer is compact.\n            // Keep Canvas as its single-panel fallback instead of hiding the app to debug.\n            session.dock.open('debug'); session.dock.open('canvas'); app.dock.open('debugger');\n          }"))
p = root / 'tests/ui-project-debug-commands.test.js'
s = p.read_text().replace("compiledBackend:'javascript', artifact", "compiledBackend:'javascript', compiledOptimize:true, artifact")
s = s.replace("backend:'javascript',dock", "backend:'javascript',settings:{optimize:true},isCurrentUI:(path,revision,epoch)=>path===model.active&&revision===model.revision&&epoch===model.workspaceEpoch,failUIBuild:error=>errors.push(error),dock")
s = s.replace("['artifact','backend','generation']", "['artifact','backend','generation','optimization']").replace('else f.session.generation++;', "else if(stale==='optimization')f.app.settings.optimize=false;else f.session.generation++;")
s += '''
// The compiler-output and debugger controllers share publication, not runtime ownership.
test('attaching keeps compiler inspection and reveals debugger after publishing build output',async t=>{
  const f=fixture(t);f.session.inspection={file};f.app.buildRevision=f.model.revision;
  f.app.uiBuildOutput=(command,build)=>f.calls.push(['output',command,build]);
  await f.controller.run('debug',file);
  assert.ok(!f.calls.some(call=>call[0]==='build'));
  const output=f.calls.findIndex(call=>call[0]==='output');
  const debuggerDock=f.calls.findIndex(call=>call[0]==='main-dock'&&call[1]==='debugger');
  assert.ok(output>=0&&debuggerDock>output);assert.deepEqual(f.calls.filter(call=>call[0]==='dock').map(call=>call[1]),['debug','canvas']);assert.deepEqual(f.errors,[]);
});
test('switching documents restores its debugger after compiler-result invalidation',()=>{
  const calls=[],app={studio:{current:{renderState:()=>calls.push('debugger')}},model:{active:file},projectView:{},renderWorkspace:()=>calls.push('workspace'),uiCommands:{entry:()=>file},build:{file:'src/other.ui.rs'},invalidate:()=>calls.push('invalidate'),schedule:()=>calls.push('schedule')};
  IdeApplication.prototype.modelChanged.call(app,{kind:'open'});
  assert.deepEqual(calls,['workspace','invalidate','schedule','debugger']);
});
'''
p.write_text(s)
run('npm', 'run', 'build:workers')
run('npm', 'run', 'build:sdk')
run('npm', 'run', 'check')
run('npm', 'test')
Path(__file__).unlink()
run('git', 'add', 'src', 'tests', 'tools', 'docs', 'styles', 'package.json')
run('git', 'diff', '--cached', '--check')
# The existing temporary workflow is removed separately through the connector.
# Project the index without that file and require the EXACT locally tested tree.
index = run('git', 'rev-parse', '--git-path', 'index', capture_output=True, text=True).stdout.strip()
with tempfile.TemporaryDirectory() as temporary:
    projected = Path(temporary) / 'index'
    shutil.copyfile(root / index, projected)
    env = {**os.environ, 'GIT_INDEX_FILE': str(projected)}
    run('git', 'update-index', '--force-remove', '.github/workflows/ui-debugger-integration.yml', env=env)
    tree = run('git', 'write-tree', env=env, capture_output=True, text=True).stdout.strip()
    if tree != '3682f4953826a3e0b18976a75a039288e7903c55':
        raise SystemExit(f'Merged tree differs from the tested tree: {tree}')
print('Verified exact integrated source tree:', tree, flush=True)
run('git', 'commit', '-m', 'Merge main: preserve compiler output, retained UI debugging and compact canvas access')
run('git', 'push', 'origin', 'HEAD:fix/ui-project-debugger')
