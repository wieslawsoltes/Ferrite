#!/usr/bin/env python3
"""RustRover-style outer workbench: real gestures, retention and persistent layouts.
Default CI uses HTTP and production workers. FERRITE_MEMORY_TEST=1 only replaces
module delivery for restricted containers; persistence/reload checks remain HTTP-only.
"""
import json
import os
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from designer_browser_support import memory_document

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts' / 'ide-docking'
MEMORY = os.environ.get('FERRITE_MEMORY_TEST') == '1'
SLOTS = ['left-top', 'left-bottom', 'right-top', 'right-bottom', 'bottom-left', 'bottom-right']
TITLES = {'compiler': 'Compiler', 'project': 'Project', 'cargo': 'Cargo', 'structure': 'Structure', 'run': 'Run', 'search': 'Find in Files', 'terminal': 'Terminal', 'agent': 'Coding Agent'}

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args): pass

def run():
    OUT.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    checks, errors = [], []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE'), headless=True, args=['--no-sandbox'])
        context = browser.new_context(viewport={'width': 1600, 'height': 1000})
        page = context.new_page(); page.set_default_timeout(12000)
        page.on('pageerror', lambda error: errors.append(str(error)))
        def case(name, action):
            start = time.perf_counter(); action()
            checks.append({'name': name, 'ms': round((time.perf_counter()-start)*1000, 2)})
            print('PASS ' + name, flush=True)
        def state(): return page.evaluate('window.ferrite.getDockState()')
        def persisted():
            result = state(); result.pop('presentation', None); return result
        def card(id): return page.locator(f'[data-tool-window="{id}"]')
        def show(id):
            if id not in state()['presentation']['shown']: page.locator(f'[data-tool="{id}"]').click()
            expect(card(id)).to_be_visible()
        def menu(name): page.get_by_role('menuitem', name=name, exact=True).click()
        def options(id): card(id).get_by_role('button', name=TITLES[id] + ' tool window options', exact=True).click()
        def mode(id, label): options(id); menu('View Mode'); menu(label)
        def reset(): page.locator('#layout-menu').click(); menu('Restore Default Layout')
        def move_menu(id, slot): options(id); menu('Move to'); menu('Move to ' + slot.replace('-', ' ').title())
        def drag(id, slot, cancel=False):
            source=card(id).locator('.tool-window-title').bounding_box()
            page.mouse.move(source['x']+12,source['y']+12);page.mouse.down();page.mouse.move(source['x']+24,source['y']+20,steps=3)
            target=page.locator(f'[data-drop-slot="{slot}"]').bounding_box()
            assert target, slot
            page.mouse.move(target['x']+target['width']/2,target['y']+target['height']/2,steps=12)
            expect(page.locator('.tool-drop-preview')).to_be_visible()
            if cancel: page.keyboard.press('Escape')
            page.mouse.up()
        def stable():
            assert page.evaluate('''() => [...window.__retainedTools].every(([id, node]) => document.querySelector(`[data-tool-window="${id}"] .tool-panel`) === node && node.parentElement === window.__toolParents.get(id))''')
            assert page.evaluate('document.querySelector("#dock-retention-frame").contentDocument === window.__retainedFrameDocument')
            assert page.locator('#dock-retention-input').input_value() == 'keep selection and draft'
        try:
            if MEMORY: memory_document(page)
            else: page.goto(f'http://127.0.0.1:{server.server_port}/')
            page.wait_for_function('window.ferrite?.getDockState && window.ferrite.getBuild()')
            def defaults():
                assert set(state()['presentation']['shown'])=={'project','cargo'}
                expect(page.locator('#workspace-actions')).to_be_hidden()
                assert page.locator('.editor-region').bounding_box()['width']>900
                assert page.locator('#left-rail [data-tool-slot="bottom-left"] [data-tool="terminal"]').count()==1
                assert page.locator('#right-rail [data-tool-slot="bottom-right"] [data-tool="search"]').count()==1
                assert page.locator('.rail-button[data-tool]').count()==17
                expect(page.locator('.floating-tool')).to_have_count(0)
                page.screenshot(path=str(OUT/'01-default.png'))
            case('compact toolbar, editor-first defaults and lower sidebar tools',defaults)
            show('compiler')
            page.evaluate('''() => {
              window.__retainedTools=new Map([...document.querySelectorAll('[data-tool-window]')].map(card=>[card.dataset.toolWindow,card.querySelector('.tool-panel')]));
              window.__toolParents=new Map([...window.__retainedTools].map(([id,node])=>[id,node.parentElement]));
              const panel=window.__retainedTools.get('compiler'), input=document.createElement('input'), frame=document.createElement('iframe');
              input.id='dock-retention-input'; input.value='keep selection and draft'; frame.id='dock-retention-frame';
              frame.srcdoc='<!doctype html><input value="iframe draft"><script>window.retainedMarker={value:42}</script>';
              panel.append(input,frame);
            }''')
            page.wait_for_function('document.querySelector("#dock-retention-frame").contentDocument?.querySelector("input")')
            page.evaluate('window.__retainedFrameDocument=document.querySelector("#dock-retention-frame").contentDocument')
            def anchors():
                for slot in SLOTS:
                    drag('compiler',slot)
                    assert state()['windows']['compiler']['anchor']==slot, state()
                    expect(page.locator(f'[data-tool-slot="{slot}"] [data-tool="compiler"]')).to_be_visible()
                    stable()
            case('pointer dragging to all six anchors preserves tool and iframe identity',anchors)
            def cancellation():
                before=persisted();drag('compiler','left-top',cancel=True)
                assert persisted()==before
                expect(page.locator('.tool-drag-overlay')).to_be_hidden();stable()
            case('Escape cancels docking transaction without layout or persistence changes',cancellation)
            def reorder():
                move_menu('compiler','left-top')
                source=page.locator('[data-tool="compiler"]').bounding_box();target=page.locator('[data-tool="project"]').bounding_box()
                page.mouse.move(source['x']+15,source['y']+15);page.mouse.down();page.mouse.move(target['x']+15,target['y']+15,steps=12);page.mouse.up()
                assert state()['slots']['left-top']['order'][0]=='compiler'
                assert page.locator('[data-tool-slot="left-top"] > button').first.get_attribute('data-tool')=='compiler'
                stable()
            case('sidebar drag insertion updates model order and actual sidebar order',reorder)
            def sizes():
                reset();show('compiler');handle=page.locator('[data-resize="right"]');before=state()['sizes']['right'];handle.focus();handle.press('ArrowLeft')
                assert state()['sizes']['right']==before+20
                before=persisted();box=handle.bounding_box();page.mouse.move(box['x'],box['y']+80);page.mouse.down();page.mouse.move(box['x']-80,box['y']+80,steps=8)
                assert state()['sizes']['right']>before['sizes']['right']
                page.keyboard.press('Escape');page.mouse.up();assert persisted()==before
                stable()
            case('accessible edge resizing and cancelled live resize restore exact preferences',sizes)
            def splits():
                show('structure');show('run');show('search');show('agent')
                assert len(state()['presentation']['shown'])==6
                assert page.locator('[data-tool-split]:visible').count()==3
                before=state()['splits']['bottom'];handle=page.locator('[data-tool-split="bottom"]');handle.focus();handle.press('ArrowRight')
                assert state()['splits']['bottom']>before
                root=page.locator('#dock-layout').bounding_box();run=card('run').bounding_box();search=card('search').bounding_box()
                assert abs(run['x']-root['x'])<2 and abs(search['x']+search['width']-root['x']-root['width'])<2
                page.locator('#layout-menu').click();menu('Enable Wide Screen Layout')
                editor=page.locator('.editor-region').bounding_box();run=card('run').bounding_box()
                assert abs(run['x']-editor['x'])<2
                page.screenshot(path=str(OUT/'02-split-workbench.png'));stable()
            case('simultaneous six tool slots, split ratios and wide-screen geometry',splits)
            def floating():
                reset();show('compiler');mode('compiler','Float');expect(card('compiler')).to_have_class(__import__('re').compile('floating-tool'))
                assert state()['windows']['compiler']['mode']=='floating';stable()
                # Menus must live above the floating top-layer surface.
                options('compiler');menu('View Mode');expect(page.get_by_role('menuitem',name='Dock Pinned',exact=True)).to_be_visible();page.keyboard.press('Escape')
                resize=card('compiler').get_by_role('button',name='Resize floating Compiler',exact=True);width=state()['windows']['compiler']['box']['width'];resize.focus();resize.press('ArrowRight')
                assert state()['windows']['compiler']['box']['width']==width+10
                source=card('compiler').locator('.tool-window-title').bounding_box();page.mouse.move(source['x']+10,source['y']+10);page.mouse.down();page.mouse.move(650,15,steps=15);page.mouse.up()
                assert state()['windows']['compiler']['mode']=='floating';stable()
                card('compiler').get_by_role('button',name='Dock',exact=True).click();assert state()['windows']['compiler']['mode']=='docked';stable()
            case('floating move/resize, top-layer options and redock retain live content',floating)
            def visibility():
                before=state()['sizes'].copy();card('compiler').locator('.tool-window-title').dblclick()
                assert state()['presentation']['maximized']=='compiler'
                expect(page.locator('.editor-region')).to_be_hidden()
                card('compiler').locator('.tool-window-title').dblclick();assert state()['presentation']['maximized'] is None
                assert state()['sizes']==before
                page.keyboard.press('Control+Shift+F12');assert not state()['presentation']['shown']
                page.keyboard.press('Control+Shift+F12');assert 'compiler' in state()['presentation']['shown']
                page.keyboard.press('Shift+Escape');expect(card('compiler')).to_be_hidden()
                page.locator('#source').focus();page.keyboard.press('F12');expect(card('compiler')).to_be_visible()
                card('compiler').get_by_role('button',name='Hide Compiler tool window',exact=True).click()
                assert state()['slots']['right-top']['active'] is None # Not the next tab.
                stable()
            case('header maximize, hide/restore all, Shift+Escape and F12 focus last tool',visibility)
            def transient():
                show('compiler');mode('compiler','Dock Unpinned');page.locator('#source').focus();expect(card('compiler')).to_be_hidden()
                show('compiler');mode('compiler','Undock (Sliding)');expect(card('compiler')).to_have_attribute('data-overlay','true')
                assert page.locator('.editor-region').bounding_box()['width']>1200
                page.locator('#source').focus();expect(card('compiler')).to_be_hidden()
                show('compiler');mode('compiler','Dock Pinned');page.locator('#source').focus();expect(card('compiler')).to_be_visible();stable()
            case('pinned, focus-dismissed unpinned and non-reserving sliding view modes',transient)
            def sidebar():
                options('compiler');menu('Remove from Sidebar');expect(page.locator('[data-tool="compiler"]')).to_be_hidden()
                page.get_by_role('button',name='More Tool Windows',exact=True).click();menu('Compiler')
                expect(page.locator('[data-tool="compiler"]')).to_be_visible();expect(card('compiler')).to_be_visible()
                page.locator('[data-tool="compiler"]').focus();page.keyboard.press('Shift+F10');menu('Move to');menu('Move to Right Bottom')
                assert state()['windows']['compiler']['anchor']=='right-bottom';stable()
            case('remove/recover sidebar tools and keyboard context-menu relocation',sidebar)
            def named():
                page.locator('#layout-menu').click();menu('Save Layout As…');page.get_by_role('dialog').get_by_role('textbox').fill('Review layout');page.get_by_role('dialog').get_by_role('button',name='Save',exact=True).click()
                saved=persisted();reset();page.locator('#layout-menu').click();menu('Restore: Review layout')
                assert persisted()==saved;stable()
            case('named layout save and restoration keep all ownership and preferences',named)
            def responsive():
                reset();before=persisted();page.set_viewport_size({'width':390,'height':844})
                expect(card('project')).to_be_hidden();expect(card('cargo')).to_be_hidden()
                assert persisted()==before
                page.locator('[data-tool="cargo"]').click();expect(card('cargo')).to_have_attribute('data-overlay','true')
                expect(page.locator('.floating-tool')).to_have_count(0)
                rect=card('cargo').bounding_box();assert rect['x']>=0 and rect['x']+rect['width']<=390
                page.screenshot(path=str(OUT/'03-narrow-overlay.png'))
                page.locator('[data-tool="project"]').click();expect(card('project')).to_be_visible();expect(card('cargo')).to_be_hidden()
                page.set_viewport_size({'width':1600,'height':1000});expect(card('cargo')).to_be_visible();expect(card('project')).to_be_visible()
                assert state()['sizes']==before['sizes'];assert state()['windows']==before['windows'];stable()
            case('responsive overlays preserve desktop placement, modes and preferred sizes',responsive)
            def compact_actions():
                page.locator('#main-menu').click();menu('Show Workspace Actions');expect(page.locator('#file-ui-view')).to_be_visible()
                page.locator('#main-menu').click();menu('Hide Workspace Actions');expect(page.locator('#workspace-actions')).to_be_hidden()
                page.locator('#main-menu').click();menu('File');menu('New');expect(page.get_by_role('dialog')).to_be_visible();page.get_by_role('button',name='Cancel',exact=True).click()
            case('compact main menu retains file commands and optional workspace actions',compact_actions)
            if not MEMORY:
                def persistence():
                    show('compiler');move_menu('compiler','bottom-right');mode('compiler','Float');expected=persisted();page.reload();page.wait_for_function('window.ferrite?.getBuild()')
                    assert persisted()==expected
                    expect(card('compiler')).to_be_visible();assert state()['windows']['compiler']['mode']=='floating'
                    page.locator('#layout-menu').click();menu('Restore: Review layout');assert state()['windows']['compiler']['anchor']=='right-bottom'
                    page.evaluate('localStorage.setItem("ferrite.layout.v4", "{corrupt")');page.reload();page.wait_for_function('window.ferrite?.getBuild()')
                    assert set(state()['presentation']['shown'])=={'project','cargo'}
                case('HTTP reload persists floating and named layouts and recovers corrupt storage',persistence)
            assert not errors, errors
        except Exception:
            page.screenshot(path=str(OUT/'failure.png'));(OUT/'state.json').write_text(json.dumps(state(),indent=2));raise
        finally:
            (OUT/'results.json').write_text(json.dumps({'delivery':'memory' if MEMORY else 'http','checks':checks,'errors':errors,'persistenceChecked':not MEMORY},indent=2))
            browser.close();server.shutdown()
    print(f'PASS {len(checks)} IDE docking acceptance cases',flush=True)

if __name__ == '__main__': run()
