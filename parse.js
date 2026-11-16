// v1: marked 18.1.3 itself, vendored byte for byte in vendor/marked/
// (MIT, vendor/marked/LICENSE). parse(markdown) returns exactly the HTML
// marked.parse(markdown) returns with marked's defaults. This file is the
// correctness baseline; the fast paths land here next.

import { marked } from './vendor/marked/marked.esm.js';

/** The HTML marked renders for `markdown`, with marked's defaults. */
export function parse(markdown) {
  return marked.parse(markdown);
}
