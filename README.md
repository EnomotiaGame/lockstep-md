# lockstep-md

[![npm](https://img.shields.io/npm/v/lockstep-md.svg)](https://www.npmjs.com/package/lockstep-md)
[![CI](https://github.com/EnomotiaGame/lockstep-md/actions/workflows/ci.yml/badge.svg)](https://github.com/EnomotiaGame/lockstep-md/actions/workflows/ci.yml)

Multilingual Markdown docs that stay in lockstep. Write the docs once, copy the folder to translate them, and let the build fail the moment a translation drops a paragraph, a table row or a section.

> **From the ENOMOTIA team.** We build [ENOMOTIA](https://enomotia.net), a strategy game set in ancient Greece that you play in the browser and on your phone. Along the way we keep meeting problems that every web and mobile product meets sooner or later. When one of our fixes turns out to be useful beyond the game, we clean it up and publish it here so you don't have to solve it again. Issues, ideas and pull requests are welcome: see [CONTRIBUTING](https://github.com/EnomotiaGame/.github/blob/main/CONTRIBUTING.md).

The game's player guide is written in Turkish and translated into English, German, Polish and Greek. That is nearly 90 files per language, edited by many hands. Prose doesn't break like code does. A translation that quietly lost a paragraph, or a table missing the row added last month, keeps reading convincingly and keeps being wrong. lockstep-md is how we keep five languages saying the same thing. It reads all five in under a fifth of a second.

## What it does

- **Fails loudly.** It reads a strict subset of Markdown, and a line it does not understand is an error with its file and line, never a paragraph that renders strangely. Every translation is checked against the original: the same articles, sections, blocks, paragraph counts and table rows and columns. A translator may write anything; they may not silently drop anything.
- **Translation-proof ids.** Articles and blocks carry ids (`{#signup}`) that survive translation, so links, anchors and your renderer work the same in every language.
- **Directives for your own content.** `::pricing monthly` marks where your app draws something (a chart, a table from your data) and keeps only its caption in the prose. You declare which directives exist, so a typo is an error.
- **i18n-ready output.** Each language becomes one nested object you can load as a translation namespace (i18next, for one), plus one language-free structure your renderer walks.
- **A Vite plugin** that serves the structure and lazy-loads one chunk per language, with live reload while you write.
- **A CLI for CI**: `lockstep-md check docs/`.
- **No runtime dependencies.** The parser runs in Node and in the browser.

## The format

```
docs/
  lockstep.json                  { "original": "en", "directives": { … } }
  en/
    _index.md                    the docs' title, and any words of their own
    01-start/
      _section.md                a section's id and title
      00-welcome.md              an article
      01-plans.md
  tr/                            a copy of en/, translated
    …
```

Order comes from the file names. Reordering is renaming, and a translator who copies the folder copies the order with it.

An article:

```markdown
---
id: welcome
see: [plans]
---
# Welcome

The summary: exactly one paragraph.

## Sign up {#signup}

Create an account with your email address. **Inline Markdown** and [links](plans) pass through.

A second paragraph.

> [!TIP] {#shortcut}
> Notes use GitHub's alert syntax: NOTE, TIP, IMPORTANT, WARNING, CAUTION.

## Limits {#limits}

| Plan | Projects |
| --- | --- |
| Free | 3 |

## Prices {#prices}

::pricing monthly

The caption under whatever your app draws here: exactly one paragraph.
```

What is refused, each with its file and line:
- lists and code blocks (write paragraphs or a table);
- headings without an id, and third-level headings;
- a plain quotation that is not a note;
- text stranded after a note;
- an unknown directive, or one with the wrong argument;
- an id used twice;
- a `see` that names no article;
- an id that could not be part of a URL.

A complete example in two languages is in [`example/docs`](example/docs).

## Use

```sh
npm install --save-dev lockstep-md
```

### In CI

```sh
npx lockstep-md check docs/
```

```
shape  tr/01-start/00-welcome.md: block `signup` has 1/0/0/ (paragraphs/rows/columns/cells), the original 2/0/0/
2 languages, original en: 1 to fix
```

It exits 1 when there is anything to fix. Add `--allow-missing` if translations may lag behind and your readers fall back to the original. Missing articles are then listed without failing the build.

### With Vite

```ts
// vite.config.ts
import { lockstep } from 'lockstep-md/vite'

export default { plugins: [lockstep({ dir: 'docs' })] }
```

```ts
import structure from 'virtual:docs/structure' // sections → articles → blocks, the same in every language
import loaders from 'virtual:docs/loaders'     // { en: () => import(…), tr: () => import(…) }

const words = (await loaders.tr()).default
words.articles.welcome.sections.signup.body    // ['E-posta adresinle bir hesap aç…', …]
```

Walk `structure` to render; for each block, take its words from the language's bundle. A `directive` block is yours to draw, by `name` and `arg`.

### From code

```ts
import { parseDocs, shapeDifferences, toBundle, toStructure } from 'lockstep-md'
import { checkDocs, loadConfig, readDocs } from 'lockstep-md/node'

const config = loadConfig('docs')
const en = readDocs('docs', 'en', config)
const result = checkDocs('docs', config) // { locales, errors, differences }
```

## Contributing

Bug reports, ideas and pull requests are welcome. If your docs need something the format refuses, open an issue and tell us what you're writing. Security problems go through [private vulnerability reporting](https://github.com/EnomotiaGame/lockstep-md/security/advisories/new). The details are in [CONTRIBUTING](https://github.com/EnomotiaGame/.github/blob/main/CONTRIBUTING.md).

## License

MIT © TRUETHINKS LTD
