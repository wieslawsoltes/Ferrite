#!/usr/bin/env python3
"""Anthropic's real browser coding path with deterministic Messages SSE fixtures.
No live provider account, bridge, mocked compiler, mocked workspace or test digest.
"""
import importlib.util
import json
import os
import threading
import traceback
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from workbench_browser_support import show_workspace_actions

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/anthropic-agent'
KEY = 'fixture-anthropic-browser-secret'
spec = importlib.util.spec_from_file_location('browser_acceptance', ROOT / 'tools/browser-acceptance.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


def tool(name, arguments=None, identifier=None):
    return {'type': 'tool_use', 'id': identifier or 'toolu_' + name, 'name': name, 'input': arguments or {}}


def sse(content):
    events = [{'type': 'message_start', 'message': {'type': 'message', 'role': 'assistant', 'content': [], 'usage': {'input_tokens': 32, 'output_tokens': 1}}}]
    for index, block in enumerate(content):
        initial = {**block, 'input': {}} if block['type'] == 'tool_use' else block
        events.append({'type': 'content_block_start', 'index': index, 'content_block': initial})
        if block['type'] == 'tool_use':
            value = json.dumps(block['input'], ensure_ascii=False)
            # Empty-only deltas on discovery tools reproduced the screenshot's failure.
            parts = [''] if block['input'] == {} else [''] + [value[i:i+17] for i in range(0, len(value), 17)]
            events.extend({'type': 'content_block_delta', 'index': index, 'delta': {'type': 'input_json_delta', 'partial_json': part}} for part in parts)
        events.append({'type': 'content_block_stop', 'index': index})
    events.extend([{'type': 'message_delta', 'delta': {'stop_reason': 'tool_use' if any(b['type'] == 'tool_use' for b in content) else 'end_turn'}, 'usage': {'output_tokens': 64}}, {'type': 'message_stop'}])
    return ''.join('event: ' + event['type'] + '\r\ndata: ' + json.dumps(event, ensure_ascii=False) + '\r\n\r\n' for event in events)


def verify_history(messages):
    pending = []
    for message in messages:
        content = message['content']
        assert content and all(b['type'] != 'text' or b['text'] for b in content), 'Empty history block'
        if pending:
            assert message['role'] == 'user'
            assert [(b['type'], b.get('tool_use_id')) for b in content[:len(pending)]] == [('tool_result', identifier) for identifier in pending]
            pending = []
        if message['role'] == 'assistant':
            pending = [b['id'] for b in content if b['type'] == 'tool_use']
    assert not pending


class TimerFixture:
    def __init__(self):
        self.turn = 0
        self.requests = []
        self.expected = {}
        self.analysis_offsets = []

    def response(self, request):
        headers = request.headers
        assert headers['x-api-key'] == KEY
        assert headers['anthropic-version'] == '2023-06-01'
        assert headers['anthropic-dangerous-direct-browser-access'] == 'true'
        self.requests.append({'url': request.url, 'method': request.method})
        if '/models' in request.url:
            return 'application/json', json.dumps({'data': [{'id': 'fixture', 'display_name': 'Anthropic fixture'}]})
        body = json.loads(request.post_data)
        assert body['model'] == 'fixture' and body['stream'] is True
        verify_history(body['messages'])
        self.turn += 1

        def result(name):
            block = next(b for m in body['messages'] for b in m['content'] if b['type'] == 'tool_result' and b['tool_use_id'] == 'toolu_' + name)
            assert not block.get('is_error'), block
            return json.loads(block['content'])

        if self.turn == 1:
            output = [{'type': 'text', 'text': ''}, tool('workspace_list'), tool('instructions_read')]
        elif self.turn == 2:
            assert 'src/main.ui.rs' in result('workspace_list')['files']
            result('instructions_read')
            output = [tool('workspace_read', {'path': 'src/main.ui.rs'}, 'toolu_view'), tool('workspace_read', {'path': 'src/model.rs'}, 'toolu_model')]
        elif self.turn == 3:
            view, model = result('view'), result('model')
            handlers = '''    let increase = {
        let state = state.clone();
        move || { ui::write(state.clone(), model::adjust_duration(ui::read(state.clone()), 1.0)); }
    };
    let decrease = {
        let state = state.clone();
        move || { ui::write(state.clone(), model::adjust_duration(ui::read(state.clone()), -1.0)); }
    };
'''
            helper = '''
pub fn adjust_duration(mut timer: Timer, amount: f64) -> Timer {
    timer.duration = timer.duration + amount;
    if timer.duration < 0.0 { timer.duration = 0.0; }
    if timer.duration > 30.0 { timer.duration = 30.0; }
    timer
}
'''
            anchor = '    let progress = if current.duration == 0.0 {'
            button = '            <button on:click={reset}>Reset</button>'
            assert view['text'].count(anchor) == 1 and view['text'].count(button) == 1
            self.expected = {'src/main.ui.rs': view['text'].replace(anchor, handlers + anchor).replace(button, button + '\n            <button aria-label="Decrease duration" on:click={decrease}>− 1 second</button>\n            <button aria-label="Increase duration" on:click={increase}>+ 1 second</button>'),
                             'src/model.rs': model['text'] + helper}
            output = [tool('workspace_apply', {'changes': [{'path': path, 'text': text, 'expectedHash': (view if path.endswith('.ui.rs') else model)['hash']} for path, text in self.expected.items()]})]
        elif self.turn == 4:
            result('workspace_apply')
            output = [tool('ui_analyze', {'path': 'src/main.ui.rs'})]
        elif self.turn == 5:
            analysis = result('ui_analyze')
            assert analysis['truncated'], 'Large analysis must use the bounded artifact path'
            self.analysis_offsets = list(range(0, analysis['characters'], 10000))
            output = [tool('artifact_read', {'id': analysis['artifact'], 'offset': offset, 'length': 10000}, 'toolu_analysis_' + str(offset)) for offset in self.analysis_offsets]
        elif self.turn == 6:
            pages = [result('analysis_' + str(offset)) for offset in self.analysis_offsets]
            assert [page['offset'] for page in pages] == self.analysis_offsets
            analysis = json.loads(''.join(page['text'] for page in pages))
            assert not [d for d in analysis['diagnostics'] if d['severity'] == 'error'], analysis
            output = [tool('ui_preview', {'path': 'src/main.ui.rs', 'backend': 'javascript'})]
        else:
            assert self.turn == 7
            result('ui_preview')
            output = [{'type': 'text', 'text': 'Implemented up/down duration buttons with 0–30 second bounds. Compiled and mounted the real Timer preview.'}]
        return 'text/event-stream', sse(output)


def run():
    OUT.mkdir(parents=True, exist_ok=True)
    fixture, errors, requests = TimerFixture(), [], []
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(base.QuietHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE'), headless=True, args=['--no-sandbox'])
        context = browser.new_context(viewport={'width': 1780, 'height': 1120})
        page = context.new_page()
        page.set_default_timeout(20000)
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('request', lambda request: requests.append(request.url))
        page.on('dialog', lambda dialog: dialog.accept())

        def route(route):
            cors = {'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'content-type,x-api-key,anthropic-version,anthropic-dangerous-direct-browser-access'}
            if route.request.method == 'OPTIONS':
                route.fulfill(status=204, headers=cors)
                return
            content_type, text = fixture.response(route.request)
            route.fulfill(status=200, content_type=content_type, body=text, headers=cors)

        context.route('https://api.anthropic.com/**', route)
        try:
            page.goto(origin + '/', wait_until='networkidle')
            page.wait_for_function('!!window.ferrite?.getBuild()')
            show_workspace_actions(page)
            page.locator('#file-samples').click()
            dialog = page.get_by_role('dialog', name='Samples', exact=True)
            dialog.locator('[data-sample="7guis-timer"]').click()
            dialog.get_by_role('button', name='Open as new project').click()
            expect(dialog).to_have_count(0)
            expect(page.locator('.ui-studio .studio-status')).to_have_attribute('data-kind', 'ready')
            original = page.evaluate('ferrite.getSnapshot().files')
            if not page.locator('.agent-workbench').is_visible():
                page.locator('[data-tool="agent"]').click()
            expect(page.locator('.agent-workspace-status')).to_contain_text('no local bridge')
            page.locator('#agent-provider').select_option('anthropic')
            page.get_by_role('button', name='API sign in', exact=True).click()
            page.locator('#agent-api-key').fill(KEY)
            page.locator('#agent-browser-key-consent').check()
            page.get_by_role('button', name='Validate API key', exact=True).click()
            expect(page.locator('dialog.agent-dialog')).to_have_count(0)
            page.locator('#agent-model').fill('fixture')
            page.locator('[data-agent-tab="context"]').click()
            page.get_by_role('spinbutton', name='Context budget (estimated tokens)', exact=True).fill('65536')
            page.locator('[data-agent-tab="chat"]').click()
            page.locator('#agent-prompt').fill('Implement up/down timer time button and logic.')
            page.locator('#agent-run').click()
            approval = page.locator('.agent-approval').first
            expect(approval).to_contain_text('workspace_apply')
            assert page.evaluate('ferrite.getSnapshot().files') == original, 'No edits before user approval'
            approval.get_by_role('button', name='Approve once').click()
            expect(approval).to_contain_text('ui_preview')
            approval.get_by_role('button', name='Approve once').click()
            expect(page.locator('.agent-badge')).to_have_text('completed')
            expect(page.locator('#agent-chat')).to_contain_text('Implemented up/down duration buttons')
            actual = page.evaluate('ferrite.getSnapshot().files')
            assert actual == {**original, **fixture.expected}
            studio = page.locator('.ui-studio')
            expect(studio.locator('.studio-status')).to_have_attribute('data-kind', 'ready')
            studio.get_by_role('button', name='Interact', exact=True).click()
            preview = studio.frame_locator('.studio-preview')
            slider = preview.get_by_role('slider', name='Duration', exact=True)
            expect(slider).to_have_value('10')
            preview.get_by_role('button', name='Increase duration', exact=True).click()
            expect(slider).to_have_value('11')
            preview.get_by_role('button', name='Decrease duration', exact=True).click()
            expect(slider).to_have_value('10')
            for limit, button in [('0', 'Decrease duration'), ('30', 'Increase duration')]:
                slider.press('Home' if limit == '0' else 'End')
                preview.get_by_role('button', name=button, exact=True).click()
                expect(slider).to_have_value(limit)
            page.locator('[data-agent-tab="changes"]').click()
            expect(page.locator('.agent-changes')).to_contain_text('src/main.ui.rs')
            expect(page.locator('.agent-changes')).to_contain_text('src/model.rs')
            page.screenshot(path=str(OUT / 'timer-coding.png'))
            records = page.evaluate('''() => new Promise((resolve, reject) => {
                const request = indexedDB.open('ferrite-agent-v1');
                request.onsuccess = () => { const db = request.result, tx = db.transaction('records'), read = tx.objectStore('records').getAll(); read.onsuccess = () => resolve(JSON.stringify(read.result)); tx.oncomplete = () => db.close(); };
                request.onerror = () => reject(request.error);
            })''')
            assert KEY not in records
            assert KEY not in page.evaluate('JSON.stringify({local:{...localStorage},session:{...sessionStorage}})')
            assert not errors, errors
            assert not any('/v1/' in url and '127.0.0.1' in url for url in requests), requests
            evidence = {'passed': True, 'turns': fixture.turn, 'scenario': 'Timer discovery, parallel reads, approved atomic two-file edit, real compiler worker, paged analysis artifacts, approved preview, increment/decrement and bounds', 'providerRequests': fixture.requests, 'paidProviderAccountsTested': False, 'agentBridgeStarted': False, 'errors': errors}
            (OUT / 'results.json').write_text(json.dumps(evidence, indent=2))
            print('PASS Anthropic Timer coding: seven Messages turns, paged analysis, two-file approval, real compiler/preview, button events and bounds, credential isolation', flush=True)
        except Exception:
            page.screenshot(path=str(OUT / 'failure.png'))
            (OUT / 'failure.json').write_text(json.dumps({'traceback': traceback.format_exc(), 'errors': errors, 'turns': fixture.turn, 'body': page.locator('body').inner_text()[-14000:]}, indent=2).replace(KEY, '[REDACTED]'))
            raise
        finally:
            context.close()
            browser.close()
            server.shutdown()


if __name__ == '__main__':
    run()
