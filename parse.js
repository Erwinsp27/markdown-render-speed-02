// swift-marked v4: marked 18.1.3 (vendored under vendor/marked/, MIT) with the
// Tokenizer's hot paths replaced by cheap pre-checks. Every replacement is a
// *necessary* condition: it proves from the characters at hand that a rule's
// own regular expression cannot match at this position, and only then skips
// the rule. Whenever a rule might match, marked's original method runs
// untouched, so the HTML is marked's HTML by construction; the gain is
// purely the regex executions that never happen.
//
// The single exception is the inline text rule. It does real work: instead
// of letting marked's large text pattern chew through the rest of the
// source, it first finds the next spot where any other inline rule could
// begin (one scan for "trigger" characters), then emits the plain-text
// token for exactly that span — raw text plus numeric-reference decoding,
// mirroring marked's own inlineText step by step. The trigger set covers
// every place a text token may end, so the token stream is unchanged.

import { Marked, Tokenizer } from './vendor/marked/marked.esm.js';

// ---------------------------------------------------------------------------
// Tiny character helpers
// ---------------------------------------------------------------------------

function isDigit(code) {
  return code >= 48 && code <= 57;
}

function isAlpha(code) {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isAlphaNum(code) {
  return isDigit(code) || isAlpha(code);
}

function isSpaceOrTab(code) {
  return code === 32 || code === 9;
}

// Email local-part characters, from the RFC 5322 atom set marked relies on.
// A 128-slot table keeps the "walk back over the local part" check O(1).
const EMAIL_ATOM = new Uint8Array(128);
for (const ch of "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.!#$%&'*+/=?_`{|}~-") {
  EMAIL_ATOM[ch.charCodeAt(0)] = 1;
}

// ---------------------------------------------------------------------------
// Where a plain-text run ends
//
// plainRunEnd(src) answers: how far can a text token starting at index 0
// run before marked would stop it? The stops are the openings of the other
// inline rules (\ < ! [ ` * ~ _), a URL scheme (http://, https://,
// ftp://), a "www." that a link could start from, "mailto:" / "xmpp:"
// after a non-alphanumeric, the first character of an email address's
// local part, and the first space of a double-space hard break ("  \n").
// ---------------------------------------------------------------------------

const TRIGGER = /[\\<!\[`*~_]|(?:[hH][tT][tT][pP][sS]?|[fF][tT][pP]):\/\/|www\.|mailto:|xmpp:|@| {2,}\n/g;

function plainRunEnd(src) {
  TRIGGER.lastIndex = 0;
  let hit;
  while ((hit = TRIGGER.exec(src)) !== null) {
    const at = hit.index;
    const piece = hit[0];
    const first = piece.charCodeAt(0);
    if (first === 64) {
      // '@' — maybe an email address starts here: step back over the
      // local part and stop at its first character.
      let start = at;
      while (start > 0) {
        const prev = src.charCodeAt(start - 1);
        if (prev >= 128 || !EMAIL_ATOM[prev]) break;
        start--;
      }
      if (start < at) return start;
      continue; // a bare '@' is ordinary text
    }
    if (piece.length === 1) return at; // \ < ! [ ` * ~ _
    if (first === 32) return at; // "  \n" — stop at its first space
    if (piece === 'www.') {
      if (at === 0) return at;
      const prev = src.charCodeAt(at - 1);
      if (prev === 32 || prev === 9 || prev === 10 || prev === 13 || prev === 42 || prev === 95 || prev === 126 || prev === 40) return at;
      continue; // "www." with no valid lookbehind is plain text
    }
    if (piece === 'mailto:' || piece === 'xmpp:') {
      if (at === 0) return at;
      if (!isAlphaNum(src.charCodeAt(at - 1))) return at;
      continue; // an alphanumeric before the scheme means no autolink
    }
    return at; // a scheme:// always ends the run
  }
  return src.length;
}

// ---------------------------------------------------------------------------
// Numeric character references, decoded exactly the way marked does
// (helpers.ts decodeNumericCharacterReference): a bare '&' becomes
// '&amp;', code points outside the valid range become U+FFFD, and 38
// becomes '&amp;' again.
// ---------------------------------------------------------------------------

function decodeNumericEntities(text, other) {
  if (!other.numericCharacterReference.test(text)) return text;
  return text.replace(other.numericCharacterReferenceOrAmpersand, (whole, dec, hex) => {
    if (dec === undefined && hex === undefined) return '&amp;';
    const point = dec === undefined ? Number.parseInt(hex, 16) : Number.parseInt(dec, 10);
    if (point === 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) return '�';
    return point === 38 ? '&amp;' : String.fromCodePoint(point);
  });
}

// ---------------------------------------------------------------------------
// Block-rule pre-checks
//
// By the time a tokenizer runs, the lexer has already folded every \r\n
// and \r into \n, so a line always ends at \n here. Each helper below
// answers a necessary condition for its rule's regex (marked 18.1.3,
// vendor/marked/marked.esm.js): false means the regex cannot match and
// the rule is skipped; true means the original method still runs, so the
// output cannot drift.
// ---------------------------------------------------------------------------

// How far the up-to-three-space indent at a line start reaches.
function leadingSpaces(src) {
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

// list — marked's list regex needs the bullet followed by a space, a tab,
// a newline, or the end of input (after the optional " " group the rule
// must reach \n or $). A bullet glued to another character — an emphasis
// star, a hyphenated word, a year like 2024 — can never be a list item.
// Numeric bullets are 1–9 digits plus '.' or ')', then the same ending.
// bulletEnd returns -1 when no list item can start at i.
function afterBullet(src, i) {
  const c = src.charCodeAt(i);
  if (Number.isNaN(c) || c === 32 || c === 9 || c === 10) return i;
  return -1;
}

function bulletEnd(src, i) {
  const c = src.charCodeAt(i);
  if (c === 42 || c === 45 || c === 43) return afterBullet(src, i + 1);
  if (isDigit(c)) {
    let j = i;
    let digits = 0;
    while (j < src.length && isDigit(src.charCodeAt(j))) {
      j++;
      digits++;
    }
    if (digits > 9) return -1;
    const mark = src.charCodeAt(j);
    if (mark !== 46 && mark !== 41) return -1;
    return afterBullet(src, j + 1);
  }
  return -1;
}

// hr — the rule needs three or more of one marker (-, _ or *) with only
// spaces or tabs between them, then the line ends. Count the marker on
// the first line; fewer than three, or any other character before the
// line ends, rules the rule out.
function hrLineOk(src, i) {
  const marker = src.charCodeAt(i);
  let seen = 0;
  let j = i;
  while (j < src.length) {
    const c = src.charCodeAt(j);
    if (c === marker) {
      seen++;
      j++;
    } else if (isSpaceOrTab(c)) {
      j++;
    } else {
      break;
    }
  }
  if (seen < 3) return false;
  const next = src.charCodeAt(j);
  return Number.isNaN(next) || next === 10;
}

// fences — an opening fence is three or more backticks or tildes in a
// row. Fewer than three of the same character cannot open one; anything
// else on the line is the full regex's business, so this stays a
// necessary condition only.
function hasFence(src, i) {
  const c = src.charCodeAt(i);
  if (c !== 96 && c !== 126) return false;
  return src.charCodeAt(i + 1) === c && src.charCodeAt(i + 2) === c;
}

// def — a link definition opens with "[label]:" where the label holds
// escaped characters, characters other than '[', ']' and '\', or a
// newline that is not followed by a blank line. An unescaped '[' inside
// the label, or a blank line inside it, ends the label's chances; a ']'
// only counts when ':' follows it. defClose returns the index of that
// ']' or -1.
function defClose(src, i) {
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
      while (isSpaceOrTab(src.charCodeAt(k))) k++;
      const after = src.charCodeAt(k);
      if (after === 10 || Number.isNaN(after)) return -1;
      j++;
      continue;
    }
    if (c === 93) return src.charCodeAt(j + 1) === 58 ? j : -1;
    j++;
  }
  return -1;
}

// lheading — a setext heading needs an underline line (up to three
// spaces, a run of '=' or '-', trailing spaces/tabs, nothing else) after
// the first line and before the paragraph ends. Paragraph text cannot
// cross a blank line, so scan lines until the first blank one: an
// underline found means the rule might match; none found means it
// cannot. Lines that would open other block rules are deliberately not
// treated as stops — stopping only at blank lines keeps this a
// necessary condition.
function isSetextLine(src, from, to) {
  let i = from;
  while (src.charCodeAt(i) === 32) i++;
  if (i - from > 3) return false;
  const c = src.charCodeAt(i);
  if (c !== 61 && c !== 45) return false;
  let k = i;
  while (src.charCodeAt(k) === c) k++;
  let t = k;
  while (isSpaceOrTab(src.charCodeAt(t))) t++;
  return t >= to;
}

function isEmptyLine(src, from, to) {
  for (let q = from; q < to; q++) {
    if (!isSpaceOrTab(src.charCodeAt(q))) return false;
  }
  return true;
}

function hasSetextUnderline(src) {
  let lineNo = 0;
  let j = 0;
  const n = src.length;
  while (j <= n) {
    let end = src.indexOf('\n', j);
    if (end === -1) end = n;
    if (lineNo >= 1) {
      if (isSetextLine(src, j, end)) return true;
      if (isEmptyLine(src, j, end)) return false;
    }
    if (end === n) return false;
    j = end + 1;
    lineNo++;
  }
  return false;
}

// table — the second line (the delimiter row) may only hold '|', ':',
// '-', spaces and tabs, and it needs at least one '-'. Any other
// character on that line rules the rule out. (Tabs are allowed here
// although the regex spells spaces; that only ever calls the original
// method, never skips a real table.)
function hasTableDelimiter(src) {
  let i = 0;
  while (src.charCodeAt(i) === 32) i++;
  const first = src.charCodeAt(i);
  if (Number.isNaN(first) || first === 10) return false;
  const nl = src.indexOf('\n');
  if (nl === -1) return false;
  const nl2 = src.indexOf('\n', nl + 1);
  const row = nl2 === -1 ? src.slice(nl + 1) : src.slice(nl + 1, nl2);
  let dash = false;
  for (let q = 0; q < row.length; q++) {
    const c = row.charCodeAt(q);
    if (c === 45) {
      dash = true;
      continue;
    }
    if (c === 124 || c === 58 || isSpaceOrTab(c)) continue;
    return false;
  }
  return dash;
}

// ---------------------------------------------------------------------------
// Patching the Tokenizer
//
// Keep marked's original methods, then replace each with a wrapper that
// returns undefined as soon as the first character (plus the structural
// checks above, where a rule needs more than its opening character)
// proves the rule cannot match. The wrappers forward every argument, so
// a rule that might match runs exactly as marked wrote it.
// ---------------------------------------------------------------------------

const Proto = Tokenizer.prototype;
const original = {};
for (const name of [
  'space', 'code', 'fences', 'heading', 'hr', 'blockquote', 'list', 'html',
  'def', 'table', 'lheading', 'paragraph', 'text',
  'escape', 'tag', 'link', 'reflink', 'emStrong', 'codespan', 'br', 'del',
  'autolink', 'url', 'inlineText',
]) original[name] = Proto[name];

// -- block rules --
Proto.space = function (src) {
  const c = src.charCodeAt(0);
  if (c !== 32 && c !== 9 && c !== 10) return undefined;
  return original.space.call(this, src);
};
Proto.code = function (src) {
  const c0 = src.charCodeAt(0);
  if (c0 === 9) return original.code.call(this, src);
  if (c0 !== 32) return undefined;
  if (src.charCodeAt(1) === 32 && src.charCodeAt(2) === 32 && src.charCodeAt(3) === 32) return original.code.call(this, src);
  if (src.charCodeAt(1) === 9 || src.charCodeAt(2) === 9 || src.charCodeAt(3) === 9) return original.code.call(this, src);
  return undefined;
};
Proto.fences = function (src) {
  if (!hasFence(src, leadingSpaces(src))) return undefined;
  return original.fences.call(this, src);
};
Proto.heading = function (src) {
  if (src.charCodeAt(leadingSpaces(src)) !== 35) return undefined;
  return original.heading.call(this, src);
};
Proto.hr = function (src) {
  const i = leadingSpaces(src);
  const c = src.charCodeAt(i);
  if (c !== 45 && c !== 95 && c !== 42) return undefined;
  if (!hrLineOk(src, i)) return undefined;
  return original.hr.call(this, src);
};
Proto.blockquote = function (src) {
  if (src.charCodeAt(leadingSpaces(src)) !== 62) return undefined;
  return original.blockquote.call(this, src);
};
Proto.list = function (src) {
  if (bulletEnd(src, leadingSpaces(src)) === -1) return undefined;
  return original.list.call(this, src);
};
Proto.html = function (src) {
  if (src.charCodeAt(leadingSpaces(src)) !== 60) return undefined;
  return original.html.call(this, src);
};
Proto.def = function (src) {
  if (defClose(src, leadingSpaces(src)) === -1) return undefined;
  return original.def.call(this, src);
};
Proto.table = function (src) {
  if (!hasTableDelimiter(src)) return undefined;
  return original.table.call(this, src);
};
Proto.lheading = function (src) {
  if (!hasSetextUnderline(src)) return undefined;
  return original.lheading.call(this, src);
};
Proto.paragraph = function (src) {
  if (src.charCodeAt(0) === 10) return undefined;
  return original.paragraph.call(this, src);
};
Proto.text = function (src) {
  if (src.charCodeAt(0) === 10) return undefined;
  return original.text.call(this, src);
};

// -- inline rules --
Proto.escape = function (src) {
  if (src.charCodeAt(0) !== 92) return undefined;
  return original.escape.call(this, src);
};
Proto.tag = function (src) {
  if (src.charCodeAt(0) !== 60) return undefined;
  return original.tag.call(this, src);
};
Proto.link = function (src) {
  const c = src.charCodeAt(0);
  if (c !== 91 && c !== 33) return undefined;
  return original.link.call(this, src);
};
Proto.reflink = function (src, links) {
  const c = src.charCodeAt(0);
  if (c !== 91 && c !== 33) return undefined;
  return original.reflink.call(this, src, links);
};
Proto.emStrong = function (src, maskedSrc, prevChar) {
  const c = src.charCodeAt(0);
  if (c !== 42 && c !== 95) return undefined;
  return original.emStrong.call(this, src, maskedSrc, prevChar);
};
Proto.codespan = function (src) {
  if (src.charCodeAt(0) !== 96) return undefined;
  return original.codespan.call(this, src);
};
Proto.br = function (src) {
  const c0 = src.charCodeAt(0);
  if (c0 === 32) {
    if (src.charCodeAt(1) !== 32) return undefined;
  } else if (c0 === 92) {
    if (src.charCodeAt(1) !== 10) return undefined;
  } else {
    return undefined;
  }
  return original.br.call(this, src);
};
Proto.del = function (src, maskedSrc, prevChar) {
  if (src.charCodeAt(0) !== 126) return undefined;
  return original.del.call(this, src, maskedSrc, prevChar);
};
Proto.autolink = function (src) {
  if (src.charCodeAt(0) !== 60) return undefined;
  return original.autolink.call(this, src);
};
Proto.url = function (src) {
  const c = src.charCodeAt(0);
  // A URL here starts with a scheme letter, "www.", or an email's
  // first character.
  if (!isAlphaNum(c) && c !== 46 && c !== 95 && c !== 43 && c !== 45) return undefined;
  return original.url.call(this, src);
};
Proto.inlineText = function (src) {
  const end = plainRunEnd(src);
  // A zero-length run means a trigger sits at position 0, so there is no
  // plain text to emit: let marked's own method decide the token.
  if (end === 0) return original.inlineText.call(this, src);
  const raw = src.slice(0, end);
  const inRaw = this.lexer.state.inRawBlock;
  return {
    type: 'text',
    raw,
    text: inRaw ? raw : decodeNumericEntities(raw, this.rules.other),
    escaped: inRaw,
  };
};

const marked = new Marked();

/** The HTML marked renders for `markdown`, with marked's defaults. */
export function parse(markdown) {
  return marked.parse(markdown);
}
