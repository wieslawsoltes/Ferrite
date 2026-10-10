#!/usr/bin/env python3
"""Production UI debugger in Chromium: actual project import, controls and opaque frames."""
import json
import os
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from designer_browser_support import memory_document

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts' / 'ui-debugger'
MEMORY = os.environ.get('FERRITE_MEMORY_TEST') == '1'
FILE = 'src/app.ui.rs'
SOURCE = '''mod math;
fn app() -> ui::Node {
    let count = ui::use_state(0);
    view! { <div><button on:click={move || {
        let previous = ui::get(count);
        let next = math::bump(previous);
        ui::set(count, next);
    }}>Increase</button><output>{ui::get(count)}</output></div> }
}'''
HELPER = '''pub fn bump(value: i64) -> i64 {
    let increment = 1_i64;
    value + increment
}'''
SECOND = '''fn app() -> ui::Node {
    let count = ui::use_state(0);
    view! { <div><button on:click={move || ui::update(count, |n| n+1)}>Second</button><output>{ui::get(count)}</output></div> }
}'''

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
            page = browser.new_page(viewport={'width':1800,'height':1080})
            page.set_default_timeout(15000)
            page.on('pageerror', lambda error: errors.append(str(error)))
            if MEMORY: memory_document(page)
            else: page.goto(f'http://127.0.0.1:{server.server_port}/')
            page.wait_for_function('!!window.ferrite')
            workspace = {'format':'ferrite-project-v1', 'name':'DebuggerRegression', 'files':{FILE:SOURCE, 'src/math.rs':HELPER, 'src/second.ui.rs':SECOND}, 'active':FILE, 'tabs':[FILE,'src/second.ui.rs'], 'documents':{FILE:{'mode':'split'}}, 'breakpoints':{'src/math.rs':[3]}}
            page.locator('#import-input').set_input_files({'name':'debugger.ferrite.json','mimeType':'application/json','buffer':json.dumps(workspace).encode()})
            studio = page.locator('.ui-studio')
            iframe = page.locator('.ui-studio .studio-preview')
            frame = page.frame_locator('.ui-studio .studio-preview')
            main_debug = page.locator('.tool-panel[data-debug-status]')
            source = page.locator('#source')
            def ready():
                expect(studio.locator('.studio-status')).to_have_attribute('data-kind','ready')
                page.wait_for_function('!!ferrite.getUIState().snapshot')
            def status(value):
                page.wait_for_function('(value)=>ferrite.getUIState().snapshot?.debugger?.status===value',arg=value)
            def key(value, in_preview=False):
                if in_preview: frame.locator('button').focus()
                else: source.focus()
                page.keyboard.press(value)
            def check(name): checks.append(name); print('PASS '+name, flush=True)
            def tab(name): page.locator('#document-tabs [role=tab]').filter(has_text=name).click()
            ready()
            frame.get_by_role('button',name='Increase',exact=True).click();expect(frame.locator('output')).to_have_text('1')
            iframe.evaluate("node=>node.dataset.debugIdentity='retained'")
            page.locator('#debug').click();status('waiting')
            expect(iframe).to_have_attribute('data-debug-identity','retained');expect(frame.locator('output')).to_have_text('1')
            frame.get_by_role('button',name='Increase',exact=True).click();status('paused')
            page.wait_for_function("ferrite.getUIState().snapshot.debugger.state.next.file==='src/math.rs'")
            expect(source).to_have_value(HELPER)
            assert page.evaluate('ferrite.getUIState().entryFile') == FILE
            assert page.evaluate('ferrite.getUIState().snapshot.debugger.state.next.line') == 3
            expect(main_debug.locator('.stack-frame')).to_have_count(2)
            expect(main_debug.get_by_label('Locals and registers')).to_contain_text('increment')
            check('Debug attaches without remounting; helper breakpoint reveals original source and real call frames/locals')
            page.screenshot(path=str(OUT/'paused-helper.png'))

            # Changes to the editor gutter take effect without recompiling or re-arming.
            page.locator('#editor-root .gutter-line[data-line="3"]').click()
            page.wait_for_function('ferrite.getUIState().snapshot.debugger.breakpoints.length===0')
            steps=page.evaluate('ferrite.getUIState().snapshot.debugger.state.steps')
            key('F11',in_preview=True)
            page.wait_for_function('(before)=>ferrite.getUIState().snapshot.debugger.state.steps>before',arg=steps)
            advanced=page.evaluate('ferrite.getUIState().snapshot.debugger.state.steps')
            key('Shift+F10')
            page.wait_for_function('(before)=>ferrite.getUIState().snapshot.debugger.state.steps<before',arg=advanced)
            key('F5',in_preview=True);status('waiting');expect(frame.locator('output')).to_have_text('2')
            assert page.evaluate('ferrite.getUIState().snapshot.debugger.armed')
            key('Shift+F5',in_preview=True);status('disarmed')
            frame.get_by_role('button',name='Increase',exact=True).click();expect(frame.locator('output')).to_have_text('3')
            check('live gutter edits, F11, reverse source stepping, F5 and Shift+F5 work across the opaque iframe boundary')

            # Step over the helper, step out the event, reverse from terminal state.
            tab('app.ui.rs');page.locator('#editor-root .gutter-line[data-line="6"]').click()
            key('F5');status('waiting');frame.get_by_role('button',name='Increase',exact=True).click();status('paused')
            page.locator('#editor-root .gutter-line[data-line="6"]').click()
            page.wait_for_function('ferrite.getUIState().snapshot.debugger.breakpoints.length===0')
            key('F10');page.wait_for_function('ferrite.getUIState().snapshot.debugger.state.next.line===7')
            key('Shift+F11');status('completed');expect(frame.locator('output')).to_have_text('3')
            expect(main_debug.get_by_role('button',name='Back instruction',exact=True)).to_be_enabled()
            main_debug.get_by_role('button',name='Back instruction',exact=True).click();status('paused')
            main_debug.get_by_role('button',name='Resume',exact=True).click();status('waiting');expect(frame.locator('output')).to_have_text('4')
            check('F10 steps over helpers, Shift+F11 finishes callbacks, and reverse remains enabled at the staged terminal state')

            # The active view's controls must never resume another retained callback.
            main_debug.get_by_role('button',name='Pause',exact=True).click()
            frame.get_by_role('button',name='Increase',exact=True).click();status('paused')
            tab('second.ui.rs');ready();frame.get_by_role('button',name='Second',exact=True).click();expect(frame.locator('output')).to_have_text('1')
            assert not page.evaluate('ferrite.getUIState().snapshot.debugger.armed')
            key('F5');status('waiting');frame.get_by_role('button',name='Second',exact=True).click();status('paused')
            key('Shift+F5');status('disarmed');expect(frame.locator('output')).to_have_text('1')
            tab('app.ui.rs');status('paused');expect(frame.locator('output')).to_have_text('4')
            key('F5');status('waiting');expect(frame.locator('output')).to_have_text('5')
            check('retained view sessions isolate paused state, Stop and Resume when switching documents')

            # A pending timer breakpoint must reveal source even in Code-only mode.
            timer = '''fn app()->ui::Node { let count=ui::use_state(0);
    ui::interval(2000,move |delta:f64| { ui::set(count,ui::get(count)+1); });
    view! { <output>{ui::get(count)}</output> }
}'''
            key('Shift+F5');status('disarmed');source.fill(timer);ready()
            page.locator('#editor-root .gutter-line[data-line="2"]').click()
            page.locator('#debug').click();status('waiting')
            page.locator('.document-mode[data-mode=code]').click()
            status('paused')
            expect(page.locator('.document-workspace')).to_have_attribute('data-mode','split')
            assert page.evaluate('ferrite.getSelection().file') == FILE
            page.locator('#stop').click();status('disarmed')
            check('timer callbacks remain debuggable and a breakpoint exits Code-only mode to reveal its source')

            # Source replacement revokes the old preview capability immediately.
            source.fill(SOURCE);ready();page.locator('#debug').click();status('waiting')
            frame.get_by_role('button',name='Increase',exact=True).click()
            page.wait_for_function("ferrite.getUIState().snapshot.debugger.status!=='running'")
            source.fill(SOURCE.replace('Increase','Updated'));ready()
            assert not page.evaluate('ferrite.getUIState().snapshot.debugger.armed')
            expect(frame.get_by_role('button',name='Updated',exact=True)).to_be_visible()
            check('editing source invalidates debugger state; a replacement preview never inherits stale arming or messages')
            page.screenshot(path=str(OUT/'debugger-workspace.png'))
            assert not errors, errors
            browser.close()
    finally:
        server.shutdown();server.server_close()
        (OUT/'results.json').write_text(json.dumps({'mode':'memory' if MEMORY else 'http','checks':checks,'errors':errors},indent=2)+'\n')
    print(json.dumps({'checks':len(checks),'pageErrors':errors}), flush=True)

if __name__ == '__main__':
    run()
