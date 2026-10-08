#!/usr/bin/env python3
"""Agent UI end-to-end: real bridge/tools/PTTY; deterministic provider API wire fixture.
Normal mode tests HTTP/CORS. FERRITE_MEMORY_TEST=1 loads modules in memory and injects
only the loopback transport through a Python test binding; it does not verify browser networking.
"""
import importlib.util
import json
import os
import subprocess
import threading
import urllib.request
import urllib.error
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('ferrite_browser',ROOT/'tools/browser-acceptance.py')
base_module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(base_module)
OUTPUT=Path(os.environ.get('FERRITE_AGENT_BROWSER_OUTPUT',str(ROOT/'artifacts/agent-browser')))
MEMORY=os.environ.get('FERRITE_MEMORY_TEST')=='1'
OUTPUT.mkdir(parents=True,exist_ok=True)

def run():
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(base_module.QuietHandler,directory=str(ROOT)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    base=f'http://127.0.0.1:{server.server_port}'
    bridge=subprocess.Popen(['node','tests/fixtures/agent-browser-bridge.mjs',base],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    connection=json.loads(bridge.stdout.readline())
    errors=[]
    def api(path,data=None):
        request=urllib.request.Request(connection['url']+path,data=None if data is None else json.dumps(data).encode(),headers={'Authorization':'Bearer '+connection['token'],'Content-Type':'application/json'})
        with urllib.request.urlopen(request,timeout=30) as response:return json.load(response)
    with sync_playwright() as playwright:
        browser=playwright.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE'),headless=True,args=['--no-sandbox'])
        context=browser.new_context(viewport={'width':1700,'height':1100},accept_downloads=True)
        page=context.new_page();page.set_default_timeout(15000)
        page.on('pageerror',lambda error: errors.append(str(error)))
        page.on('dialog',lambda dialog: dialog.accept())
        try:
            if MEMORY:
                def bridge_fetch(url,options):
                    assert url.startswith(connection['url']+'/v1/'),url
                    request=urllib.request.Request(url,data=options.get('body','').encode() if options.get('method')=='POST' else None,headers=options.get('headers',{}),method=options.get('method','GET'))
                    try:
                        with urllib.request.urlopen(request,timeout=40) as response:return {'status':response.status,'text':response.read().decode()}
                    except urllib.error.HTTPError as error:return {'status':error.code,'text':error.read().decode()}
                page.expose_function('ferriteTestBridge',bridge_fetch)
                page.evaluate('''() => { const native=window.fetch;window.fetch=async(url,options={})=>{if(String(url).startsWith('http://127.0.0.1:')){const result=await window.ferriteTestBridge(String(url),{method:options.method,headers:options.headers,body:options.body});return new Response(result.text,{status:result.status,headers:{'content-type':'application/json'}});}return native(url,options);}; }''')
                base_module.memory_document(page)
            else:page.goto(base+'/',wait_until='networkidle')
            page.wait_for_function('!!window.ferrite?.getBuild()')
            page.locator('[data-tool="agent"]').click()
            agent=page.locator('.agent-workbench');expect(agent).to_be_visible()
            agent.get_by_role('button',name='Connect',exact=True).click()
            page.locator('#agent-bridge-url').fill(connection['url']);page.locator('#agent-bridge-token').fill(connection['token']);page.locator('#agent-trust-host').check()
            page.locator('dialog.agent-dialog').get_by_role('button',name='Connect',exact=True).click();expect(page.locator('dialog.agent-dialog')).to_have_count(0)
            agent.get_by_role('button',name='API sign in',exact=True).click();page.locator('#agent-api-key').fill('fixture-private-api-key');page.locator('dialog.agent-dialog').get_by_role('button',name='Validate API key').click();expect(page.locator('dialog.agent-dialog')).to_have_count(0)
            expect(page.locator('#agent-models option')).to_have_count(1);page.locator('#agent-model').fill('test-tool-model')
            agent.get_by_role('button',name='Import native workspace').click();page.wait_for_function('window.ferrite.getSnapshot().files["src/main.rs"].includes("Before agent")')
            page.locator('#agent-prompt').fill('Change the greeting and verify the program output.')
            page.locator('#agent-run').click()
            approval=page.locator('.agent-approval');expect(approval.first).to_contain_text('workspace_replace');approval.first.locator('summary').click();expect(approval.first).to_contain_text('Agent integration passed');approval.first.get_by_role('button',name='Approve once').click()
            expect(approval.first).to_contain_text('compiler_execute');approval.first.get_by_role('button',name='Approve once').click()
            expect(agent.locator('.agent-badge')).to_have_text('completed',timeout=30000)
            expect(page.locator('#agent-chat')).to_contain_text('verified the MIR execution')
            page.wait_for_function('window.ferrite.getSnapshot().files["src/main.rs"].includes("Agent integration passed")')
            assert 'Agent integration passed' in (Path(connection['root'])/'src/main.rs').read_text()
            print('PASS provider API sign-in/model discovery, persistent task, edit preview/approval, real tools and synchronized editor')
            agent.locator('[data-agent-tab="trace"]').click();expect(agent.locator('.agent-trace')).to_contain_text('tool.completed');expect(agent.locator('.agent-metrics')).to_contain_text('Input 200')
            agent.locator('[data-agent-tab="context"]').click();expect(agent.locator('progress')).to_be_visible()
            agent.locator('[data-agent-tab="tools"]').click();expect(agent.locator('.agent-tool-list')).to_contain_text('rust_language');expect(agent.locator('.agent-tool-list')).to_contain_text('compiler_inspect')
            print('PASS event visualizer, usage counters, context and MCP capability explorer')
            # A real MCP/agent IDE command traverses the server-to-browser request/reply channel.
            state=api('/v1/tools/call',{'name':'ide_inspect','arguments':{}})
            for _ in range(120):
                if state.get('state',{}).get('revision') == page.evaluate('window.ferrite.getRevision()'):break
                page.wait_for_timeout(50)
                state=api('/v1/tools/call',{'name':'ide_inspect','arguments':{}})
            assert state['state']['revision'] == page.evaluate('window.ferrite.getRevision()'),state
            result_holder=[]
            def command():
                try:result_holder.append(api('/v1/tools/call',{'name':'ide_command','arguments':{'command':'editor.select','arguments':{'path':'src/main.rs','start':0,'end':7},'expectedRevision':state['state']['revision']}}))
                except Exception as error:result_holder.append(error)
            thread=threading.Thread(target=command);thread.start()
            for _ in range(300):
                if page.evaluate('window.ferrite.getSelection()?.end === 7'):break
                if result_holder:raise AssertionError(result_holder)
                page.wait_for_timeout(50)
            assert page.evaluate('window.ferrite.getSelection()?.end === 7'),result_holder
            while thread.is_alive():page.wait_for_timeout(50)
            assert isinstance(result_holder[0],dict),result_holder
            print('PASS revision-checked external IDE command with source selection')
            page.screenshot(path=str(OUTPUT/'agent-tools.png'),full_page=True)
            page.locator('[data-tool="terminal"]').click()
            page.locator('#browser-terminal-input').fill('echo browser-terminal-ok | wc -c');page.locator('#browser-terminal-input').press('Enter');expect(page.locator('.terminal-screen')).to_contain_text('20')
            page.locator('.terminal-workbench').get_by_role('button',name='New native',exact=True).click();expect(page.locator('.terminal-status')).to_contain_text('Native PTY')
            ime=page.get_by_role('textbox',name='Native terminal input',exact=True);ime.focus();ime.press_sequentially("printf 'native-terminal-%s\\n' 'ok'; stty size",delay=5);ime.press('Enter')
            expect(page.locator('.terminal-screen')).to_contain_text('native-terminal-ok',timeout=20000)
            page.screenshot(path=str(OUTPUT/'agent-terminal.png'),full_page=True)
            print('PASS browser utility pipeline and real interactive native PTY')
            # No bearer or API key may enter persistent web storage.
            stored=page.evaluate('JSON.stringify({local:{...localStorage},session:{...sessionStorage}})' if not MEMORY else '"memory-mode-no-origin-storage"')
            assert connection['token'] not in stored and 'fixture-private-api-key' not in stored
            if not agent.is_visible():page.locator('[data-tool="agent"]').click()
            agent.get_by_role('button',name='Fork',exact=True).click();expect(page.locator('#agent-session-select option')).to_have_count(3)
            agent.get_by_role('button',name='API sign out',exact=True).click();expect(page.locator('#agent-model')).to_have_attribute('placeholder','API sign in required')
            agent.get_by_role('button',name='Disconnect',exact=True).click();expect(agent.locator('.agent-badge')).to_have_text('Disconnected')
            assert not errors,errors
            print('PASS session fork, sign-out, disconnect and credential non-persistence')
            (OUTPUT/'results.json').write_text(json.dumps({'passed':5,'transport':'memory-injected' if MEMORY else 'http','provider':'deterministic fixture; real provider billing not exercised','errors':errors},indent=2))
        except Exception:
            page.screenshot(path=str(OUTPUT/'failure.png'),full_page=True)
            (OUTPUT/'errors.json').write_text(json.dumps(errors,indent=2))
            raise
        finally:
            context.close();browser.close();bridge.terminate()
            try:bridge.wait(timeout=10)
            except subprocess.TimeoutExpired:bridge.kill();bridge.wait()
            server.shutdown()

if __name__=='__main__':run()
