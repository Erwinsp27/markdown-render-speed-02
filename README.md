# swift-marked

A fast drop-in replacement for marked 18.1.3: `parse(markdown)` returns exactly
the HTML `marked.parse(markdown)` returns with marked's default options
(GFM on, breaks off, pedantic off, async off), but renders the long documents
in the benchmark measurably faster.

## Layout

- `parse.js` — the module. `parse(markdown)` returns the HTML string.
  It is a fork of marked 18.1.3 (MIT, see `vendor/marked/LICENSE` and
  `vendor/marked/NOTICE`) with its hot paths rewritten: a character-code
  dispatched inline lexer that scans plain-text runs with `indexOf` instead
  of trying a regex at every character, and a block lexer that dispatches on
  the first character before trying block rules. Output is identical to
  marked's on every case of the practice set (680 CommonMark/GFM spec
  examples + 40 generated READMEs).
- `main.ts` — the driver the harness runs: reads `/input/cases.json`,
  renders each case alone with `parse`, writes `/output/html.json`.
- `vendor/marked/` — marked 18.1.3, vendored byte for byte from the
  competition kit (MIT), kept as the reference and as the fallback for
  inputs the fast paths decline.

## Build / check

```sh
node cli/makefun.mjs grade-local --kit <kit> --bot . --driver docker
```

No dependencies, no install step, Node 22 only.
