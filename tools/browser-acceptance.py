#!/usr/bin/env python3
"""Real Chromium acceptance tests. Default: HTTP origin + production worker bundles.

FERRITE_MEMORY_TEST=1 is a restricted-container mode: the same production modules
and classic worker bundles are loaded from in-memory blob URLs, with no navigation.
It does not test HTTP delivery, browser persistence or native network integration.
"""
import json
import os
import posixpath
import re
import subprocess
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = Path(os.environ.get('FERRITE_BROWSER_OUTPUT', str(ROOT / 'artifacts' / 'browser')))
MEMORY = os.environ.get('FERRITE_MEMORY_TEST') == '1'
OUTPUT.mkdir(parents=True, exist_ok=True)


def memory_document(page):
    modules = {str(p.relative_to(ROOT)): p.read_text() for p in (ROOT / 'src').rglob('*.js')}
    definitions, visited = [], set()

    def visit(path):
        if path in visited:
            return
        visited.add(path)
        source, replacements = modules[path], []
        for match in re.finditer(r'''(?m)(?:import|export)\s[^\n]*?\sfrom\s*(['"])([^'"]+)\1''', source):
            if not match.group(2).startswith('.'):
                continue
            target = posixpath.normpath(posixpath.join(posixpath.dirname(path), match.group(2)))
            visit(target)
            replacements.append({'start': match.start(2) - 1, 'end': match.end(2) + 1, 'target': target, 'url': False})
        for match in re.finditer(r'''new URL\((['"])([^'"]+)\1,\s*import.meta.url\)''', source):
            target = posixpath.normpath(posixpath.join(posixpath.dirname(path), match.group(2)))
            visit(target)
            replacements.append({'start': match.start(), 'end': match.end(), 'target': target, 'url': True})
        definitions.append({'path': path, 'source': source, 'replacements': sorted(replacements, key=lambda r: r['start'], reverse=True)})

    visit('src/ui/main.js')
    entry = page.evaluate('''definitions => {
      const urls={};
      for(const module of definitions){
        let source=module.source;
        for(const r of module.replacements){let text=JSON.stringify(urls[r.target]);if(r.url)text='new URL('+text+')';source=source.slice(0,r.start)+text+source.slice(r.end);}
        urls[module.path]=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
      }
      return urls['src/ui/main.js'];
    }''', definitions)
    html = (ROOT / 'index.html').read_text().replace('<link rel="stylesheet" href="./styles/ide.css">', '<style>' + (ROOT / 'styles/ide.css').read_text() + '</style>')
    page.set_content(html.replace('./src/ui/main.js', entry), wait_until='load')


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def run():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}/'
    results, errors = [], []
    native_process = None
    with sync_playwright() as playwright:
        executable = os.environ.get('CHROMIUM_EXECUTABLE')
        browser = playwright.chromium.launch(executable_path=executable, headless=True, args=['--no-sandbox'])
        context = browser.new_context(viewport={'width': 1600, 'height': 1000}, accept_downloads=True)
        page = context.new_page()
        page.set_default_timeout(12000)
        page.on('pageerror', lambda error: errors.append(str(error)))

        def case(name, action):
            start = time.perf_counter()
            action()
            results.append({'name': name, 'status': 'passed', 'ms': round((time.perf_counter() - start) * 1000, 2)})
            print('PASS ' + name, flush=True)

        def status_success():
            expect(page.locator('#status')).to_have_attribute('data-kind', 'success')

        def select_sample(name):
            page.locator('#sample-select').select_option(label=name)
            status_success()

        def show_tool(name):
            # Palette always opens a window; rail buttons intentionally toggle it.
            page.locator('#search-everywhere').click()
            page.get_by_role('textbox', name='Search Everywhere').fill('Show ' + name + ' tool window')
            page.get_by_role('textbox', name='Search Everywhere').press('Enter')

        def run_program(expected):
            page.locator('#run').click()
            expect(page.locator('#status')).to_have_text('Process finished successfully')
            expect(page.locator('#terminal')).to_have_text(expected)

        try:
            if MEMORY:
                memory_document(page)
            else:
                page.goto(base, wait_until='networkidle')
            case('startup and typed compiler integration', status_success)
            case('default multi-file trait sample executes', lambda: run_program('rectangle area = 42\ntriangle area = 20\n'))
            page.screenshot(path=str(OUTPUT / 'ide.png'))

            def stages():
                names = page.locator('#stage-select option').all_text_contents()
                assert len(names) == 19, names
                for name in names:
                    page.locator('#stage-select').select_option(label=name)
                    expect(page.locator('#inspector-content')).not_to_be_empty()
                assert page.locator('#inspector-content .generated-line').count() > 100
            case('all 19 compiler stage adapters render', stages)

            def source_navigation():
                page.locator('#stage-select').select_option(label='Tokens')
                target = page.locator('.token-chip[data-source-file="src/geometry.rs"]').filter(has_text='trait').first
                start, end = int(target.get_attribute('data-source-start')), int(target.get_attribute('data-source-end'))
                target.click()
                expect(page.locator('#active-path')).to_have_text('src/geometry.rs')
                selection = page.locator('#source').evaluate('e=>[e.selectionStart,e.selectionEnd]')
                assert selection == [start, end], selection
                source = page.locator('#source').input_value()
                offset = source.index('width')
                page.locator('#source').evaluate('(e,p)=>{e.focus();e.setSelectionRange(p,p+5);e.dispatchEvent(new Event("select"));}', offset)
                expect(page.locator('.token-chip.source-selected').first).to_have_text('width')
            case('token ↔ source selection across multiple files', source_navigation)

            def graph_navigation():
                page.locator('#stage-select').select_option(label='MIR / CFG')
                page.locator('#instance-select').select_option('geometry::Rect::area<>')
                line = page.locator('.ir-line.source-link').first
                start, end = int(line.get_attribute('data-source-start')), int(line.get_attribute('data-source-end'))
                line.click()
                assert page.locator('#source').evaluate('e=>[e.selectionStart,e.selectionEnd]') == [start, end]
                page.locator('#stage-select').select_option(label='Call Graph')
                assert page.locator('.graph-edge').count() >= 4
            case('MIR instruction selection and resolved call-graph edges', graph_navigation)

            def automatic_compilation():
                page.locator('#project-tree button[data-file="src/main.rs"]').click()
                source = page.locator('#source').input_value().replace('width: 7', 'width: 8')
                page.locator('#source').fill(source)
                page.wait_for_function('window.ferrite.getBuild()?.unit.files.some(f=>f.file==="src/main.rs" && f.source.includes("width: 8"))')
                status_success()
                run_program('rectangle area = 48\ntriangle area = 20\n')
                page.locator('#auto-check').uncheck()
                page.locator('#source').fill(source + '\n// no automatic compile\n')
                expect(page.locator('#inspector-content')).to_contain_text('older source revision')
                page.wait_for_timeout(450)
                expect(page.locator('#status')).to_contain_text('Modified')
                page.locator('#check').click()
                status_success()
                page.locator('#auto-check').check()
            case('auto-check, stale-data invalidation and manual mode', automatic_compilation)

            def files():
                page.locator('#file-new').click()
                page.locator('dialog input[name="value"]').fill('src/notes.rs')
                page.get_by_role('button', name='Create file', exact=True).click()
                expect(page.locator('#active-path')).to_have_text('src/notes.rs')
                page.locator('#source').fill('// document retained across tabs\n')
                page.locator('#project-tree button[data-file="src/main.rs"]').click()
                page.locator('#project-tree button[data-file="src/notes.rs"]').click()
                expect(page.locator('#source')).to_have_value('// document retained across tabs\n')
                page.locator('#file-rename').click()
                page.locator('dialog input[name="value"]').fill('src/renamed.rs')
                page.get_by_role('button', name='Rename', exact=True).last.click()
                expect(page.locator('#active-path')).to_have_text('src/renamed.rs')
                page.locator('#file-delete').click()
                page.get_by_role('button', name='Delete file', exact=True).click()
                page.wait_for_function('!Object.hasOwn(window.ferrite.getSnapshot().files,"src/renamed.rs")')
                status_success()
            case('multi-file create, tab switching, rename and delete', files)

            def docking():
                show_tool('Compiler')
                source = page.locator('[data-dock="right"] button[data-panel="compiler"]')
                destination = page.locator('[data-dock="bottom"] .tool-tabs')
                transfer = page.evaluate_handle('new DataTransfer()')
                source.dispatch_event('dragstart', {'dataTransfer': transfer})
                destination.dispatch_event('dragover', {'dataTransfer': transfer})
                destination.dispatch_event('drop', {'dataTransfer': transfer})
                expect(page.locator('[data-dock="bottom"] button[data-panel="compiler"]')).to_be_visible()
                tab = page.locator('[data-dock="bottom"] button[data-panel="compiler"]')
                tab.dblclick()
                expect(page.locator('.floating-tool')).to_be_visible()
                page.locator('.floating-tool').get_by_role('button', name='Dock', exact=True).click()
                expect(page.locator('.floating-tool')).to_have_count(0)
                page.locator('#layout-reset').click()
                splitter = page.locator('[data-resize="right"]')
                before = page.locator('[data-dock="right"]').bounding_box()['width']
                splitter.focus()
                splitter.press('ArrowLeft')
                after = page.locator('[data-dock="right"]').bounding_box()['width']
                assert after > before, (before, after)
            case('dock move, floating tool, redock, reset and keyboard resize', docking)

            def debugger():
                select_sample('Control-flow and Fibonacci')
                page.locator('#debug').click()
                expect(page.locator('#status')).to_contain_text('Paused')
                expect(page.locator('.stack-frame')).not_to_have_count(0)
                page.get_by_role('button', name='Step instruction', exact=True).click()
                expect(page.locator('.debug-summary')).to_contain_text('1 instructions')
                page.get_by_role('button', name='Step line', exact=True).click()
                page.get_by_role('button', name='Resume', exact=True).click()
                expect(page.locator('#status')).to_have_text('Process finished successfully')
                show_tool('Run')
                expect(page.locator('#terminal')).to_have_text('fib(10) = 55\n')
                page.locator('#stage-select').select_option(label='MIR / CFG')
                page.locator('#instance-select').select_option('fib<>')
                assert page.locator('.graph-edge').count() >= 4
                page.get_by_role('button', name='Fit', exact=True).click()
                page.screenshot(path=str(OUTPUT / 'control-flow.png'))
            case('actual MIR debugger stepping, frames, run and graph', debugger)

            def unit_tests():
                select_sample('Unit tests · ignored & expected panic')
                page.locator('#test').click()
                expect(page.locator('#status')).to_have_text('4 tests · 0 failed')
                assert page.locator('.test-result.passed').count() == 3
                assert page.locator('.test-result.ignored').count() == 1
            case('test harness runs tests, ignore and should_panic', unit_tests)

            def negative_diagnostics():
                page.locator('#sample-select').select_option(label='Ownership diagnostic · use after move')
                expect(page.locator('#status')).to_have_attribute('data-kind', 'error')
                diagnostic = page.locator('.problem-item .source-link')
                expect(diagnostic).to_contain_text('E0382')
                diagnostic.click()
                assert page.locator('#source').evaluate('e=>e.selectionEnd>e.selectionStart')
            case('ownership diagnostics navigate exact source ranges', negative_diagnostics)

            def persistence_and_export():
                select_sample('Pattern control flow · if let / while let')
                page.locator('#file-save').click()
                if not MEMORY:
                    page.reload(wait_until='networkidle')
                    status_success()
                    expect(page.locator('#source')).to_contain_text('')  # textarea value checked below
                    assert 'while let' in page.locator('#source').input_value()
                with page.expect_download() as download:
                    page.locator('#file-export').click()
                target = OUTPUT / 'project.ferrite.json'
                download.value.save_as(target)
                snapshot = json.loads(target.read_text())
                assert snapshot['format'] == 'ferrite-project-v1'
                assert set(snapshot) == {'format', 'files'}
                page.locator('#import-input').set_input_files(target)
                status_success()
                assert 'while let' in page.locator('#source').input_value()
            case('snapshot export/import and HTTP-mode persistence', persistence_and_export)

            def cancellation():
                page.locator('#source').fill('fn main(){ loop {} }')
                status_success()
                page.locator('#run').click()
                page.locator('#stop').click()
                expect(page.locator('#status')).to_have_text('Stopped')
                select_sample('Geometry lab · traits & modules')
                run_program('rectangle area = 42\ntriangle area = 20\n')
            case('cancel and recover without obsolete worker output', cancellation)

            def closure_capture_view():
                select_sample('Closures · capture modes & call traits')
                run_program('scaled 42\nstate 2 3\nowned payload\n')
                page.locator('#stage-select').select_option(label='Closure captures')
                for text in ['FnMut', 'FnOnce', 'shared borrow', 'mutable borrow', 'move']:
                    expect(page.locator('#inspector-content')).to_contain_text(text)
                page.locator('#inspector-content .source-link').first.click()
                start, end = page.locator('#source').evaluate('e=>[e.selectionStart,e.selectionEnd]')
                assert end > start
                select_sample('Geometry lab · traits & modules')
            case('closure captures execute and navigate explicit callable environments', closure_capture_view)

            def cargo_configuration():
                select_sample('Conditional build · Cargo features & cfg')
                run_program('baseline false\n')
                show_tool('Cargo')
                page.locator('input[data-feature="fast"]').check()
                page.wait_for_function('window.ferrite.getBuild()?.plan.features["Cargo.toml"].enabled.includes("fast")')
                run_program('accelerated true\n')
                page.locator('#stage-select').select_option(label='Configuration')
                expect(page.locator('#inspector-content')).to_contain_text('feature = "fast"')
                assert page.locator('#inspector-content .source-link').count() > 0
                page.locator('input[data-feature="fast"]').uncheck()
                page.wait_for_function('window.ferrite.getBuild() && !window.ferrite.getBuild().plan.features["Cargo.toml"].enabled.includes("fast")')
                run_program('baseline false\n')
                select_sample('Geometry lab · traits & modules')
            case('Cargo feature toggles update actual cfg lowering and source-linked decisions', cargo_configuration)

            if os.environ.get('FERRITE_NATIVE_TEST') == '1' and not MEMORY:
                native_process = subprocess.Popen(['node', 'tools/cargo-bridge.mjs', '--trust-projects', '--origin', base.rstrip('/'), '--port', '0'], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                address_line = native_process.stdout.readline().strip()
                token_line = native_process.stdout.readline().strip()
                address = address_line.removeprefix('Ferrite native Cargo bridge: ')
                token = token_line.removeprefix('Bearer token (keep private): ')
                assert address.startswith('http://127.0.0.1:') and len(token) >= 32

                def native_cargo():
                    page.locator('#sample-select').select_option(label='Native Rust · async, closures & macros')
                    expect(page.locator('#status')).to_contain_text('connect Native Cargo')
                    page.locator('#native-connect').click()
                    page.get_by_role('textbox', name='Cargo bridge address').fill(address)
                    page.get_by_role('textbox', name='Cargo bridge bearer token').fill(token)
                    connect = page.get_by_role('button', name='Connect', exact=True)
                    expect(connect).to_be_disabled()
                    page.get_by_role('checkbox', name='I trust this project and authorize native code execution.').check()
                    connect.click()
                    expect(page.locator('#status')).to_contain_text('Connected to the trusted native Cargo')
                    page.locator('#run').click()
                    expect(page.locator('#status')).to_contain_text('exit 0', timeout=60000)
                    show_tool('Run')
                    expect(page.locator('#terminal')).to_contain_text('Hello, native Rust! [1, 4, 9, 16, 25]')
                    assert not page.evaluate('(token)=>JSON.stringify(localStorage).includes(token)', token)
                    assert token not in json.dumps(page.evaluate('window.ferrite.getSnapshot()'))
                    page.locator('#auto-check').uncheck()
                    page.locator('#source').fill('fn main() { let wrong: u32 = "no"; println!("{}",wrong); }')
                    page.locator('#check').click()
                    expect(page.locator('#status')).to_have_attribute('data-kind', 'error', timeout=60000)
                    error_item = page.locator('.problem-item[data-code="E0308"]')
                    expect(error_item).to_have_count(1)
                    expect(error_item).to_contain_text('mismatched types')
                    error_item.locator('.source-link').click()
                    assert page.locator('#source').evaluate('e=>e.selectionEnd>e.selectionStart')
                    show_tool('Cargo')
                    page.get_by_role('button', name='Disconnect', exact=True).click()
                    page.locator('#auto-check').check()
                    select_sample('Geometry lab · traits & modules')
                case('real authenticated Cargo bridge runs full Rust and maps native diagnostics', native_cargo)

            def mobile():
                page.set_viewport_size({'width': 390, 'height': 844})
                page.locator('[data-tool="compiler"]').click()
                expect(page.locator('.floating-tool')).to_be_visible()
                box = page.locator('.floating-tool').bounding_box()
                assert box['x'] >= 0 and box['width'] <= 390
                page.screenshot(path=str(OUTPUT / 'mobile.png'))
            case('small-screen compiler tool can open as a floating window', mobile)
            assert not errors, errors
            (OUTPUT / 'results.json').write_text(json.dumps({'mode': 'in-memory' if MEMORY else 'http', 'cases': results, 'browserErrors': errors}, indent=2))
            print(f'PASS {len(results)} browser acceptance cases ({"in-memory" if MEMORY else "HTTP"})', flush=True)
        except Exception as error:
            page.screenshot(path=str(OUTPUT / 'failure.png'))
            (OUTPUT / 'failure.json').write_text(json.dumps({'error': str(error), 'cases': results, 'browserErrors': errors, 'status': page.locator('#status').inner_text()}, indent=2))
            raise
        finally:
            browser.close()
            if native_process is not None:
                native_process.terminate()
                try:
                    native_process.communicate(timeout=10)
                except subprocess.TimeoutExpired:
                    native_process.kill()
                    native_process.communicate(timeout=3)
            server.shutdown()


if __name__ == '__main__':
    run()
