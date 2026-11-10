#!/usr/bin/env python3
"""Print the command of the "Axiom-scoped unit tests" step of .github/workflows/axiom-ci.yml, exactly as written there.
Run from the repository root: python3 -I .axiom-work/scripts/ci_axiom_unit_command.py"""
import sys

sys.dont_write_bytecode = True
lines = open('.github/workflows/axiom-ci.yml', encoding='utf-8').read().split('\n')
names = [i for i, line in enumerate(lines) if line.strip() == '- name: Axiom-scoped unit tests']
assert len(names) == 1, 'step not found exactly once'
run = next(i for i in range(names[0] + 1, len(lines)) if lines[i].strip().startswith('run:'))
assert lines[run].strip() == 'run: |', lines[run]
indent = len(lines[run]) - len(lines[run].lstrip())
block = []
for line in lines[run + 1:]:
    if line.strip() and len(line) - len(line.lstrip()) <= indent:
        break
    block.append(line[indent + 2:] if line.strip() else '')
command = '\n'.join(block).strip()
assert command.startswith('ORCA_BACKGROUND_LAUNCH=1 pnpm exec vitest run --config config/vitest.config.ts'), command[:90]
assert 'src/main/axiom' in command
sys.stdout.write(command)
