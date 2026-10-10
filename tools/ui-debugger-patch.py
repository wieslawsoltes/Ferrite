"""One-time source transfer; removed from the branch after successful application."""
from pathlib import Path
import hashlib
import subprocess

root = Path(__file__).resolve().parents[1]
hashes = [
    '67c780d98f08d35ee3bbaeb4096cb1666659b30e098dc68878def5299a47d107',
    '03effff7a621581f434ce1f4f80ba3dd263bac3670a5632100de9ad2a4f65c11',
    '8a7f9e034cdeee0358fdfdf8a2db61e01781bed157d999169252656da0b0ad6d',
    'ad5598190625ceeb12c9c1f9441b9add75dbe39cd8c5f5f6261338f8c4572b8e',
    '0e58337d8b052d6f3c84ed09454946eb5061e34ee53bd75e9c11cd70679e2ace',
    '7740be93f717d02839c48ffc93971b5918cfcf17ea2e112c22a9c0cb7a1ffab6',
]
parts = [root / 'tools' / f'ui-debugger-part-{i}.patch' for i in range(len(hashes))]
for part, expected in zip(parts, hashes):
    actual = hashlib.sha256(part.read_bytes()).hexdigest()
    if actual != expected:
        raise SystemExit(f'Source transfer checksum mismatch: {part.name}: {actual} != {expected}')
patch = b''.join(part.read_bytes() for part in parts)
if hashlib.sha256(patch).hexdigest() != '76d8cec9b83d38fa439b22608bd690b0e55dc11b2df6b9f09835c67af3599e38':
    raise SystemExit('Combined source patch checksum mismatch')
subprocess.run(['git', 'apply', '--check', '--unidiff-zero', '-'], cwd=root, input=patch, check=True)
subprocess.run(['git', 'apply', '--unidiff-zero', '-'], cwd=root, input=patch, check=True)
for part in parts:
    part.unlink()
Path(__file__).unlink()
print('Applied the exact locally tested UI debugger source; temporary transfer files removed.')
