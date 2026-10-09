#!/usr/bin/env python3
"""Execute the actual rustc output, including independent offline file navigation."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/native-ui'

def run():
    checks, errors = [], []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE'), headless=True, args=['--no-sandbox'])
            context = browser.new_context(offline=True)
            page = context.new_page()
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto((OUT / 'app.html').as_uri())
            page.wait_for_function("window.ferriteUI?.inspect().components > 0")
            assert page.locator('#count').inner_text() == '0'
            page.locator('#increment').click()
            page.wait_for_function("document.querySelector('#count').textContent === '1'")
            checks.append('actual rustc wasm state update in independent offline HTML')
            page.locator('#name').fill('世界 <Rust> "🦀"')
            page.wait_for_function("document.querySelector('#greeting').textContent === 'Hello, 世界 <Rust> \"🦀\"'")
            page.locator('#focus').click()
            assert page.evaluate("document.activeElement.id") == 'name'
            checks.append('owned UTF-8 event snapshots, controlled input and DOM ref')
            other = context.new_page()
            other.on('pageerror', lambda e: errors.append(str(e)))
            other.goto((OUT / 'app.html').as_uri())
            other.wait_for_function("document.querySelector('#count')?.textContent === '0'")
            assert page.locator('#count').inner_text() == '1'
            checks.append('independent native application instances')
            page.screenshot(path=str(OUT/'native-ui.png'), full_page=True)
            page.evaluate("ferriteUI.dispose()")
            assert page.locator('#app').inner_text() == ''
            assert page.evaluate("ferriteUI.inspect().disposed")
            checks.append('explicit native session and DOM disposal')
            assert not errors, errors
            browser.close()
    finally:
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT/'results.json').write_text(json.dumps({'mode':'offline-file', 'checks':checks,'errors':errors},indent=2))
    print(json.dumps({'checks':len(checks),'errors':errors}))

if __name__ == '__main__':
    run()
