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
  const c = src.charCodeAt(skip3(src));
  if (c !== 96 && c !== 126) return undefined;
  return orig.fences.call(this, src);
};
P.heading = function (src) {
  if (src.charCodeAt(skip3(src)) !== 35) return undefined;
  return orig.heading.call(this, src);
};
P.hr = function (src) {
  const c = src.charCodeAt(skip3(src));
  if (c !== 45 && c !== 95 && c !== 42) return undefined;
  return orig.hr.call(this, src);
};
P.blockquote = function (src) {
  if (src.charCodeAt(skip3(src)) !== 62) return undefined;
  return orig.blockquote.call(this, src);
};
P.list = function (src) {
  const c = src.charCodeAt(skip3(src));
  if (c !== 42 && c !== 45 && c !== 43 && !(c >= 48 && c <= 57)) return undefined;
  return orig.list.call(this, src);
};
P.html = function (src) {
  if (src.charCodeAt(skip3(src)) !== 60) return undefined;
  return orig.html.call(this, src);
};
P.def = function (src) {
  if (src.charCodeAt(skip3(src)) !== 91) return undefined;
  return orig.def.call(this, src);
};
P.table = function (src) {
  let i = 0;
  while (src.charCodeAt(i) === 32) i++;
  const c = src.charCodeAt(i);
  if (Number.isNaN(c) || c === 10) return undefined; // no header character
  const nl = src.indexOf('\n');
  if (nl === -1) return undefined;
  const nl2 = src.indexOf('\n', nl + 1);
  const line2 = nl2 === -1 ? src.slice(nl + 1) : src.slice(nl + 1, nl2);
  if (line2.indexOf('-') === -1) return undefined; // delimiter row needs '-'
  return orig.table.call(this, src);
};
P.paragraph = function (src) {
  if (src.charCodeAt(0) === 10) return undefined;
  return orig.paragraph.call(this, src);
};
P.text = function (src) {
  if (src.charCodeAt(0) === 10) return undefined;
  return orig.text.call(this, src);
};
// lheading keeps marked's method: its underline may sit several lines down.

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
