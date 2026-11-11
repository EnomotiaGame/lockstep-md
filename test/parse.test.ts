import { describe, expect, it } from 'vitest'
import {
  DocsSyntaxError,
  parseArticle,
  parseDocs,
  parseSection,
  shapeDifferences,
  toBundle,
  toStructure,
  yamlScalar,
  type DocsFile,
  type ParseOptions,
} from '../src/index.js'

const article = (body: string, front = 'id: sample') => `---\n${front}\n---\n${body}`
const opts: ParseOptions = { directives: { chart: { args: ['sales', 'costs'] }, map: {}, embed: { args: 'any' } } }

describe('the format', () => {
  it('reads an article: title, summary, prose, a table, a note and a directive', () => {
    const a = parseArticle(
      article(
        [
          '# Title',
          '',
          'The summary.',
          '',
          '## Prose {#prose}',
          '',
          'One **bold** paragraph.',
          'still the same paragraph.',
          '',
          'A second one.',
          '',
          '## Table {#table}',
          '',
          '| A | B |',
          '| --- | --- |',
          '| a \\| pipe | b |',
          '',
          '> [!WARNING] {#note}',
          '> First.',
          '>',
          '> Second.',
          '',
          '## Sales {#sales}',
          '',
          '::chart sales',
          '',
          'The caption.',
        ].join('\n'),
        'id: sample\nsee: [other]\nauthor: Ada',
      ),
      'x.md',
      opts,
    )
    expect(a.title).toBe('Title')
    expect(a.summary).toBe('The summary.')
    expect(a.see).toEqual(['other'])
    expect(a.meta).toEqual({ author: 'Ada' })
    expect(a.blocks).toEqual([
      { kind: 'prose', id: 'prose' },
      { kind: 'table', id: 'table' },
      { kind: 'note', id: 'note', variant: 'warning' },
      { kind: 'directive', id: 'sales', name: 'chart', arg: 'sales' },
    ])
    // A paragraph wrapped over two lines is one paragraph.
    expect(a.text.prose!.body).toEqual(['One **bold** paragraph. still the same paragraph.', 'A second one.'])
    expect(a.text.table).toEqual({ heading: 'Table', columns: ['A', 'B'], rows: [['a | pipe', 'b']] })
    expect(a.text.note!.body).toEqual(['First.', 'Second.'])
    expect(a.text.sales).toEqual({ heading: 'Sales', caption: 'The caption.' })
  })

  it('knows every GitHub alert kind as a note', () => {
    for (const kind of ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']) {
      const a = parseArticle(article(`# T\n\nS.\n\n> [!${kind}] {#n}\n> Text.\n`), 'x.md')
      expect(a.blocks).toEqual([{ kind: 'note', id: 'n', variant: kind.toLowerCase() }])
    }
  })

  it('takes directives as the project declares them', () => {
    const block = (line: string) => parseArticle(article(`# T\n\nS.\n\n## H {#h}\n\n${line}\n\nCaption.\n`), 'x.md', opts).blocks[0]
    expect(block('::map')).toEqual({ kind: 'directive', id: 'h', name: 'map' })
    expect(block('::embed video-1')).toEqual({ kind: 'directive', id: 'h', name: 'embed', arg: 'video-1' })
    expect(() => block('::map world')).toThrow('`::map` takes no argument')
    expect(() => block('::chart profit')).toThrow('`::chart` takes sales, costs')
    expect(() => block('::chart')).toThrow('`::chart` takes sales, costs')
    expect(() => block('::embed')).toThrow('`::embed` takes one argument')
    expect(() => block('::poll')).toThrow('unknown directive `::poll`; known: `::chart`, `::map`, `::embed`')
    expect(() => parseArticle(article('# T\n\nS.\n\n## H {#h}\n\n::map\n\nC.\n'), 'x.md')).toThrow('this project declares none')
    expect(() => block('::constructor')).toThrow('unknown directive')
  })

  it.each([
    ['a list', '# T\n\nS.\n\n## H {#h}\n\n- item\n', 'lists are not part'],
    ['a numbered list', '# T\n\nS.\n\n## H {#h}\n\n1. item\n', 'lists are not part'],
    ['a code block', '# T\n\nS.\n\n## H {#h}\n\n```js\nx\n```\n', 'code blocks are not part'],
    ['a heading without an id', '# T\n\nS.\n\n## H\n\nText.\n', '## Heading {#block-id}'],
    ['a third-level heading', '# T\n\nS.\n\n### H {#h}\n\nText.\n', '## Heading {#block-id}'],
    ['a malformed directive', '# T\n\nS.\n\n## H {#h}\n\n::Chart\n\nCaption.\n', 'is not a directive'],
    ['a directive without a caption', '# T\n\nS.\n\n## H {#h}\n\n::map\n', 'exactly one caption'],
    ['a directive after text', '# T\n\nS.\n\n## H {#h}\n\nCaption.\n\n::map\n', 'comes first'],
    ['no summary', '# T\n\n## H {#h}\n\nText.\n', 'exactly one summary'],
    ['two summaries', '# T\n\nS.\n\nS2.\n\n## H {#h}\n\nText.\n', 'exactly one summary'],
    ['two titles', '# T\n\nS.\n\n# U\n', 'one `# title`'],
    ['a block id twice', '# T\n\nS.\n\n## A {#h}\n\nA.\n\n## B {#h}\n\nB.\n', 'used twice'],
    ['text after a note', '# T\n\nS.\n\n> [!NOTE] {#n}\n> N.\n\nLost.\n', 'needs a `## heading'],
    ['an empty note', '# T\n\nS.\n\n> [!NOTE] {#n}\n', 'at least one paragraph'],
    ['a plain quotation', '# T\n\nS.\n\n## H {#h}\n\n> quoted\n', 'is a note'],
    ['a table without its rule', '# T\n\nS.\n\n## H {#h}\n\n| A |\n| a |\n', '`| --- |`'],
    ['a table with text', '# T\n\nS.\n\n## H {#h}\n\nText.\n\n| A |\n| --- |\n| a |\n', 'nothing else'],
    ['an empty block', '# T\n\nS.\n\n## H {#h}\n\n## I {#i}\n\nText.\n', 'at least one paragraph'],
  ])('refuses %s, with the file and the line', (_what, body, message) => {
    const parse = () => parseArticle(article(body), 'x.md', opts)
    expect(parse).toThrow(DocsSyntaxError)
    expect(parse).toThrow(message)
    expect(parse).toThrow(/^x\.md:\d+:/)
  })

  it('names the line of the mistake', () => {
    try {
      parseArticle(article('# T\n\nS.\n\n## H {#h}\n\nFine.\n\n- not fine\n'), 'docs/en/a.md')
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(DocsSyntaxError)
      expect((e as DocsSyntaxError).file).toBe('docs/en/a.md')
      expect((e as DocsSyntaxError).line).toBe(12)
    }
  })

  it('refuses an id that could not be part of an address, with its file and line', () => {
    for (const id of ['Walls', '../walls', 'walls" onclick="x', 'a b', 'duvar-ş']) {
      expect(() => parseArticle(article('# X\n\nS.\n', `see: []\nid: ${JSON.stringify(id)}`), 'x.md')).toThrow(/^x\.md:3: an id is/)
      expect(() => parseSection(`---\nid: ${JSON.stringify(id)}\n---\n# A\n`, 's.md')).toThrow(/^s\.md:2: an id is/)
    }
    expect(parseArticle(article('# X\n\nS.\n', 'id: walls_2-b'), 'x.md').id).toBe('walls_2-b')
  })

  it('round-trips frontmatter values it writes', () => {
    for (const v of ['plain', 'two: parts', '"quoted"', ' padded', '{{count}} items', '- dash', '#hash']) {
      const a = parseArticle(article('# X\n\nS.\n', `id: x\nlabel: ${yamlScalar(v)}`), 'x.md')
      expect(a.meta.label).toBe(v)
    }
  })
})

const files = (sections: Record<string, Record<string, string>>, index = '---\ncontents: Contents\n---\n# Docs\n'): DocsFile[] => [
  { path: '_index.md', content: index },
  ...Object.entries(sections).flatMap(([folder, arts]) => [
    { path: `${folder}/_section.md`, content: `---\nid: ${folder.replace(/^\d+-/, '')}\n---\n# ${folder}\n` },
    ...Object.entries(arts).map(([name, content]) => ({ path: `${folder}/${name}`, content })),
  ]),
]

describe('a language folder', () => {
  it('reads nested frontmatter, lists and quoted values, in file-name order', () => {
    const g = parseDocs(
      'xx',
      files(
        {
          '02-b': { '00-y.md': article('# Y\n\nS.\n', 'id: y') },
          '01-a': { '01-z.md': article('# Z\n\nS.\n', 'id: z'), '00-x.md': article('# X\n\nS.\n', 'id: x') },
        },
        '---\nsearch:\n  label: Ara\n  count: "{{count}} bölüm"\nsteps:\n  - one\n  - "two: yes"\n---\n# Guide\n',
      ),
    )
    expect(g.meta).toEqual({ search: { label: 'Ara', count: '{{count}} bölüm' }, steps: ['one', 'two: yes'] })
    expect(toStructure(g)).toEqual([
      { id: 'a', articles: [{ id: 'x', blocks: [] }, { id: 'z', blocks: [] }] },
      { id: 'b', articles: [{ id: 'y', blocks: [] }] },
    ])
    expect(toBundle(g)).toMatchObject({ title: 'Guide', sections: { a: '01-a', b: '02-b' }, articles: { x: { title: 'X', summary: 'S.' } } })
  })

  it('refuses a `see` that names no article, a missing index, and ids used twice', () => {
    expect(() => parseDocs('xx', files({ '01-a': { '00-x.md': article('# X\n\nS.\n', 'id: x\nsee: [nowhere]') } }))).toThrow(
      'which is no article',
    )
    expect(() => parseDocs('xx', files({ '01-a': {} }).slice(1))).toThrow('_index.md')
    expect(() =>
      parseDocs('xx', files({ '01-a': { '00-x.md': article('# X\n\nS.\n', 'id: x'), '01-y.md': article('# Y\n\nS.\n', 'id: x') } })),
    ).toThrow('article id `x` is used twice')
    expect(() => parseDocs('xx', [...files({ '01-a': {} }), { path: '01-a/deep/x.md', content: '' }])).toThrow('<section>/<article>.md')
  })
})

describe('lockstep', () => {
  const en = () =>
    parseDocs(
      'en',
      files({
        '01-a': {
          '00-x.md': article('# X\n\nS.\n\n## P {#p}\n\nOne.\n\nTwo.\n\n## T {#t}\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n', 'id: x\nsee: [y]'),
          '01-y.md': article('# Y\n\nS.\n', 'id: y'),
        },
      }),
    )

  it('finds nothing to say about a faithful translation', () => {
    const de = parseDocs(
      'de',
      files({
        '01-a': {
          '00-x.md': article('# X\n\nZ.\n\n## P {#p}\n\nEins.\n\nZwei.\n\n## T {#t}\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n', 'id: x\nsee: [y]'),
          '01-y.md': article('# Y\n\nZ.\n', 'id: y'),
        },
      }),
    )
    expect(shapeDifferences(en(), de)).toEqual([])
  })

  it('reports a dropped paragraph, a dropped row, a missing article and an extra one', () => {
    const de = parseDocs(
      'de',
      files({
        '01-a': {
          '00-x.md': article('# X\n\nZ.\n\n## P {#p}\n\nEins und zwei.\n\n## T {#t}\n\n| A | B |\n| --- | --- |\n', 'id: x\nsee: [z]'),
          '02-z.md': article('# Z\n\nZ.\n', 'id: z'),
        },
      }),
    )
    const diffs = shapeDifferences(en(), de)
    expect(diffs.map((d) => d.kind).sort()).toEqual(['counts', 'counts', 'extra', 'missing', 'see'])
    expect(diffs.find((d) => d.kind === 'missing')!.message).toContain('no article `y`')
    expect(diffs.find((d) => d.kind === 'counts')!.file).toBe('de/01-a/00-x.md')
  })

  it('reports blocks that changed kind or order, and an article that moved section', () => {
    const de = parseDocs(
      'de',
      files({
        '01-a': { '00-x.md': article('# X\n\nZ.\n\n## T {#t}\n\nKeine Tabelle.\n\n## P {#p}\n\nEins.\n\nZwei.\n', 'id: x\nsee: [y]') },
        '02-b': { '00-y.md': article('# Y\n\nZ.\n', 'id: y') },
      }),
    )
    expect(shapeDifferences(en(), de).map((d) => d.kind).sort()).toEqual(['blocks', 'moved'])
  })
})
