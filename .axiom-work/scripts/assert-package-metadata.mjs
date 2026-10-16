// Sidecar helper: package.json metadata expected after M0-10 (kept out of the sidecar line because ';' splits extras).
import { readFileSync } from 'node:fs'
const p = JSON.parse(readFileSync('package.json', 'utf8'))
const ok = p.license === 'MIT' && p.name === 'orca' && /LaPaGaYo\/Axiom/.test(p.homepage) && p.author === 'LaPaGaYo'
if (!ok) { console.error('package.json metadata mismatch', { name: p.name, license: p.license, homepage: p.homepage, author: p.author }); process.exit(1) }
console.log('package.json metadata ok')
