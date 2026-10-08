#!/usr/bin/env python3
"""Bridge-free agent acceptance. The ONLY server is a static file server; no agent bridge/process.
Provider API responses are deterministic wire fixtures, not paid account validation.
FERRITE_MEMORY_TEST=1 substitutes module delivery and SHA-256 in restricted containers;
that mode does not claim to verify HTTP/CORS, IndexedDB, Web Locks or reload persistence.
"""
import hashlib
import importlib.util
import json
import os
import threading
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('ferrite_acceptance', ROOT / 'tools/browser-acceptance.py')
base_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base_module)
OUTPUT = ROOT / 'artifacts/browser-agent'
OUTPUT.mkdir(parents=True, exist_ok=True)
MEMORY = os.environ.get('FERRITE_MEMORY_TEST') == '1'
KEY = 'fixture-browser-private-api-key'
FIXTURE = {'Cargo.toml': '[package]\nname="browser_demo"\nversion="0.1.0"\nedition="2021"\n',
           'src/main.rs': 'fn main() { println!("Before browser agent"); }\n'}

class ProviderFixture:
    def __init__(self):
        self.calls = []
        self.mode = 'task'
        self.sequence = 0
    def response(self, url, options):
        self.calls.append({'url': url, 'method': options.get('method', 'GET')})
        body = json.loads(options.get('body') or '{}')
        provider = 'anthropic' if 'anthropic.com' in url else 'gemini' if 'googleapis.com' in url else 'openai'
        headers = {k.lower():v for k,v in options.get('headers', {}).items()}
        assert (headers.get('authorization') == 'Bearer ' + KEY if provider == 'openai' else headers.get('x-api-key' if provider == 'anthropic' else 'x-goog-api-key') == KEY), headers
        if provider == 'anthropic': assert headers.get('anthropic-dangerous-direct-browser-access') == 'true'
        if '/models' in url and ':streamGenerateContent' not in url:
            data = {'models':[{'name':'models/fixture','supportedGenerationMethods':['generateContent']}]} if provider == 'gemini' else {'data':[{'id':'fixture','display_name':'Fixture model'}]}
            return {'status':200,'contentType':'application/json','text':json.dumps(data)}
        if provider != 'openai':
            data = {'content':[{'type':'text','text':'Direct Anthropic browser request passed.'}], 'stop_reason':'end_turn', 'usage':{'input_tokens':15,'output_tokens':9}} if provider == 'anthropic' else {'candidates':[{'content':{'parts':[{'text':'Direct Gemini browser request passed.'}]},'finishReason':'STOP'}], 'usageMetadata':{'promptTokenCount':15,'candidatesTokenCount':9}}
            if provider == 'anthropic': return {'status':200,'contentType':'application/json','text':json.dumps(data)}
            return {'status':200,'contentType':'text/event-stream','text':'data: '+json.dumps(data)+'\n\n'}
        self.sequence += 1
        def call(name,args):
            return [{'type':'function_call','call_id':f'fixture-{self.sequence}','name':name,'arguments':json.dumps(args)}]
        def message(text):
            return [{'type':'message','role':'assistant','content':[{'type':'output_text','text':text}]}]
        if body.get('instructions','').startswith('Summarize'):
            output=message('Preserved task: greeting changed and MIR execution verified. Continue using live hashes. User chose browser-only.')
        elif self.mode == 'deny': output=call('workspace_read',{'path':'src/main.rs'})
        elif self.mode == 'pending': output=call('user_question',{'question':'Hold this task for a project-switch cancellation check.'})
        elif self.mode == 'answer': output=message('Explicit follow-up completed in the browser.')
        else:
            history=body.get('input',[])
            results=[item for item in history if item.get('type')=='function_call_output']
            last=results[-1] if results else None
            request=next((item for item in reversed(history) if item.get('type')=='function_call' and last and item['call_id']==last['call_id']),None)
            value=json.loads(last['output']) if last else None
            name=request['name'] if request else None
            if name is None: output=call('plan_update',{'steps':[{'step':'Inspect, edit, run and review browser greeting','status':'in_progress'}]})
            elif name=='plan_update': output=call('workspace_read',{'path':'src/main.rs'})
            elif name=='workspace_read': output=call('workspace_replace',{'path':'src/main.rs','expectedHash':value['hash'],'oldText':'Before browser agent','newText':'Browser agent integration passed'})
            elif name=='workspace_replace': output=call('compiler_execute',{'mode':'run'})
            elif name=='compiler_execute':
                assert 'Browser agent integration passed' in value['output'], value
                output=call('user_question',{'question':'Which execution mode should this task retain?','options':['Browser only','Optional native later']})
            elif name=='user_question':
                assert value['answer']=='Browser only' and not value['grantsPermissions'],value
                output=call('ide_inspect',{})
            elif name=='ide_inspect': output=call('ide_command',{'command':'editor.select','arguments':{'path':'src/main.rs','start':0,'end':7},'expectedRevision':value['state']['revision']})
            else: output=message('Updated the greeting and verified real browser MIR execution. No local bridge was used.')
        final={'status':'completed','output':output,'usage':{'input_tokens':50,'output_tokens':25}}
        return {'status':200,'contentType':'text/event-stream','text':'event: response.completed\ndata: '+json.dumps({'type':'response.completed','response':final})+'\n\n'}

def run():
    fixture=ProviderFixture();errors=[];network=[];results=[]
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(base_module.QuietHandler,directory=str(ROOT)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    origin=f'http://127.0.0.1:{server.server_port}'
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE'),headless=True,args=['--no-sandbox'])
        context=browser.new_context(viewport={'width':1720,'height':1120},accept_downloads=True)
        def route(request):
            if request.request.method == 'OPTIONS':
                request.fulfill(status=204,headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'authorization,content-type,x-api-key,x-goog-api-key,anthropic-version,anthropic-dangerous-direct-browser-access'});return
            value=fixture.response(request.request.url,{'method':request.request.method,'headers':request.request.headers,'body':request.request.post_data})
            request.fulfill(status=value['status'],content_type=value['contentType'],body=value['text'],headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'*'})
        for host in ['api.openai.com','api.anthropic.com','generativelanguage.googleapis.com']:context.route('https://'+host+'/**',route)
        page=context.new_page();page.set_default_timeout(15000);page.on('pageerror',lambda error:errors.append(str(error)));page.on('request',lambda req:network.append(req.url));page.on('dialog',lambda dialog:dialog.accept())
        def show_agent():
            if not page.locator('.agent-workbench').is_visible():page.locator('[data-tool="agent"]').click()
        def passed(name):results.append(name);print('PASS '+name,flush=True)
        def login(provider):
            page.locator('#agent-provider').select_option(provider)
            page.get_by_role('button',name='API sign in',exact=True).click()
            page.locator('#agent-api-key').fill(KEY);page.locator('#agent-browser-key-consent').check()
            page.get_by_role('button',name='Validate API key',exact=True).click();expect(page.locator('dialog.agent-dialog')).to_have_count(0)
            page.locator('#agent-model').fill('fixture')
        try:
            if MEMORY:
                page.expose_function('ferriteTestDigest',lambda value:list(hashlib.sha256(bytes(value)).digest()))
                page.expose_function('ferriteTestProvider',fixture.response)
                page.evaluate('''() => {
                  if(!crypto.subtle)Object.defineProperty(crypto,'subtle',{value:{digest:async(name,bytes)=>{if(name!=='SHA-256')throw Error('Unexpected test algorithm');return new Uint8Array(await window.ferriteTestDigest([...new Uint8Array(bytes)])).buffer;}}});
                  const native=window.fetch;window.fetch=async(url,options={})=>{if(/^https:\\/\\/(api.openai.com|api.anthropic.com|generativelanguage.googleapis.com)\\//.test(String(url))){options.signal?.throwIfAborted();const result=await window.ferriteTestProvider(String(url),{method:options.method,headers:options.headers,body:options.body});options.signal?.throwIfAborted();return new Response(result.text,{status:result.status,headers:{'content-type':result.contentType}});}return native(url,options);};
                }''')
                base_module.memory_document(page);page.add_style_tag(path=str(ROOT/'styles/agent.css'))
            else:page.goto(origin+'/',wait_until='networkidle')
            page.wait_for_function('!!window.ferrite?.getBuild()')
            page.locator('#import-input').set_input_files({'name':'browser.ferrite.json','mimeType':'application/json','buffer':json.dumps({'format':'ferrite-project-v1','files':FIXTURE}).encode()})
            page.wait_for_function('window.ferrite.getSnapshot().files["src/main.rs"].includes("Before browser agent")')
            show_agent();expect(page.locator('.agent-workspace-status')).to_contain_text('no local bridge')
            expect(page.locator('.agent-badge')).to_have_text('Ready · browser')
            login('openai');passed('default browser runtime and direct API-key consent/model discovery without a bridge')
            page.locator('#agent-prompt').fill('Change the greeting and verify actual execution.');page.locator('#agent-run').click()
            approval=page.locator('.agent-approval');expect(approval.first).to_contain_text('workspace_replace');approval.first.locator('summary').click();expect(approval.first).to_contain_text('Browser agent integration passed');approval.first.get_by_role('button',name='Approve once').click()
            expect(approval.first).to_contain_text('compiler_execute');approval.first.get_by_role('button',name='Approve once').click()
            question=page.locator('.agent-question');expect(question).to_contain_text('execution mode');question.get_by_role('button',name='Browser only',exact=True).click();question.get_by_role('button',name='Send answer').click()
            expect(page.locator('.agent-badge')).to_have_text('completed',timeout=30000)
            assert 'Browser agent integration passed' in page.evaluate('window.ferrite.getSnapshot().files["src/main.rs"]')
            assert page.evaluate('window.ferrite.getSelection().end')==7
            passed('real read/edit/checkpoint/compiler worker, one-shot approvals, human answer and live IDE command')
            session_id=page.locator('#agent-session-select').input_value()
            page.locator('[data-agent-tab="trace"]').click();expect(page.locator('.agent-trace')).to_contain_text('tool.completed');page.screenshot(path=str(OUTPUT/'browser-agent-trace.png'))
            page.locator('[data-agent-tab="changes"]').click();expect(page.locator('.agent-changes')).to_contain_text('src/main.rs');expect(page.locator('.agent-changes')).to_contain_text('Browser agent integration passed')
            page.screenshot(path=str(OUTPUT/'browser-agent-review.png'))
            page.get_by_role('button',name='Restore hunk 1',exact=True).click();expect(page.locator('.agent-changes')).to_contain_text('No source changes')
            assert 'Before browser agent' in page.evaluate('window.ferrite.getSnapshot().files["src/main.rs"]')
            passed('task change review, source-linked exact line diff and hash-protected hunk restoration')
            page.locator('[data-agent-tab="followups"]').click();page.get_by_role('textbox',name='Queued follow-up',exact=True).fill('Describe next steps without changing source.');page.get_by_role('button',name='Queue message',exact=True).click()
            expect(page.locator('.agent-followup')).to_have_count(1);before=len(fixture.calls)
            page.get_by_role('button',name='Load into composer',exact=True).click();expect(page.locator('#agent-prompt')).to_have_value('Describe next steps without changing source.');assert len(fixture.calls)==before
            fixture.mode='answer';page.locator('#agent-run').click();expect(page.locator('.agent-badge')).to_have_text('completed')
            page.locator('[data-agent-tab="context"]').click();page.get_by_role('button',name='Compact now',exact=True).click();expect(page.locator('[data-agent-content="context"] .agent-json')).to_contain_text('Preserved task')
            passed('explicit queued follow-up with no automatic send, continued session and model-assisted compaction')
            page.locator('[data-tool="terminal"]').click();page.locator('#browser-terminal-input').fill('cargo run');page.locator('#browser-terminal-input').press('Enter');expect(page.locator('.terminal-screen')).to_contain_text('Before browser agent')
            page.locator('#browser-terminal-input').fill('printf "a\\nb\\n" > notes.txt; cat notes.txt | wc -l');page.locator('#browser-terminal-input').press('Enter');expect(page.locator('.terminal-screen')).to_contain_text('2');page.wait_for_function('window.ferrite.getSnapshot().files["notes.txt"] === "a\\nb\\n"')
            page.locator('#browser-terminal-input').fill('agent status');page.locator('#browser-terminal-input').press('Enter');expect(page.locator('.terminal-screen')).to_contain_text(session_id)
            page.locator('#browser-terminal-input').fill('agent task \"Summarize terminal harness status\"');page.locator('#browser-terminal-input').press('Enter');expect(page.locator('.terminal-screen')).to_contain_text('Explicit follow-up completed in the browser')
            page.screenshot(path=str(OUTPUT/'browser-agent-terminal.png'));passed('browser terminal runs actual Cargo-subset code and checkpointed Unix-like utility pipelines')
            show_agent()
            for provider in ['anthropic','gemini']:
                page.locator('.agent-workbench').get_by_role('button',name='New',exact=True).click();login(provider)
                page.locator('#agent-prompt').fill('Verify direct '+provider+' API adapter.');page.locator('#agent-run').click();expect(page.locator('.agent-badge')).to_have_text('completed')
                expect(page.locator('#agent-chat')).to_contain_text('Direct '+('Anthropic' if provider=='anthropic' else 'Gemini'))
                page.get_by_role('button',name='API sign out',exact=True).click();expect(page.locator('#agent-model')).to_have_attribute('placeholder','API sign in required')
            passed('Anthropic direct-browser opt-in header and Gemini native protocol, including API sign-out')
            page.locator('#agent-session-select').select_option(session_id);expect(page.locator('#agent-chat')).to_contain_text('No local bridge was used')
            if not MEMORY:
                stored=page.evaluate('JSON.stringify({local:{...localStorage},session:{...sessionStorage}})');assert KEY not in stored
                # Actual IndexedDB contents, not an API mock.
                records=page.evaluate('''() => new Promise((resolve,reject)=>{const open=indexedDB.open('ferrite-agent-v1');open.onsuccess=()=>{const db=open.result,tx=db.transaction('records'),q=tx.objectStore('records').getAll();q.onsuccess=()=>resolve(JSON.stringify(q.result));tx.oncomplete=()=>db.close();};open.onerror=()=>reject(open.error);})''')
                assert KEY not in records and session_id in records
                page.reload(wait_until='networkidle');show_agent();expect(page.locator('#agent-model')).to_have_attribute('placeholder','API sign in required');expect(page.locator('#agent-session-select option')).not_to_have_count(1)
                page.locator('#agent-session-select').select_option(session_id);expect(page.locator('#agent-chat')).to_contain_text('No local bridge was used')
                page.locator('[data-agent-tab="followups"]').click();expect(page.locator('.agent-followup')).to_have_count(1)
                second=context.new_page();second.goto(origin+'/',wait_until='networkidle');second.locator('[data-tool="agent"]').click();expect(second.locator('.agent-error').filter(has_text='another tab')).to_be_visible();second.close()
                passed('real IndexedDB reload recovery, queue retention, memory-only keys and exclusive cross-tab journal ownership')
                login('openai')
            fixture.mode='deny';page.locator('[data-agent-tab="permissions"]').click();page.get_by_role('combobox',name='Permission for workspace_read',exact=True).select_option('deny')
            page.locator('#agent-prompt').fill('Check the permission policy.');page.locator('#agent-run').click();expect(page.locator('.agent-badge')).to_have_text('cancelled');passed('per-tool denial stops the task instead of trying an alternative route')
            page.locator('[data-agent-tab="permissions"]').click();page.get_by_role('combobox',name='Permission for workspace_read',exact=True).select_option('default')
            fixture.mode='pending';page.locator('#agent-prompt').fill('Prepare a task to be revoked.');page.locator('#agent-run').click();expect(page.locator('.agent-question')).to_contain_text('project-switch')
            page.locator('#sample-select').select_option(label='Generics & modules');show_agent();expect(page.locator('.agent-badge')).to_have_text('Ready · browser');expect(page.locator('.agent-question')).to_have_count(0);expect(page.locator('#agent-model')).to_have_attribute('placeholder','API sign in required');expect(page.locator('#agent-session-select option')).to_have_count(1)
            passed('project replacement revokes active requests/questions/credentials and isolates new task history')
            assert not errors,errors
            assert not any('/v1/' in url and '127.0.0.1' in url for url in network), network
            assert all(any(host in item['url'] for host in ['api.openai.com','api.anthropic.com','generativelanguage.googleapis.com']) for item in fixture.calls)
            (OUTPUT/'results.json').write_text(json.dumps({'passed':len(results),'cases':results,'mode':'memory-modules-and-test-hash' if MEMORY else 'http-real-browser-storage','agentBridgeStarted':False,'nativeProcessStarted':False,'paidProviderAccountsTested':False,'providerRequests':fixture.calls,'errors':errors},indent=2))
        except Exception:
            page.screenshot(path=str(OUTPUT/'failure.png'));(OUTPUT/'errors.json').write_text(json.dumps({'errors':errors,'body':page.locator('body').inner_text()[-18000:],'providerRequests':fixture.calls},indent=2));raise
        finally:context.close();browser.close();server.shutdown()

if __name__=='__main__':run()
