#!/usr/bin/env python3
"""Actual Chromium: first-party server rendering/hydration and offline hydrated files."""
import json
import os
import subprocess
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts' / 'ui-rendering'
MEMORY = os.environ.get('FERRITE_MEMORY_TEST') == '1'

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass

def run():
    OUT.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    errors, results = [], []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE'), headless=True, args=['--no-sandbox'])
            page = browser.new_page(); page.on('pageerror', lambda error: errors.append(str(error)))
            if MEMORY:
                page.set_content('<!doctype html><main></main>')
                page.add_script_tag(content=(ROOT / 'src/sdk/ferrite.bundle.js').read_text())
            else:
                page.goto(f'http://127.0.0.1:{server.server_port}/examples/ui-embed.html')
                page.wait_for_function('!!window.Ferrite')
            code = (ROOT / 'tests/fixtures/ui-rendering-browser.js').read_text().replace('export async function', 'async function')
            results.extend(page.evaluate('async () => { ' + code + '\n return await uiRenderingBrowserTests(Ferrite); }'))
            for backend in ['javascript', 'mir', 'wasm']:
                path = OUT / f'hydrated-{backend}.html'
                subprocess.run(['node', '--input-type=module', '-e', '''
                  import {writeFileSync} from 'node:fs';
                  import {compileUI, exportHydratedHTML} from './src/sdk/Ferrite.js';
                  const a=compileUI('fn app()->ui::Node {let n=ui::state(4_i64); view!{<button on:click={move || ui::modify(n,|v|v+1)}>{ui::read(n)}</button>}}');
                  writeFileSync(process.argv[1],exportHydratedHTML(a,{backend:process.argv[2]}));
                ''', str(path), backend], cwd=ROOT, check=True)
                context = browser.new_context(offline=True)
                app = context.new_page(); app.on('pageerror', lambda error: errors.append(str(error)))
                if MEMORY:
                    app.set_content(path.read_text())
                else:
                    app.goto(path.as_uri())
                expect(app.locator('button')).to_have_text('4')
                app.locator('button').click(); expect(app.locator('button')).to_have_text('5')
                assert app.evaluate('ferriteUI.inspect().root.timeline.some(e=>e.type==="hydrate"&&e.reused)')
                context.close()
            results.append('independent offline hydrated HTML exports execute on JavaScript, MIR and actual Wasm')
            assert not errors, errors
            browser.close()
    finally:
        server.shutdown(); server.server_close()
        (OUT / 'results.json').write_text(json.dumps({'mode': 'memory' if MEMORY else 'http', 'checks': results, 'pageErrors': errors}, indent=2))
    print(json.dumps({'checks': len(results), 'pageErrors': errors}))

if __name__ == '__main__':
    run()
