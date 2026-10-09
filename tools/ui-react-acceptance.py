#!/usr/bin/env python3
"""Pinned, real React/Radix browser conformance (optional test dependencies)."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/ui-react'

def run():
    OUT.mkdir(parents=True, exist_ok=True)
    errors, checks = [], []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE'), headless=True, args=['--no-sandbox'])
            page = browser.new_page()
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            page.set_content('<!doctype html><html><body></body></html>')
            page.add_script_tag(content=(ROOT / 'src/sdk/ferrite.bundle.js').read_text())
            page.add_script_tag(content=(OUT / 'reference.bundle.js').read_text())
            code = (ROOT / 'tests/fixtures/ui-react-browser.js').read_text().replace('export async function', 'async function')
            checks = page.evaluate('async () => { ' + code + '\n return await uiReactBrowserTests(Ferrite, FerriteReactReference); }')
            assert not errors, errors
            browser.close()
    finally:
        (OUT / 'results.json').write_text(json.dumps({'reference': 'React/ReactDOM 19.2.0, Radix Dialog 1.1.15', 'checks': checks, 'errors': errors}, indent=2))
    print(json.dumps({'checks': len(checks), 'errors': errors}))

if __name__ == '__main__':
    run()
