# swift-marked

A faster drop-in for marked 18.1.3. Calling `parse(markdown)` gives back
exactly the HTML that `marked.parse(markdown)` gives back under marked's
defaults (GFM enabled, hard breaks off, pedantic off, synchronous) — the
long documents in the benchmark just come out sooner.

## What lives here

- `parse.js` — the module; `parse(markdown)` returns the HTML string. It
  starts from marked 18.1.3 (MIT — see `vendor/marked/LICENSE` and
  `vendor/marked/NOTICE`) and rewrites the hot paths instead of
  reimplementing the renderer:
  - **First-character dispatch.** Every block rule is guarded by a cheap
    check on the opening character: when the character rules the rule out,
    the tokenizer returns `undefined` at once instead of running the rule's
    regular expression at all.
  - **Trigger-scan inline text.** The one inline method that does genuine
    work is `inlineText`. It scans for the next position where an inline
    rule could possibly start (a single cheap regex over trigger characters)
    and builds the text token for the whole run directly — raw text plus
    numeric-reference decoding, exactly as marked's own `inlineText` does —
    so the output is marked's output by construction.
  - **Second-level structural checks (v4).** Six more guards, each a
    *necessary* condition proved from marked 18.1.3's own regexes — when
    the check fails, the regex provably cannot match, so the original
    method is skipped; when it passes, the original method still runs
    unchanged, so nothing about the output can drift:
    1. `list` — after a bullet must come a space, tab, newline or
       end-of-input (`listBulletEnd` / `termAfterBullet`); a numeric
       bullet needs 1–9 digits plus `.` or `)` plus the same terminator.
       This is what keeps `*emphasis`, `-word` and years like `2024`
       out of the list rule.
    2. `hr` — the first line must contain at least three of one marker
       with only spaces or tabs between them (`hrLine`).
    3. Fences — an opening fence needs three identical backticks or
       tildes in a row (`fenceRun`).
    4. `def` — a multi-line-aware label scan (`defLabelEnd`): an
       unescaped `[` or a blank line inside the label, or a `]` not
       followed by `:`, rules the definition out.
    5. `lheading` — scans lines for a setext underline before the first
       blank line (`setextUnderline`, `isUnderlineLine`, `isBlankLine`),
       plus a new `P.lheading` patch; it stops only at blank lines, so
       it stays a necessary condition.
    6. `table` — the delimiter row may hold only `|`, `:` `-`, spaces
       and tabs, and it needs at least one `-` (`tableDelimiter`).
  Together the six checks skip roughly 27,800 regex executions over the
  full 720-case practice set (measured on v3, with zero false skips):
  list 761, hr 2,115, fences 648, def 2,148, lheading 17,589,
  table 3,508.
- `main.ts` — the driver the harness runs: loads `/input/cases.json`
  (or `$MAKEFUN_INPUT_DIR/cases.json`), renders each case on its own
  with `parse`, and writes the HTML strings in order to
  `/output/html.json` (or `$MAKEFUN_OUTPUT_DIR/html.json`).
- `vendor/marked/` — marked 18.1.3 vendored byte for byte from the
  competition kit (MIT). It is the reference the fast paths are checked
  against, and the fallback for anything they decline.

## Correctness

Every case of the 720-document practice set (680 CommonMark/GFM spec
examples plus 40 generated READMEs) renders byte-identically to marked,
and a 400-document random fuzz over emphasis, links, autolinks, email
and `www.` addresses, tables, lists, code fences, raw HTML and setext
headings shows zero mismatches against `marked.parse`.

## Build / check

```sh
node cli/makefun.mjs grade-local --kit <kit> --bot . --driver docker
```

No dependencies and no install step; Node 22 only.
