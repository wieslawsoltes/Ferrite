#!/usr/bin/env python3
"""Real pointer/keyboard docking of retained per-document designer surfaces."""
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
OUT = ROOT / 'artifacts/designer-docking'
MEMORY = os.environ.get('FERRITE_MEMORY_TEST') == '1'

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *_args): pass

def run():
    OUT.mkdir(parents=True, exist_ok=True)
    checks, errors = [], []
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE'), args=['--no-sandbox'])
            page = browser.new_page(viewport={'width':1600,'height':1080}, has_touch=True)
            page.set_default_timeout(12000)
            page.on('pageerror', lambda e: errors.append(str(e)))
            if MEMORY: memory_document(page)
            else: page.goto(f'http://127.0.0.1:{server.server_port}/')
            page.wait_for_function('!!window.ferrite');show_workspace_actions(page)
            studio = page.locator('.ui-studio')
            frame = page.frame_locator('.ui-studio .studio-preview')
            def ready(): expect(studio.locator('.studio-status')).to_have_attribute('data-kind','ready')
            def mode(value): page.locator(f'.document-mode[data-mode={value}]').click()
            def panel(id): return studio.locator(f'[data-dock-panel={id}]')
            def button(name): return page.get_by_role('button',name=name,exact=True)
            def show(title):
                studio.get_by_role('button',name='Panels',exact=True).click()
                button('Show '+title).click()
            def reset():
                studio.get_by_role('button',name='Panels',exact=True).click()
                button('Reset designer layout').click()
            def menu(title): button(title+' panel actions').click()
            def layout(): return page.evaluate('ferrite.getUIState().docking.layout')
            def create(path):
                page.locator('#file-ui-view').click()
                page.get_by_label('View file path',exact=True).fill(path)
                page.get_by_label('View template',exact=True).select_option('counter')
                button('Create view').click();ready();mode('design')
            def check(name): checks.append(name);print('PASS '+name,flush=True)
            def unchanged():
                assert page.evaluate("window.__canvasFrame===document.querySelector('.ui-studio .studio-preview') && window.__canvasWindow===window.__canvasFrame.contentWindow && window.__canvasLoads===0")
                show('Canvas');expect(frame.locator('output')).to_have_text('1')
            def drag(source, x, y, cancel=False):
                box=source.bounding_box();assert box, 'Missing drag source'
                page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);page.mouse.down()
                page.mouse.move(x,y,steps=8)
                expect(page.locator('.dock-drag-shield:popover-open')).to_be_visible()
                if cancel: page.keyboard.press('Escape')
                page.mouse.up()
            create('src/docking.ui.rs')
            frame.get_by_role('button',name='Increase').click();expect(frame.locator('output')).to_have_text('1')
            page.evaluate("""() => {window.__canvasFrame=document.querySelector('.ui-studio .studio-preview');window.__canvasWindow=__canvasFrame.contentWindow;window.__canvasLoads=0;__canvasFrame.addEventListener('load',()=>window.__canvasLoads++);} """)
            studio.get_by_label('New attribute name',exact=True).fill('data-unsubmitted')
            for id,title in [('structure','Structure'),('toolbox','Toolbox'),('properties','Properties'),('styles','Styles'),('debug','Debug'),('settings','Settings / Export'),('canvas','Canvas')]:
                show(title);button('Float '+title).click()
                expect(panel(id)).to_have_attribute('data-floating','true')
                assert panel(id).evaluate("e=>e.matches(':popover-open')")
                old=next(box['width'] for box in layout()['floating'] if id in box['node']['tabs'])
                button('Resize floating '+title).focus();page.keyboard.press('ArrowRight')
                new=next(box['width'] for box in layout()['floating'] if id in box['node']['tabs'])
                assert new>old
                button('Hide '+title).click();expect(panel(id)).not_to_be_visible()
                show(title);expect(panel(id)).to_be_visible()
                button('Dock '+title+' back').click();expect(panel(id)).to_have_attribute('data-floating','false')
                unchanged()
            show('Properties');expect(studio.get_by_label('New attribute name',exact=True)).to_have_value('data-unsubmitted')
            check('all seven panels float, resize, hide/reopen and redock without reloading the live iframe or losing an attribute draft')

            # Separate tabs into independent dock groups, then stack and reorder using keyboard.
            show('Styles');menu('Styles');button('Dock Styles bottom').click()
            show('Debug');menu('Debug');page.get_by_label('Dock Debug relative to',exact=True).select_option('styles')
            page.get_by_label('Dock Debug position',exact=True).select_option('center');button('Apply docking').click()
            group=lambda: next(n for n in flatten(layout()['root']) if n['type']=='group' and 'styles' in n['tabs'])
            assert group()['tabs']==['styles','debug']
            studio.get_by_role('tab',name='Debug',exact=True).focus();page.keyboard.press('Control+ArrowLeft')
            assert group()['tabs']==['debug','styles']
            page.keyboard.press('ArrowRight');expect(panel('styles')).to_be_visible()
            check('independent bottom docking, explicit tab grouping and bidirectional keyboard tab navigation')
            reset();unchanged()

            # There is a columns splitter and navigation splitter; use vertical columns.
            handle=studio.locator('.dock-splitter[data-axis=x]').first
            box=handle.bounding_box();before=layout()
            page.mouse.move(box['x']+2,box['y']+20);page.mouse.down();page.mouse.move(box['x']+62,box['y']+20,steps=5);page.mouse.up()
            assert layout()!=before
            before=layout();canvas_tab=studio.get_by_role('tab',name='Canvas',exact=True)
            drag(canvas_tab,40,50,True);assert layout()==before
            unchanged()
            check('pointer split resizing and Escape-cancelled drags preserve a valid layout')

            # Drag onto another panel's center to form a tab group, using real hit testing.
            target=panel('properties').bounding_box()
            drag(studio.get_by_role('tab',name='Toolbox',exact=True),target['x']+target['width']/2,target['y']+target['height']/2)
            assert any(n['type']=='group' and 'toolbox' in n['tabs'] and 'properties' in n['tabs'] for n in flatten(layout()['root']))
            # Drag the canvas outside the workbench, then redock its retained surface.
            drag(studio.get_by_role('tab',name='Canvas',exact=True),50,70)
            expect(panel('canvas')).to_have_attribute('data-floating','true')
            unchanged();button('Dock Canvas back').click()
            check('real header drags show docking guides, group tools and float the live canvas')
            reset()

            show('Properties');button('Float Properties').click();saved=layout()
            create('src/other.ui.rs');assert not page.locator('.dock-panel:popover-open').count()
            frame.get_by_role('button',name='Increase').click();frame.get_by_role('button',name='Increase').click()
            page.locator('#document-tabs [role=tab]').filter(has_text='docking.ui.rs').click()
            assert layout()==saved;expect(panel('properties')).to_have_attribute('data-floating','true');unchanged()
            mode('code');assert not page.locator('.dock-panel:popover-open').count()
            mode('preview');expect(frame.locator('output')).to_have_text('1');assert not page.locator('.dock-panel:popover-open').count()
            mode('design');expect(panel('properties')).to_have_attribute('data-floating','true')
            check('floating panels are document-owned and disappear in other documents, Code and Preview modes')

            # Dock into the top edge with the accessible menu so the layout is clearly non-default.
            menu('Properties');button('Dock Properties top').click();saved=layout()
            if not MEMORY:
                page.reload();page.wait_for_function('!!window.ferrite');show_workspace_actions(page);ready()
                assert layout()==saved
                check('real HTTP-origin reload restores the exact designer layout')
            page.screenshot(path=str(OUT/'desktop-docking.png'))
            page.set_viewport_size({'width':390,'height':844})
            show('Properties');expect(studio.get_by_label('Element tag',exact=True)).to_be_visible()
            show('Toolbox');expect(studio.get_by_label('Search toolbox',exact=True)).to_be_visible()
            show('Canvas');expect(frame.locator('body')).to_be_visible()
            assert layout()==saved
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            page.screenshot(path=str(OUT/'mobile-panels.png'))
            check('compact panel selection keeps every tool reachable without rewriting desktop docking')
            page.set_viewport_size({'width':1600,'height':1080});reset()
            # This viewport transition must not steal header focus or lose draft values.
            show('Properties');button('Properties panel actions').focus();page.keyboard.press('Enter')
            expect(page.get_by_role('dialog',name='Properties panel actions',exact=True)).to_be_visible()
            page.keyboard.press('Escape');expect(button('Properties panel actions')).to_be_focused()
            check('panel menu is keyboard reachable and Escape returns focus')

            # Source-backed workflow: search, insert, then apply literal text directly.
            show('Structure');studio.get_by_label('Filter UI structure',exact=True).fill('h1')
            assert studio.get_by_role('treeitem').count()>=2
            studio.get_by_label('Filter UI structure',exact=True).fill('')
            studio.get_by_role('treeitem').filter(has_text='<h1>').click()
            show('Properties');studio.get_by_label('Element text',exact=True).fill('Docked designer')
            button('Apply text').click();ready();expect(frame.locator('h1')).to_have_text('Docked designer')
            expect(studio.get_by_label('Element text',exact=True)).to_have_value('Docked designer')
            studio.get_by_label('Element text',exact=True).fill('Refined designer <ready>')
            studio.get_by_label('Element text',exact=True).press('Enter');ready()
            expect(frame.locator('h1')).to_have_text('Refined designer <ready>')
            expect(frame.locator('h1 ready')).to_have_count(0)
            expect(studio.get_by_label('Element text',exact=True)).to_have_value('Refined designer <ready>')
            show('Toolbox');studio.get_by_label('Toolbox insertion position',exact=True).select_option('after')
            studio.get_by_label('Search toolbox',exact=True).fill('paragraph');button('Text').click();ready()
            expect(frame.get_by_text('Text',exact=True)).to_be_visible()
            show('Toolbox');studio.get_by_label('Search toolbox',exact=True).fill('')
            page.screenshot(path=str(OUT/'desktop-designer.png'))
            check('searchable outline/toolbox and direct text editing write validated source')
            assert not errors,errors
            browser.close()
    finally:
        server.shutdown();server.server_close()
        (OUT/'results.json').write_text(json.dumps({'mode':'memory' if MEMORY else 'http','checks':checks,'errors':errors},indent=2))
    print(json.dumps({'checks':len(checks),'errors':errors}),flush=True)

def flatten(node):
    if not node: return []
    return [node]+(flatten(node['first'])+flatten(node['second']) if node['type']=='split' else [])

if __name__=='__main__': run()
