"""Restricted-container delivery for designer acceptance; never used for HTTP tests."""
import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def memory_document(page):
    # Reuse the production module/worker delivery from the generic IDE harness.
    # The designer stylesheet is optional there, but required for these UI tests.
    runpy.run_path(str(ROOT / 'tools' / 'browser-acceptance.py'))['memory_document'](page)
    page.add_style_tag(content=(ROOT / 'styles' / 'designer.css').read_text())
