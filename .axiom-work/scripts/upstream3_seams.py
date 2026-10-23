"""Shared by upstream3-prep.py (baseline on main) and upstream3-seam-check.py (candidate): the Axiom touchpoints
inside upstream-owned code. Two kinds:
  import — a name imported (`import { … } from`) from an Axiom-added module, counted in each file that imports it;
  token  — a *Axiom* / axiomX / AXIOM_* identifier or an 'axiom.…' string, counted everywhere.
Only src/, tests/ and config/ code is scanned; Axiom-added files themselves are excluded by the callers."""
import os
import re
from collections import defaultdict

CODE = re.compile(r'^(src|tests|config)/.*\.(ts|tsx|mts|cts|js|mjs|cjs)$')
IMPORT = re.compile(r"import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['\"]([^'\"]+)['\"]")
TOKEN = re.compile(r"'axiom\.[A-Za-z.]+'|\b[A-Za-z0-9_]*Axiom[A-Za-z0-9_]*\b|\baxiom[A-Z][A-Za-z0-9_]*\b|\bAXIOM_[A-Z0-9_]+\b")
TOKEN_NOISE = {'Axiom', 'nAxiom', 'naxiom'}


def _resolve(spec, importer, axiom_added):
    if not spec.startswith('.'):
        return None
    base = os.path.normpath(os.path.join(os.path.dirname(importer), spec))
    for ext in ('', '.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs', '/index.ts', '/index.tsx'):
        if base + ext in axiom_added:
            return base + ext
    return None


def count_touchpoints(texts, axiom_added):
    """texts: {path: source} of upstream-owned code. Returns {(kind, module, name): count}."""
    counts = defaultdict(int)
    for path, text in texts.items():
        if 'import' in text:
            for m in IMPORT.finditer(text):
                target = _resolve(m.group(2), path, axiom_added)
                if not target:
                    continue
                module = os.path.splitext(os.path.basename(target))[0]
                for raw in m.group(1).split(','):
                    name = re.sub(r'^type\s+', '', raw.strip()).split(' as ')[-1].strip()
                    if re.fullmatch(r'[A-Za-z_$][\w$]*', name):
                        counts[('import', module, name)] += len(re.findall(r'(?<![\w$])' + re.escape(name) + r'(?![\w$])', text))
        if 'xiom' in text or 'XIOM' in text:
            for tok in TOKEN.findall(text):
                if tok not in TOKEN_NOISE:
                    counts[('token', '-', tok)] += 1
    return counts
