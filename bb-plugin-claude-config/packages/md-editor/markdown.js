// markdown.js — the lossless markdown ↔ DOM round-trip the editor is built on.
// One contenteditable surface: block lines become `.mde-ln` blocks, inline runs become real styled elements
// (no zero-width markers). Tables render as a NATIVE <table> with a <colgroup> and table-layout:fixed, so the
// browser owns column geometry — cells, controls and resize grips all share the exact same column borders.
//
// Host-agnostic: the only outside knowledge is an optional `linkResolver(href) -> {label,onClick}|null`.

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function splitFront(src) {
  src = src || "";
  // Only a block that OPENS with `---` on line 1, has a closing `---`, AND whose inner lines look like YAML
  // is treated as frontmatter. Otherwise a leading `---` is a thematic break / normal content and stays in the body.
  const m = /^(---\n)([\s\S]*?)(\n---\n?)([\s\S]*)$/.exec(src);
  if (!m) return { fm: "", body: src };
  const nonEmpty = m[2].split("\n").filter((l) => l.trim() !== "");
  const yamlish = nonEmpty.length > 0 && nonEmpty.every(
    (l) => /^\s*[\w.-]+\s*:/.test(l) || /^\s*-\s+/.test(l) || /^\s+\S/.test(l)   // key:, list item, or indented continuation
  );
  if (!yamlish) return { fm: "", body: src };
  return { fm: m[1] + m[2] + m[3], body: m[4] };
}

// ---- inline ----
// The inline layer is a strict round-trip: render (markdown → DOM) and serialize (DOM → markdown) are inverses.
// Backslash escapes are honoured on render (`\*` → literal `*`, backslash consumed) and produced on serialize for
// any plain text that WOULD otherwise be re-interpreted, so a literal `2*3*4` stays literal across undo/redo.
const ESCAPABLE = "\\`*~_[]()#+-.!>{}";
const isEscapable = (ch) => ESCAPABLE.indexOf(ch) >= 0;

// `atLinks` (opt-in, default false): recognise a Claude-style `@path` import token as a link too. It is scanned
// at the SAME top-level tier as `[..](..)` — over the whole line, before styleRuns ever sees the text — so any
// `@path` that WOULD round-trip-break is always captured into its own span here and never left as plain text;
// text that stays plain (e.g. `user@host`, or `@` not at a boundary) needed no reinterpretation to begin with,
// and its neighbours re-serialize back to the exact same characters, so escapeInline needs no `@`-specific case.
export function inlineDOM(text, linkResolver, atLinks) {
  const frag = document.createDocumentFragment();
  const linkRe = /\[([^\]]*)\]\(([^)]+)\)/g;
  const matches = [];
  let m;
  while ((m = linkRe.exec(text))) {
    if (m.index > 0 && text[m.index - 1] === "\\") continue;   // escaped `\[` → not a link; handled as text
    matches.push({ start: m.index, end: m.index + m[0].length, kind: "link", label: m[1], raw: m[0], href: m[2] });
  }
  if (atLinks) {
    // boundary: start of line, or a whitespace char right before `@` — so `user@host` never matches (the `@` is
    // preceded by a non-whitespace letter). Path = a run of non-whitespace (`@[^\s]+`, per contract).
    const atRe = /(^|\s)@(\S+)/g;
    while ((m = atRe.exec(text))) {
      const start = m.index + m[1].length;   // skip past the captured boundary char itself, which is not part of the token
      matches.push({ start, end: start + 1 + m[2].length, kind: "at", path: m[2] });
    }
  }
  matches.sort((a, b) => a.start - b.start);
  let last = 0;
  for (const mm of matches) {
    if (mm.start < last) continue;   // overlaps an already-consumed (earlier-starting) match — that one wins
    if (mm.start > last) styleRuns(frag, text.slice(last, mm.start));
    frag.appendChild(mm.kind === "link" ? mkLink(mm.label, mm.raw, mm.href, linkResolver) : mkAtLink(mm.path, linkResolver));
    last = mm.end;
  }
  if (last < text.length) styleRuns(frag, text.slice(last));
  return frag;
}
function styleRuns(frag, text) {
  let i = 0, buf = "";
  const flush = () => { if (buf) { frag.appendChild(document.createTextNode(buf)); buf = ""; } };
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\" && i + 1 < text.length && isEscapable(text[i + 1])) { buf += text[i + 1]; i += 2; continue; }   // escaped punctuation → literal
    const rest = text.slice(i);
    let m;
    if ((m = /^\*\*([^*\n]+)\*\*/.exec(rest))) { flush(); frag.appendChild(el("b", null, m[1])); i += m[0].length; continue; }
    if ((m = /^~~([^~\n]+)~~/.exec(rest)))     { flush(); frag.appendChild(el("s", null, m[1])); i += m[0].length; continue; }
    if ((m = /^`([^`\n]+)`/.exec(rest)))       { flush(); frag.appendChild(el("code", null, m[1])); i += m[0].length; continue; }
    if ((m = /^\*([^*\n]+)\*/.exec(rest)))     { flush(); frag.appendChild(el("i", null, m[1])); i += m[0].length; continue; }
    buf += ch; i++;
  }
  flush();
}
// Escape a plain-text run so render→serialize→render is idempotent: if the inline parser WOULD re-interpret it,
// backslash-escape the delimiter characters (and a leading `[` of a link shape) so it survives as literal text.
function escapeInline(text) {
  let out = "", i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    let m;
    if ((m = /^\*\*[^*\n]+\*\*/.exec(rest)) || (m = /^~~[^~\n]+~~/.exec(rest)) ||
        (m = /^`[^`\n]+`/.exec(rest)) || (m = /^\*[^*\n]+\*/.exec(rest))) {
      out += m[0].replace(/([\\`*~])/g, "\\$1");   // whole token was literal text → escape its delimiters
      i += m[0].length; continue;
    }
    if ((m = /^\[[^\]]*\]\([^)]+\)/.exec(rest))) { out += "\\" + m[0]; i += m[0].length; continue; }   // literal link shape → escape the `[`
    if (text[i] === "\\" && i + 1 < text.length && isEscapable(text[i + 1])) { out += "\\\\"; i++; continue; }   // preserve a real backslash before escapable char
    out += text[i]; i++;
  }
  return out;
}
function mkLink(label, raw, href, linkResolver) {
  const resolved = linkResolver ? linkResolver(href) : null;
  const s = el("span", "mde-link" + (resolved ? " mde-link-live" : " mde-link-plain"));
  s.textContent = label; s.dataset.md = raw; s.dataset.href = href;
  return s;
}
// `@path` import token → link span. href passed to linkResolver is the path WITHOUT the leading `@`; the visible
// label is the whole `@path`. `.mde-atlink` also carries `.mde-link` so `_followLink`'s `.mde-link[data-href]`
// click handler picks it up for free.
function mkAtLink(path, linkResolver) {
  const resolved = linkResolver ? linkResolver(path) : null;
  const s = el("span", "mde-link mde-atlink" + (resolved ? " mde-link-live" : " mde-link-plain"));
  s.textContent = "@" + path; s.dataset.md = "@" + path; s.dataset.href = path;
  return s;
}
// `literal` marks a context whose text the renderer does NOT re-parse (inside **bold** / *italic* / ~~strike~~,
// whose content styleRuns keeps verbatim) — there, plain text is emitted as-is; at the reparsed top level it is
// escapeInline'd so a literal `2*3*4` can't turn into emphasis on the next render.
export function inlineMd(nd, literal) {
  let out = "";
  for (let c = nd.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1 && c.classList && c.classList.contains("mde-ctl")) continue;   // injected control — never source
    if (c.nodeType === 3) out += literal ? c.textContent : escapeInline(c.textContent);
    else if (c.nodeName === "BR") out += "\n";                                          // soft line break → newline
    else if (c.nodeType === 1 && c.classList && c.classList.contains("mde-atlink"))     // `@path` token — its OWN form, not `[..](..)`
      out += c.textContent;
    else if (c.nodeType === 1 && c.classList && c.classList.contains("mde-link"))       // reconstruct from LIVE state so label edits round-trip
      out += "[" + c.textContent + "](" + (c.dataset.href || "") + ")";
    else if (c.dataset && c.dataset.md != null) out += c.dataset.md;
    else if (c.tagName === "B" || c.tagName === "STRONG") out += "**" + inlineMd(c, true) + "**";
    else if (c.tagName === "CODE") out += "`" + c.textContent + "`";
    else if (c.tagName === "S" || c.tagName === "DEL" || c.tagName === "STRIKE") out += "~~" + inlineMd(c, true) + "~~";
    else if (c.tagName === "I" || c.tagName === "EM") out += "*" + inlineMd(c, true) + "*";
    else out += inlineMd(c, literal);
  }
  return out;
}

// ---- table markdown model (Pandoc pipe tables; separator dash length = relative column width) ----
export const isTableRow = (l) => l.trim().charAt(0) === "|";
export const isSep = (l) => /-/.test(l) && /^\s*\|[\s|:\-]*\|?\s*$/.test(l) && l.trim().charAt(0) === "|";
const escPipe = (c) => String(c).replace(/\|/g, "\\|");   // GFM: a literal `|` inside a cell is written `\|`
// split a row on UNescaped pipes only (and never inside a `code` span), then unescape `\|` → `|` per cell
export function cellsOf(l) {
  const s = l.trim(), raw = [];
  let cur = "", code = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && i + 1 < s.length && s[i + 1] === "|") { cur += "\\|"; i++; continue; }   // keep escaped pipe intact for now
    if (ch === "`") { code = !code; cur += ch; continue; }
    if (ch === "|" && !code) { raw.push(cur); cur = ""; continue; }
    cur += ch;
  }
  raw.push(cur);
  if (raw.length && raw[0].trim() === "") raw.shift();                        // drop leading empty from the opening `|`
  if (raw.length && raw[raw.length - 1].trim() === "") raw.pop();             // drop trailing empty from the closing `|`
  return raw.map((c) => c.trim().replace(/\\\|/g, "|"));
}
// Segment a run of consecutive pipe-line indices [start..end] into one descriptor per table. The separator is
// identified POSITIONALLY — it is the line right after a header — so a dashes-only DATA row (`| - |`) is never
// taken for a separator, and a run holding multiple header+separator pairs becomes multiple tables.
function segmentRun(lines, start, end) {
  const segs = [];
  let i = start;
  while (i <= end) {
    if (i + 1 <= end && isSep(lines[i + 1])) {                                // header at i, separator at i+1
      const s = i, sep = i + 1;
      let j = i + 2;
      while (j <= end && !(j + 1 <= end && isSep(lines[j + 1]))) j++;         // body runs until the next header+separator pair
      segs.push({ s, e: j - 1, sep });
      i = j;
    } else i++;                                                               // stray pipe line with no separator following → not a table
  }
  return segs;
}
export function tSpec(cell) { const c = cell.trim(), L = c.charAt(0) === ":", R = c.charAt(c.length - 1) === ":"; return { align: L && R ? "c" : L ? "l" : R ? "r" : "", width: Math.max(3, (c.match(/[-:]/g) || []).length) }; }   // width = whole marker length (dashes + colons), so alignment colons don't shrink it on round-trip
export function tSepCell(sp) { const w = Math.max(3, sp.width | 0); if (sp.align === "c") return ":" + "-".repeat(Math.max(1, w - 2)) + ":"; if (sp.align === "l") return ":" + "-".repeat(w - 1); if (sp.align === "r") return "-".repeat(w - 1) + ":"; return "-".repeat(w); }
export function findTables(lines) {
  const t = []; let i = 0;
  while (i < lines.length) {
    if (isTableRow(lines[i])) { let j = i; while (j < lines.length && isTableRow(lines[j])) j++; segmentRun(lines, i, j - 1).forEach((seg) => t.push(seg)); i = j; } else i++;
  }
  return t;
}
export function readModel(lines, t) {
  const specs = cellsOf(lines[t.sep]).map(tSpec), rows = []; let hc = 0;
  for (let i = t.s; i <= t.e; i++) { if (i === t.sep) continue; const c = cellsOf(lines[i]); while (c.length < specs.length) c.push(""); c.length = specs.length; rows.push(c); if (i < t.sep) hc++; }
  return { specs, rows, headerCount: hc };
}
export function writeModel(m) {
  const out = [];
  for (let i = 0; i < m.rows.length; i++) { out.push("| " + m.rows[i].map(escPipe).join(" | ") + " |"); if (i === m.headerCount - 1) out.push("| " + m.specs.map(tSepCell).join(" | ") + " |"); }
  if (m.headerCount <= 0) out.unshift("| " + m.specs.map(tSepCell).join(" | ") + " |");
  return out;
}

// build a native <table> from a run of pipe lines (sepIdx is passed positionally by callers; falls back to search)
export function buildTable(run, linkResolver, atLinks, sepIdx) {
  if (sepIdx == null) sepIdx = run.findIndex(isSep);
  const specs = cellsOf(run[sepIdx]).map(tSpec), ncol = specs.length;
  const sum = specs.reduce((s, c) => s + c.width, 0) || ncol;
  const wrap = el("div", "mde-ln mde-tablewrap");
  const table = el("table", "mde-table"); wrap.appendChild(table);
  const cg = el("colgroup");
  specs.forEach((sp) => { const c = el("col"); c.dataset.w = sp.width; c.dataset.align = sp.align; c.style.width = (sp.width / sum * 100).toFixed(3) + "%"; cg.appendChild(c); });
  table.appendChild(cg);
  const tb = el("tbody"); table.appendChild(tb);
  run.forEach((line, i) => {
    if (i === sepIdx) return;
    const tr = el("tr", "mde-trow" + (i < sepIdx ? " mde-thead" : "")); tr.dataset.md = line;
    const cells = cellsOf(line);
    for (let ci = 0; ci < ncol; ci++) {
      const td = el("td", "mde-cell"), sp = specs[ci] || { align: "" };
      if (sp.align) td.style.textAlign = sp.align === "c" ? "center" : sp.align === "r" ? "right" : "left";
      const lb = el("span", "mde-clab"); lb.appendChild(inlineDOM(cells[ci] || "", linkResolver, atLinks)); td.appendChild(lb);
      tr.appendChild(td);
    }
    tb.appendChild(tr);
  });
  return wrap;
}
export function serializeTable(wrap) {
  const table = wrap.querySelector("table.mde-table");
  const cols = [].map.call(table.querySelectorAll("col"), (c) => ({ width: +c.dataset.w || 3, align: c.dataset.align || "" }));
  const rows = [].slice.call(table.querySelectorAll("tr.mde-trow"));
  let hc = 0; rows.forEach((tr) => { if (tr.classList.contains("mde-thead")) hc++; });
  const sep = "| " + cols.map(tSepCell).join(" | ") + " |", out = [];
  rows.forEach((tr, idx) => {
    const cells = [].map.call(tr.querySelectorAll(":scope > td"), (td) => inlineMd(td).trim());
    if (tr.dataset.md != null && cellsOf(tr.dataset.md).join(" ") === cells.join(" ")) out.push(tr.dataset.md);
    else out.push("| " + cells.map(escPipe).join(" | ") + " |");
    if (idx === hc - 1) out.push(sep);
  });
  if (hc <= 0) out.unshift(sep);
  return out;
}

// ---- block ----
export function lineBlock(line, linkResolver, atLinks) {
  const h = /^(#{1,6})\s+(.*)$/.exec(line), li = /^(\s*[-*]\s+)(.*)$/.exec(line),
        hr = /^\s*(---|\*\*\*|___)\s*$/.exec(line), bq = /^(\s*>+\s?)(.*)$/.exec(line),
        ol = /^(\s*)(\d+[.)])(\s+)(.*)$/.exec(line);
  if (hr) { const d = el("div", "mde-ln mde-hr"); d.dataset.md = hr[0]; return d; }
  if (h) { const lvl = h[1].length, d = el("div", "mde-ln " + (lvl <= 1 ? "mde-h" : lvl === 2 ? "mde-h2" : "mde-h3")); d.dataset.pre = h[1] + " "; d.appendChild(inlineDOM(h[2], linkResolver, atLinks)); return d; }
  if (li) { const d = el("div", "mde-ln mde-li"); d.dataset.pre = li[1]; d.appendChild(inlineDOM(li[2], linkResolver, atLinks)); return d; }
  if (ol) { const d = el("div", "mde-ln mde-oli"); d.dataset.pre = ol[1] + ol[2] + ol[3]; d.dataset.num = ol[2]; d.appendChild(inlineDOM(ol[4], linkResolver, atLinks)); return d; }
  if (bq) { const d = el("div", "mde-ln mde-quote"); d.dataset.pre = bq[1]; d.appendChild(inlineDOM(bq[2], linkResolver, atLinks)); return d; }
  if (line === "") return el("div", "mde-ln mde-blank");
  const d = el("div", "mde-ln mde-body"); d.appendChild(inlineDOM(line, linkResolver, atLinks)); return d;
}

export function blockText(elem) {
  let s = "";
  (function walk(n) {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) s += c.textContent;
      else if (c.nodeName === "BR") s += "\n";
      else if (c.nodeType === 1) { if (/^(DIV|P)$/.test(c.nodeName) && s && s.slice(-1) !== "\n") s += "\n"; walk(c); }
    }
  })(elem);
  return s;
}

export function renderBody(root, body, linkResolver, atLinks) {
  const lines = body.split("\n");
  let fence = null;
  const flush = () => {
    if (!fence) return;
    const closed = fence.length > 1 && /^\s*```/.test(fence[fence.length - 1]);
    const inner = fence.slice(1, closed ? -1 : undefined).join("\n");
    const pre = el("pre", "mde-ln mde-code");
    pre.dataset.md = fence.join("\n"); pre.dataset.open = fence[0]; pre.dataset.close = closed ? fence[fence.length - 1] : ""; pre.dataset.code = inner;
    pre.textContent = inner; root.appendChild(pre); fence = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) { if (fence) { fence.push(line); flush(); } else fence = [line]; continue; }
    if (fence) { fence.push(line); continue; }
    if (isTableRow(line)) {
      let j = i; while (j < lines.length && isTableRow(lines[j])) j++;
      const segs = segmentRun(lines, i, j - 1);
      if (segs.length) {
        let cur = i;
        segs.forEach((seg) => {
          for (let k = cur; k < seg.s; k++) root.appendChild(lineBlock(lines[k], linkResolver, atLinks));   // stray pipe lines before this table
          root.appendChild(buildTable(lines.slice(seg.s, seg.e + 1), linkResolver, atLinks, seg.sep - seg.s));
          cur = seg.e + 1;
        });
        for (let k = cur; k < j; k++) root.appendChild(lineBlock(lines[k], linkResolver, atLinks));           // trailing stray pipe lines
        i = j - 1; continue;
      }
    }
    root.appendChild(lineBlock(line, linkResolver, atLinks));
  }
  flush();
}

function emitBlock(b, out) {
  if (b.nodeType !== 1) { if (b.nodeType === 3 && b.textContent !== "") out.push(b.textContent); return; }
  if (b.classList.contains("mde-ctl")) return;
  if (b.classList.contains("mde-tablewrap")) { serializeTable(b).forEach((l) => out.push(l)); return; }
  if (b.classList.contains("mde-code")) {
    const code = blockText(b);
    if (b.dataset.code != null && code === b.dataset.code) out.push(b.dataset.md);
    else out.push((b.dataset.open || "```") + "\n" + code + (b.dataset.close ? "\n" + b.dataset.close : ""));
  } else if (b.dataset && b.dataset.md != null) out.push(b.dataset.md);
  else out.push((b.dataset && b.dataset.pre ? b.dataset.pre : "") + inlineMd(b));
}
export function serializeBody(root) {
  const out = [];
  for (let b = root.firstChild; b; b = b.nextSibling) emitBlock(b, out);
  return out.join("\n");
}
