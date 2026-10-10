#!/usr/bin/env python3
"""Specification interactions in generated offline JS/MIR/Wasm apps and the actual IDE gallery."""
import json, os, subprocess, threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from workbench_browser_support import show_workspace_actions
from playwright.sync_api import sync_playwright, expect
from designer_browser_support import memory_document
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'artifacts/7guis'
MEMORY=os.environ.get('FERRITE_MEMORY_TEST')=='1'
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*_args): pass

def tasks(page, slug):
    def button(name): return page.get_by_role('button',name=name,exact=True)
    if slug=='counter':
        expect(page.get_by_label('Count',exact=True)).to_have_value('0');button('Count').click();button('Count').click();expect(page.get_by_label('Count',exact=True)).to_have_value('2')
    elif slug=='temperature':
        c=page.get_by_label('Celsius',exact=True);f=page.get_by_label('Fahrenheit',exact=True)
        expect(c).to_have_value('');expect(f).to_have_value('');c.fill('100');expect(f).to_have_value('212');f.fill('32');expect(c).to_have_value('0');c.fill('invalid');expect(f).to_have_value('32');c.fill('-40');expect(f).to_have_value('-40')
    elif slug=='flight':
        start=page.get_by_label('Departure date');end=page.get_by_label('Return date');kind=page.get_by_label('Flight type')
        expect(end).to_be_disabled();button('Book').click();expect(page.get_by_role('status')).to_contain_text('one-way flight on 10.10.2026')
        kind.select_option('return');end.fill('09.10.2026');expect(button('Book')).to_be_disabled();start.fill('29.02.1900');expect(start).to_have_attribute('aria-invalid','true')
        start.fill('29.02.2000');end.fill('01.03.2000');expect(button('Book')).to_be_enabled();button('Book').click();expect(page.get_by_role('status')).to_contain_text('return flight from 29.02.2000 to 01.03.2000')
        kind.select_option('one-way');expect(end).to_be_disabled()
    elif slug=='timer':
        duration=page.get_by_label('Duration',exact=True);seconds=page.get_by_label('Elapsed seconds');gauge=page.get_by_label('Elapsed time',exact=True)
        duration.fill('0');button('Reset').click();expect(seconds).to_have_text('0');expect(gauge).to_have_attribute('value','1')
        duration.fill('0.2');expect(seconds).to_have_text('0.2');page.wait_for_timeout(150);expect(seconds).to_have_text('0.2')
        duration.fill('0.4');expect(seconds).to_have_text('0.4');duration.fill('0');button('Reset').click();expect(seconds).to_have_text('0')
    elif slug=='crud':
        people=page.get_by_label('People',exact=True);prefix=page.get_by_label('Filter prefix');name=page.get_by_label('Name',exact=True);surname=page.get_by_label('Surname',exact=True)
        expect(button('Update')).to_be_disabled();expect(button('Delete')).to_be_disabled();prefix.fill('Mu');expect(people.locator('option')).to_have_count(1);people.select_option('1');expect(name).to_have_value('Max')
        name.fill('Ada');surname.fill('Muller');button('Update').click();expect(people.locator('option')).to_have_text(['Muller, Ada'])
        surname.fill('Mustermann');button('Create').click();expect(people.locator('option')).to_have_count(2);people.select_option('3');button('Delete').click();expect(people.locator('option')).to_have_count(1);expect(button('Delete')).to_be_disabled()
        prefix.fill('');expect(people.locator('option')).to_have_count(3);people.select_option('2');expect(name).to_have_value('Roman')
    elif slug=='circles':
        svg=page.get_by_label('Circle canvas',exact=True);box=svg.bounding_box();assert box
        def point(x,y): return {'x':box['width']*x/600,'y':box['height']*y/340}
        svg.click(position=point(100,100));svg.click(position=point(160,100));expect(svg.locator('circle')).to_have_count(2)
        svg.click(position=point(100,100),button='right');page.get_by_role('menuitem',name='Adjust diameter',exact=True).click();dialog=page.get_by_role('dialog',name='Adjust diameter');expect(dialog).to_be_visible()
        slider=page.get_by_label('Diameter',exact=True);slider.fill('150');expect(svg.locator('circle').nth(0)).to_have_attribute('r','75');slider.fill('140');button('Close').click();expect(dialog).to_have_count(0)
        # Nearest containing circle wins in the overlap, even though the first is larger.
        svg.hover(position=point(155,100));expect(svg.locator('circle').nth(1)).to_have_attribute('fill','#b7c2d4')
        button('Undo').click();expect(svg.locator('circle').nth(0)).to_have_attribute('r','15');button('Redo').click();expect(svg.locator('circle').nth(0)).to_have_attribute('r','70')
        button('Undo').click();svg.click(position=point(300,200));expect(button('Redo')).to_be_disabled();button('Undo').click();expect(svg.locator('circle')).to_have_count(2)
    elif slug=='cells':
        grid=page.get_by_role('grid',name='Spreadsheet');expect(grid.get_by_role('gridcell')).to_have_count(2600)
        def cell(label): return grid.locator(f'[data-cell="{label}"]')
        def edit(label,formula,key='Enter'):
            cell(label).dblclick();field=page.get_by_label('Edit '+label,exact=True);expect(field).to_be_visible();field.fill(formula);field.press(key)
        edit('A0','2');expect(cell('A0')).to_have_text('2');edit('B0','=A0*3');expect(cell('B0')).to_have_text('6');edit('C0','=sum(A0:B0)');expect(cell('C0')).to_have_text('8')
        edit('A0','4');expect(cell('C0')).to_have_text('16');expect(page.locator('[data-evaluations]')).to_have_attribute('data-evaluations','3')
        edit('A0','999','Escape');expect(cell('A0')).to_have_text('4');edit('D0','=D0');expect(cell('D0')).to_have_text('#CYCLE!');edit('D0','=A100');expect(cell('D0')).to_have_text('#REF!');edit('D0','=1/0');expect(cell('D0')).to_have_text('#DIV/0!')
        cell('E0').dblclick();field=page.get_by_label('Edit E0');field.fill('text <script>');cell('F0').click();expect(cell('E0')).to_have_text('text <script>')
        cell('A0').focus();cell('A0').press('ArrowRight');expect(cell('B0')).to_have_attribute('aria-selected','true');cell('B0').press('F2');expect(page.get_by_label('Edit B0')).to_have_value('=A0*3');page.get_by_label('Edit B0').press('Escape')
        cell('Z99').scroll_into_view_if_needed();expect(cell('Z99')).to_be_visible()

def run():
    OUT.mkdir(parents=True,exist_ok=True);subprocess.run(['node','tools/export-seven-guis.mjs'],cwd=ROOT,check=True)
    checks=[];errors=[];server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(ROOT)));threading.Thread(target=server.serve_forever,daemon=True).start()
    def check(name): checks.append(name);print('PASS '+name,flush=True)
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE'),args=['--no-sandbox'])
            for backend in os.environ.get('FERRITE_TEST_BACKENDS','javascript,mir,wasm').split(','):
                for slug in os.environ.get('FERRITE_TEST_SAMPLES','counter,temperature,flight,timer,crud,circles,cells').split(','):
                    page=browser.new_page(viewport={'width':1200,'height':950});page.set_default_timeout(20000);page.on('pageerror',lambda e:errors.append(str(e)))
                    # The complete exported HTML executes with network denied, including Wasm.
                    page.route('**/*',lambda route:route.abort())
                    page.set_content((OUT/f'exports/{slug}-{backend}.html').read_text());tasks(page,slug)
                    expect(page.locator('#ferrite-error')).to_have_count(0)
                    if backend=='javascript':page.screenshot(path=str(OUT/f'{slug}.png'))
                    check(f'{backend}: offline {slug} specification interactions');page.close()
            page=browser.new_page(viewport={'width':1440,'height':1000});page.set_default_timeout(20000);page.on('pageerror',lambda e:errors.append(str(e)))
            if MEMORY:memory_document(page);page.add_style_tag(content=(ROOT/'styles/samples.css').read_text())
            else:page.goto(f'http://127.0.0.1:{server.server_port}/')
            page.wait_for_function('!!window.ferrite');show_workspace_actions(page);original=page.evaluate('ferrite.getSnapshot()');page.locator('#file-samples').click();dialog=page.get_by_role('dialog',name='Samples',exact=True)
            expect(dialog.locator('.sample-browser-status')).to_contain_text('Live javascript');preview=dialog.frame_locator('iframe');tasks(preview,'counter')
            page.get_by_label('Sample category').select_option('7GUIs');expect(dialog.locator('[data-sample]')).to_have_count(7)
            page.get_by_label('Search samples').fill('spreadsheet');expect(dialog.locator('[data-sample]')).to_have_count(1);dialog.locator('[data-sample="7guis-cells"]').click();expect(dialog.locator('.sample-browser-status')).to_contain_text('Live javascript');expect(preview.get_by_role('gridcell')).to_have_count(2600)
            dialog.get_by_role('tab',name='Source files').click();page.get_by_label('Sample source file').select_option('src/model.rs');expect(page.get_by_label('Sample source code')).to_contain_text('pub struct Sheet');assert page.evaluate('ferrite.getSnapshot()')==original
            check('gallery search, categories, isolated live preview and actual source files do not mutate the workspace')
            page.get_by_label('Search samples').fill('');dialog.locator('[data-sample="7guis-counter"]').click();dialog.get_by_role('tab',name='Live preview').click();expect(dialog.locator('.sample-browser-status')).to_contain_text('Live javascript');page.screenshot(path=str(OUT/'sample-browser.png'))
            dialog.get_by_role('button',name='Add to current project').click();expect(dialog).to_have_count(0);studio=page.locator('.ui-studio');expect(studio.locator('.studio-status')).to_have_attribute('data-kind','ready');installed=page.evaluate('ferrite.getSnapshot()');assert installed['files']['src/main.rs']==original['files']['src/main.rs'];assert any('samples/7guis/counter/' in f for f in installed['files'])
            frame=studio.frame_locator('.studio-preview');tasks(frame,'counter');page.get_by_role('button',name='Check',exact=True).click();page.wait_for_timeout(800);expect(frame.get_by_label('Count',exact=True)).to_have_value('2')
            check('atomic sample addition preserves the current project; Check validates UI without resetting its live state')
            # Global Run is a real UI command and rebuilds the selected sample.
            page.get_by_role('button',name='Run',exact=True).click();expect(studio.locator('.studio-status')).to_have_attribute('data-kind','ready');expect(frame.get_by_label('Count',exact=True)).to_have_value('0')
            with page.expect_download() as download:page.get_by_role('button',name='Build',exact=True).click()
            export=OUT/'ide-counter.html';download.value.save_as(str(export));assert 'UISession' in export.read_text();check('main IDE Run targets the view and Build exports standalone HTML')
            page.locator('#file-samples').click();dialog=page.get_by_role('dialog',name='Samples',exact=True);dialog.get_by_role('button',name='Add to current project').click();expect(dialog).to_have_count(0);assert any('counter-2/' in f for f in page.evaluate('ferrite.getSnapshot()')['files']);check('adding the same sample twice creates independent sidecar-safe copies')
            page.locator('#file-samples').click();dialog=page.get_by_role('dialog',name='Samples',exact=True);dialog.locator('[data-sample="7guis-cells"]').click();dialog.get_by_role('button',name='Open as new project').click();expect(dialog).to_have_count(0);expect(page.locator('.ui-studio .studio-status')).to_have_attribute('data-kind','ready');expect(page.frame_locator('.ui-studio .studio-preview').get_by_role('gridcell')).to_have_count(2600);assert page.evaluate('ferrite.getSnapshot().name')=='Cells';check('opening Cells installs its real multi-file view with the explicit 2M render budget')
            page.locator('#project-menu').click();projects=page.get_by_role('dialog',name='Projects',exact=True);expect(projects.locator('.recent-projects button')).not_to_have_count(0);projects.get_by_role('button',name='Close',exact=True).click()
            page.set_viewport_size({'width':390,'height':844});page.locator('#file-samples').click();dialog=page.get_by_role('dialog',name='Samples',exact=True);expect(dialog.get_by_role('button',name='Open as new project')).to_be_visible();page.screenshot(path=str(OUT/'mobile-browser.png'));dialog.get_by_role('button',name='Close',exact=True).click();check('recent project recovery is discoverable and the gallery remains usable on a narrow viewport')
            assert not errors,errors;browser.close()
    finally:
        server.shutdown();(OUT/'results.json').write_text(json.dumps({'checks':checks,'errors':errors,'delivery':'restricted-memory IDE; offline exports' if MEMORY else 'HTTP/module workers and offline exports','count':len(checks)},indent=2))
if __name__=='__main__':run()
