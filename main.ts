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
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`cases.json in ${dir} is not an array`);
  }
  for (const c of parsed) {
    if (typeof c !== 'object' || c === null || typeof (c as BenchmarkCase).markdown !== 'string') {
      throw new Error(`cases.json in ${dir} has a case without a string "markdown"`);
    }
  }
  return parsed as BenchmarkCase[];
}

function renderAll(cases: BenchmarkCase[]): string[] {
  const out: string[] = [];
  for (const c of cases) {
    try {
      out.push(parse(c.markdown));
    } catch (err) {
      throw new Error(`failed to render case ${c.id}: ${(err as Error).message}`);
    }
  }
  return out;
}

const casesPath = envDir('MAKEFUN_INPUT_DIR', '/input');
const outputPath = envDir('MAKEFUN_OUTPUT_DIR', '/output');

writeFileSync(
  join(outputPath, 'html.json'),
  JSON.stringify(renderAll(loadCases(casesPath))),
);
