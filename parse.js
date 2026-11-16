// swift-marked v3: marked 18.1.3 (vendored in vendor/marked/, MIT) with its
// Tokenizer's hot methods patched in place. Each patch either proves from
// the first characters that its rule cannot match (return undefined — the
// rule's regex is anchored and needs those characters) or calls marked's
// original method unchanged. Nothing about marked's tokenizing, parsing or
// rendering is reimplemented, so the output is marked's output by
// construction; the speed comes from skipping the dozen regex executions
// the inline/block loops try at every position.
//
// The one method that does real work is inlineText: instead of running
// marked's giant text regex over the whole remaining source, it first
// scans for the next position where any inline rule could start (the
// "trigger scan"), then builds the text token for just that run directly
// (raw + numeric-reference decoding, exactly as marked's inlineText does).
// The trigger set is a superset of every position where marked's text
// token can end, so the tokens produced are the same ones marked
// produces, only found with one cheap scan instead of a regex cascade.

import { Marked, Tokenizer } from './vendor/marked/marked.esm.js';

// ---------------------------------------------------------------------------
// Character classes (ASCII)
// ---------------------------------------------------------------------------

const EMAIL_LOCAL = new Uint8Array(128);
for (const ch of "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.!#$%&'*+/=?_`{|}~-") {
  EMAIL_LOCAL[ch.charCodeAt(0)] = 1;
}
function isAlnum(c) {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

// ---------------------------------------------------------------------------
// Inline text run scan
//
// textRunEnd(src) returns the index where the plain-text run starting at 0
// ends: the first position where marked's text token would stop, or
// src.length. Stops are: a character that starts another inline rule
// (\ < ! [ ` * ~ _), a scheme (http://, https://, ftp://), a www. with a
// valid lookbehind (start, whitespace, *, _, ~, (), a mailto:/xmpp: preceded
// by a non-alphanumeric (or at the start), the start of an email's local
// part, and the first space of a "  \n" hard-break run.
// ---------------------------------------------------------------------------

const TRIGGER_RE = /[\\<!\[`*~_]|(?:[hH][tT][tT][pP][sS]?|[fF][tT][pP]):\/\/|www\.|mailto:|xmpp:|@| {2,}\n/g;

function textRunEnd(src) {
  TRIGGER_RE.lastIndex = 0;
  let m;
  while ((m = TRIGGER_RE.exec(src)) !== null) {
    const i = m.index;
    const tok = m[0];
    const c0 = tok.charCodeAt(0);
    if (c0 === 64) { // '@': walk back over the email local part
      let s = i;
      while (s > 0 && src.charCodeAt(s - 1) < 128 && EMAIL_LOCAL[src.charCodeAt(s - 1)]) s--;
      if (s < i) return s;
      continue; // lone '@', not an email start
    }
    if (tok.length === 1) return i; // \ < ! [ ` * ~ _
    if (c0 === 32) return i; // "  \n": stop at the first space
    if (tok === 'www.') {
      if (i === 0) return i;
      const p = src.charCodeAt(i - 1);
      if (p === 32 || p === 9 || p === 10 || p === 13 || p === 42 || p === 95 || p === 126 || p === 40) return i;
      continue; // www. without a valid lookbehind is plain text
    }
    if (tok === 'mailto:' || tok === 'xmpp:') {
      if (i === 0) return i;
      if (!isAlnum(src.charCodeAt(i - 1))) return i;
      continue; // preceded by an alphanumeric: no autolink here
    }
    return i; // scheme:// — always a stop
  }
  return src.length;
}

// ---------------------------------------------------------------------------
// Numeric character reference decoding, exactly as marked's helper does it
// (helpers.ts decodeNumericCharacterReferences), using the rules' regexes.
// ---------------------------------------------------------------------------

function decodeNumericRefs(text, other) {
  if (!other.numericCharacterReference.test(text)) return text;
  return text.replace(other.numericCharacterReferenceOrAmpersand, (ref, dec, hex) => {
    if (dec === undefined && hex === undefined) return '&amp;';
    const code = dec === undefined ? Number.parseInt(hex, 16) : Number.parseInt(dec, 10);
    if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '�';
    return code === 38 ? '&amp;' : String.fromCodePoint(code);
  });
}

// ---------------------------------------------------------------------------
// Block pre-checks. Each returns undefined when its rule cannot match,
// otherwise it calls marked's original method.
// ---------------------------------------------------------------------------

function skip3(src) {
  let i = 0;
  if (src.charCodeAt(0) === 32) {
    i = 1;
    if (src.charCodeAt(1) === 32) {
      i = 2;
      if (src.charCodeAt(2) === 32) i = 3;
    }
  }
  return i;
}

// ---------------------------------------------------------------------------
// Second-level structural checks for block rules.
//
// The first-char dispatches below already skip a rule when its opening
// character cannot start it. These helpers go one step further: they check
// the characters the rule's regex needs *after* its opening character, so
// a call that would fail the regex is skipped without running it. Each
// helper is a *necessary* condition only — it answers false only when the
// regex provably cannot match, and true whenever it might; a true answer
// still calls marked's original method, so the output is unchanged by
// construction. The proofs cite the exact regex from marked 18.1.3
// (vendor/marked/marked.esm.js). By the time any tokenizer runs, the
// lexer has replaced every \r\n and \r with \n, so only \n ends lines.
// ---------------------------------------------------------------------------

// list: marked's list rule is
//   /^ {0,3}(?:[*+-]|\d{1,9}[.)])([ \t][^\n]*?)?(?:\n|$)/  (rules.block.list)
// After the bullet, the optional group can only contribute a space or a
// tab, and the rule must then end at a newline or at end of input — so the
// character right after the bullet must be a space, a tab, a newline, or
// the end of the string. A bullet followed by any other character (an
// emphasis star, a hyphenated word, a year like 2024) cannot be a list
// item. A numeric bullet is 1-9 digits followed by '.' or ')', then the
// same terminator. listBulletEnd returns -1 when the rule cannot match.
function termAfterBullet(src, i) {
  const c = src.charCodeAt(i);
  if (Number.isNaN(c) || c === 32 || c === 9 || c === 10) return i;
  return -1;
}

function listBulletEnd(src, i) {
  const c = src.charCodeAt(i);
  if (c === 42 || c === 45 || c === 43) return termAfterBullet(src, i + 1);
  if (c >= 48 && c <= 57) {
    let j = i;
    let n = 0;
    while (j < src.length && src.charCodeAt(j) >= 48 && src.charCodeAt(j) <= 57) {
      j++;
      n++;
    }
    if (n > 9) return -1;
    const d = src.charCodeAt(j);
    if (d !== 46 && d !== 41) return -1;
    return termAfterBullet(src, j + 1);
  }
  return -1;
}

// hr: marked's hr rule is
//   /^ {0,3}((?:-[ \t]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/
// (rules.block.hr). A line can only be a thematic break when it holds
// three or more of one marker (-, _ or *) with nothing but spaces or tabs
// between them, and then ends. Scan the first line counting the marker:
// fewer than three, or any other character before the line ends, means
// the rule cannot match.
function hrLine(src, i) {
  const m = src.charCodeAt(i);
  let n = 0;
  let j = i;
  while (j < src.length) {
    const c = src.charCodeAt(j);
    if (c === m) {
      n++;
      j++;
    } else if (c === 32 || c === 9) {
      j++;
    } else {
      break;
    }
  }
  if (n < 3) return false;
  const c = src.charCodeAt(j);
  return Number.isNaN(c) || c === 10;
}

// fences: marked's fences rule is
//   /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$).../
// (rules.block.fences). The opening fence is three or more backticks or
// three or more tildes in a row; fewer than three of the same character
// cannot open a fence. A further backtick on the line, or text after the
// fence, only matters to the full regex — this check stays a necessary
// condition and still calls the original method whenever three match.
function fenceRun(src, i) {
  const c = src.charCodeAt(i);
  if (c !== 96 && c !== 126) return false;
  return src.charCodeAt(i + 1) === c && src.charCodeAt(i + 2) === c;
}

// def: marked's def rule is
//   /^ {0,3}\[(label)\]: *.../  (rules.block.def)
// where the label is one or more of an escaped character, a character
// other than '[', ']' or a backslash, or a newline that is not followed
// by a blank line. So a definition can only start when the label is
// closed by an unescaped ']' followed by ':' before the label runs out —
// an unescaped '[' inside the label, or a blank line inside it, ends any
// chance of a match. Scan the label and answer -1 when no closing can
// still happen; otherwise return the index of the closing ']'.
function defLabelEnd(src, i) {
  if (src.charCodeAt(i) !== 91) return -1;
  let j = i + 1;
  while (j < src.length) {
    const c = src.charCodeAt(j);
    if (c === 92) {
      j += 2;
      continue;
    }
    if (c === 91) return -1;
    if (c === 10) {
      let k = j + 1;
      while (src.charCodeAt(k) === 32 || src.charCodeAt(k) === 9) k++;
      const n = src.charCodeAt(k);
      if (n === 10 || Number.isNaN(n)) return -1;
      j++;
      continue;
    }
    if (c === 93) return src.charCodeAt(j + 1) === 58 ? j : -1;
    j++;
  }
  return -1;
}

// lheading: marked's lheading rule is
//   /^((?:.|\n(?!\s*?\n|bull |fences|blockquote|heading|hr|html|table))+?)
//    \n {0,3}(=+|-+)[ \t]*(?:\n+|$)/
// (rules.block.lheading, built from Oe). A setext heading can only match
// when a line that is nothing but up to three spaces, a run of '=' or
// '-', and trailing spaces or tabs — the underline — appears after the
// first line and before the paragraph ends. The paragraph text cannot
// cross a blank line (the lookahead blocks a newline followed by one), so
// scan the lines until the first blank line: an underline found means the
// rule might match, none found means it cannot. Lines that would start
// another block rule are deliberately not treated as stops here —
// stopping only at blank lines keeps this a necessary condition, and a
// call the original method then settles.
function isUnderlineLine(src, a, b) {
  let i = a;
  while (src.charCodeAt(i) === 32) i++;
  if (i - a > 3) return false;
  const c = src.charCodeAt(i);
  if (c !== 61 && c !== 45) return false;
  let k = i;
  while (src.charCodeAt(k) === c) k++;
  let t = k;
  while (src.charCodeAt(t) === 32 || src.charCodeAt(t) === 9) t++;
  return t >= b;
}

function isBlankLine(src, a, b) {
  for (let q = a; q < b; q++) {
    const c = src.charCodeAt(q);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function setextUnderline(src) {
  let line = 0;
  let j = 0;
  const n = src.length;
  while (j <= n) {
    let e = src.indexOf('\n', j);
    if (e === -1) e = n;
    if (line >= 1) {
      if (isUnderlineLine(src, j, e)) return true;
      if (isBlankLine(src, j, e)) return false;
    }
    if (e === n) return false;
    j = e + 1;
    line++;
  }
  return false;
}

// table: marked's table rule is
//   /^ *([^\n ].*)\n {0,3}((?:\| *)?:?-+:? *(?:\| *:?-+:? *)*(?:\| *)?)(?:\n...|$)/
// (rules.block.table, xe). The second line — the delimiter row — may only
// hold '|', ':' and '-' with spaces or tabs around them, and it needs at
// least one '-'; any other character on that line means the rule cannot
// match. (Tabs are allowed by this check although the regex spells
// spaces; that only ever calls the original method, never skips a table.)
function tableDelimiter(src) {
  let i = 0;
  while (src.charCodeAt(i) === 32) i++;
  if (Number.isNaN(src.charCodeAt(i)) || src.charCodeAt(i) === 10) return false;
  const nl = src.indexOf('\n');
  if (nl === -1) return false;
  const nl2 = src.indexOf('\n', nl + 1);
  const line2 = nl2 === -1 ? src.slice(nl + 1) : src.slice(nl + 1, nl2);
  let dash = false;
  for (let q = 0; q < line2.length; q++) {
    const c = line2.charCodeAt(q);
    if (c === 45) {
      dash = true;
      continue;
    }
    if (c === 124 || c === 58 || c === 32 || c === 9) continue;
    return false;
  }
  return dash;
}

const P = Tokenizer.prototype;
const orig = {};
for (const name of [
  'space', 'code', 'fences', 'heading', 'hr', 'blockquote', 'list', 'html',
  'def', 'table', 'lheading', 'paragraph', 'text',
  'escape', 'tag', 'link', 'reflink', 'emStrong', 'codespan', 'br', 'del',
  'autolink', 'url', 'inlineText',
]) orig[name] = P[name];

// -- block --
P.space = function (src) {
  const c = src.charCodeAt(0);
  if (c !== 32 && c !== 9 && c !== 10) return undefined;
  return orig.space.call(this, src);
};
P.code = function (src) {
  const c0 = src.charCodeAt(0);
  if (c0 === 9) return orig.code.call(this, src);
  if (c0 !== 32) return undefined;
  // needs 4 spaces, or a tab within the first 4 characters
  if (src.charCodeAt(1) === 32 && src.charCodeAt(2) === 32 && src.charCodeAt(3) === 32) return orig.code.call(this, src);
  if (src.charCodeAt(1) === 9 || src.charCodeAt(2) === 9 || src.charCodeAt(3) === 9) return orig.code.call(this, src);
  return undefined;
};
P.fences = function (src) {
  if (!fenceRun(src, skip3(src))) return undefined;
  return orig.fences.call(this, src);
};
P.heading = function (src) {
  if (src.charCodeAt(skip3(src)) !== 35) return undefined;
  return orig.heading.call(this, src);
};
P.hr = function (src) {
  const i = skip3(src);
  const c = src.charCodeAt(i);
  if (c !== 45 && c !== 95 && c !== 42) return undefined;
  if (!hrLine(src, i)) return undefined;
  return orig.hr.call(this, src);
};
P.blockquote = function (src) {
  if (src.charCodeAt(skip3(src)) !== 62) return undefined;
  return orig.blockquote.call(this, src);
};
P.list = function (src) {
  if (listBulletEnd(src, skip3(src)) === -1) return undefined;
  return orig.list.call(this, src);
};
P.html = function (src) {
  if (src.charCodeAt(skip3(src)) !== 60) return undefined;
  return orig.html.call(this, src);
};
P.def = function (src) {
  if (defLabelEnd(src, skip3(src)) === -1) return undefined;
  return orig.def.call(this, src);
};
P.table = function (src) {
  if (!tableDelimiter(src)) return undefined;
  return orig.table.call(this, src);
};
// lheading keeps marked's method, but only when a setext underline can
// follow: its underline may sit several lines down, so setextUnderline
// scans for it instead of looking at the first characters.
P.lheading = function (src) {
  if (!setextUnderline(src)) return undefined;
  return orig.lheading.call(this, src);
};
P.paragraph = function (src) {
  if (src.charCodeAt(0) === 10) return undefined;
  return orig.paragraph.call(this, src);
};
P.text = function (src) {
  if (src.charCodeAt(0) === 10) return undefined;
  return orig.text.call(this, src);
};

// -- inline --
P.escape = function (src) {
  if (src.charCodeAt(0) !== 92) return undefined;
  return orig.escape.call(this, src);
};
P.tag = function (src) {
  if (src.charCodeAt(0) !== 60) return undefined;
  return orig.tag.call(this, src);
};
P.link = function (src) {
  const c = src.charCodeAt(0);
  if (c !== 91 && c !== 33) return undefined;
  return orig.link.call(this, src);
};
P.reflink = function (src, links) {
  const c = src.charCodeAt(0);
  if (c !== 91 && c !== 33) return undefined;
  return orig.reflink.call(this, src, links);
};
P.emStrong = function (src, maskedSrc, prevChar) {
  const c = src.charCodeAt(0);
  if (c !== 42 && c !== 95) return undefined;
  return orig.emStrong.call(this, src, maskedSrc, prevChar);
};
P.codespan = function (src) {
  if (src.charCodeAt(0) !== 96) return undefined;
  return orig.codespan.call(this, src);
};
P.br = function (src) {
  const c0 = src.charCodeAt(0);
  if (c0 === 32) {
    if (src.charCodeAt(1) !== 32) return undefined;
  } else if (c0 === 92) {
    if (src.charCodeAt(1) !== 10) return undefined;
  } else {
    return undefined;
  }
  return orig.br.call(this, src);
};
P.del = function (src, maskedSrc, prevChar) {
  if (src.charCodeAt(0) !== 126) return undefined;
  return orig.del.call(this, src, maskedSrc, prevChar);
};
P.autolink = function (src) {
  if (src.charCodeAt(0) !== 60) return undefined;
  return orig.autolink.call(this, src);
};
P.url = function (src) {
  const c = src.charCodeAt(0);
  // a url starts with a scheme letter, 'www.', or an email local char
  if (!isAlnum(c) && c !== 46 && c !== 95 && c !== 43 && c !== 45) return undefined;
  return orig.url.call(this, src);
};
P.inlineText = function (src) {
  const end = textRunEnd(src);
  // A zero-length run means a trigger sits at position 0, so there is no
  // plain text to emit here: let marked's own method decide the token.
  if (end === 0) return orig.inlineText.call(this, src);
  const raw = src.slice(0, end);
  const escaped = this.lexer.state.inRawBlock;
  return {
    type: 'text',
    raw,
    text: escaped ? raw : decodeNumericRefs(raw, this.rules.other),
    escaped,
  };
};

const instance = new Marked();

/** The HTML marked renders for `markdown`, with marked's defaults. */
export function parse(markdown) {
  return instance.parse(markdown);
}
