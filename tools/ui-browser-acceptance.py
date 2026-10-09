#!/usr/bin/env python3
"""Actual Chromium: source-backed designer, isolated previews, SDK and offline exports."""
import json
import os
import runpy
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'artifacts' / 'ui-browser'
MEMORY = os.environ.get('FERRITE_MEMORY_TEST') == '1'

def open_export(page, path):
    # Restricted mode executes identical HTML; it does not test file delivery.
    if MEMORY:
        page.set_content(path.read_text(), wait_until='load')
    else:
        page.goto(path.as_uri())

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass

def run():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}/'
    results, errors = [], []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE'), headless=True, args=['--no-sandbox'])
            context = browser.new_context(viewport={'width': 1600, 'height': 1080}, accept_downloads=True)
            page = context.new_page(); page.set_default_timeout(20000)
            page.on('pageerror', lambda error: errors.append(str(error)))
            if MEMORY:
                runpy.run_path(str(ROOT / 'tools' / 'browser-acceptance.py'))['memory_document'](page)
            else:
                page.goto(base)
            page.wait_for_function('!!window.ferrite')
            page.locator('[data-panel="ui-studio"]').click()
            studio = page.locator('.ui-studio')
            studio.get_by_role('button', name='counter', exact=True).click()
            expect(studio.locator('.studio-status')).to_have_attribute('data-kind', 'ready')
            frame = page.frame_locator('.studio-preview')
            expect(frame.locator('output')).to_have_text('0')
            frame.get_by_role('button', name='Increase').click(); expect(frame.locator('output')).to_have_text('1')
            assert page.locator('.studio-preview').get_attribute('sandbox') == 'allow-scripts'
            assert page.evaluate("document.querySelector('.studio-preview').contentDocument === null")
            results.append('source example compiled; real click updates Rust state; preview has opaque origin')
            # Canvas picking updates the source selection, not a detached design-only model.
            studio.get_by_role('button', name='Pick element', exact=True).click()
            frame.locator('h1').click()
            expect(studio.get_by_label('Element tag', exact=True)).to_have_value('h1')
            studio.get_by_label('New attribute name').fill('data-design')
            # A delayed programmatic editor selection must not reconstruct focused property inputs.
            page.evaluate("""async () => { document.querySelector('#source').dispatchEvent(new Event('select')); await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); }""")
            # Reselecting the same source node must preserve unsaved inspector input.
            studio.locator('.studio-outline [aria-selected="true"]').click()
            expect(studio.get_by_label('New attribute name')).to_have_value('data-design')
            studio.get_by_label('New attribute value').fill('edited')
            studio.get_by_role('button', name='Add attribute', exact=True).click()
            expect(studio.locator('.studio-status')).to_have_attribute('data-kind', 'ready')
            expect(frame.locator('h1')).to_have_attribute('data-design', 'edited')
            assert 'data-design="edited"' in page.evaluate('Object.values(window.ferrite.getSnapshot().files).find(s=>s.includes("A little Rust"))')
            # Export the actual edited app and execute the download without network.
            with page.expect_download() as info:
                studio.get_by_role('button', name='Export HTML', exact=True).click()
            download = info.value; path = OUTPUT / 'counter.html'; download.save_as(path)
            offline = browser.new_context(viewport={'width': 900, 'height': 650}, offline=True)
            offpage = offline.new_page(); offerrors = []
            offpage.on('pageerror', lambda error: offerrors.append(str(error)))
            open_export(offpage, path); expect(offpage.locator('output')).to_have_text('0')
            offpage.get_by_role('button', name='Increase').click(); expect(offpage.locator('output')).to_have_text('1')
            assert not offerrors, offerrors
            offpage.screenshot(path=str(OUTPUT / 'offline-export.png'))
            offline.close(); results.append('canvas selection -> typed source edit -> live DOM -> offline exported file all agree')
            # Recompile each real backend, then step an event callback in MIR.
            for backend in ['wasm', 'mir', 'javascript']:
                studio.get_by_label('UI backend', exact=True).select_option(backend)
                studio.get_by_role('button', name='Preview', exact=True).click()
                expect(studio.locator('.studio-status')).to_have_attribute('data-kind', 'ready')
                frame.get_by_role('button', name='Increase').click(); expect(frame.locator('output')).to_have_text('1')
            studio.get_by_role('button', name='Arm events', exact=True).click()
            page.wait_for_function('window.ferrite.getUIState().snapshot?.debugger?.armed')
            frame.get_by_role('button', name='Increase').click()
            page.wait_for_function('!!window.ferrite.getUIState().snapshot?.debugger?.state')
            expect(frame.locator('output')).to_have_text('1')
            studio.get_by_role('button', name='Instruction', exact=True).click()
            page.wait_for_function('window.ferrite.getUIState().snapshot?.debugger?.state?.history?.available > 0')
            studio.get_by_role('button', name='Back instruction', exact=True).click()
            page.wait_for_function('window.ferrite.getUIState().snapshot?.debugger?.state?.steps === 0')
            studio.get_by_role('button', name='Continue', exact=True).click(); expect(frame.locator('output')).to_have_text('2')
            studio.get_by_role('button', name='Disarm', exact=True).click()
            results.append('Wasm/JS/MIR real DOM parity; event callback instruction stepping changes actual UI state')
            studio.get_by_role('button', name='form', exact=True).click()
            expect(studio.locator('.studio-status')).to_have_attribute('data-kind', 'ready')
            frame.get_by_label('Your name').fill('Browser')
            expect(frame.locator('h1')).to_have_text('Hello, Browser!')
            frame.get_by_role('button', name='Focus input').click(); expect(frame.locator('input')).to_be_focused()
            # Source typing is reflected in the normal workspace and recompiles.
            studio.locator('summary').filter(has_text='Rust source').click()
            source = studio.get_by_label('UI Rust source', exact=True)
            source.fill(source.input_value().replace('Hello, ', 'Welcome, '))
            assert 'Welcome, ' in page.locator('#source').input_value()
            page.locator('#source').fill(page.locator('#source').input_value().replace('Welcome, ', 'Greetings, '))
            assert 'Greetings, ' in source.input_value()
            studio.get_by_role('button', name='Preview', exact=True).click()
            expect(studio.locator('.studio-status')).to_have_attribute('data-kind', 'ready')
            expect(frame.locator('h1')).to_have_text('Greetings, Rust!')
            results.append('controlled input, DOM refs and bidirectional editor source synchronization')
            page.screenshot(path=str(OUTPUT / 'ide-ui-studio.png'))
            # Single classic-script SDK: no module import waterfall and explicit script execution.
            sdk = context.new_page(); sdk.on('pageerror', lambda error: errors.append(str(error)))
            if MEMORY:
                html = (ROOT / 'examples/ui-embed.html').read_text()
                bundle = (ROOT / 'src/sdk/ferrite.bundle.js').read_text().replace('</script', '<\\/script')
                html = html.replace('<script src="../src/sdk/ferrite.bundle.js"></script>', '<script>' + bundle + '</script>')
                sdk.set_content(html, wait_until='load')
            else:
                sdk.goto(base + 'examples/ui-embed.html')
            sdk.wait_for_function('!!window.Ferrite')
            expect(sdk.locator('#counter output')).to_have_text('0')
            sdk.locator('#counter button').click(); expect(sdk.locator('#counter output')).to_have_text('1')
            assert sdk.evaluate('Ferrite.runScripts().length') == 0
            sdk_results = sdk.evaluate('''() => {
              const result = {};
              for (const backend of ['mir', 'wasm', 'javascript']) result[backend] = Ferrite.runRust('fn main() -> i64 { 6 * 7 }', {backend}).value.toString();
              return result;
            }''')
            assert sdk_results == {'mir': '42', 'wasm': '42', 'javascript': '42'}, sdk_results
            results.append('classic-script embeddable SDK and explicit Rust script tags run without a bridge')
            sdk.screenshot(path=str(OUTPUT / 'embedded-sdk.png'))
            # Standalone Wasm/MIR exports execute with all networking disabled too.
            for backend in ['wasm', 'mir']:
                html = sdk.evaluate('''backend => Ferrite.exportHTML(Ferrite.compileUI('fn app() -> ui::Node { let n = ui::use_state(4); view! { <button on:click={move || ui::update(n, |v| v + 1)}>{ui::get(n)}</button> } }'), {backend})''', backend)
                target = OUTPUT / f'offline-{backend}.html'; target.write_text(html)
                isolated = browser.new_context(offline=True); app = isolated.new_page(); open_export(app, target)
                expect(app.locator('button')).to_have_text('4'); app.locator('button').click(); expect(app.locator('button')).to_have_text('5'); isolated.close()
            results.append('offline Wasm and MIR single-file exports execute independently')
            # Import a real multi-file project, pick a component's source, and drag its DOM.
            project_files = {
                'src/app.rs': 'mod card; fn app() -> ui::Node { view! { <div style="position:relative;width:800px;height:600px"><card::Card /></div> } }',
                'src/card.rs': 'pub fn Card() -> ui::Node { let n = ui::state(3_i64); view! { <button style="position:absolute;left:40px;top:32px;width:100px;height:40px" on:click={move || ui::modify(n, |v| v + 1)}>{ui::read(n)}</button> } }'
            }
            page.locator('#import-input').set_input_files({'name': 'ui.ferrite.json', 'mimeType': 'application/json', 'buffer': json.dumps({'format': 'ferrite-project-v1', 'files': project_files}).encode()})
            page.wait_for_function("!!window.ferrite.getSnapshot().files['src/card.rs']")
            studio.get_by_label('UI project entry file', exact=True).select_option('src/app.rs')
            studio.get_by_role('button', name='Preview', exact=True).click()
            expect(studio.locator('.studio-status')).to_have_attribute('data-kind', 'ready')
            studio.get_by_role('button', name='Pick element', exact=True).click(); frame.locator('button').click()
            expect(studio.get_by_label('UI source file', exact=True)).to_have_value('src/card.rs')
            assert page.evaluate('window.ferrite.getUIState().entryFile') == 'src/app.rs'
            studio.get_by_role('button', name='Pick element', exact=True).click()
            studio.get_by_label('Canvas editing', exact=True).select_option('move')
            rect = frame.locator('button').bounding_box()
            page.mouse.move(rect['x'] + 20, rect['y'] + 20); page.mouse.down()
            page.mouse.move(rect['x'] + 44, rect['y'] + 36, steps=4); page.mouse.up()
            expect(studio.locator('.studio-status')).to_have_attribute('data-kind', 'ready')
            page.wait_for_function("window.ferrite.getSnapshot().files['src/card.rs'].includes('left: 64px')")
            assert 'top: 48px' in page.evaluate("window.ferrite.getSnapshot().files['src/card.rs']")
            frame.locator('button').click(); expect(frame.locator('button')).to_have_text('4')
            styles = studio.get_by_label('UI application CSS').locator('..')
            if not styles.evaluate('(node) => node.open'): styles.locator('summary').click()
            studio.get_by_label('UI application CSS').fill('button { color: rgb(120, 20, 40); }')
            studio.get_by_label('UI backend', exact=True).select_option('wasm')
            studio.get_by_label('Preview width', exact=True).select_option('375px')
            saved = page.evaluate('window.ferrite.getSnapshot()')
            settings = json.loads(saved['files']['src/app.ui.json'])
            assert settings['backend'] == 'wasm' and settings['viewport'] == '375px'
            assert 'rgb(120, 20, 40)' in saved['files'][settings['stylesheet']]
            # Reload through the same public snapshot import path in both harness modes.
            page.locator('#import-input').set_input_files({'name': 'saved.ferrite.json', 'mimeType': 'application/json', 'buffer': json.dumps(saved).encode()})
            studio.get_by_label('UI project entry file', exact=True).select_option('src/app.rs')
            expect(studio.get_by_label('UI backend', exact=True)).to_have_value('wasm')
            expect(studio.get_by_label('Preview width', exact=True)).to_have_value('375px')
            studio.get_by_role('button', name='Preview', exact=True).click()
            expect(studio.locator('.studio-status')).to_have_attribute('data-kind', 'ready')
            expect(frame.locator('button')).to_have_css('color', 'rgb(120, 20, 40)')
            results.append('multi-file component picking, real pointer canvas transaction and persisted CSS/project settings round-trip')
            page.set_viewport_size({'width': 390, 'height': 844})
            page.locator('[data-tool="ui-studio"]').click()
            expect(studio).to_be_visible(); page.screenshot(path=str(OUTPUT / 'mobile-ui-studio.png'))
            results.append('UI Studio remains reachable and operable as a mobile floating tool window')
            assert not errors, errors
            browser.close()
    finally:
        server.shutdown(); server.server_close()
        (OUTPUT / 'results.json').write_text(json.dumps({'mode': 'memory' if MEMORY else 'http', 'checks': results, 'pageErrors': errors}, indent=2))
    print(json.dumps({'checks': len(results), 'pageErrors': errors}))

if __name__ == '__main__':
    run()
