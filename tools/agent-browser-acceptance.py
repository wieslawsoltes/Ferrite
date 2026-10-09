#!/usr/bin/env python3
"""Agent UI end-to-end: real bridge/tools/PTTY; deterministic provider API wire fixture.
Normal mode tests HTTP/CORS. FERRITE_MEMORY_TEST=1 loads modules in memory and injects
only the loopback transport through a Python test binding; it does not verify browser networking.
"""
import importlib.util
import json
import os
import shlex
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
    network=[]
    def api(path,data=None):
        request=urllib.request.Request(connection['url']+path,data=None if data is None else json.dumps(data).encode(),headers={'Authorization':'Bearer '+connection['token'],'Content-Type':'application/json'})
        with urllib.request.urlopen(request,timeout=30) as response:return json.load(response)
    with sync_playwright() as playwright:
        browser=playwright.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE'),headless=True,args=['--no-sandbox'])
        context=browser.new_context(viewport={'width':1700,'height':1100},accept_downloads=True)
        page=context.new_page();page.set_default_timeout(15000)
        page.on('pageerror',lambda error: errors.append(str(error)))
        page.on('console',lambda message: network.append({'type':message.type,'text':message.text}) if message.type in ['warning','error'] else None)
        page.on('requestfailed',lambda request: network.append({'url':request.url,'failure':request.failure}))
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
                page.add_style_tag(content=(ROOT/'styles/agent.css').read_text())
            else:page.goto(base+'/',wait_until='networkidle')
            page.wait_for_function('!!window.ferrite?.getBuild()')
            page.locator('[data-tool="agent"]').click()
            agent=page.locator('.agent-workbench');expect(agent).to_be_visible()
            agent.get_by_role('button',name='Connect',exact=True).click()
            page.locator('#agent-bridge-url').fill(connection['url']);page.locator('#agent-bridge-token').fill(connection['token']);page.locator('#agent-trust-host').check()
            # Exercise failed authentication before the real, deliberately slow handshake.
            page.locator('#agent-bridge-token').fill('invalid-private-token')
            page.locator('dialog.agent-dialog').get_by_role('button',name='Connect',exact=True).click()
            expect(page.locator('dialog.agent-dialog .agent-error')).to_contain_text('bearer token')
            expect(agent.locator('.agent-badge')).to_have_text('Disconnected')
            page.locator('#agent-bridge-token').fill(connection['token'])
            page.locator('dialog.agent-dialog').get_by_role('button',name='Connect',exact=True).click();expect(page.locator('dialog.agent-dialog')).to_have_count(0)
            expect(agent.locator('.agent-error')).to_be_hidden()
            print('PASS failed authentication recovery and delayed atomic IDE connection')
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
            # A real ncurses application: both human interaction and the MCP screen
            # oracle must agree. Increasing the dock is equivalent to a splitter resize.
            page.locator('.dock-layout').evaluate("node => node.style.setProperty('--bottom-size', '500px')")
            terminal_id=page.locator('#agent-terminal-tabs').input_value()
            ime.focus();ime.press_sequentially('python3 -I -u '+shlex.quote(str(ROOT/'tests/fixtures/terminal-curses.py')),delay=1);ime.press('Enter')
            rendered=page.locator('.terminal-screen .xterm-rows')
            expect(rendered).to_contain_text('Ferrite ncurses interoperability',timeout=20000)
            expect(rendered).to_contain_text('Unicode: 界é')
            screen=api('/v1/terminals/'+terminal_id+'/screen')
            assert screen['buffer']=='alternate' and screen['title']=='Ferrite ncurses fixture',screen
            ime.press('ArrowDown');expect(rendered).to_contain_text('Selected: 2')
            ime.press('F1');expect(rendered).to_contain_text('Event: HELP')
            page.keyboard.insert_text('Ż界');expect(rendered).to_contain_text('Input: Ż界')
            screen=api('/v1/terminals/'+terminal_id+'/screen')
            assert 'Selected: 2' in screen['text'] and 'Input: Ż界' in screen['text'],screen
            box=page.locator('.terminal-screen .xterm-screen').bounding_box()
            page.mouse.click(box['x']+6.5*box['width']/screen['cols'],box['y']+7.5*box['height']/screen['rows'])
            expect(rendered).to_contain_text('MOUSE 7,8')
            previous_size=(screen['cols'],screen['rows'])
            page.set_viewport_size({'width':1580,'height':1100})
            page.locator('.dock-layout').evaluate("node => node.style.setProperty('--bottom-size', '560px')")
            for _ in range(100):
                page.wait_for_timeout(50)
                screen=api('/v1/terminals/'+terminal_id+'/screen')
                if (screen['cols'],screen['rows'])!=previous_size and ('Size: %dx%d'%(screen['cols'],screen['rows'])) in screen['text']:break
            assert (screen['cols'],screen['rows'])!=previous_size,screen
            expect(rendered).to_contain_text('Size: %dx%d'%(screen['cols'],screen['rows']))
            page.locator('#agent-terminal-tabs').select_option('browser')
            page.locator('#agent-terminal-tabs').select_option(terminal_id)
            expect(rendered).to_contain_text('Selected: 2')
            # Compare every visible cell row with the headless authority, not
            # merely a few text fragments that could hide a damaged right edge.
            for _ in range(100):
                page.wait_for_timeout(50)
                screen=api('/v1/terminals/'+terminal_id+'/screen')
                visible_rows=rendered.locator(':scope > div').evaluate_all("nodes => nodes.map(node => node.textContent.replace(/\\u00a0/g, ' ').trimEnd())")
                if visible_rows==screen['lines']:break
            assert visible_rows==screen['lines'],{'browser':visible_rows,'authority':screen['lines']}
            assert screen['lines'][0].startswith('┌') and screen['lines'][0].endswith('┐'),screen['lines']
            assert screen['lines'][-1].startswith('└') and screen['lines'][-1].endswith('┘'),screen['lines']
            assert all(line.startswith('│') and line.endswith('│') for line in screen['lines'][1:-1]),screen['lines']
            page.screenshot(path=str(OUTPUT/'terminal-ncurses.png'),full_page=True)
            print('PASS actual browser ncurses: alternate screen, Unicode, arrows/F1, IME input, mouse, resize and tab restoration')
            # No bearer or API key may enter persistent web storage.
            stored=page.evaluate('JSON.stringify({local:{...localStorage},session:{...sessionStorage}})' if not MEMORY else '"memory-mode-no-origin-storage"')
            assert connection['token'] not in stored and 'fixture-private-api-key' not in stored
            if not agent.is_visible():page.locator('[data-tool="agent"]').click()
            agent.get_by_role('button',name='Fork',exact=True).click();expect(page.locator('#agent-session-select option')).to_have_count(3)
            agent.get_by_role('button',name='API sign out',exact=True).click();expect(page.locator('#agent-model')).to_have_attribute('placeholder','API sign in required')
            agent.get_by_role('button',name='Disconnect',exact=True).click();expect(agent.locator('.agent-badge')).to_have_text('Disconnected')
            expect(page.locator('#agent-terminal-tabs option')).to_have_count(1)
            # Reuse the actual bridge; old PTYs remain native but stale local tabs were retired.
            agent.get_by_role('button',name='Connect',exact=True).click()
            page.locator('#agent-bridge-url').fill(connection['url']);page.locator('#agent-bridge-token').fill(connection['token']);page.locator('#agent-trust-host').check()
            page.locator('dialog.agent-dialog').get_by_role('button',name='Connect',exact=True).click();expect(page.locator('dialog.agent-dialog')).to_have_count(0)
            expect(page.locator('#agent-terminal-tabs option')).to_have_count(2)
            expect(agent.locator('.agent-error')).to_be_hidden()
            if not page.locator('.terminal-workbench').is_visible():page.locator('[data-tool="terminal"]').click()
            page.locator('#agent-terminal-tabs').select_option(terminal_id)
            expect(rendered).to_contain_text('Ferrite ncurses interoperability')
            expect(rendered).to_contain_text('Selected: 2')
            expect(rendered).to_contain_text('Input: Ż界')
            ime=page.get_by_role('textbox',name='Native terminal input',exact=True)
            ime.focus();ime.press('q')
            expect(rendered).to_contain_text('CURSES_EXIT_OK')
            screen=api('/v1/terminals/'+terminal_id+'/screen')
            assert screen['buffer']=='normal' and 'NORMAL BUFFER' in screen['text'],screen
            print('PASS live ncurses reconnect snapshot and normal-screen restoration on exit')
            if not agent.is_visible():page.locator('[data-tool="agent"]').click()
            agent.get_by_role('button',name='Import native workspace').click()
            expect(agent.locator('.agent-workspace-status')).to_contain_text('Synchronized')
            native_before=(Path(connection['root'])/'src/main.rs').read_text()
            page.locator('#sample-select').select_option(label='Geometry lab · traits & modules')
            expect(agent.locator('.agent-workspace-status')).to_contain_text('synchronization is off')
            page.wait_for_timeout(750)
            assert (Path(connection['root'])/'src/main.rs').read_text()==native_before
            agent.get_by_role('button',name='Disconnect',exact=True).click();expect(agent.locator('.agent-badge')).to_have_text('Disconnected')
            assert not errors,errors
            print('PASS session fork, sign-out, reconnect, project-switch isolation and credential non-persistence')
            (OUTPUT/'results.json').write_text(json.dumps({'passed':8,'transport':'memory-injected' if MEMORY else 'http','provider':'deterministic fixture; real provider billing not exercised','errors':errors},indent=2))
        except Exception:
            page.screenshot(path=str(OUTPUT/'failure.png'),full_page=True)
            (OUTPUT/'errors.json').write_text(json.dumps(errors,indent=2))
            diagnostics=json.dumps({'network':network,'dialogs':page.locator('dialog .agent-error').all_text_contents(),'agentErrors':page.locator('.agent-workbench > .agent-error').all_text_contents()},indent=2)
            for secret in [connection['token'],'fixture-private-api-key']:diagnostics=diagnostics.replace(secret,'[REDACTED]')
            (OUTPUT/'diagnostics.json').write_text(diagnostics)
            raise
        finally:
            context.close();browser.close();bridge.terminate()
            try:bridge.wait(timeout=10)
            except subprocess.TimeoutExpired:bridge.kill();bridge.wait()
            server.shutdown()

if __name__=='__main__':run()
