#!/usr/bin/env python3
"""Rust/view! editor UX in real Chromium. No native bridge or model provider is used."""
import json
import os
import runpy
import subprocess
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from workbench_browser_support import show_workspace_actions
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/editor-language'
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
            page = browser.new_page(viewport={'width':1680,'height':1050})
            page.set_default_timeout(15000)
            page.on('pageerror', lambda error: errors.append(str(error)))
            if MEMORY:
                # This restricted browser rejects even zero-import module workers at
                # opaque origins. Execute the IDENTICAL source graph as a classic
                # worker, using the repository's deterministic packer. CI uses HTTP
                # and the unmodified production module-worker delivery below.
                packed=subprocess.check_output(['node',str(ROOT/'tools/bundle-workers.mjs'),'--entry','src/ui/workers/ui-language-worker.js','--stdout'],cwd=ROOT,text=True)
                page.evaluate('''source=>{const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'})),Native=window.Worker;
                  window.Worker=class extends Native{constructor(entry,options){super(options?.type==='module'?url:entry,options?.type==='module'?{...options,type:'classic'}:options);}};}''',packed)
                runpy.run_path(str(ROOT/'tools/browser-acceptance.py'))['memory_document'](page)
                page.add_style_tag(content=(ROOT/'styles/editor-language.css').read_text())
            else: page.goto(f'http://127.0.0.1:{server.server_port}/')
            page.wait_for_function('!!window.ferrite');show_workspace_actions(page)
            page.locator('#auto-check').uncheck()
            def check(name): checks.append(name); print('PASS '+name,flush=True)
            def caret(editor, offset):
                # Python indexes Unicode scalars; DOM/LSP positions are UTF-16.
                utf16=len(editor.input_value()[:offset].encode('utf-16-le'))//2
                editor.evaluate('(e,p)=>{e.focus();e.setSelectionRange(p,p);e.dispatchEvent(new Event("select"));}',utf16)
            def command(name):
                page.locator('#search-everywhere').click()
                page.get_by_role('textbox',name='Search Everywhere').fill(name)
                page.get_by_role('dialog',name='Search Everywhere').get_by_role('button',name=name,exact=True).click()
            def complete(editor, source, offset, label):
                editor.fill(source); caret(editor,offset); editor.press('Control+Space')
                option=page.get_by_role('listbox',name='Rust completions').get_by_role('option').filter(has=page.locator('.editor-completion-label',has_text=label)).first
                expect(option).to_be_visible(); return option
            def import_files(files):
                page.locator('#import-input').set_input_files({'name':'language.ferrite.json','mimeType':'application/json','buffer':json.dumps({'format':'ferrite-project-v1','files':files}).encode()})
                page.wait_for_function('(files)=>Object.keys(files).every(p=>ferrite.getSnapshot().files[p]===files[p])',arg=files)
            source=page.locator('#source')
            page.locator('#file-project').click(); page.get_by_label('Project name',exact=True).fill('RustLanguageTools')
            page.get_by_role('button',name='Create project',exact=True).click()
            expect(page.locator('.ui-studio .studio-status')).to_have_attribute('data-kind','ready')
            page.locator('#file-ui-view').click();page.get_by_label('View file path',exact=True).fill('src/counter.ui.rs')
            page.get_by_label('View template',exact=True).select_option('counter');page.get_by_role('button',name='Create view',exact=True).click()
            page.wait_for_function('ferrite.getUIState().entryFile === "src/counter.ui.rs"')
            expect(page.locator('.ui-studio .studio-status')).to_have_attribute('data-kind','ready')
            page.locator('.document-mode-toolbar').get_by_role('button',name='Code',exact=True).click()
            original=source.input_value()
            highlight=page.locator('#editor-root .editor-highlight')
            assert highlight.text_content()==original+'\n'
            for kind in ['keyword','function','namespace','type','macro','tag','attribute','event','number','string']:
                assert highlight.locator('.syntax-'+kind).count()>0,kind
            colors=highlight.evaluate('e=>new Set([...e.querySelectorAll("span")].map(s=>getComputedStyle(s).color)).size')
            assert colors>=7,colors
            assert 'Typed events · keyed DOM' in highlight.text_content()
            page.screenshot(path=str(OUT/'rust-ui-highlighting.png'))
            check('reported counter source has distinct Rust/markup colors and an exactly aligned text overlay')

            prefix='fn app() -> ui::Node { view! { <button on:cl'
            option=complete(source,prefix,len(prefix),'on:click')
            # Popup must survive background diagnostics and retain textarea keyboard focus.
            page.wait_for_timeout(800); expect(option).to_be_visible(); source.press('Enter')
            expect(source).to_have_value(prefix[:-5]+'on:click')
            source.press('Control+z');expect(source).to_have_value(prefix)
            check('incomplete markup completion accepts on Enter and undoes as one edit without a bridge')

            text='fn app() -> ui::Node { let count = ui::use_state(0); view! { <p>{ui::get(count)}</p> } }'
            offset=text.index('ui::get')+len('ui::ge')
            complete(source,text,offset,'get');source.press('Tab');expect(source).to_have_value(text)
            check('mid-token completion replaces the suffix instead of duplicating it')

            source.fill(original); caret(source,original.index('count'))
            source.press('Control+q');expect(page.locator('.language-documentation')).to_contain_text('count: ui::State')
            caret(source,original.index('count',original.index('on:click')));source.press('Control+b')
            page.wait_for_function('(offset)=>document.querySelector("#source").selectionStart===offset',arg=original.index('count'))
            source.press('Alt+F7');expect(page.locator('.language-location')).to_have_count(4)
            check('hover, Ctrl+B and references resolve original-source state bindings including closures')

            caret(source,original.index('count'));source.press('Shift+F6')
            page.get_by_label('New symbol name',exact=True).fill('counter')
            page.get_by_role('button',name='Preview edits',exact=True).click()
            expect(page.locator('#apply-refactoring')).to_be_visible()
            expect(source).to_have_value(original)
            page.locator('#apply-refactoring').click()
            assert source.input_value().count('ui::update(counter')==2
            assert 'let counter =' in source.input_value()
            page.locator('#undo-refactoring').click();expect(source).to_have_value(original)
            check('UI local rename previews four exact edits, applies atomically and supports undo')

            caret(source,original.index('count'));source.press('Shift+F6')
            page.get_by_label('New symbol name',exact=True).fill('counter')
            source.evaluate('''e=>{e.value+='\\n// concurrent edit';e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:null}));}''')
            page.get_by_role('button',name='Preview edits',exact=True).click()
            page.wait_for_timeout(450)
            expect(page.locator('#apply-refactoring')).to_have_count(0)
            expect(source).to_have_value(original+'\n// concurrent edit')
            source.fill(original)
            check('source changes while the rename modal is open invalidate its anchored symbol lease')

            text='fn app() -> ui::Node { let count = ui::use_state(0); ui::update(count, '
            source.fill(text);caret(source,len(text));source.press('Control+Shift+Space')
            expect(page.locator('.language-documentation')).to_contain_text('Parameter: update: F')
            check('signature help uses the compiler UI ABI and identifies the current parameter')

            bad=original.replace('ui::use_state(0)','ui::use_state("bad")')
            source.fill(bad)
            expect(page.locator('#editor-root .editor-diagnostic').first).to_be_visible()
            expect(page.locator('#editor-root .gutter-line.has-diagnostic').first).to_be_visible()
            source.fill(original)
            expect(page.locator('#editor-root .editor-diagnostic')).to_have_count(0)
            check('live canonical UI type diagnostics underline original source and clear after correction')

            # A real second editor has a different file and caret, not a mirrored global active path.
            files={'Cargo.toml':'[package]\nname="language"\nversion="0.1.0"\n','src/main.rs':'mod other; fn main() { other::run(); }','src/other.rs':'pub fn run() { let second = 1; println!("{}", second); }'}
            import_files(files)
            page.locator('.document-mode-toolbar').get_by_role('button',name='Split',exact=True).click()
            page.get_by_label('Split editor file',exact=True).select_option('src/other.rs')
            split=page.locator('#split-source');expect(split).to_have_value(files['src/other.rs'])
            caret(split,files['src/other.rs'].rindex('second')+3);split.press('Control+Space')
            expect(page.get_by_role('listbox',name='Rust completions')).to_contain_text('second')
            split.press('Tab');expect(split).to_have_value(files['src/other.rs']);expect(source).to_have_value(files['src/main.rs'])
            caret(split,files['src/other.rs'].rindex('second'));split.press('Control+b')
            page.wait_for_function('(offset)=>document.querySelector("#split-source").selectionStart===offset',arg=files['src/other.rs'].index('second'))
            expect(source).to_have_value(files['src/main.rs'])
            check('completion and definition follow the focused split document without changing the main document')

            crlf='fn main() {\r\n    let r#type = 1;\r\n    println!("🦀 {}", r#type);\r\n}\r\n'
            import_files({'Cargo.toml':files['Cargo.toml'],'src/main.rs':crlf})
            normalized=source.input_value();offset=normalized.rindex('r#type')+4;caret(source,offset);source.press('Control+Space')
            expect(page.get_by_role('listbox',name='Rust completions')).to_contain_text('type')
            source.press('Tab');expect(source).to_have_value(normalized)
            assert page.evaluate('ferrite.getSnapshot().files["src/main.rs"]')==crlf
            caret(source,normalized.rindex('r#type'));source.press('Control+b')
            page.wait_for_function('(offset)=>document.querySelector("#source").selectionStart===offset',arg=normalized.index('r#type'))
            assert highlight.text_content()==normalized+'\n'
            check('CRLF, Unicode and raw identifiers retain file bytes, UTF-16 navigation and overlay alignment')

            prefix='fn main() { let count = 1; cou'
            source.fill(prefix);caret(source,len(prefix))
            source.evaluate('e=>e.dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true}))')
            source.press('Control+Space')
            page.wait_for_timeout(250)
            expect(page.locator('.editor-completions:not([hidden])')).to_have_count(0)
            source.evaluate('e=>e.dispatchEvent(new CompositionEvent("compositionend",{bubbles:true}))')
            source.press('Control+Space');expect(page.get_by_role('listbox',name='Rust completions')).to_be_visible()
            source.press('ArrowLeft');expect(page.locator('.editor-completions:not([hidden])')).to_have_count(0)
            check('IME composition is not intercepted and caret navigation dismisses stale completion')
            assert not errors,errors
            browser.close()
    finally:
        server.shutdown()
        (OUT/'results.json').write_text(json.dumps({'mode':'memory' if MEMORY else 'http','checks':checks,'errors':errors,'nativeBridgeStarted':False,'uiWorkerDelivery':'same-source classic test bundle' if MEMORY else 'production module worker'},indent=2))
    print(json.dumps({'checks':len(checks),'errors':errors}),flush=True)

if __name__=='__main__': run()
