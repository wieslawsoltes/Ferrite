#!/usr/bin/env python3
"""Compiler output across Cargo samples, UI commands, retained tabs and failures.

CI uses normal HTTP, including cold reload from a persisted UI workspace. Restricted
memory delivery exercises the same modules but explicitly skips persistence.
"""
import json
import os
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from designer_browser_support import memory_document

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/compiler-output'
MEMORY = os.environ.get('FERRITE_MEMORY_TEST') == '1'


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
            browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE'), args=['--no-sandbox'])
            page = browser.new_page(viewport={'width': 1800, 'height': 1080}, accept_downloads=True)
            page.set_default_timeout(15000)
            page.on('pageerror', lambda error: errors.append(str(error)))
            if MEMORY:
                memory_document(page)
            else:
                page.goto(f'http://127.0.0.1:{server.server_port}/')

            def check(name):
                checks.append(name)
                print('PASS ' + name, flush=True)

            def current(frontend=None):
                page.wait_for_function('window.ferrite?.getBuild() && ferrite.getBuildRevision() === ferrite.getRevision()')
                if frontend:
                    page.wait_for_function('(value) => ferrite.getBuild()?.frontend === value', arg=frontend)
                expect(page.locator('#stage-select')).to_be_enabled()

            def command(name):
                page.locator('#search-everywhere').click()
                page.get_by_role('textbox', name='Search Everywhere').fill(name)
                page.get_by_role('dialog', name='Search Everywhere').get_by_role('button', name=name, exact=True).click()

            def show_tool(name):
                command(f'Show {name} tool window')

            def sample(sample_id, add=False):
                page.locator('#file-samples').click()
                page.locator(f'[data-sample="{sample_id}"]').click()
                page.get_by_role('button', name='Add to current project' if add else 'Open as new project', exact=True).click()

            def ready():
                expect(page.locator('.ui-studio .studio-status')).to_have_attribute('data-kind', 'ready')

            def mode(name):
                page.get_by_role('toolbar', name='Document layout').get_by_role('button', name=name, exact=True).click()

            current()
            assert page.locator('#stage-select option').count() == 21
            check('ordinary startup populates the shared compiler inspector')
            page.locator('#auto-check').uncheck()
            sample('rust-0')
            current()
            expect(page.locator('#status')).to_have_attribute('data-kind', 'success')
            assert not page.evaluate('!!ferrite.getBuild().frontend')
            with page.expect_download() as downloaded:
                page.locator('#build').click()
            assert downloaded.value.suggested_filename == 'ferrite-generated.mjs'
            expect(page.locator('#terminal')).to_be_visible()
            expect(page.locator('#terminal')).to_contain_text('Build succeeded')
            expect(page.locator('#inspector-content')).to_be_visible()
            check('opening a Rust sample compiles with auto-check off and Build reveals its output')

            sample('7guis-counter')
            current('rust-ui')
            ready()
            check('UI sample preview publishes a complete build without requiring a Rust main')
            if not MEMORY:
                page.reload()
                current('rust-ui')
                ready()
                check('cold persisted UI-only workspace initializes compiler output on reload')

            show_tool('Compiler')
            names = page.locator('#stage-select option').all_text_contents()
            assert len(names) == 21 and 'UI source nodes' in names and 'Cargo' not in names, names
            for name in names:
                page.locator('#stage-select').select_option(label=name)
                expect(page.locator('#inspector-content')).not_to_be_empty()
            assert page.locator('.generated-line').count() > 100
            page.locator('#stage-select').select_option(label='MIR / CFG')
            expect(page.locator('#instance-select')).to_have_value('app<>')
            assert page.locator('#inspector-content .graph-node').count() > 0
            show_tool('Profile')
            expect(page.locator('.profile-hero')).to_be_visible()
            expect(page.locator('.profile-counts')).to_contain_text('Instances')
            expect(page.locator('.parallel-profile')).to_have_count(0)
            check('all UI pipeline stages, real MIR graphs, emitted code and measured profile render')

            page.locator('#run').click()
            ready()
            current('rust-ui')
            expect(page.locator('#terminal')).to_contain_text('Rust UI run:')
            expect(page.locator('#terminal')).to_be_visible()
            expect(page.locator('#inspector-content')).to_be_visible()
            frame = page.frame_locator('.ui-studio .studio-preview')
            frame.get_by_role('button', name='Count', exact=True).click()
            expect(frame.get_by_label('Count', exact=True)).to_have_value('1')
            page.locator('#check').click()
            expect(page.locator('#status')).to_contain_text('preview state unchanged')
            current('rust-ui')
            expect(frame.get_by_label('Count', exact=True)).to_have_value('1')
            check('Run exposes both output and visualizations; Check preserves live UI state')

            for backend in ['browser', 'wasm']:
                page.locator('#backend-select').select_option(backend)
                with page.expect_download() as downloaded:
                    page.locator('#build').click()
                download = downloaded.value
                assert download.suggested_filename.endswith('.html')
                html = Path(download.path()).read_text()
                assert html.startswith('<!doctype html>') and 'UI source nodes' not in html
                exported = browser.new_page()
                exported.on('pageerror', lambda error: errors.append(str(error)))
                exported.set_content(html)
                exported.get_by_role('button', name='Count', exact=True).click()
                expect(exported.get_by_label('Count', exact=True)).to_have_value('1')
                exported.close()
                current('rust-ui')
                expect(page.locator('#terminal')).to_contain_text('Standalone Rust UI HTML exported')
            check('JavaScript and Wasm Build retain compiler results and export independently runnable apps')

            page.locator('#backend-select').select_option('browser')
            page.locator('#optimize').uncheck()
            page.locator('#check').click()
            current('rust-ui')
            assert page.evaluate('ferrite.getBuild().optimize') is False
            assert page.evaluate('ferrite.getBuild().optimizations.length') == 0
            check('the IDE optimization toggle reaches the UI compiler')

            mode('Code')
            saved = page.locator('#source').input_value()
            page.locator('#source').fill('fn app() -> ui::Node { unknown_function() }')
            page.locator('#check').click()
            expect(page.locator('.compiler-build-summary')).to_have_attribute('data-kind', 'error')
            expect(page.locator('#stage-select')).to_be_disabled()
            assert page.evaluate('ferrite.getBuildRevision()') == -1
            show_tool('Compiler')
            expect(page.locator('#inspector-content')).to_contain_text('Fix the diagnostic')
            page.locator('#source').fill(saved)
            page.locator('#check').click()
            current('rust-ui')
            expect(page.locator('.compiler-build-summary')).to_have_attribute('data-kind', 'success')
            check('failed compilation shows an explicit error, disables stale artifacts and recovers')

            page.locator('#run').click()
            ready()
            current('rust-ui')
            first = page.evaluate('ferrite.getUIState().entryFile')
            sample('7guis-counter', add=True)
            ready()
            current('rust-ui')
            second = page.evaluate('ferrite.getUIState().entryFile')
            assert first != second
            page.locator('#document-tabs').locator(f'[data-file="{first}"]').click()
            ready()
            current('rust-ui')
            assert page.evaluate('ferrite.getBuild().file') == first
            page.locator('#document-tabs').locator(f'[data-file="{second}"]').click()
            ready()
            current('rust-ui')
            assert page.evaluate('ferrite.getBuild().file') == second
            show_tool('Compiler')
            page.locator('#stage-select').select_option(label='Tokens')
            target = page.locator(f'.token-chip[data-source-file="{second}"]').filter(has_text='app').first
            start = int(target.get_attribute('data-source-start'))
            target.click()
            expect(page.locator('#active-path')).to_have_text(second)
            assert page.locator('#source').evaluate('element => element.selectionStart') == start
            mode('Design')
            expect(page.locator('#inspector-content')).to_be_visible()
            page.locator('#stage-select').select_option(label='MIR / CFG')
            page.screenshot(path=str(OUT / 'ui-compiler-results.png'))
            check('retained tabs restore their own compiler artifacts and source links without hiding tools')
            assert not errors, errors
            browser.close()
    finally:
        server.shutdown()
        (OUT / 'results.json').write_text(json.dumps({'delivery': 'memory' if MEMORY else 'http', 'checks': checks, 'errors': errors}, indent=2))
    print(json.dumps({'checks': len(checks), 'errors': errors}), flush=True)


if __name__ == '__main__':
    run()
