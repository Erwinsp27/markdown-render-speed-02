// Entrypoint the harness executes: turn every benchmark case into HTML.
//
// It loads the case list (an array of { id, markdown }) from
// `$MAKEFUN_INPUT_DIR/cases.json` — or `/input/cases.json` when the variable
// is absent, which is where the cases live inside the grading container —
// renders each document on its own through `parse` from parse.js, and dumps
// the resulting HTML strings, in the same order, as a JSON array at
// `$MAKEFUN_OUTPUT_DIR/html.json` (or `/output/html.json` outside a
// container). Rendering is strictly one case at a time so no state can leak
// between documents.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

interface BenchmarkCase {
  id: string;
  markdown: string;
}

function envDir(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function loadCases(dir: string): BenchmarkCase[] {
  const raw = readFileSync(join(dir, 'cases.json'), 'utf8');
  return JSON.parse(raw) as BenchmarkCase[];
}

function renderAll(cases: BenchmarkCase[]): string[] {
  const out: string[] = [];
  for (const { markdown } of cases) out.push(parse(markdown));
  return out;
}

const casesPath = envDir('MAKEFUN_INPUT_DIR', '/input');
const outputPath = envDir('MAKEFUN_OUTPUT_DIR', '/output');

writeFileSync(
  join(outputPath, 'html.json'),
  JSON.stringify(renderAll(loadCases(casesPath))),
);
