#!/usr/bin/env node
// Advisory Jev (TypeSafe System One) triage of one Attempt — never a gate (D29).
// Usage: node .axiom-work/jev/triage.mjs <BRIEF-ID> <seq>
// Reads the attempt summary, verification log, Worker report and brief; asks Jev typed questions
// (failure triage, report completeness, scope creep, replan class of each suggested follow-up);
// writes .axiom-work/logs/jev-<ID>-<seq>-<ts>.json with a `human_verdict` slot for the verifier's own call.
// The API key is read from ~/.config/axiom/typesafe.env (TYPESAFE_API_KEY=...) and never printed.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

const [ID, SEQ] = process.argv.slice(2)
if (!ID || !SEQ) {
  console.error('usage: triage.mjs <BRIEF-ID> <seq>')
  process.exit(2)
}
const LOGS = '.axiom-work/logs'
const ENDPOINT = 'https://api.typesafe.ai/v1/systemone'

function readKey() {
  const p = join(homedir(), '.config', 'axiom', 'typesafe.env')
  if (!existsSync(p)) {
    return null
  }
  const m = readFileSync(p, 'utf8').match(/^TYPESAFE_API_KEY=(\S+)/m)
  return m ? m[1] : null
}
const key = readKey()
if (!key) {
  console.log('jev: no API key at ~/.config/axiom/typesafe.env; skipped')
  process.exit(0)
}

const latest = (prefix, suffix) =>
  readdirSync(LOGS)
    .filter((f) => f.startsWith(prefix) && f.endsWith(suffix))
    .sort()
    .at(-1)
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}\n…[truncated ${s.length - n} chars]` : s)
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
const strip = (s) => s.replace(ANSI_ESCAPE, '')
const readIf = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')

const summaryFile = latest(`attempt-${ID}-${SEQ}-`, '.summary')
const summary = summaryFile ? readFileSync(join(LOGS, summaryFile), 'utf8') : ''
const [, cand, base] = summary.match(/^candidate: ([0-9a-f]+) \(base ([0-9a-f]+)\)/m) ?? []
const verifyFile = latest(`verify-${ID}-${SEQ}-`, '.log')
const verifyLog = verifyFile ? strip(readFileSync(join(LOGS, verifyFile), 'utf8')) : ''
const gateResults = verifyLog
  .split('\n')
  .filter((l) => l.startsWith('---- RESULT') || l.includes('OVERALL='))

// Failing tests: "FAIL  <file> > <name>" lines plus the first error-looking line after each.
const failures = []
const lines = verifyLog.split('\n')
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^ FAIL {2}(\S+)(?: > (.*))?$/)
  if (!m) {
    continue
  }
  const [, file, name = ''] = m
  if (failures.some((f) => f.file === file && f.name === name)) {
    continue
  }
  const error = (lines.slice(i + 1, i + 6).find((l) => /Error|expected|Timed out|EPERM|ENOENT/.test(l)) ?? '').trim()
  failures.push({ file, name, error: error.slice(0, 400) })
}

const report = readIf(`.axiom-work/reports/${ID}-${SEQ}.md`)
const brief = readIf(`.axiom-work/briefs/${ID}.md`)
// Allowed scope = the brief's Scope section plus every attempt addendum (addenda carry scope authorizations).
const scope = [
  (brief.match(/## Scope[\s\S]*?(?=\n## )/) ?? [''])[0],
  ...[...brief.matchAll(/^# Attempt \d+ addendum[\s\S]*?(?=\n---\n|$(?![\s\S]))/gm)].map((m) => m[0])
].join('\n\n')
const changedFiles =
  cand && base
    ? execSync(`git diff --name-only ${base} ${cand}`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
    : []
const known = readIf('.axiom-work/jev/known-environmental.txt')
  .split('\n')
  .filter((l) => l && !l.startsWith('#'))
const followUps = (report.match(/## Suggested follow-ups[\s\S]*?(?=\n## |$(?![\s\S]))/) ?? [''])[0]
  .split('\n')
  .filter((l) => /^(?:- |\d+\. )/.test(l))
  .map((l) => l.replace(/^(?:- |\d+\. )/, '').trim())
  .slice(0, 8)

const questions = {}
failures.slice(0, 10).forEach((_, i) => {
  questions[`failure_${i}_caused_by_candidate`] = {
    type: 'noul',
    instructions: `Is the failing test \`failures[${i}]\` plausibly caused by the candidate's own changes (see \`changed_files\`), rather than by the host environment, test flakiness, or a known environmental failure listed in \`known_environmental_failures\`?`,
    criteria: {
      true: 'The failing test file, or the code it exercises, overlaps with changed_files, or the error names a symbol or behaviour the candidate changed',
      false: 'The file is on the known environmental list, the error is a timeout, EPERM, missing binary or network problem, or nothing the candidate changed is involved'
    }
  }
})
questions.report_completeness = {
  type: 'score',
  instructions: 'How completely does `worker_report` satisfy the submission contract in `submission_contract`?',
  criteria: [
    'Missing most required sections: no commands, no results, or no files-changed list',
    'Has files and a summary, but checks lack exact commands or results, and limitations or follow-ups are missing',
    'All sections present; checks list commands and pass/fail; limitations are generic',
    'All sections present and specific: commands with results and durations, concrete limitations with file references, explicit unresolved questions and follow-ups'
  ]
}
questions.scope_creep = {
  type: 'noul',
  instructions: 'Does `changed_files` or `worker_report` show changes outside the allowed scope described in `brief_scope`?',
  criteria: {
    true: 'Files or behaviours changed that the scope section does not list and that the report does not justify as an authorized extension',
    false: 'Every changed file falls under a listed scope item, an addendum authorization, or is a report or baseline artifact'
  }
}
followUps.forEach((_, i) => {
  questions[`followup_${i}_replan_class`] = {
    type: 'choice',
    instructions: `Classify the suggested follow-up \`follow_ups[${i}]\` according to the replanning policy in \`replan_policy\`.`,
    criteria: {
      NO_REPLAN: 'Expected progress or a local fix; no task graph change needed',
      MINOR_ADJUSTMENT: 'A new or changed Task, dependency, AgentSpec or Context within the approved architecture',
      MAJOR_REPLAN: 'Goal change, invalidated architecture, unavailable critical dependency, repeated systemic failure, or broad integration conflict',
      NOT_A_WORK_ITEM: 'Not actionable work: an observation, a caveat, or something already covered'
    }
  }
})

const state = {
  attempt: { id: ID, seq: Number(SEQ), candidate: cand ?? null, base: base ?? null },
  gate_results: gateResults,
  failures,
  known_environmental_failures: known,
  changed_files: changedFiles,
  brief_scope: clip(scope, 6000),
  submission_contract:
    'Task and Attempt identifiers; immutable candidate identity; concise implementation summary; files changed; tests and checks run with exact commands and results; produced Artifacts; known limitations and risks; unresolved questions; suggested follow-up work.',
  replan_policy:
    'NO_REPLAN: expected progress or local fix. MINOR_ADJUSTMENT: Task, dependency, AgentSpec, or Context change within the approved architecture. MAJOR_REPLAN: Goal change, invalidated architecture, unavailable critical dependency, repeated systemic failure, or broad integration conflict.',
  follow_ups: followUps,
  worker_report: clip(report, 16000)
}

async function ask(body) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (res.status === 429 || res.status === 529) {
      await new Promise((r) => setTimeout(r, 1500 * attempt))
      continue
    }
    return res
  }
  return null
}

const body = { model: 'jev-latest', state, questions }
const res = await ask(body)
if (!res || !res.ok) {
  console.log(`jev: request failed${res ? ` (HTTP ${res.status}: ${(await res.text()).slice(0, 300)})` : ' (retries exhausted)'}`)
  process.exit(0)
}
const json = await res.json()
mkdirSync(LOGS, { recursive: true })
const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '')
const out = `${LOGS}/jev-${ID}-${SEQ}-${ts}.json`
writeFileSync(
  out,
  JSON.stringify(
    {
      request: {
        model: body.model,
        questions,
        state_digest: { failures: failures.length, changed_files: changedFiles.length, follow_ups: followUps.length }
      },
      response: json,
      human_verdict: null
    },
    null,
    2
  )
)
console.log(`jev: ${out}`)
for (const [k, v] of Object.entries(json.answers ?? {})) {
  const text =
    v.type === 'noul'
      ? `p(yes)=${Number(v.noul).toFixed(2)}`
      : v.type === 'choice'
        ? `${v.choice} (confidence ${Number(v.confidence).toFixed(2)})`
        : `score ${Number(v.score).toFixed(2)} of ${questions[k].criteria.length - 1} (confidence ${Number(v.confidence).toFixed(2)})`
  console.log(`  ${k}: ${text}`)
}
if (json.usage) {
  console.log(`  usage: ${JSON.stringify(json.usage)}`)
}
