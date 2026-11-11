#!/usr/bin/env node
import { checkDocs, loadConfig } from './node.js'

const USAGE = `lockstep-md check <docs-dir> [--original <locale>] [--allow-missing]

Reads every language folder in <docs-dir>, reports syntax errors with their
file and line, and every place a translation's shape differs from the
original's. Exits 1 if there is anything to fix.

  --original <locale>  the language the docs are written in
                       (default: "original" in <docs-dir>/lockstep.json)
  --allow-missing      a translation may lack articles (readers fall back to
                       the original); report them without failing
`

function main(argv: string[]): number {
  const [command, dir, ...rest] = argv
  if (command !== 'check' || !dir || dir.startsWith('-')) {
    process.stderr.write(USAGE)
    return 2
  }
  let original: string | undefined
  let allowMissing = false
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (arg === '--original') original = rest[++i]
    else if (arg === '--allow-missing') allowMissing = true
    else {
      process.stderr.write(`unknown option ${arg}\n\n${USAGE}`)
      return 2
    }
  }

  let config
  try {
    config = loadConfig(dir, original ? { original } : {})
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`)
    return 2
  }
  const result = checkDocs(dir, config)
  const missing = result.differences.filter((d) => d.kind === 'missing')
  const failing = result.differences.filter((d) => !(allowMissing && d.kind === 'missing'))

  for (const e of result.errors) process.stdout.write(`error  ${e}\n`)
  for (const d of failing) process.stdout.write(`shape  ${d.message}\n`)
  if (allowMissing) for (const d of missing) process.stdout.write(`note   ${d.message}\n`)

  const problems = result.errors.length + failing.length
  const summary = `${result.locales.length} languages, original ${config.original}: ${problems === 0 ? 'in lockstep' : `${problems} to fix`}`
  process.stdout.write(`${summary}\n`)
  return problems === 0 ? 0 : 1
}

process.exitCode = main(process.argv.slice(2))
