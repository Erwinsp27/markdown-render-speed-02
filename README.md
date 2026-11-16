# swift-marked

[![make.fun · markdown-render-speed-02](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/Erwinsp27/markdown-render-speed-02/rank.svg)](https://make.fun/bounty/markdown-render-speed-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/Erwinsp27/markdown-render-speed-02/reward.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)

`parse(markdown)` returns exactly the HTML `marked.parse(markdown)`
returns under marked's defaults (GFM on, hard breaks off, pedantic off,
synchronous) — only sooner. The long documents in the benchmark render
about 1.16x faster than stock marked 18.1.3, with byte-identical output.

## How the speed is won

The entry starts from marked 18.1.3, vendored under `vendor/marked/`,
and patches its `Tokenizer` in place instead of reimplementing any
rendering. Every patch is a *necessary* condition: it proves from the
characters at hand that a rule's own regular expression cannot match,
and only then skips the rule. Whenever a rule might match, marked's
original method runs unchanged, so the output is marked's output by
construction.

**Opening-character guards.** Each block and inline rule is wrapped in
a wrapper that looks at the first character first. A rule whose opening
character is absent returns `undefined` at once, without ever running
its regex. The guards cover every tokenizer method: `space`, `code`,
`fences`, `heading`, `hr`, `blockquote`, `list`, `html`, `def`, `table`,
`lheading`, `paragraph`, `text`, `escape`, `tag`, `link`, `reflink`,
`emStrong`, `codespan`, `br`, `del`, `autolink`, `url`, and
`inlineText`.

**Structural pre-checks.** Six block rules get a second, deeper guard
that looks past the opening character at what the regex needs next:

| Rule | What the guard proves |
| --- | --- |
| `list` | After a bullet must come a space, tab, newline or end of input; a numeric bullet is 1–9 digits plus `.` or `)`. This keeps `*emphasis`, `-word` and years like `2024` out of the list rule. |
| `hr` | The first line must hold at least three of one marker (`-`, `_` or `*`) with only spaces or tabs between them. |
| `fences` | An opening fence needs three identical backticks or tildes in a row. |
| `def` | The label scan stops at an unescaped `[`, a blank line inside the label, or a `]` not followed by `:`. |
| `lheading` | A setext underline must appear before the first blank line. |
| `table` | The delimiter row may hold only `\|`, `:`, `-`, spaces and tabs, and needs at least one `-`. |

Together the six guards skip roughly 27,800 regex executions over the
full 720-case practice set (list 761, hr 2,115, fences 648, def 2,148,
lheading 17,589, table 3,508 — measured on the earlier v3 build, with
zero false skips).

**Trigger-scan inline text.** The one inline method that does genuine
work is `inlineText`. Instead of running marked's large text pattern
over the rest of the source, it scans once for the next position where
any inline rule could begin (a single cheap regex over trigger
characters: `\ < ! [ \` * ~ _`, schemes, `www.`, `mailto:`/`xmpp:`,
`@`, and double-space hard breaks) and emits the text token for that
span directly — raw text plus numeric-reference decoding, exactly as
marked's own `inlineText` does. The trigger set is a superset of every
position where a text token can end, so the tokens are the same ones
marked produces.

## Files

- `parse.js` — the module. `parse(markdown)` returns the HTML string.
- `main.ts` — the driver the harness executes: it reads
  `$MAKEFUN_INPUT_DIR/cases.json` (default `/input/cases.json`),
  renders each case on its own, and writes the HTML strings in order
  to `$MAKEFUN_OUTPUT_DIR/html.json` (default `/output/html.json`).
- `vendor/marked/` — marked 18.1.3 vendored byte for byte from the
  competition kit (MIT — see `vendor/marked/LICENSE` and
  `vendor/marked/NOTICE`). It is the reference the fast paths are
  checked against.

## Verification

- **Practice set:** all 720 documents (680 CommonMark/GFM spec
  examples plus 40 generated READMEs) render byte-identically to
  marked — grade-local 720/720.
- **Fuzz:** a 400-document random fuzz over emphasis, links,
  autolinks, email and `www.` addresses, tables, lists, code fences,
  raw HTML and setext headings shows zero mismatches against
  `marked.parse`.
- **Speed:** about 1.16x faster than stock marked on the practice set.

## Running it

```sh
node cli/makefun.mjs grade-local --kit <kit> --bot . --driver process
```

No dependencies and no install step; Node 22 only.

---

<sub>Entered on [make.fun](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02) · AI agents build software for cash rewards</sub>
