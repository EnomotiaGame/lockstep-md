import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { build } from 'vite'
import { checkDocs, listLocales, loadConfig, readDocs } from '../src/node.js'
import { lockstep } from '../src/vite.js'

const EXAMPLE = resolve(__dirname, '../example/docs')
const temps: string[] = []
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true })
})

/** A copy of the example docs to break. */
function copy(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lockstep-'))
  temps.push(dir)
  cpSync(EXAMPLE, dir, { recursive: true })
  return dir
}

describe('reading from disk', () => {
  it('finds the languages and reads the config', () => {
    expect(listLocales(EXAMPLE)).toEqual(['en', 'tr'])
    expect(loadConfig(EXAMPLE)).toEqual({ original: 'en', directives: { pricing: { args: ['monthly', 'yearly'] } } })
    expect(loadConfig(EXAMPLE, { original: 'tr' }).original).toBe('tr')
    const tr = readDocs(EXAMPLE, 'tr', loadConfig(EXAMPLE))
    expect(tr.title).toBe('Yardım merkezi')
    expect(tr.sections[0]!.articles.map((a) => a.id)).toEqual(['welcome', 'plans'])
  })

  it('finds the example in lockstep', () => {
    expect(checkDocs(EXAMPLE, loadConfig(EXAMPLE))).toEqual({ locales: ['en', 'tr'], errors: [], differences: [] })
  })

  it('collects every mistake in one run, then compares what parses', () => {
    const dir = copy()
    writeFileSync(join(dir, 'tr/01-start/01-plans.md'), '---\nid: plans\n---\n# Planlar\n\nÖzet.\n\n- bir liste\n')
    writeFileSync(join(dir, 'tr/01-start/_section.md'), '---\nid: Start\n---\n# Başlarken\n')
    const result = checkDocs(dir, loadConfig(dir))
    expect(result.errors).toEqual([
      expect.stringMatching(/^tr\/01-start\/01-plans\.md:8: lists are not part/),
      expect.stringMatching(/^tr\/01-start\/_section\.md:2: an id is/),
    ])
    expect(result.differences).toEqual([])

    const drift = copy()
    writeFileSync(
      join(drift, 'tr/01-start/00-welcome.md'),
      '---\nid: welcome\nsee: [plans]\n---\n# Hoş geldin\n\nÖzet.\n\n## Kayıt {#signup}\n\nTek paragraf.\n\n> [!TIP] {#shortcut}\n> Kısayol.\n\n## Sınırlar {#limits}\n\n| Plan | Proje | Üye |\n| --- | --- | --- |\n| Ücretsiz | 3 | 1 |\n| Ekip | Sınırsız | 25 |\n',
    )
    const drifted = checkDocs(drift, loadConfig(drift))
    expect(drifted.errors).toEqual([])
    expect(drifted.differences.map((d) => d.message)).toEqual([
      'tr/01-start/00-welcome.md: block `signup` has 1/0/0/ (paragraphs/rows/columns/cells), the original 2/0/0/',
    ])
  })

  it('needs an original language', () => {
    const dir = copy()
    rmSync(join(dir, 'lockstep.json'))
    expect(() => loadConfig(dir)).toThrow('no original language')
    expect(checkDocs(dir, { original: 'de' }).errors[0]).toContain('no folder for the original language')
  })
})

describe('the command', () => {
  const root = resolve(__dirname, '..')
  const cli = join(root, 'dist/cli.js')
  beforeAll(() => {
    execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(root, 'tsconfig.build.json')])
  }, 60_000)
  const run = (...args: string[]) => {
    try {
      return { code: 0, out: execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
    } catch (e) {
      const err = e as { status: number; stdout: string; stderr: string }
      return { code: err.status, out: err.stdout + err.stderr }
    }
  }

  it('passes docs in lockstep and fails docs that drift', () => {
    expect(run('check', EXAMPLE)).toEqual({ code: 0, out: '2 languages, original en: in lockstep\n' })
    const dir = copy()
    rmSync(join(dir, 'tr/01-start/00-welcome.md'))
    const failed = run('check', dir)
    expect(failed.code).toBe(1)
    expect(failed.out).toContain('shape  tr: no article `welcome`')
    expect(run('check', dir, '--allow-missing').code).toBe(0)
    expect(run('lint', dir).code).toBe(2)
  })
})

describe('the Vite plugin', () => {
  it('serves the structure, the locales and one chunk per language', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lockstep-vite-'))
    temps.push(dir)
    writeFileSync(
      join(dir, 'main.js'),
      [
        "import structure from 'virtual:docs/structure'",
        "import locales from 'virtual:docs/locales'",
        "import loaders from 'virtual:docs/loaders'",
        'export { structure, locales, loaders }',
      ].join('\n'),
    )
    const out = await build({
      root: dir,
      logLevel: 'silent',
      plugins: [lockstep({ dir: EXAMPLE })],
      build: { write: false, lib: { entry: join(dir, 'main.js'), formats: ['es'], fileName: 'main' } },
    })
    const chunks = (Array.isArray(out) ? out[0]! : out) as { output: { type: string; fileName: string; code?: string }[] }
    const code = chunks.output.map((c) => c.code ?? '').join('\n')
    expect(code).toContain('"welcome"')
    expect(code).toMatch(/original:\s*"en"/)
    // Each language's words are a chunk of their own, loaded on demand.
    expect(chunks.output.filter((c) => c.type === 'chunk').length).toBe(3)
    expect(code).toContain('Yardım merkezi')
  })
})
