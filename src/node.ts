import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import {
  DocsSyntaxError,
  INDEX_FILE,
  SECTION_FILE,
  parseArticle,
  parseDocs,
  parseIndex,
  parseSection,
  shapeDifferences,
  type DirectiveSpec,
  type Difference,
  type DocsFile,
  type ParseOptions,
  type ParsedDocs,
} from './parse.js'

/**
 * READING DOCS FROM DISK.
 *
 * A docs folder holds one folder per language, named by its locale code
 * (`en`, `de-DE`, `pt-BR`), and optionally a `lockstep.json`:
 *
 *     { "original": "en", "directives": { "chart": { "args": ["sales", "costs"] } } }
 *
 * `original` is the language the docs are written in; every other folder is a
 * translation of it. `directives` are the `::name` lines articles may use.
 */

/** What `lockstep.json` holds. */
export interface Config extends ParseOptions {
  /** The language the docs are written in. */
  original: string
}

/** The name of the optional config file at the top of a docs folder. */
export const CONFIG_FILE = 'lockstep.json'

const LOCALE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/

/** The language folders: every directory whose name is a locale code. */
export function listLocales(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => LOCALE.test(name))
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .sort()
}

/** Every `.md` file of one language folder, with its path inside it. */
export function readFolder(dir: string, locale: string): DocsFile[] {
  const base = join(dir, locale)
  const out: DocsFile[] = []
  const walk = (at: string) => {
    for (const name of readdirSync(at).sort()) {
      const full = join(at, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (name.endsWith('.md')) {
        out.push({ path: relative(base, full).split(sep).join('/'), content: readFileSync(full, 'utf8') })
      }
    }
  }
  walk(base)
  return out
}

/** One language, parsed. */
export function readDocs(dir: string, locale: string, options: ParseOptions = {}): ParsedDocs {
  return parseDocs(locale, readFolder(dir, locale), options)
}

/**
 * The docs folder's config: `lockstep.json` merged under what the caller
 * passes. `original` must come from one or the other.
 */
export function loadConfig(dir: string, overrides: Partial<Config> = {}): Config {
  const path = join(dir, CONFIG_FILE)
  let fromFile: Partial<Config> = {}
  if (existsSync(path)) {
    try {
      fromFile = JSON.parse(readFileSync(path, 'utf8')) as Partial<Config>
    } catch {
      throw new Error(`${path}: not valid JSON`)
    }
  }
  const original = overrides.original ?? fromFile.original
  if (!original) throw new Error(`no original language: set "original" in ${path} or pass it`)
  const directives: Record<string, DirectiveSpec> = { ...(fromFile.directives ?? {}), ...(overrides.directives ?? {}) }
  return { original, directives }
}

export interface CheckResult {
  locales: string[]
  /** Syntax errors, with file and line, in any language. */
  errors: string[]
  /** Where translations' shapes differ from the original's. */
  differences: Difference[]
}

/**
 * Reads every language and compares each translation's shape with the
 * original's. Nothing throws for a mistake in a docs file: every mistake is
 * collected, so one run reports them all.
 */
export function checkDocs(dir: string, config: Config): CheckResult {
  const locales = listLocales(dir)
  const errors: string[] = []
  const differences: Difference[] = []
  if (!locales.includes(config.original)) {
    errors.push(`${dir}: no folder for the original language \`${config.original}\``)
    return { locales, errors, differences }
  }
  const parsed = new Map<string, ParsedDocs>()
  const collect = (fn: () => void): boolean => {
    try {
      fn()
      return true
    } catch (e) {
      if (!(e instanceof DocsSyntaxError)) throw e
      errors.push(e.message)
      return false
    }
  }
  for (const locale of locales) {
    const files = readFolder(dir, locale)
    // Each file on its own first, so one run reports every broken file
    // rather than the first in each language.
    let clean = true
    for (const f of files) {
      const file = `${locale}/${f.path}`
      const one = f.path === INDEX_FILE
        ? () => parseIndex(f.content, file)
        : f.path.endsWith(`/${SECTION_FILE}`)
          ? () => parseSection(f.content, file)
          : () => parseArticle(f.content, file, config)
      clean = collect(one) && clean
    }
    // Then the folder as a whole: ids used twice, `see`, the layout.
    if (clean) collect(() => parsed.set(locale, parseDocs(locale, files, config)))
  }
  const original = parsed.get(config.original)
  if (original) {
    for (const [locale, docs] of parsed) {
      if (locale !== config.original) differences.push(...shapeDifferences(original, docs))
    }
  }
  return { locales, errors, differences }
}
