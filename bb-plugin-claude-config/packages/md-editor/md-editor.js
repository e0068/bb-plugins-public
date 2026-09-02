// md-editor.js — a self-contained WYSIWYG markdown editor. One contenteditable surface; markdown is the value.
//
//   const ed = new MarkdownEditor(hostEl, {
//     value, onChange, editable,               // core
//     linkResolver(href) -> {label,onClick}|null,   // optional: make links interactive
//     pathProvider(query, mode) -> [{path,label}],  // optional: "/" (path) & "@" (@import) completion
//     onSave(markdown) -> Promise,                   // optional: Ctrl/⌘+S → diff-confirm → save
//     history: false, onBeforeChange() {},           // optional: host owns undo instead of the editor's own (see below)
//   });
//   `history: false` hands undo entirely to the host: internal history becomes a no-op (no ⌘Z/⌘Y binding, no
//   stack), and `onBeforeChange` — if given — fires right before each STRUCTURED edit (format-bar wrap, table op,
//   "/" path insert; anything that would otherwise go through `history.batch(fn)`) so the host can checkpoint its
//   own state first. Typing is NOT routed through it: a native `beforeinput` already reaches the host before any
//   keystroke mutates the DOM, so the host checkpoints that path itself (`onBeforeChange` firing there too would
//   double-checkpoint). Generic hook, no assumptions about what the host does with it.
//   ed.getValue(); ed.setValue(md); ed.focus(); ed.destroy();
//
// Tables live in tables.js, the round-trip in markdown.js, undo in history.js. No build step, no dependencies.

import { el, splitFront, renderBody, serializeBody, lineBlock, inlineMd } from "./markdown.js";
import { decorateTables, insertStarterTable, closeMenus } from "./tables.js";
import { createHistory } from "./history.js";

// {l:label, cls, b:before, a:after, pre:line-prefix, key, name, hot:hotkey label}
const FMT = [
  { l: "B", b: "**", a: "**", key: "bold", name: "Bold", hot: "⌘B" },
  { l: "I", cls: "em", b: "*", a: "*", key: "italic", name: "Italic", hot: "⌘I" },
  { l: "S", cls: "st", b: "~~", a: "~~", key: "strike", name: "Strikethrough", hot: "⌘⇧S" },
  { l: "<>", cls: "mono", b: "`", a: "`", key: "code", name: "Code", hot: "⌘E" },
  { sep: 1 },
  { l: "🔗", b: "[", a: "](url)", key: "link", name: "Link", hot: "⌘K" },
  { sep: 1 },
  { l: "H1", b: "# ", a: "", pre: 1, key: "h1", name: "Heading 1" },
  { l: "H2", b: "## ", a: "", pre: 1, key: "h2", name: "Heading 2" },
  { l: "H3", b: "### ", a: "", pre: 1, key: "h3", name: "Heading 3" },
  { sep: 1 },
  { l: "•", b: "- ", a: "", pre: 1, key: "bullet", name: "Bullet list" },
  { l: "1.", b: "1. ", a: "", pre: 1, key: "number", name: "Numbered list" },
  { l: "❝", b: "> ", a: "", pre: 1, key: "quote", name: "Quote" },
  { sep: 1 },
  { l: "▦", key: "table", name: "Insert table" },
];
const FMT_TAG = { bold: /^(B|STRONG)$/, italic: /^(I|EM)$/, strike: /^(S|DEL|STRIKE)$/, code: /^CODE$/ };
const WRAP_TAG = { bold: "B", italic: "I", strike: "S", code: "CODE" };
const HOTKEY = { b: "bold", i: "italic", e: "code", k: "link" };

export class MarkdownEditor {
  constructor(host, opts = {}) {
    this.host = host;
    this.opts = opts;
    this._value = opts.value || "";
    this.editable = opts.editable !== false;
    this.linkResolver = opts.linkResolver || null;
    this.atLinks = opts.atLinks === true;   // opt-in: `@path` import tokens become links too (default false — unchanged behaviour)
    this.pathProvider = opts.pathProvider || null;
    this.onSave = opts.onSave || null;
    this._fm = "";
    this._listeners = [];        // per-render (torn down each _render)
    this._persist = [];          // persistent (format bar) — cleared only on destroy
    this.historyOn = opts.history !== false;
    this.history = this.historyOn
      ? createHistory(() => this.getValue(), (v) => { this._value = v; this._render(); this._emit(); })
      : { recordInput() {}, batch(fn) { opts.onBeforeChange && opts.onBeforeChange(); fn(); }, undo() {}, redo() {} };  // no-op: the host owns undo — but still signals before a structural mutation
    this._render();
  }

  // ---- public API ----
  getValue() { return this.root ? this._fm + serializeBody(this.root) : this._value; }
  setValue(v) { this._value = v; this._render(); }
  focus(opts) { this.root && this.root.focus(opts); }   // opts (e.g. {preventScroll:true}) forwarded so a host can focus without yanking scroll
  destroy() {
    this._teardown();
    this._persist.forEach(([t, e, f, o]) => t.removeEventListener(e, f, o)); this._persist = [];
    if (this._ppTimer) { clearTimeout(this._ppTimer); this._ppTimer = null; }
    this._closePathPicker();                                             // remove any open path dropdown from document.body
    closeMenus();                                                        // remove any open table dropdown from document.body
    const dm = document.getElementById("mde-diffmodal"); if (dm) dm.remove();   // remove any open save-diff modal
    this.host.innerHTML = "";
    if (this._bar) { this._bar.remove(); this._bar = null; }
    if (this._tip) { this._tip.remove(); this._tip = null; }
  }

  // ---- internals ----
  _emit() { const v = this.getValue(); this._value = v; this.opts.onChange && this.opts.onChange(v); }
  _on(target, ev, fn, opt) { target.addEventListener(ev, fn, opt); this._listeners.push([target, ev, fn, opt]); }        // per-render
  _onPersist(target, ev, fn, opt) { target.addEventListener(ev, fn, opt); this._persist.push([target, ev, fn, opt]); }   // survives re-renders
  _teardown() { this._listeners.forEach(([t, e, f, o]) => t.removeEventListener(e, f, o)); this._listeners = []; }

  _tableCtx(root) {
    return {
      editable: true,
      linkResolver: this.linkResolver,
      atLinks: this.atLinks,
      getBody: () => serializeBody(root),
      setBody: (body) => { this.history.batch(() => { this._value = this._fm + body; }); this._render(); this._emit(); },
      commitDOM: () => { this.history.batch(() => { this._value = this.getValue(); }); this._render(); this._emit(); },
    };
  }

  _render() {
    this._teardown();
    const parts = splitFront(this._value); this._fm = parts.fm;
    const root = el("div", "mde-root" + (this.editable ? " mde-editable" : " mde-readonly"));
    root.setAttribute("contenteditable", this.editable ? "true" : "false");
    root.setAttribute("spellcheck", "false");
    renderBody(root, parts.body, this.linkResolver, this.atLinks);
    if (this.editable) decorateTables(root, this._tableCtx(root));
    this.host.innerHTML = "";
    this.host.appendChild(root);
    this.root = root;
    this._wire(root);
    if (this.editable && !this._bar) this._buildFormatBar();
  }

  _wire(root) {
    if (!this.editable) {
      this._on(root, "click", (e) => this._followLink(e));
      return;
    }
    this._on(root, "beforeinput", () => this.history.recordInput());
    this._on(root, "input", () => { this._emit(); if (this.pathProvider) this._schedulePathPicker(root); });   // one handler → one serialize per keystroke
    this._on(root, "click", (e) => this._onClick(e));
    this._on(root, "keydown", (e) => this._onKeydown(e, root));
    this._on(document, "selectionchange", () => this._normalizeTableCaret());   // keep the caret out of the gaps between table cells
  }
  _schedulePathPicker(root) {   // debounce the picker scan so it doesn't run on every keystroke
    if (this._ppTimer) clearTimeout(this._ppTimer);
    this._ppTimer = setTimeout(() => { this._ppTimer = null; this._updatePathPicker(root); }, 120);
  }

  _followLink(e) {
    const lk = e.target.closest && e.target.closest(".mde-link[data-href]");
    if (lk && this.linkResolver) { const r = this.linkResolver(lk.dataset.href); if (r && r.onClick) { e.preventDefault(); r.onClick(); } }
  }

  // 1st click on a run selects it whole (bold/code/link/heading text, or a table cell's label — which also
  // lands the caret INSIDE an empty cell); clicking the same run again drops the caret under the cursor.
  _onClick() {
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.getRangeAt(0).collapsed) return;   // a drag-selection stays as-is
    const tok = this._tokenAt();
    if (tok && tok === this._selTok) { this._selTok = null; return; }
    if (tok) { this._selectToken(tok); this._selTok = tok; } else this._selTok = null;
  }

  _onKeydown(e, root) {
    if (this._pathdd) {   // the / or @ path picker is open — arrows move the selection, Enter accepts, Escape closes (never touches the document)
      const last = (this._ppItems ? this._ppItems.length : 1) - 1;
      if (e.key === "ArrowDown") { this._ppIdx = Math.min(this._ppIdx + 1, last); this._highlightPathPick(); e.preventDefault(); return; }
      if (e.key === "ArrowUp") { this._ppIdx = Math.max(this._ppIdx - 1, 0); this._highlightPathPick(); e.preventDefault(); return; }
      if (e.key === "Enter") { this._acceptPathPick(this._ppIdx); e.preventDefault(); return; }
      if (e.key === "Escape") { this._closePathPicker(); e.preventDefault(); return; }
    }
    const meta = e.metaKey || e.ctrlKey;
    if (this.historyOn && meta && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? this.history.redo() : this.history.undo(); return; }
    if (this.historyOn && meta && e.key.toLowerCase() === "y") { e.preventDefault(); this.history.redo(); return; }
    if (meta && e.key.toLowerCase() === "s" && this.onSave) { e.preventDefault(); this._openSaveDiff(); return; }
    if (meta) {
      let key = null;
      if (e.shiftKey && e.key.toLowerCase() === "s") key = "strike";
      else if (e.altKey && /^[123]$/.test(e.key)) key = "h" + e.key;
      else if (!e.shiftKey && !e.altKey && HOTKEY[e.key.toLowerCase()]) key = HOTKEY[e.key.toLowerCase()];
      if (key) { e.preventDefault(); this._applyFmt(FMT.find((f) => f.key === key)); return; }
    }
    // inside a table cell: Enter must not split the row; Tab / Shift-Tab hop cells
    const sel = window.getSelection(); if (!sel.rangeCount) return;
    let node = sel.getRangeAt(0).startContainer; node = node.nodeType === 1 ? node : node.parentElement;
    const cell = node && node.closest ? node.closest(".mde-trow > .mde-cell") : null;
    if (!cell) return;
    const put = (td, mode) => {   // mode "whole": select the cell's text; "start"/"end": drop a collapsed caret there
      const cl = td.querySelector(".mde-clab") || td, r = document.createRange(); r.selectNodeContents(cl);
      if (mode === "start") r.collapse(true); else if (mode === "end") r.collapse(false);
      sel.removeAllRanges(); sel.addRange(r);
    };
    const tds = [].filter.call(cell.parentElement.children, (x) => x.classList && x.classList.contains("mde-cell"));
    const colIdx = tds.indexOf(cell);
    const edge = this._cellCaretEdge(cell.querySelector(".mde-clab") || cell);
    const wholeSel = !sel.isCollapsed && edge.atStart && edge.atEnd;   // the whole cell is currently selected
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {   // ←/→ move to the prev/next cell in the SAME row
      const target = tds[colIdx + (e.key === "ArrowRight" ? 1 : -1)];
      if (wholeSel) { if (target) { e.preventDefault(); put(target, "whole"); } }                              // whole cell selected → jump selecting the whole neighbour
      else if (e.key === "ArrowRight" && edge.atEnd && target) { e.preventDefault(); put(target, "start"); }   // at the edge → caret into the neighbour
      else if (e.key === "ArrowLeft" && edge.atStart && target) { e.preventDefault(); put(target, "end"); }
      return;                                                                                                  // otherwise: not at an edge → let the browser move the caret within the cell
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {      // ↑/↓ move to the cell in the SAME column of the adjacent row
      const rows = [].slice.call(root.querySelectorAll("table.mde-table tr.mde-trow"));
      const target = rows[rows.indexOf(cell.parentElement) + (e.key === "ArrowDown" ? 1 : -1)];
      const tc = target && target.children[colIdx];
      if (tc) { e.preventDefault(); put(tc, wholeSel ? "whole" : (e.key === "ArrowDown" ? "start" : "end")); }   // whole → select neighbour; else drop a caret
      return;
    }
    if (e.key === "Enter") { e.preventDefault(); }
    else if (e.key === "Tab") {
      e.preventDefault();
      const cells = [].slice.call(root.querySelectorAll(".mde-trow > .mde-cell"));
      const t = cells[cells.indexOf(cell) + (e.shiftKey ? -1 : 1)];
      if (t) { const clab = t.querySelector(".mde-clab") || t, r = document.createRange(); r.selectNodeContents(clab); sel.removeAllRanges(); sel.addRange(r); }
    }
    else if (e.key === "Backspace" || e.key === "Delete") {   // deleting the last character of a row removes the row (and the table if it was the last row)
      const tr = cell.closest("tr.mde-trow");
      const rowText = tr ? [].map.call(tr.querySelectorAll(":scope > td .mde-clab"), (c) => c.textContent).join("") : "x";
      if (rowText.length <= 1) {
        e.preventDefault();
        const rd = tr.querySelector(".mde-rowdelx");   // fire its click via mousedown+mouseup (no move → counts as a click, not a drag)
        if (rd) { rd.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 })); document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })); }
      }
    }
  }

  // in a table, the caret must sit inside a cell — never in the gap between cells. Snap a stray collapsed caret
  // (from clicking the border-spacing gap, a bare <tr>, or a <td> outside its label) into the nearest cell.
  _normalizeTableCaret() {
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return;                    // a real text selection is left alone
    const a = sel.anchorNode; if (!a || !this.root.contains(a)) return;
    const anchorEl = a.nodeType === 1 ? a : a.parentElement;
    if (!anchorEl || anchorEl.closest(".mde-clab")) return;             // already inside cell content — fine
    const table = anchorEl.closest("table.mde-table"); if (!table) return;   // not inside a table
    const dataRows = [].slice.call(table.querySelectorAll("tr.mde-trow"));
    let td = anchorEl.closest("td.mde-cell");
    if (!td) {
      const ctlCell = anchorEl.closest("td.mde-tctlcell"), tr = anchorEl.closest("tr.mde-trow");
      if (ctlCell) td = dataRows[0] && dataRows[0].children[ctlCell.cellIndex];   // drifted into the (non-editable) control row → first data cell of that column
      else if (tr) {
        const cells = tr.querySelectorAll(":scope > td.mde-cell");
        const off = a === tr ? sel.anchorOffset : 0;
        td = cells[Math.max(0, Math.min(off - 1, cells.length - 1))];            // gap in a data row → the cell on its left
      } else {                                                                    // caret at tbody / table level (the empty band) → nearest data row, first cell
        const tbody = table.querySelector("tbody");
        const idx = anchorEl === tbody ? Math.max(0, sel.anchorOffset - 1) : 0;   // tbody child 0 is the control row
        const row = dataRows[Math.min(idx, dataRows.length - 1)] || dataRows[0];
        td = row && row.children[0];
      }
    }
    const clab = td && td.querySelector(".mde-clab"); if (!clab) return;
    const r = document.createRange(); r.selectNodeContents(clab); r.collapse(false);   // caret at the end of that cell
    sel.removeAllRanges(); sel.addRange(r);
  }

  // is the caret at the very start / end of a cell's content? (used for edge-aware ←/→ cell hopping)
  _cellCaretEdge(clab) {
    const sel = window.getSelection(); if (!sel.rangeCount) return { atStart: false, atEnd: false };
    const r = sel.getRangeAt(0);
    let atStart = false, atEnd = false;
    try { const pre = document.createRange(); pre.selectNodeContents(clab); pre.setEnd(r.startContainer, r.startOffset); atStart = pre.toString().length === 0; } catch (_) {}
    try { const post = document.createRange(); post.selectNodeContents(clab); post.setStart(r.endContainer, r.endOffset); atEnd = post.toString().length === 0; } catch (_) {}
    return { atStart, atEnd };
  }

  // ---- run selection (click a run → select it whole) ----
  _tokenAt() {
    const sel = window.getSelection(); if (!sel.rangeCount) return null;
    const host = this.root, r = sel.getRangeAt(0); if (!host.contains(r.endContainer)) return null;
    const node = r.endContainer.nodeType === 3 ? r.endContainer.parentElement : r.endContainer;
    let tok = node;
    while (tok && tok !== host && !/^(B|STRONG|I|EM|S|DEL|STRIKE|CODE)$/.test(tok.tagName) && !(tok.classList && tok.classList.contains("mde-link"))) tok = tok.parentElement;
    if (tok && tok !== host) return tok;
    let cell = node;
    while (cell && cell !== host && !(cell.classList && cell.classList.contains("mde-cell"))) cell = cell.parentElement;
    if (cell && cell !== host && cell.parentElement && cell.parentElement.classList.contains("mde-trow")) return cell.querySelector(".mde-clab") || cell;
    let ln = node; const head = (x) => x && x.classList && (x.classList.contains("mde-h") || x.classList.contains("mde-h2") || x.classList.contains("mde-h3"));
    while (ln && ln !== host && !head(ln)) ln = ln.parentElement;
    return ln && ln !== host ? ln : null;
  }
  _selectToken(tok) {
    const sel = window.getSelection(), rg = document.createRange();
    const whole = tok.classList && (tok.classList.contains("mde-clab") || tok.classList.contains("mde-h") || tok.classList.contains("mde-h2") || tok.classList.contains("mde-h3"));
    whole ? rg.selectNodeContents(tok) : rg.selectNode(tok);
    sel.removeAllRanges(); sel.addRange(rg);
  }

  // ---- format bar ----
  _lineOf(nd) { let b = nd && (nd.nodeType === 1 ? nd : nd.parentElement); while (b && b.parentElement !== this.root) b = b.parentElement; return b && b.parentElement === this.root ? b : null; }
  _activeFormats(sel) {
    const res = {}; if (!sel.rangeCount || !this.root.contains(sel.anchorNode)) return res;
    const r = sel.getRangeAt(0);
    let e = r.startContainer.nodeType === 1 ? (r.startContainer.childNodes[r.startOffset] || r.startContainer) : r.startContainer.parentElement;
    for (let x = e; x && x !== this.root; x = x.parentElement) {
      const tg = x.tagName;
      if (tg === "B" || tg === "STRONG") res.bold = 1; else if (tg === "CODE") res.code = 1;
      else if (tg === "I" || tg === "EM") res.italic = 1; else if (tg === "S" || tg === "DEL" || tg === "STRIKE") res.strike = 1;
      if (x.parentElement === this.root) {
        const pre = (x.dataset && x.dataset.pre) || "", hm = /^(#{1,6}) $/.exec(pre);
        if (hm) res["h" + Math.min(hm[1].length, 3)] = 1; else if (/^\s*[-*] /.test(pre)) res.bullet = 1;
        if (/^\s*\d+[.)] /.test(pre)) res.number = 1; if (/^\s*>+/.test(pre)) res.quote = 1;   // ordered-list / quote marker lives in dataset.pre, not textContent
      }
    }
    return res;
  }
  _buildFormatBar() {
    const bar = el("div", "mde-fmtbar");
    const tip = el("div", "mde-tip"); document.body.appendChild(tip); this._tip = tip;   // custom tooltip → appears instantly (native title lags)
    const showTip = (btn, f) => {
      tip.textContent = f.name + (f.hot ? "  " + f.hot : "");
      tip.classList.add("on");
      const br = btn.getBoundingClientRect(), tr = tip.getBoundingClientRect();
      let left = Math.round(br.left + br.width / 2 - tr.width / 2);
      left = Math.max(4, Math.min(left, window.innerWidth - tr.width - 4));
      let top = Math.round(br.top - tr.height - 6); if (top < 4) top = Math.round(br.bottom + 6);
      tip.style.left = left + "px"; tip.style.top = top + "px";
    };
    const hideTip = () => tip.classList.remove("on");
    FMT.forEach((f) => {
      if (f.sep) { bar.appendChild(el("span", "mde-fmtsep")); return; }
      const b = el("button", "mde-fmtbtn" + (f.cls ? " mde-" + f.cls : ""), f.l);
      b.addEventListener("mousedown", (e) => { e.preventDefault(); this._applyFmt(f); });
      b.addEventListener("mouseenter", () => showTip(b, f));
      b.addEventListener("mouseleave", hideTip);
      f._btn = b; bar.appendChild(b);
    });
    document.body.appendChild(bar); this._bar = bar;
    const reposition = () => {
      const sel = window.getSelection();
      if (!this.editable || !sel.rangeCount || sel.isCollapsed || !this.root.contains(sel.anchorNode)) { bar.classList.remove("on"); hideTip(); return; }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      bar.classList.add("on");
      const bw = bar.offsetWidth, bh = bar.offsetHeight, m = 6;   // keep the whole bar on-screen
      let left = Math.round(rect.left + rect.width / 2 - bw / 2);
      left = Math.max(m, Math.min(left, window.innerWidth - bw - m));
      let top = Math.round(rect.top - bh - 8);
      if (top < m) top = Math.round(rect.bottom + 8);            // no room above the selection → flip below it
      top = Math.max(m, Math.min(top, window.innerHeight - bh - m));
      bar.style.left = left + "px"; bar.style.top = top + "px";
      const active = this._activeFormats(sel);
      FMT.forEach((f) => { if (f._btn) f._btn.classList.toggle("mde-active", !!active[f.key]); });
    };
    this._onPersist(document, "selectionchange", reposition);   // persistent: the bar is built once and must keep working across re-renders
    this._onPersist(window, "scroll", reposition, true);
  }
  _applyFmt(f) {
    if (f.key === "table") { this._insertTableAtCaret(); return; }
    const sel = window.getSelection(); if (!sel.rangeCount || !this.root.contains(sel.anchorNode)) return;
    if (f.pre) { this._applyLineFmt(f, sel); return; }
    if (sel.isCollapsed) return;
    const active = this._activeFormats(sel);
    if (active[f.key] && FMT_TAG[f.key]) { this._removeInlineFmt(f, sel); return; }
    if (f.key === "link") { this._insertLink(sel); return; }
    if (WRAP_TAG[f.key]) { this._wrapInline(f, sel); }
  }
  _wrapInline(f, sel) {
    this.history.batch(() => {
      const r = sel.getRangeAt(0), elm = document.createElement(WRAP_TAG[f.key]);
      if (f.key === "code") { elm.textContent = r.toString(); r.deleteContents(); } else elm.appendChild(r.extractContents());
      r.insertNode(elm);
      const rg = document.createRange(); rg.selectNode(elm); sel.removeAllRanges(); sel.addRange(rg);
    });
    this._emit();
  }
  _removeInlineFmt(f, sel) {
    const rx = FMT_TAG[f.key]; if (!rx) return;
    const r = sel.getRangeAt(0);
    const startEl = r.startContainer.nodeType === 1 ? (r.startContainer.childNodes[r.startOffset] || r.startContainer) : r.startContainer.parentElement;
    let fel = startEl; while (fel && fel !== this.root && !rx.test(fel.tagName)) fel = fel.parentElement;
    if (!fel || fel === this.root) return;
    this.history.batch(() => {
      const parent = fel.parentNode, first = fel.firstChild, last = fel.lastChild;
      while (fel.firstChild) parent.insertBefore(fel.firstChild, fel);
      parent.removeChild(fel);
      if (first) { const rg = document.createRange(); rg.setStartBefore(first); rg.setEndAfter(last); sel.removeAllRanges(); sel.addRange(rg); }
    });
    this._emit();
  }
  _insertLink(sel) {
    const text = sel.toString(); if (!text) return;
    const href = prompt("URL:", "https://"); if (!href) return;
    this.history.batch(() => {
      const r = sel.getRangeAt(0);
      const span = el("span", "mde-link" + (this.linkResolver && this.linkResolver(href) ? " mde-link-live" : " mde-link-plain"));
      span.textContent = text; span.dataset.md = "[" + text + "](" + href + ")"; span.dataset.href = href;
      r.deleteContents(); r.insertNode(span);
      const rg = document.createRange(); rg.selectNode(span); sel.removeAllRanges(); sel.addRange(rg);
    });
    this._emit();
  }
  // toggle a line-level format on every line block the selection touches — rebuilt from source so it never double-prefixes
  _applyLineFmt(f, sel) {
    const r = sel.getRangeAt(0);
    let blocks = [].filter.call(this.root.children, (b) => b.nodeType === 1 && b.dataset.md == null && !b.classList.contains("mde-ctl") && !b.classList.contains("mde-table") && r.intersectsNode(b));
    if (!blocks.length) { const one = this._lineOf(r.startContainer); if (one && one.dataset.md == null) blocks = [one]; }
    if (!blocks.length) return;
    const remove = !!this._activeFormats(sel)[f.key];
    this.history.batch(() => {
      let first = null, last = null;
      blocks.forEach((b) => {
        const content = inlineMd(b).replace(/^\d+\.\s+/, "").replace(/^>\s+/, "");
        const fresh = lineBlock(remove ? content : f.b + content, this.linkResolver, this.atLinks);
        if (!first) first = fresh; last = fresh;
        b.parentNode.replaceChild(fresh, b);
      });
      const rng = document.createRange(); rng.setStart(first, 0); rng.setEnd(last, last.childNodes.length);
      sel.removeAllRanges(); sel.addRange(rng);
    });
    this._emit();
  }

  _insertTableAtCaret() {
    const sel = window.getSelection();
    let ref = null, headers = null;
    if (sel.rangeCount && this.root.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      const text = sel.toString().trim();
      const blk = this._lineOf(sel.anchorNode);
      if (text) {
        headers = text.split(/\s+/);        // each selected word → one column, that word is its header
        range.deleteContents();             // the words move INTO the table — they leave the paragraph
      }
      if (blk) { ref = blk.nextSibling; if (text && !blk.textContent.trim()) blk.remove(); }   // emptied line → the table takes its place; else it lands right after the block
    }
    insertStarterTable(this.root, ref, this._tableCtx(this.root), headers);
  }

  // ---- path picker plugin ("/" path, "@" @import) ----
  _updatePathPicker(root) {
    this._closePathPicker();
    const sel = window.getSelection(); if (!sel.rangeCount || !sel.isCollapsed) return;
    const node = sel.anchorNode; if (!node || node.nodeType !== 3) return;
    const before = node.textContent.slice(0, sel.anchorOffset);
    const m = /([\/@])([^\s\/@]*)$/.exec(before); if (!m) return;
    const mode = m[1] === "@" ? "import" : "path", query = m[2];
    const items = (this.pathProvider(query, mode) || []).slice(0, 8); if (!items.length) return;
    const dd = el("div", "mde-pathdd"); dd.setAttribute("contenteditable", "false");
    this._ppItems = items; this._ppNode = node; this._ppMatch = m; this._ppMode = mode; this._ppRows = []; this._ppIdx = 0;
    items.forEach((it, i) => {
      const row = el("div", "mde-pathrow"); row.appendChild(el("span", "mde-pathname", it.label || it.path));
      if (it.comment) row.appendChild(el("span", "mde-pathcmt", it.comment));
      row.addEventListener("mousedown", (e) => { e.preventDefault(); this._acceptPathPick(i); });
      dd.appendChild(row); this._ppRows.push(row);
    });
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    dd.style.left = Math.round(rect.left) + "px"; dd.style.top = Math.round(rect.bottom + 4) + "px";
    document.body.appendChild(dd); this._pathdd = dd;
    this._highlightPathPick();
  }
  _highlightPathPick() { if (this._ppRows) this._ppRows.forEach((r, i) => r.classList.toggle("mde-on", i === this._ppIdx)); }
  // shared insert logic — used by both a mouse click on a row and Enter with a row keyboard-selected
  _acceptPathPick(i) {
    const it = this._ppItems && this._ppItems[i]; if (!it) return;
    const node = this._ppNode, m = this._ppMatch, mode = this._ppMode;
    const sel = window.getSelection(); if (!sel.rangeCount) return;
    const insert = mode === "import" ? "@" + it.path : it.path;
    const start = sel.anchorOffset - m[0].length;
    this.history.batch(() => {   // record a pre-state so undo reverts the inserted path
      node.textContent = node.textContent.slice(0, start) + insert + node.textContent.slice(sel.anchorOffset);
    });
    const r = document.createRange(); r.setStart(node, start + insert.length); r.collapse(true);
    sel.removeAllRanges(); sel.addRange(r);
    this._closePathPicker(); this._emit();
  }
  _closePathPicker() { if (this._pathdd) { this._pathdd.remove(); this._pathdd = null; } this._ppItems = null; this._ppRows = null; }

  // ---- save shell (diff confirm) ----
  _openSaveDiff() {
    if (document.getElementById("mde-diffmodal")) return;
    const cur = this.getValue();
    const box = el("div", "mde-modalbox");
    box.appendChild(el("div", "mde-modaltitle", "Save changes?"));
    const pre = el("pre", "mde-modaldiff"); pre.textContent = cur; box.appendChild(pre);
    const btns = el("div", "mde-modalbtns");
    const mk = (label, cls, fn) => { const b = el("button", "mde-modalbtn" + (cls ? " " + cls : ""), label); b.addEventListener("click", fn); return b; };
    const wrap = el("div", "mde-modal"); wrap.id = "mde-diffmodal";
    btns.appendChild(mk("Save", "mde-primary", (e) => {
      const b = e.currentTarget; b.textContent = "Saving…"; b.disabled = true;
      Promise.resolve(this.onSave(cur)).then(() => wrap.remove()).catch((err) => { b.disabled = false; b.textContent = "Error — retry"; if (window.console) console.error(err); });
    }));
    btns.appendChild(mk("Cancel", "", () => wrap.remove()));
    box.appendChild(btns); wrap.appendChild(box); document.body.appendChild(wrap);
  }
}
