#!/usr/bin/env python3
"""Execute the actual rustc output, including independent offline file navigation."""
import json
import os
from designer_browser_support import memory_document
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from workbench_browser_support import show_workspace_actions
from playwright.sync_api import sync_playwright, expect
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/native-ui'
MEMORY = os.environ.get('FERRITE_MEMORY_TEST') == '1'

def open_app(page, path=None):
    path = path or OUT / 'app.html'
    if MEMORY:
        # Identical HTML execution only: this mode does not prove file delivery.
        page.set_content(path.read_text(), wait_until='load')
    else:
        page.goto(path.as_uri())
    page.wait_for_function("window.ferriteUI && (ferriteUI.inspect().components > 0 || ferriteUI.inspect().disposed)")
    state = page.evaluate('ferriteUI.inspect()')
    assert not state['disposed'] and not state['faulted'], page.locator('body').inner_text()

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass

def run():
    OUT.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    checks, errors = [], []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE'), headless=True, args=['--no-sandbox'])
            context = browser.new_context(offline=True)
            page = context.new_page()
            page.on('pageerror', lambda e: errors.append(str(e)))
            open_app(page)
            assert page.locator('#count').inner_text() == '0'
            page.locator('#increment').click()
            page.wait_for_function("document.querySelector('#count').textContent === '1'")
            checks.append('actual rustc wasm state update in independent offline HTML')
            page.locator('#name').fill('世界 <Rust> "🦀"')
            page.wait_for_function("document.querySelector('#greeting').textContent === 'Hello, 世界 <Rust> \"🦀\"'")
            page.locator('#focus').click()
            assert page.evaluate("document.activeElement.id") == 'name'
            checks.append('owned UTF-8 event snapshots, controlled input and DOM ref')
            other = context.new_page()
            other.on('pageerror', lambda e: errors.append(str(e)))
            open_app(other)
            other.wait_for_function("document.querySelector('#count')?.textContent === '0'")
            assert page.locator('#count').inner_text() == '1'
            checks.append('independent native application instances')
            page.screenshot(path=str(OUT/'native-ui.png'), full_page=True)
            page.evaluate("ferriteUI.dispose()")
            assert page.locator('#app').inner_text() == ''
            assert page.evaluate("ferriteUI.inspect().disposed")
            checks.append('explicit native session and DOM disposal')
            # Mount the same real rustc binary through the production IDE file picker.
            ide = browser.new_context(viewport={'width': 1600, 'height': 1080}, accept_downloads=True)
            editor = ide.new_page(); editor.set_default_timeout(20000)
            editor.on('pageerror', lambda error: errors.append(str(error)))
            if MEMORY:
                memory_document(editor)
            else:
                editor.goto(f'http://127.0.0.1:{server.server_port}/')
            editor.wait_for_function('!!window.ferrite');show_workspace_actions(editor)
            editor.locator('#file-ui-view').click()
            editor.get_by_label('View file path', exact=True).fill('src/native.ui.rs')
            editor.get_by_role('button', name='Create view', exact=True).click()
            expect(editor.locator('.ui-studio .studio-status')).to_have_attribute('data-kind', 'ready')
            before = editor.evaluate('window.ferrite.getSnapshot().files')
            studio = editor.locator('.ui-studio')
            studio.get_by_label('Load trusted Cargo UI Wasm', exact=True).set_input_files(str(OUT / 'app.wasm'))
            expect(studio.locator('.studio-status')).to_have_attribute('data-kind', 'ready')
            frame = editor.frame_locator('.studio-preview')
            expect(frame.locator('#count')).to_have_text('0')
            frame.locator('#increment').click(); expect(frame.locator('#count')).to_have_text('1')
            state = editor.evaluate('window.ferrite.getUIState()')
            assert state['backend'] == 'native-wasm' and state['snapshot']['components'] == 1
            assert state['snapshot']['debugger']['supported'] is False
            assert editor.evaluate('window.ferrite.getSnapshot().files') == before
            assert editor.locator('.studio-preview').get_attribute('sandbox') == 'allow-scripts'
            assert editor.evaluate("document.querySelector('.studio-preview').contentDocument === null")
            checks.append('native Wasm file picker, opaque-origin preview, real click, inspection and unchanged workspace')
            studio.get_by_role('button', name='Settings / Export', exact=True).click()
            with editor.expect_download() as info:
                studio.get_by_role('button', name='Export HTML', exact=True).click()
            exported = OUT / 'ide-export.html'; info.value.save_as(exported)
            reopened = context.new_page(); reopened.on('pageerror', lambda error: errors.append(str(error)))
            open_app(reopened, exported)
            reopened.locator('#increment').click(); expect(reopened.locator('#count')).to_have_text('1')
            editor.screenshot(path=str(OUT / 'native-studio.png'))
            checks.append('IDE native export reopened as an independent offline application')
            assert not errors, errors
            browser.close()
    finally:
        server.shutdown(); server.server_close()
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT/'results.json').write_text(json.dumps({'mode':'memory' if MEMORY else 'offline-file', 'checks':checks,'errors':errors},indent=2))
    print(json.dumps({'checks':len(checks),'errors':errors}))

if __name__ == '__main__':
    run()
