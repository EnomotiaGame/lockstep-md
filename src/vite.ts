import { join, resolve, sep } from 'node:path'
import type { Plugin } from 'vite'
import { toBundle, toStructure } from './parse.js'
import { listLocales, loadConfig, readDocs, readFolder, type Config } from './node.js'

export interface LockstepPluginOptions extends Partial<Config> {
  /** The docs folder, holding one folder per language. */
  dir: string
  /** The virtual module prefix. `virtual:docs/` by default. */
  prefix?: string
}

/**
 * THE DOCS, AS VIRTUAL MODULES.
 *
 *     virtual:docs/structure        the sections, articles and blocks, the same
 *                                   in every language, read from the original
 *     virtual:docs/locales          { original, locales }
 *     virtual:docs/bundle/<locale>  one language's words (see toBundle)
 *     virtual:docs/loaders          { <locale>: () => import(bundle) }, so each
 *                                   language is its own chunk, fetched lazily
 *
 * A mistake in a docs file fails the build with its file and line. In the dev
 * server, editing a docs file reloads the page.
 */
export function lockstep(options: LockstepPluginOptions): Plugin {
  const dir = resolve(options.dir)
  const prefix = options.prefix ?? 'virtual:docs/'
  const resolved = '\0' + prefix
  const config = () => loadConfig(dir, options)

  return {
    name: 'lockstep-md',
    resolveId(id) {
      return id.startsWith(prefix) ? resolved + id.slice(prefix.length) : undefined
    },
    load(id) {
      if (!id.startsWith(resolved)) return undefined
      const what = id.slice(resolved.length)
      const cfg = config()
      const locales = listLocales(dir)
      // Every docs file is a dependency of every docs module: a change to one
      // article can change the structure, a bundle, or both.
      for (const locale of locales) {
        for (const f of readFolder(dir, locale)) this.addWatchFile(join(dir, locale, f.path))
      }
      if (what === 'structure') {
        return `export default ${JSON.stringify(toStructure(readDocs(dir, cfg.original, cfg)))}`
      }
      if (what === 'loaders') {
        const entries = locales.map((l) => `${JSON.stringify(l)}: () => import(${JSON.stringify(`${prefix}bundle/${l}`)})`)
        return `export default {${entries.join(',')}}`
      }
      if (what === 'locales') {
        return `export default ${JSON.stringify({ original: cfg.original, locales })}`
      }
      if (what.startsWith('bundle/')) {
        const locale = what.slice('bundle/'.length)
        if (!locales.includes(locale)) this.error(`the docs have no language folder \`${locale}\``)
        return `export default ${JSON.stringify(toBundle(readDocs(dir, locale, cfg)))}`
      }
      this.error(`unknown docs module \`${prefix}${what}\``)
    },
    handleHotUpdate({ file, server }) {
      if (!file.startsWith(dir + sep)) return
      for (const mod of server.moduleGraph.idToModuleMap.values()) {
        if (mod.id?.startsWith(resolved)) server.moduleGraph.invalidateModule(mod)
      }
      server.ws.send({ type: 'full-reload' })
      return []
    },
  }
}

export default lockstep
