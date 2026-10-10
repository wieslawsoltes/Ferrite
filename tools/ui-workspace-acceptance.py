#!/usr/bin/env python3
"""Real project/tree/tab workflows and independent file-owned designers.

HTTP is the CI default. Restricted memory mode executes the same modules but does
not claim network delivery, OS folder picking or localStorage reload coverage.
"""
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
OUT = ROOT / 'artifacts/ui-workspace'
MEMORY = os.environ.get('FERRITE_MEMORY_TEST') == '1'

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *_args): pass

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
            page.wait_for_function('!!window.ferrite');show_workspace_actions(page)
            studio = page.locator('.ui-studio')
            frame = page.frame_locator('.ui-studio .studio-preview')
            def command(name):
                page.locator('#search-everywhere').click()
                page.get_by_role('textbox', name='Search Everywhere').fill(name)
                page.get_by_role('dialog',name='Search Everywhere').get_by_role('button', name=name, exact=True).click()
            def mode(name): page.locator('.document-mode-toolbar').get_by_role('button',name=name,exact=True).click()
            def ready(path=None):
                if path: page.wait_for_function('(path) => ferrite.getUIState().entryFile === path',arg=path)
                expect(studio.locator('.studio-status')).to_have_attribute('data-kind','ready')
            def view(path):
                page.locator('#file-ui-view').click()
                page.get_by_label('View file path',exact=True).fill(path)
                page.get_by_label('View template',exact=True).select_option('counter')
                page.get_by_role('button',name='Create view',exact=True).click();ready(path)
            def tab(path): return page.locator('#document-tabs [role="tab"]').filter(has_text=path.split('/')[-1])
            def check(name): checks.append(name);print('PASS '+name,flush=True)
            page.locator('#file-project').click()
            page.get_by_label('Project name',exact=True).fill('DesignerWorkspace')
            page.get_by_role('button',name='Create project',exact=True).click();ready()
            expect(page.locator('#project-name')).to_have_text('DesignerWorkspace')
            assert page.evaluate("!!ferrite.getSnapshot().files['src/app.ui.rs']")
            expect(page.locator('#sample-select')).to_have_count(0)
            assert not studio.get_by_role('button',name='counter',exact=True).count()
            check('UI project creation is explicit and the designer has no sample buttons')

            command('New Folder');page.get_by_label('Project-relative path',exact=True).fill('assets/icons')
            page.get_by_role('button',name='Create folder',exact=True).click()
            page.wait_for_function("ferrite.getSnapshot().folders.includes('assets/icons')")
            view('src/pages/first.ui.rs');frame.get_by_role('button',name='Increase').click()
            expect(frame.locator('output')).to_have_text('1')
            view('src/pages/second.ui.rs');frame.get_by_role('button',name='Increase').click();frame.get_by_role('button',name='Increase').click()
            expect(frame.locator('output')).to_have_text('2')
            tab('first.ui.rs').click();expect(frame.locator('output')).to_have_text('1')
            mode('Code');expect(page.locator('#source')).to_be_visible();expect(studio).not_to_be_visible()
            mode('Preview');expect(page.locator('#source')).not_to_be_visible();expect(frame.locator('output')).to_have_text('1')
            tab('second.ui.rs').click();expect(page.locator('.document-workspace')).to_have_attribute('data-mode','split');expect(frame.locator('output')).to_have_text('2')
            tab('first.ui.rs').click();expect(page.locator('.document-workspace')).to_have_attribute('data-mode','preview')
            mode('Design');expect(studio.get_by_label('UI source outline')).to_be_visible()
            mode('Split');page.get_by_role('separator',name='Resize code and designer',exact=True).focus();page.keyboard.press('ArrowRight')
            expect(page.get_by_role('separator',name='Resize code and designer',exact=True)).to_have_attribute('aria-valuenow','52')
            page.get_by_role('button',name='Split Down',exact=True).click()
            expect(page.locator('.document-workspace')).to_have_attribute('data-orientation','down')
            page.get_by_role('button',name='Split Right',exact=True).click()
            check('each tab preserves runtime state, mode and a keyboard-resizable split')

            # Stale background diagnostics must never navigate away from the selected file.
            mode('Code');source=page.locator('#source');original=source.input_value();source.fill(original+'\ninvalid syntax !!!')
            tab('second.ui.rs').click();expect(frame.locator('output')).to_have_text('2')
            page.wait_for_timeout(600)
            assert page.evaluate('ferrite.getUIState().entryFile')=='src/pages/second.ui.rs'
            tab('first.ui.rs').click();source.fill(original);mode('Split');ready()
            mode('Design');studio.get_by_role('tab',name='Styles',exact=True).click()
            studio.get_by_label('UI application CSS',exact=True).fill('body { color: rgb(11, 22, 33); }')
            studio.get_by_role('button',name='Preview',exact=True).click();ready()
            expect(frame.locator('body')).to_have_css('color','rgb(11, 22, 33)')
            tab('second.ui.rs').click();expect(frame.locator('output')).to_have_text('2')
            assert 'rgb(11, 22, 33)' not in page.evaluate("ferrite.getSnapshot().files['src/pages/second.ui.css']")
            check('CSS and stale asynchronous work are isolated to the owning view')

            tab('first.ui.rs').click(button='right');page.get_by_role('menuitem',name='Pin tab',exact=True).click()
            tab('first.ui.rs').click(button='right');page.get_by_role('menuitem',name='Close Others',exact=True).click()
            expect(page.locator('#document-tabs [role=tab]')).to_have_count(1)
            command('Reopen Closed Tab');expect(page.locator('#document-tabs [role=tab]')).to_have_count(2)
            command('Open src/pages/first.ui.rs');page.locator('#file-rename').click()
            page.get_by_label('Project-relative path',exact=True).fill('src/pages/home.ui.rs')
            page.get_by_role('dialog').get_by_role('button',name='Rename',exact=True).click();ready('src/pages/home.ui.rs')
            assert page.evaluate("JSON.parse(ferrite.getSnapshot().files['src/pages/home.ui.json']).entryFile")=='src/pages/home.ui.rs'
            assert page.evaluate("!!ferrite.getSnapshot().files['src/pages/home.ui.css']")
            mode('Split');page.locator('#source').click();page.keyboard.press('ArrowRight')
            page.wait_for_function("ferrite.getSelection()?.file === 'src/pages/home.ui.rs'")
            check('tab menus, reopen and view rename preserve sidecars and source selection identity')

            # Folder actions use the same transaction controller as toolbar commands.
            page.locator('#project-tree [data-path="src/pages"]').click(button='right')
            page.get_by_role('menuitem',name='Rename / Move…',exact=True).click()
            page.get_by_label('Project-relative path',exact=True).fill('src/screens')
            page.get_by_role('dialog').get_by_role('button',name='Rename',exact=True).click();ready('src/screens/home.ui.rs')
            assert page.evaluate("!!ferrite.getSnapshot().files['src/screens/home.ui.rs']")
            page.locator('#project-tree [data-path="src/screens/home.ui.rs"]').click(button='right')
            page.get_by_role('menuitem',name='Duplicate…',exact=True).click()
            page.get_by_label('New project-relative path',exact=True).fill('src/screens/copy.ui.rs')
            page.get_by_role('button',name='Duplicate',exact=True).click();ready('src/screens/copy.ui.rs')
            assert page.evaluate("JSON.parse(ferrite.getSnapshot().files['src/screens/copy.ui.json']).stylesheet")=='src/screens/copy.ui.css'
            check('recursive folder move and UI-view duplication update project metadata atomically')

            command('Open src/main.rs');command('Split Editor Right')
            expect(page.get_by_label('Split source editor',exact=True)).to_be_visible()
            page.get_by_label('Split editor file',exact=True).select_option('Cargo.toml')
            assert 'DesignerWorkspace' in page.get_by_label('Split source editor',exact=True).input_value()
            page.get_by_role('button',name='Unsplit',exact=True).click()
            command('Open src/screens/home.ui.rs');mode('Preview')
            page.screenshot(path=str(OUT/'project-design-workspace.png'))
            check('ordinary source files also have independently selectable editor splits')

            # Restore a named project through the normal project switcher, not a writable test hook.
            page.locator('#file-project').click();page.get_by_label('Project name',exact=True).fill('OtherProject')
            page.get_by_label('Project type',exact=True).select_option('binary');page.get_by_role('button',name='Create project',exact=True).click()
            expect(page.locator('#project-name')).to_have_text('OtherProject')
            page.locator('#project-menu').click();page.get_by_role('dialog',name='Projects').get_by_role('button',name='DesignerWorkspace',exact=True).click()
            expect(page.locator('#project-name')).to_have_text('DesignerWorkspace');ready()
            page.wait_for_function("ferrite.getSnapshot().folders.includes('assets/icons')")
            expect(page.locator('.document-workspace')).to_have_attribute('data-mode','preview')
            check('project switching restores files, folders, tabs and per-file modes')
            if not MEMORY:
                page.reload();page.wait_for_function('!!window.ferrite');show_workspace_actions(page);ready()
                expect(page.locator('#project-name')).to_have_text('DesignerWorkspace')
                expect(page.locator('.document-workspace')).to_have_attribute('data-mode','preview')
                check('HTTP-origin browser storage survives a real page reload')
            page.set_viewport_size({'width':390,'height':844});mode('Split')
            expect(studio).to_be_visible();studio.get_by_role('button',name='Panels',exact=True).click()
            page.get_by_role('button',name='Show Properties',exact=True).click()
            expect(studio.get_by_role('tab',name='Properties',exact=True)).to_be_visible()
            studio.get_by_role('button',name='Panels',exact=True).click()
            page.get_by_role('button',name='Show Canvas',exact=True).click()
            expect(frame.locator('body')).to_be_visible();page.screenshot(path=str(OUT/'mobile-document-workspace.png'))
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            check('mobile stacks code and preview; inspector remains explicitly reachable')
            assert not errors,errors
            browser.close()
    finally:
        server.shutdown();server.server_close()
        (OUT/'results.json').write_text(json.dumps({'mode':'memory' if MEMORY else 'http','checks':checks,'errors':errors},indent=2))
    print(json.dumps({'checks':len(checks),'errors':errors}))

if __name__=='__main__': run()
