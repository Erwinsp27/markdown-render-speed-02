// Driver the harness runs: render every case in `$MAKEFUN_INPUT_DIR/cases.json`
// (or `/input/cases.json` when the variable is unset) to HTML with `parse`
// and write the results, in input order, as a JSON array at
// `$MAKEFUN_OUTPUT_DIR/html.json` (or `/output/html.json`).
//
// One case is rendered at a time and each result is independent, so no
// state can leak from one document into the next.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

interface BenchmarkCase {
  id: string;
  markdown: string;
}

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

function readCases(dir: string): BenchmarkCase[] {
  const text = readFileSync(join(dir, 'cases.json'), 'utf8');
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data)) {
    throw new Error(`cases.json in ${dir} is not an array`);
  }
  for (const entry of data) {
    if (typeof entry !== 'object' || entry === null || typeof (entry as BenchmarkCase).markdown !== 'string') {
      throw new Error(`cases.json in ${dir} has a case without a string "markdown"`);
    }
  }
  return data as BenchmarkCase[];
}

function renderCases(cases: BenchmarkCase[]): string[] {
  const html: string[] = [];
  for (const entry of cases) {
    try {
      html.push(parse(entry.markdown));
    } catch (err) {
      throw new Error(`failed to render case ${entry.id}: ${(err as Error).message}`);
    }
  }
  return html;
}

writeFileSync(
  join(outputDir, 'html.json'),
  JSON.stringify(renderCases(readCases(inputDir))),
);
