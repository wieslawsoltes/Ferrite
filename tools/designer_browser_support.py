"""Restricted-container delivery for designer acceptance; never used for HTTP tests."""
import runpy
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def memory_document(page):
    # Opaque-origin module workers are blocked in this container. As in the editor
    # acceptance suite, pack the identical UI-analysis graph as a classic worker.
    # Default HTTP tests never take this branch or replace worker delivery.
    packed = subprocess.check_output(['node', str(ROOT/'tools/bundle-workers.mjs'),
        '--entry', 'src/ui/workers/ui-language-worker.js', '--stdout'], cwd=ROOT, text=True)
    page.evaluate("""source => {
      const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'})), Native=window.Worker;
      window.Worker=class extends Native {
        constructor(entry,options){super(options?.type==='module'?url:entry,options?.type==='module'?{...options,type:'classic'}:options);}
      };
    }""", packed)
    # Reuse the production module/worker delivery from the generic IDE harness.
    # The designer stylesheet is optional there, but required for these UI tests.
    runpy.run_path(str(ROOT / 'tools' / 'browser-acceptance.py'))['memory_document'](page)
    page.add_style_tag(content=(ROOT / 'styles' / 'editor-language.css').read_text())
    page.add_style_tag(content=(ROOT / 'styles' / 'designer.css').read_text())
