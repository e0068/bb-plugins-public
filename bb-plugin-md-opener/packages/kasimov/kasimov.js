var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// editor/shell/composer-history.js
var LIMIT = 200;
var IDLE_MS = 700;
var BURST_MS = 5e3;
function createHistory(env) {
  var undoStack = [], redoStack = [], suspended = false;
  function hostOf(nd) {
    var e = nd && (nd.nodeType === 1 ? nd : nd.parentElement);
    while (e && !(e.dataset && e.dataset.hkey)) e = e.parentElement;
    return e || null;
  }
  function blocksOf(host) {
    var kids = [].filter.call(host.childNodes, function(n) {
      return n.nodeType === 1 || n.nodeType === 3 && n.textContent !== "";
    });
    return kids.length ? kids : [host];
  }
  function holds(blk, nd) {
    return blk === nd || blk.nodeType === 1 && blk.contains(nd);
  }
  function caretNow() {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    var r = sel.getRangeAt(0), host = hostOf(r.endContainer);
    if (!host) return null;
    var blocks = blocksOf(host), off = 0, i;
    if (r.endContainer === host && blocks[0] !== host) {
      for (i = 0; i < Math.min(r.endOffset, blocks.length); i++) off += blocks[i].textContent.length + 1;
      return { key: host.dataset.hkey, off };
    }
    for (i = 0; i < blocks.length; i++) {
      if (holds(blocks[i], r.endContainer)) {
        var rg = document.createRange();
        rg.selectNodeContents(blocks[i]);
        rg.setEnd(r.endContainer, r.endOffset);
        return { key: host.dataset.hkey, off: off + rg.toString().length };
      }
      off += blocks[i].textContent.length + 1;
    }
    return { key: host.dataset.hkey, off };
  }
  function placeCaret(c) {
    if (!c) return;
    var host = document.querySelector('[data-hkey="' + c.key + '"]');
    if (!host) return;
    var blocks = blocksOf(host), off = c.off;
    for (var i = 0; i < blocks.length; i++) {
      var len = blocks[i].textContent.length;
      if (off <= len || i === blocks.length - 1) {
        host.focus({ preventScroll: true });
        putCaret(blocks[i], Math.min(off, len));
        return;
      }
      off -= len + 1;
    }
  }
  function putCaret(blk, off) {
    var rg = document.createRange();
    if (blk.nodeType === 3) rg.setStart(blk, off);
    else {
      rg.selectNodeContents(blk);
      var w = document.createTreeWalker(blk, NodeFilter.SHOW_TEXT), seen = 0, t;
      while (t = w.nextNode()) {
        if (seen + t.textContent.length >= off) {
          rg.setStart(t, off - seen);
          break;
        }
        seen += t.textContent.length;
      }
    }
    rg.collapse(true);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(rg);
  }
  function snap(tag, caret) {
    var s = env.getState();
    s.tag = tag;
    s.caret = caret || caretNow();
    s.t = s.t0 = Date.now();
    return s;
  }
  function coalesces(top, tag, caret) {
    if (!top || top.tag !== tag || tag !== "type" && tag !== "del") return false;
    var now = Date.now();
    return now - top.t < IDLE_MS && now - top.t0 < BURST_MS && !!caret && !!top.caret && top.caret.key === caret.key;
  }
  function record(tag) {
    if (suspended) return;
    redoStack.length = 0;
    var top = undoStack[undoStack.length - 1], caret = caretNow();
    if (coalesces(top, tag, caret)) {
      top.t = Date.now();
      return;
    }
    undoStack.push(snap(tag, caret));
    if (undoStack.length > LIMIT) undoStack.shift();
  }
  function recordInput(e) {
    record(/^insert(Text|CompositionText)$/.test(e.inputType) ? "type" : /^delete/.test(e.inputType) ? "del" : "edit");
  }
  function batch(tag, fn) {
    record(tag);
    var was = suspended;
    suspended = true;
    try {
      fn();
    } finally {
      suspended = was;
    }
  }
  function apply(s) {
    suspended = true;
    try {
      env.setState(s);
      env.render();
      placeCaret(s.caret);
    } finally {
      suspended = false;
    }
  }
  function undo() {
    if (!undoStack.length) return false;
    redoStack.push(snap("redo"));
    apply(undoStack.pop());
    return true;
  }
  function redo() {
    if (!redoStack.length) return false;
    undoStack.push(snap("undo"));
    apply(redoStack.pop());
    return true;
  }
  function isKey(e, code, letter) {
    return e.code === code || (e.key || "").toLowerCase() === letter;
  }
  function onKeydown(e) {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    var z = isKey(e, "KeyZ", "z"), y = isKey(e, "KeyY", "y");
    if (!z && !y) return;
    var a = document.activeElement;
    if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA")) return;
    e.preventDefault();
    if (env.blocked && env.blocked()) return;
    if (y || e.shiftKey) redo();
    else undo();
  }
  document.addEventListener("keydown", onKeydown, true);
  function destroy() {
    document.removeEventListener("keydown", onKeydown, true);
  }
  return { record, recordInput, batch, undo, redo, destroy };
}

// editor/shell/composer-edit-shell.js
function createEditShell(env) {
  var el2 = env.el, node = env.node, contentOf = env.contentOf, edits = env.edits, render = env.render, closeDiffModal = env.closeModal;
  var saveMode = env.saveMode || "manual", autosaveTimer = null;
  function noteEdit(n) {
    if (saveMode !== "autosave" || !env.autosaveWrite) return;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(function() {
      autosaveTimer = null;
      env.autosaveWrite(n).catch(function() {
      });
    }, 600);
  }
  function saveEdit() {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
    env.setEditing(null);
    render();
  }
  function cancelEdit() {
    var editing = env.getEditing();
    if (editing == null) return;
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
    env.record("cancel");
    var n = node(editing);
    if (n && env.getSnapshot() === (n.content || "")) delete edits[editing];
    else edits[editing] = env.getSnapshot();
    env.setEditing(null);
    render();
  }
  function lineDiff(a, b) {
    var al = (a || "").split("\n"), bl = (b || "").split("\n"), m = al.length, n = bl.length;
    var dp = [];
    for (var i = 0; i <= m; i++) {
      dp[i] = [];
      for (var j = 0; j <= n; j++) dp[i][j] = 0;
    }
    for (var i2 = m - 1; i2 >= 0; i2--) for (var j2 = n - 1; j2 >= 0; j2--)
      dp[i2][j2] = al[i2] === bl[j2] ? dp[i2 + 1][j2 + 1] + 1 : Math.max(dp[i2 + 1][j2], dp[i2][j2 + 1]);
    var out = [], i = 0, j = 0;
    while (i < m && j < n) {
      if (al[i] === bl[j]) {
        out.push({ t: " ", s: al[i] });
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        out.push({ t: "-", s: al[i] });
        i++;
      } else {
        out.push({ t: "+", s: bl[j] });
        j++;
      }
    }
    while (i < m) out.push({ t: "-", s: al[i++] });
    while (j < n) out.push({ t: "+", s: bl[j++] });
    return out;
  }
  function openDiffModal() {
    var editing = env.getEditing();
    if (editing == null || document.getElementById("cg-diffmodal")) return;
    if (env.closeMenus) env.closeMenus();
    var n = node(editing);
    if (!n) return;
    if (saveMode === "autosave") {
      if (autosaveTimer) {
        clearTimeout(autosaveTimer);
        autosaveTimer = null;
        if (env.autosaveWrite) env.autosaveWrite(n).catch(function() {
        });
      }
      saveEdit();
      return;
    }
    var orig = env.getSnapshot() || "", cur = contentOf(n);
    if (orig === cur) {
      saveEdit();
      return;
    }
    var diff = lineDiff(orig, cur), added = 0, removed = 0;
    diff.forEach(function(d) {
      if (d.t === "+") added++;
      else if (d.t === "-") removed++;
    });
    var box = el2("div", "cg-modalbox");
    var t = el2("div", "cg-modaltitle");
    t.textContent = "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F \u0432 " + n.name + "?";
    box.appendChild(t);
    var sub = el2("div", "cg-modalsub");
    sub.textContent = "+" + added + "  \u2212" + removed;
    box.appendChild(sub);
    var dv = el2("div", "cg-diff");
    diff.forEach(function(d) {
      var ln = el2("div", "cg-diffline" + (d.t === "+" ? " cg-diff-add" : d.t === "-" ? " cg-diff-del" : ""));
      ln.textContent = (d.t === " " ? "   " : d.t + "  ") + d.s;
      dv.appendChild(ln);
    });
    box.appendChild(dv);
    function mkbtn(label, cls, fn) {
      var b = el2("button", "cg-modalbtn" + (cls ? " " + cls : ""));
      b.textContent = label;
      b.addEventListener("click", fn);
      return b;
    }
    var btns = el2("div", "cg-modalbtns");
    btns.appendChild(mkbtn("\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C", "cg-modalprimary", function(ev) {
      if (!env.saveToDisk) {
        closeDiffModal();
        saveEdit();
        return;
      }
      var b = ev.currentTarget;
      b.textContent = "\u0421\u043E\u0445\u0440\u0430\u043D\u044F\u044E\u2026";
      b.disabled = true;
      env.saveToDisk(n).then(function() {
        closeDiffModal();
      }).catch(function(err) {
        b.disabled = false;
        b.textContent = "\u041E\u0448\u0438\u0431\u043A\u0430 \u2014 \u043F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C";
        if (window.console) console.error("save failed:", err);
      });
    }));
    btns.appendChild(mkbtn("\u041E\u0442\u043C\u0435\u043D\u0438\u0442\u044C \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F", "", function() {
      closeDiffModal();
      cancelEdit();
    }));
    btns.appendChild(mkbtn("\u041F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442\u044C", "", function() {
      closeDiffModal();
    }));
    box.appendChild(btns);
    var wrap = el2("div", "cg-modal");
    wrap.id = "cg-diffmodal";
    wrap.appendChild(box);
    document.body.appendChild(wrap);
  }
  function syncEditScrim() {
    var app = document.getElementById("app");
    [].forEach.call(app.querySelectorAll(".cg-editing-col"), function(p) {
      p.classList.remove("cg-editing-col");
    });
    var scrim = document.getElementById("cg-scrim");
    if (env.getEditing() == null) {
      if (scrim) scrim.remove();
      closeDiffModal();
      if (env.closeMenus) env.closeMenus();
      return;
    }
    var live = app.querySelector(".cg-edit.cg-live"), col = live && live.closest(".cg-panel");
    if (col) col.classList.add("cg-editing-col");
    if (!scrim) {
      scrim = el2("div", "cg-scrim");
      scrim.id = "cg-scrim";
      scrim.addEventListener("mousedown", function(e) {
        e.preventDefault();
        openDiffModal();
      });
      document.body.appendChild(scrim);
    }
  }
  return { syncEditScrim, cancelEdit, saveEdit, openDiffModal, noteEdit };
}

// editor/shell/composer-editor.js
function createLegacyEditor(env) {
  var el2 = env.el, rootEntry = env.rootEntry, contentOf = env.contentOf, drillTo = env.drillTo, render = env.render, splitFront2 = env.splitFront, nodeMatches = env.nodeMatches, nodeById = env.node, batch = env.batch;
  function isHeadingLine(el3) {
    return !!(el3 && el3.classList && (el3.classList.contains("cg-h") || el3.classList.contains("cg-sub") || el3.classList.contains("cg-sub3")));
  }
  function tokenAt(host) {
    var sel = window.getSelection();
    if (!sel.rangeCount) return null;
    var r = sel.getRangeAt(0);
    if (!host.contains(r.endContainer)) return null;
    var node = r.endContainer.nodeType === 3 ? r.endContainer.parentElement : r.endContainer;
    var tok = node;
    while (tok && tok !== host && !/^(B|STRONG|I|EM|S|DEL|STRIKE|CODE)$/.test(tok.tagName) && !(tok.classList && tok.classList.contains("cg-mdlink"))) tok = tok.parentElement;
    if (tok && tok !== host) return tok;
    var cell = node;
    while (cell && cell !== host && !(cell.classList && cell.classList.contains("uicell"))) cell = cell.parentElement;
    if (cell && cell !== host && cell.parentElement && cell.parentElement.classList.contains("cg-trow")) return cell.querySelector(".clab") || cell;
    var ln = node;
    while (ln && ln !== host && !isHeadingLine(ln)) ln = ln.parentElement;
    return ln && ln !== host ? ln : null;
  }
  function selectToken(tok) {
    var sel = window.getSelection(), rg = document.createRange();
    if (isHeadingLine(tok) || tok.classList && tok.classList.contains("clab")) rg.selectNodeContents(tok);
    else rg.selectNode(tok);
    sel.removeAllRanges();
    sel.addRange(rg);
  }
  function focusAt(x, y) {
    var r = document.caretRangeFromPoint && document.caretRangeFromPoint(x, y);
    var host = r && (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement);
    while (host && !(host.classList && host.classList.contains("cg-edit"))) host = host.parentElement;
    if (host) {
      host.focus({ preventScroll: true });
      if (r) {
        var s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
      }
      if (env.hideTags()) {
        var tk = tokenAt(host);
        if (tk) {
          selectToken(tk);
          host._selTok = tk;
        }
      }
    } else {
      var first = document.querySelector(".cg-edit.cg-live");
      if (first) first.focus({ preventScroll: true });
    }
  }
  function bodyNav(l) {
    if (!l || !l.target) return null;
    var ok = l.target.indexOf("root:") === 0 ? rootEntry(l.target.slice(5)) : nodeById(l.target);
    return ok ? l.target : null;
  }
  function mkLink2(text, raw, l) {
    var tgt = bodyNav(l), s = el2("span", "cg-mdlink" + (tgt ? "" : " cg-mdlink-dead"));
    s.textContent = text;
    s.dataset.md = raw;
    if (tgt) s.dataset.target = tgt;
    return s;
  }
  function slugify(s) {
    return (s || "").toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");
  }
  function headingSlugs(root) {
    var s = {};
    [].forEach.call(root.querySelectorAll(".cg-ln.cg-h, .cg-ln.cg-sub, .cg-ln.cg-sub3"), function(h) {
      s[slugify(h.textContent)] = 1;
    });
    return s;
  }
  function scrollToHeading(root, slug) {
    var heads = root.querySelectorAll(".cg-ln.cg-h, .cg-ln.cg-sub, .cg-ln.cg-sub3");
    for (var i = 0; i < heads.length; i++) if (slugify(heads[i].textContent) === slug) {
      heads[i].scrollIntoView({ block: "start" });
      return true;
    }
    return false;
  }
  function markDeadAnchors(root) {
    var slugs = headingSlugs(root);
    [].forEach.call(root.querySelectorAll(".cg-mdlink[data-anchor]"), function(a) {
      if (!slugs[a.dataset.anchor]) a.classList.add("cg-mdlink-dead");
    });
  }
  function mkAnchor(text, href) {
    var s = el2("span", "cg-mdlink");
    s.textContent = text;
    s.dataset.md = "[" + text + "](" + href + ")";
    s.dataset.anchor = href.slice(1).toLowerCase();
    return s;
  }
  function inlineDOM2(line, linkBy) {
    var frag = document.createDocumentFragment(), re = /\[\[([^\]]+)\]\]|\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|~~([^~]+)~~|\*([^*\n]+)\*|(@[~.\w][\w./~-]*)|((?:~\/\.claude|\.claude|references|skills|agents)\/[\w./~-]+)/g, last = 0, m;
    while (m = re.exec(line)) {
      if (m.index > last) frag.appendChild(document.createTextNode(line.slice(last, m.index)));
      if (m[1] != null) frag.appendChild(mkLink2(m[1], "[[" + m[1] + "]]", linkBy[m[1]]));
      else if (m[2] != null) frag.appendChild(m[3] && m[3].charAt(0) === "#" ? mkAnchor(m[2], m[3]) : mkLink2(m[2], "[" + m[2] + "](" + m[3] + ")", linkBy[m[3]] || linkBy[m[2]]));
      else if (m[4] != null) {
        var lk = linkBy[m[4]], tgt = bodyNav(lk), c = el2("code");
        c.textContent = m[4];
        if (tgt) {
          c.classList.add("cg-mdlink");
          c.dataset.target = tgt;
          c.dataset.md = "`" + m[4] + "`";
        }
        frag.appendChild(c);
      } else if (m[5] != null) {
        var b = el2("b");
        b.textContent = m[5];
        frag.appendChild(b);
      } else if (m[6] != null) {
        var s = el2("s");
        s.textContent = m[6];
        frag.appendChild(s);
      } else if (m[7] != null) {
        var i = el2("i");
        i.textContent = m[7];
        frag.appendChild(i);
      } else if (m[8] != null) {
        var l8 = linkBy[m[8].replace(/^@+/, "")];
        frag.appendChild(l8 ? mkLink2(m[8], m[8], l8) : document.createTextNode(m[8]));
      } else {
        var l9 = linkBy[m[9]];
        frag.appendChild(l9 ? mkLink2(m[9], m[9], l9) : document.createTextNode(m[9]));
      }
      last = re.lastIndex;
    }
    if (last < line.length) frag.appendChild(document.createTextNode(line.slice(last)));
    return frag;
  }
  function tCells(line) {
    return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(function(c) {
      return c.trim();
    });
  }
  function lineBlock2(line, linkBy, grid) {
    var h = /^(#{1,6})\s+(.*)$/.exec(line), li = /^(\s*[-*]\s+)(.*)$/.exec(line), hr = /^\s*(---|\*\*\*|___)\s*$/.exec(line), bq = /^(\s*>+\s?)(.*)$/.exec(line), ol = /^(\s*)(\d+[.)])(\s+)(.*)$/.exec(line);
    if (hr) {
      var dr = el2("div", "cg-ln cg-hr");
      dr.dataset.md = hr[0];
      return dr;
    }
    if (h) {
      var lvl = h[1].length, dh = el2("div", "cg-ln " + (lvl <= 1 ? "cg-h" : lvl === 2 ? "cg-sub" : "cg-sub3"));
      dh.dataset.pre = h[1] + " ";
      dh.appendChild(inlineDOM2(h[2], linkBy));
      return dh;
    }
    if (li) {
      var dl = el2("div", "cg-ln cg-li");
      dl.dataset.pre = li[1];
      dl.appendChild(inlineDOM2(li[2], linkBy));
      return dl;
    }
    if (ol) {
      var dnl = el2("div", "cg-ln cg-oli");
      dnl.dataset.pre = ol[1] + ol[2] + ol[3];
      dnl.dataset.num = ol[2];
      dnl.appendChild(inlineDOM2(ol[4], linkBy));
      return dnl;
    }
    if (bq) {
      var dq2 = el2("div", "cg-ln cg-quote");
      dq2.dataset.pre = bq[1];
      dq2.appendChild(inlineDOM2(bq[2], linkBy));
      return dq2;
    }
    if (grid && line.trim().charAt(0) === "|") {
      if (/^[\s|:-]+$/.test(line) && line.indexOf("-") >= 0) {
        var ts = el2("div", "cg-ln cg-tsep");
        ts.dataset.md = line;
        return ts;
      }
      var tr = el2("div", "cg-ln cg-trow");
      tr.dataset.md = line;
      tCells(line).forEach(function(c) {
        var u = el2("div", "uicell"), lb = el2("span", "clab");
        lb.appendChild(inlineDOM2(c, linkBy));
        u.appendChild(lb);
        tr.appendChild(u);
      });
      return tr;
    }
    if (line === "") return el2("div", "cg-ln cg-blank");
    var dp = el2("div", "cg-ln cg-body");
    dp.appendChild(inlineDOM2(line, linkBy));
    return dp;
  }
  function tSpec2(cell) {
    var c = cell.trim(), L = c.charAt(0) === ":", R = c.charAt(c.length - 1) === ":";
    return { align: L && R ? "c" : L ? "l" : R ? "r" : "", width: Math.max(3, (c.match(/-/g) || []).length) };
  }
  function tCellsOf(l) {
    return l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(function(c) {
      return c.trim();
    });
  }
  function tableGroups(root) {
    var groups = [], cur = null;
    for (var b = root.firstChild; b; b = b.nextSibling) {
      var isT = b.nodeType === 1 && b.classList && (b.classList.contains("cg-trow") || b.classList.contains("cg-tsep")) && !b.classList.contains("cg-ctl");
      if (isT) {
        if (!cur) {
          cur = [];
          groups.push(cur);
        }
        cur.push(b);
      } else cur = null;
    }
    return groups;
  }
  function decorateTables2(root) {
    tableGroups(root).forEach(function(blocks) {
      var sepEl = null, rowsEls = [];
      blocks.forEach(function(b) {
        if (b.classList.contains("cg-tsep")) sepEl = b;
        else rowsEls.push(b);
      });
      if (!rowsEls.length) return;
      var ncol = rowsEls[0].querySelectorAll(":scope > .uicell").length;
      var specs = sepEl ? tCellsOf(sepEl.dataset.md).map(tSpec2) : [];
      while (specs.length < ncol) specs.push({ align: "", width: 3 });
      rowsEls.forEach(function(tr) {
        var cells = tr.querySelectorAll(":scope > .uicell");
        for (var c = 0; c < cells.length; c++) {
          var sp = specs[c] || { width: 3, align: "" };
          cells[c].style.flexGrow = sp.width;
          cells[c].style.flexBasis = "0";
          cells[c].style.textAlign = sp.align === "c" ? "center" : sp.align === "r" ? "right" : "";
        }
      });
    });
  }
  function bodyOf(n, colIndex) {
    var parts = splitFront2(contentOf(n));
    n._fm = parts.fm;
    var live = n.editable && env.getEditing() === n.id, raw = live && !env.hideTags();
    var linkBy = {};
    (n.links || []).forEach(function(l) {
      if (l.label != null && !(l.label in linkBy)) linkBy[l.label] = l;
    });
    var root = el2("div", "cg-sec cg-mdbody cg-edit" + (live ? " cg-live" : "") + (raw ? " cg-raw" : ""));
    root._linkBy = linkBy;
    root._colIndex = colIndex;
    if (live) root.dataset.hkey = "body:" + n.id;
    root.setAttribute("contenteditable", live ? "true" : "false");
    if (!n.editable) root.classList.add("cg-ro");
    if (raw) root.textContent = parts.body;
    else {
      let flushFence = function() {
        if (!fence) return;
        var closed = fence.length > 1 && /^\s*```/.test(fence[fence.length - 1]);
        var inner = fence.slice(1, closed ? -1 : void 0).join("\n");
        var pre = el2("pre", "cg-ln cg-code");
        pre.dataset.md = fence.join("\n");
        pre.dataset.open = fence[0];
        pre.dataset.close = closed ? fence[fence.length - 1] : "";
        pre.dataset.code = inner;
        pre.textContent = inner;
        root.appendChild(pre);
        fence = null;
      };
      var fence = null;
      parts.body.split("\n").forEach(function(line) {
        if (/^\s*```/.test(line)) {
          if (fence) {
            fence.push(line);
            flushFence();
          } else fence = [line];
          return;
        }
        if (fence) {
          fence.push(line);
          return;
        }
        root.appendChild(lineBlock2(line, linkBy, true));
      });
      flushFence();
      markDeadAnchors(root);
      [].forEach.call(root.querySelectorAll(".cg-tsep"), function(s) {
        var p = s.previousElementSibling;
        if (p && p.classList.contains("cg-trow")) p.classList.add("cg-thead");
      });
      decorateTables2(root);
    }
    if (!live) root.addEventListener("mousedown", function(e) {
      var anc = e.target.closest && e.target.closest(".cg-mdlink[data-anchor]");
      if (anc) {
        e.preventDefault();
        e.stopPropagation();
        scrollToHeading(root, anc.dataset.anchor);
        return;
      }
      var lk = e.target.closest && e.target.closest(".cg-mdlink[data-target]");
      if (lk) {
        e.preventDefault();
        e.stopPropagation();
        drillTo(colIndex, lk.dataset.target);
        return;
      }
      if (!n.editable) return;
      e.preventDefault();
      var x = e.clientX, y = e.clientY;
      env.setSnapshot(contentOf(n));
      env.setEditing(n.id);
      render();
      focusAt(x, y);
    });
    return root;
  }
  var _pathMenu = null;
  function _pathOutside(e) {
    if (_pathMenu && !_pathMenu.contains(e.target)) closePathMenu();
  }
  function closePathMenu() {
    if (_pathMenu) {
      _pathMenu.remove();
      _pathMenu = null;
      document.removeEventListener("mousedown", _pathOutside, true);
    }
  }
  function updatePathPicker(host) {
    var sel = window.getSelection();
    if (!sel.rangeCount) {
      closePathMenu();
      return;
    }
    var r = sel.getRangeAt(0), tnode = r.endContainer;
    if (!r.collapsed || !host.contains(tnode) || tnode.nodeType !== 3) {
      closePathMenu();
      return;
    }
    var caret = r.endOffset, m = /(^|\s)(@[\w./~-]*|(?:~\/|\/)[\w./~-]*)$/.exec(tnode.textContent.slice(0, caret));
    if (!m) {
      closePathMenu();
      return;
    }
    var tokenStart = m.index + m[1].length, token = m[2];
    var isImport = token.charAt(0) === "@", query = isImport ? token.slice(1) : token;
    var opts = nodeMatches(query).filter(function(n) {
      return n.path.toLowerCase() !== query.toLowerCase();
    }).slice(0, 14);
    if (!opts.length) {
      closePathMenu();
      return;
    }
    var rect = r.cloneRange().getBoundingClientRect();
    closePathMenu();
    var menu = el2("div", "cg-dd cg-pathdd");
    opts.forEach(function(n) {
      var opt = el2("div", "cg-dd-opt");
      var lab = el2("div", "cg-dd-lab");
      lab.textContent = n.name || n.path.split("/").pop();
      opt.appendChild(lab);
      var cm = el2("div", "cg-dd-cmt");
      cm.textContent = n.path;
      opt.appendChild(cm);
      opt.addEventListener("mousedown", function(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        batch("path", function() {
          var insert = isImport ? "@" + n.path : n.path;
          tnode.textContent = tnode.textContent.slice(0, tokenStart) + insert + tnode.textContent.slice(caret);
          var pos = tokenStart + insert.length, rr = document.createRange();
          rr.setStart(tnode, pos);
          rr.collapse(true);
          sel.removeAllRanges();
          sel.addRange(rr);
          host.dispatchEvent(new Event("input", { bubbles: true }));
        });
        closePathMenu();
      });
      menu.appendChild(opt);
    });
    document.body.appendChild(menu);
    menu.style.left = Math.max(6, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8)) + "px";
    menu.style.top = (rect.bottom + menu.offsetHeight + 8 > window.innerHeight ? Math.max(6, rect.top - menu.offsetHeight - 3) : rect.bottom + 4) + "px";
    _pathMenu = menu;
    setTimeout(function() {
      document.addEventListener("mousedown", _pathOutside, true);
    }, 0);
  }
  function attachPathPicker(host) {
    host.addEventListener("input", function() {
      updatePathPicker(host);
    });
    host.addEventListener("blur", function() {
      setTimeout(closePathMenu, 120);
    });
  }
  function closeMenus2() {
    var b = document.querySelector(".cg-fmtbar.on");
    if (b) b.classList.remove("on");
    var u = document.querySelector(".cg-urlbar.on");
    if (u) u.classList.remove("on");
    closePathMenu();
  }
  return { bodyOf, attachPathPicker, closeMenus: closeMenus2 };
}

// editor/md-editor/markdown.js
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function splitFront(src) {
  src = src || "";
  const m = /^(---\n)([\s\S]*?)(\n---\n?)([\s\S]*)$/.exec(src);
  if (!m) return { fm: "", body: src };
  const nonEmpty = m[2].split("\n").filter((l) => l.trim() !== "");
  const yamlish = nonEmpty.length > 0 && nonEmpty.every(
    (l) => /^\s*[\w.-]+\s*:/.test(l) || /^\s*-\s+/.test(l) || /^\s+\S/.test(l)
    // key:, list item, or indented continuation
  );
  if (!yamlish) return { fm: "", body: src };
  return { fm: m[1] + m[2] + m[3], body: m[4] };
}
function parseFrontmatter(fm) {
  const inner = String(fm || "").replace(/^---\r?\n/, "").replace(/\r?\n?---\r?\n?$/, "");
  const rows = [];
  for (const line of inner.split("\n")) {
    const m = /^([\w.-]+):\s?(.*)$/.exec(line);
    if (m) rows.push({ key: m[1], value: m[2] });
    else if (rows.length && line.trim() !== "") {
      const last = rows[rows.length - 1], cont = line.replace(/^\s+/, "");
      last.value = last.value ? last.value + "\n" + cont : cont;
    }
  }
  return rows;
}
function isFrontmatterFlat(fm) {
  const inner = String(fm || "").replace(/^---\r?\n/, "").replace(/\r?\n?---\r?\n?$/, "");
  const lines = inner.split("\n").filter((l) => l.trim() !== "");
  return lines.length > 0 && lines.every((l) => /^[\w.-]+:/.test(l));
}
function buildFrontmatter(fm, editable) {
  const rows = parseFrontmatter(fm);
  if (!rows.length) return null;
  const canEdit = !!editable && isFrontmatterFlat(fm);
  const wrap = el("div", "mde-ln mde-fmwrap" + (canEdit ? " mde-fm-editable" : ""));
  wrap.setAttribute("contenteditable", "false");
  const grid = el("div", "mde-fm");
  rows.forEach(({ key, value }) => {
    const k = el("div", "mde-fmkey", key), v = el("div", "mde-fmval", value);
    if (canEdit) {
      k.setAttribute("contenteditable", "true");
      v.setAttribute("contenteditable", "true");
    }
    grid.appendChild(k);
    grid.appendChild(v);
  });
  wrap.appendChild(grid);
  return wrap;
}
function serializeFrontmatter(wrap) {
  const keys = [].map.call(wrap.querySelectorAll(".mde-fmkey"), (e) => e.textContent);
  const vals = [].map.call(wrap.querySelectorAll(".mde-fmval"), (e) => e.textContent);
  const lines = keys.map((k, i) => {
    const v = vals[i] || "";
    return v === "" ? k + ":" : k + ": " + v;
  });
  return "---\n" + lines.join("\n") + "\n---\n";
}
var ESCAPABLE = "\\`*~_[]()#+-.!>{}";
var isEscapable = (ch) => ESCAPABLE.indexOf(ch) >= 0;
function inlineDOM(text, linkResolver, atLinks = true) {
  const frag = document.createDocumentFragment();
  const linkRe = atLinks ? /\[([^\]]*)\]\(([^)]+)\)|(@[~.\w][\w./~-]*)/g : /\[([^\]]*)\]\(([^)]+)\)/g;
  let last = 0, m;
  while (m = linkRe.exec(text)) {
    if (m.index > 0 && text[m.index - 1] === "\\") continue;
    if (m.index > last) styleRuns(frag, text.slice(last, m.index));
    if (m[3] != null) frag.appendChild(mkAtLink(m[3], linkResolver));
    else frag.appendChild(mkLink(m[1], m[0], m[2], linkResolver));
    last = m.index + m[0].length;
  }
  if (last < text.length) styleRuns(frag, text.slice(last));
  return frag;
}
function styleRuns(frag, text) {
  let i = 0, buf = "";
  const flush = () => {
    if (buf) {
      frag.appendChild(document.createTextNode(buf));
      buf = "";
    }
  };
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\" && i + 1 < text.length && isEscapable(text[i + 1])) {
      buf += text[i + 1];
      i += 2;
      continue;
    }
    const rest = text.slice(i);
    let m;
    if (m = /^\*\*([^*\n]+)\*\*/.exec(rest)) {
      flush();
      frag.appendChild(el("b", null, m[1]));
      i += m[0].length;
      continue;
    }
    if (m = /^~~([^~\n]+)~~/.exec(rest)) {
      flush();
      frag.appendChild(el("s", null, m[1]));
      i += m[0].length;
      continue;
    }
    if (m = /^\+\+([^+\n]+)\+\+/.exec(rest)) {
      flush();
      frag.appendChild(el("u", null, m[1]));
      i += m[0].length;
      continue;
    }
    if (m = /^`([^`\n]+)`/.exec(rest)) {
      flush();
      frag.appendChild(el("code", null, m[1]));
      i += m[0].length;
      continue;
    }
    if (m = /^\*([^*\n]+)\*/.exec(rest)) {
      flush();
      frag.appendChild(el("i", null, m[1]));
      i += m[0].length;
      continue;
    }
    buf += ch;
    i++;
  }
  flush();
}
function escapeInline(text) {
  let out = "", i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    let m;
    if ((m = /^\*\*[^*\n]+\*\*/.exec(rest)) || (m = /^~~[^~\n]+~~/.exec(rest)) || (m = /^\+\+[^+\n]+\+\+/.exec(rest)) || (m = /^`[^`\n]+`/.exec(rest)) || (m = /^\*[^*\n]+\*/.exec(rest))) {
      out += m[0].replace(/([\\`*~+])/g, "\\$1");
      i += m[0].length;
      continue;
    }
    if (m = /^\[[^\]]*\]\([^)]+\)/.exec(rest)) {
      out += "\\" + m[0];
      i += m[0].length;
      continue;
    }
    if (text[i] === "\\" && i + 1 < text.length && isEscapable(text[i + 1])) {
      out += "\\\\";
      i++;
      continue;
    }
    out += text[i];
    i++;
  }
  return out;
}
function mkLink(label, raw, href, linkResolver) {
  const resolved = linkResolver ? linkResolver(href) : null;
  const s = el("span", "mde-link" + (resolved ? " mde-link-live" : " mde-link-plain"));
  s.textContent = label;
  s.dataset.md = raw;
  s.dataset.href = href;
  return s;
}
function mkAtLink(raw, linkResolver) {
  const href = raw.replace(/^@/, "");
  if (!(linkResolver && linkResolver(href))) return document.createTextNode(raw);
  const s = el("span", "mde-atlink mde-link-live");
  s.textContent = raw;
  s.dataset.md = raw;
  s.dataset.href = href;
  return s;
}
function inlineMd(nd, literal, open) {
  open = open || {};
  let out = "";
  for (let c = nd.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1 && c.classList && c.classList.contains("mde-ctl")) continue;
    if (c.nodeType === 3) out += literal ? c.textContent : escapeInline(c.textContent);
    else if (c.nodeName === "BR") out += "\n";
    else if (c.nodeType === 1 && c.classList && c.classList.contains("mde-atlink"))
      out += c.textContent;
    else if (c.nodeType === 1 && c.classList && c.classList.contains("mde-link"))
      out += "[" + c.textContent + "](" + (c.dataset.href || "") + ")";
    else if (c.dataset && c.dataset.md != null) out += c.dataset.md;
    else if (c.tagName === "B" || c.tagName === "STRONG") out += emitWrap(c, "**", "b", open);
    else if (c.tagName === "CODE") {
      if (c.textContent) out += "`" + c.textContent + "`";
    } else if (c.tagName === "S" || c.tagName === "DEL" || c.tagName === "STRIKE") out += emitWrap(c, "~~", "s", open);
    else if (c.tagName === "U" || c.tagName === "INS") out += emitWrap(c, "++", "u", open);
    else if (c.tagName === "I" || c.tagName === "EM") out += emitWrap(c, "*", "i", open);
    else out += inlineMd(c, literal, open);
  }
  return out;
}
function emitWrap(el2, mark, key, open) {
  if (open[key]) return inlineMd(el2, true, open);
  const s = inlineMd(el2, true, { ...open, [key]: 1 });
  return s ? mark + s + mark : "";
}
var isTableRow = (l) => l.trim().charAt(0) === "|";
var isSep = (l) => /-/.test(l) && /^\s*\|[\s|:\-]*\|?\s*$/.test(l) && l.trim().charAt(0) === "|";
var escPipe = (c) => String(c).replace(/\|/g, "\\|");
function cellsOf(l) {
  const s = l.trim(), raw = [];
  let cur = "", code = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && i + 1 < s.length && s[i + 1] === "|") {
      cur += "\\|";
      i++;
      continue;
    }
    if (ch === "`") {
      code = !code;
      cur += ch;
      continue;
    }
    if (ch === "|" && !code) {
      raw.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  raw.push(cur);
  if (raw.length && raw[0].trim() === "") raw.shift();
  if (raw.length && raw[raw.length - 1].trim() === "") raw.pop();
  return raw.map((c) => c.trim().replace(/\\\|/g, "|"));
}
function segmentRun(lines, start, end) {
  const segs = [];
  let i = start;
  while (i <= end) {
    if (i + 1 <= end && isSep(lines[i + 1])) {
      const s = i, sep = i + 1;
      let j = i + 2;
      while (j <= end && !(j + 1 <= end && isSep(lines[j + 1]))) j++;
      segs.push({ s, e: j - 1, sep });
      i = j;
    } else i++;
  }
  return segs;
}
function tSpec(cell) {
  const c = cell.trim(), L = c.charAt(0) === ":", R = c.charAt(c.length - 1) === ":";
  return { align: L && R ? "c" : L ? "l" : R ? "r" : "", width: Math.max(3, (c.match(/[-:]/g) || []).length) };
}
function tSepCell(sp) {
  const w = Math.max(3, sp.width | 0);
  if (sp.align === "c") return ":" + "-".repeat(Math.max(1, w - 2)) + ":";
  if (sp.align === "l") return ":" + "-".repeat(w - 1);
  if (sp.align === "r") return "-".repeat(w - 1) + ":";
  return "-".repeat(w);
}
function findTables(lines) {
  const t = [];
  let i = 0;
  while (i < lines.length) {
    if (isTableRow(lines[i])) {
      let j = i;
      while (j < lines.length && isTableRow(lines[j])) j++;
      segmentRun(lines, i, j - 1).forEach((seg) => t.push(seg));
      i = j;
    } else i++;
  }
  return t;
}
function readModel(lines, t) {
  const specs = cellsOf(lines[t.sep]).map(tSpec), rows = [];
  let hc = 0;
  for (let i = t.s; i <= t.e; i++) {
    if (i === t.sep) continue;
    const c = cellsOf(lines[i]);
    while (c.length < specs.length) c.push("");
    c.length = specs.length;
    rows.push(c);
    if (i < t.sep) hc++;
  }
  return { specs, rows, headerCount: hc };
}
function writeModel(m) {
  const out = [];
  for (let i = 0; i < m.rows.length; i++) {
    out.push("| " + m.rows[i].map(escPipe).join(" | ") + " |");
    if (i === m.headerCount - 1) out.push("| " + m.specs.map(tSepCell).join(" | ") + " |");
  }
  if (m.headerCount <= 0) out.unshift("| " + m.specs.map(tSepCell).join(" | ") + " |");
  return out;
}
function buildTable(run, linkResolver, sepIdx, atLinks = true) {
  if (sepIdx == null) sepIdx = run.findIndex(isSep);
  const specs = cellsOf(run[sepIdx]).map(tSpec), ncol = specs.length;
  const sum = specs.reduce((s, c) => s + c.width, 0) || ncol;
  const wrap = el("div", "mde-ln mde-tablewrap");
  const table = el("table", "mde-table");
  wrap.appendChild(table);
  const cg = el("colgroup");
  specs.forEach((sp) => {
    const c = el("col");
    c.dataset.w = sp.width;
    c.dataset.align = sp.align;
    c.style.width = (sp.width / sum * 100).toFixed(3) + "%";
    cg.appendChild(c);
  });
  table.appendChild(cg);
  const tb = el("tbody");
  table.appendChild(tb);
  run.forEach((line, i) => {
    if (i === sepIdx) return;
    const tr = el("tr", "mde-trow" + (i < sepIdx ? " mde-thead" : ""));
    tr.dataset.md = line;
    const cells = cellsOf(line);
    for (let ci = 0; ci < ncol; ci++) {
      const td = el("td", "mde-cell"), sp = specs[ci] || { align: "" };
      if (sp.align) td.style.textAlign = sp.align === "c" ? "center" : sp.align === "r" ? "right" : "left";
      const lb = el("span", "mde-clab");
      lb.appendChild(inlineDOM(cells[ci] || "", linkResolver, atLinks));
      td.appendChild(lb);
      tr.appendChild(td);
    }
    tb.appendChild(tr);
  });
  return wrap;
}
function serializeTable(wrap) {
  const table = wrap.querySelector("table.mde-table");
  const cols = [].map.call(table.querySelectorAll("col"), (c) => ({ width: +c.dataset.w || 3, align: c.dataset.align || "" }));
  const rows = [].slice.call(table.querySelectorAll("tr.mde-trow"));
  let hc = 0;
  rows.forEach((tr) => {
    if (tr.classList.contains("mde-thead")) hc++;
  });
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
function lineBlock(line, linkResolver, atLinks = true) {
  const h = /^(#{1,6})\s+(.*)$/.exec(line), li = /^(\s*[-*]\s+)(.*)$/.exec(line), hr = /^\s*(---|\*\*\*|___)\s*$/.exec(line), bq = /^(\s*>+\s?)(.*)$/.exec(line), ol = /^(\s*)(\d+[.)])(\s+)(.*)$/.exec(line);
  if (hr) {
    const d2 = el("div", "mde-ln mde-hr");
    d2.dataset.md = hr[0];
    return d2;
  }
  if (h) {
    const lvl = h[1].length, d2 = el("div", "mde-ln " + (lvl <= 1 ? "mde-h" : lvl === 2 ? "mde-h2" : "mde-h3"));
    d2.dataset.pre = h[1] + " ";
    d2.appendChild(inlineDOM(h[2], linkResolver, atLinks));
    return d2;
  }
  if (li) {
    const d2 = el("div", "mde-ln mde-li");
    d2.dataset.pre = li[1];
    applyListDepth(d2);
    d2.appendChild(inlineDOM(li[2], linkResolver, atLinks));
    return d2;
  }
  if (ol) {
    const d2 = el("div", "mde-ln mde-oli");
    d2.dataset.pre = ol[1] + ol[2] + ol[3];
    d2.dataset.num = ol[2];
    applyListDepth(d2);
    d2.appendChild(inlineDOM(ol[4], linkResolver, atLinks));
    return d2;
  }
  if (bq) {
    const d2 = el("div", "mde-ln mde-quote");
    d2.dataset.pre = bq[1];
    d2.appendChild(inlineDOM(bq[2], linkResolver, atLinks));
    return d2;
  }
  if (line === "") return el("div", "mde-ln mde-blank");
  const d = el("div", "mde-ln mde-body");
  d.appendChild(inlineDOM(line, linkResolver, atLinks));
  return d;
}
var INDENT_STEP = 2;
function parseListItem(pre) {
  if (typeof pre !== "string") return null;
  let m;
  if (m = /^(\s*)([-*])(\s+)$/.exec(pre)) return { kind: "bullet", indent: m[1], bullet: m[2], space: m[3] };
  if (m = /^(\s*)(\d+)([.)])(\s+)$/.exec(pre)) return { kind: "ordered", indent: m[1], num: parseInt(m[2], 10), dot: m[3], space: m[4] };
  return null;
}
function listItemPre(info) {
  return info.kind === "bullet" ? info.indent + info.bullet + info.space : info.indent + info.num + info.dot + info.space;
}
function nextListItem(info) {
  return info.kind === "ordered" ? { ...info, num: info.num + 1 } : { ...info };
}
function indentListItem(info, delta) {
  const len = Math.max(0, info.indent.length + delta * INDENT_STEP);
  return { ...info, indent: " ".repeat(len) };
}
function listDepth(pre) {
  const info = parseListItem(pre);
  return info ? Math.floor(info.indent.length / INDENT_STEP) : 0;
}
function renumberOrdered(items) {
  const counters = [];
  return items.map(({ ordered, depth }) => {
    counters.length = depth + 1;
    if (!ordered) return null;
    counters[depth] = (counters[depth] || 0) + 1;
    return counters[depth];
  });
}
function applyListDepth(block) {
  const depth = listDepth(block.dataset.pre || "");
  if (depth) block.style.setProperty("--kasi-li-depth", depth);
  else block.style.removeProperty("--kasi-li-depth");
}
function blockText(elem) {
  let s = "";
  (function walk(n) {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) s += c.textContent;
      else if (c.nodeName === "BR") s += "\n";
      else if (c.nodeType === 1) {
        if (/^(DIV|P)$/.test(c.nodeName) && s && s.slice(-1) !== "\n") s += "\n";
        walk(c);
      }
    }
  })(elem);
  return s;
}
function renderBody(root, body, linkResolver, atLinks = true) {
  const lines = body.split("\n");
  let fence = null;
  const flush = () => {
    if (!fence) return;
    const closed = fence.length > 1 && /^\s*```/.test(fence[fence.length - 1]);
    const inner = fence.slice(1, closed ? -1 : void 0).join("\n");
    const pre = el("pre", "mde-ln mde-code");
    pre.dataset.md = fence.join("\n");
    pre.dataset.open = fence[0];
    pre.dataset.close = closed ? fence[fence.length - 1] : "";
    pre.dataset.code = inner;
    pre.textContent = inner;
    root.appendChild(pre);
    fence = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      if (fence) {
        fence.push(line);
        flush();
      } else fence = [line];
      continue;
    }
    if (fence) {
      fence.push(line);
      continue;
    }
    if (isTableRow(line)) {
      let j = i;
      while (j < lines.length && isTableRow(lines[j])) j++;
      const segs = segmentRun(lines, i, j - 1);
      if (segs.length) {
        let cur = i;
        segs.forEach((seg) => {
          for (let k = cur; k < seg.s; k++) root.appendChild(lineBlock(lines[k], linkResolver, atLinks));
          root.appendChild(buildTable(lines.slice(seg.s, seg.e + 1), linkResolver, seg.sep - seg.s, atLinks));
          cur = seg.e + 1;
        });
        for (let k = cur; k < j; k++) root.appendChild(lineBlock(lines[k], linkResolver, atLinks));
        i = j - 1;
        continue;
      }
    }
    root.appendChild(lineBlock(line, linkResolver, atLinks));
  }
  flush();
}
var BLOCKISH = /^(p|div|ul|ol|li|h[1-6]|blockquote|pre|table|section|article)$/;
var hasBlockChild = (elem) => [].some.call(elem.children, (c) => BLOCKISH.test(c.tagName.toLowerCase()));
var ws = (s) => s.replace(/\s+/g, " ");
function htmlInline(node) {
  let out = "";
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 3) {
      out += ws(c.data);
      continue;
    }
    if (c.nodeType !== 1) continue;
    const t = c.tagName.toLowerCase(), inner = htmlInline(c);
    if (t === "br") out += "\n";
    else if ((t === "strong" || t === "b") && inner.trim()) out += "**" + inner + "**";
    else if ((t === "em" || t === "i") && inner.trim()) out += "*" + inner + "*";
    else if ((t === "s" || t === "del" || t === "strike") && inner.trim()) out += "~~" + inner + "~~";
    else if (t === "code") out += "`" + ws(c.textContent) + "`";
    else if (t === "a") {
      const href = (c.getAttribute("href") || "").trim();
      out += href ? "[" + (inner || href) + "](" + href + ")" : inner;
    } else out += inner;
  }
  return out;
}
function htmlList(listEl, ordered, depth) {
  const indent = "  ".repeat(depth), lines = [];
  let n = 1;
  for (let li = listEl.firstElementChild; li; li = li.nextElementSibling) {
    if (li.tagName.toLowerCase() !== "li") continue;
    const holder = listEl.ownerDocument.createElement("span"), nested = [];
    for (let cn = li.firstChild; cn; cn = cn.nextSibling) {
      if (cn.nodeType === 1 && /^(ul|ol)$/.test(cn.tagName.toLowerCase())) nested.push(cn);
      else holder.appendChild(cn.cloneNode(true));
    }
    lines.push(indent + (ordered ? n++ + "." : "-") + " " + ws(htmlInline(holder)).trim());
    nested.forEach((nl) => lines.push(htmlList(nl, nl.tagName.toLowerCase() === "ol", depth + 1)));
  }
  return lines.join("\n");
}
function htmlBlocks(node, out) {
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 3) {
      const t2 = ws(c.data).trim();
      if (t2) out.push(t2);
      continue;
    }
    if (c.nodeType !== 1) continue;
    const t = c.tagName.toLowerCase();
    if (/^h[1-6]$/.test(t)) {
      const s = htmlInline(c).trim();
      if (s) out.push("#".repeat(+t[1]) + " " + s);
    } else if (t === "ul" || t === "ol") out.push(htmlList(c, t === "ol", 0));
    else if (t === "blockquote") {
      const q = [];
      htmlBlocks(c, q);
      q.forEach((b) => out.push(b.split("\n").map((l) => "> " + l).join("\n")));
    } else if (t === "pre") out.push("```\n" + c.textContent.replace(/\n+$/, "") + "\n```");
    else if (t === "p" || t === "div" || t === "section" || t === "article") {
      if (hasBlockChild(c)) htmlBlocks(c, out);
      else {
        const s = htmlInline(c).trim();
        if (s) out.push(headingish(s));
      }
    } else if (t === "br") {
    } else {
      const s = htmlInline(c).trim();
      if (s) out.push(headingish(s));
    }
  }
}
var headingish = (s) => /^\*\*[^\n]+\*\*$/.test(s) ? "## " + s.slice(2, -2) : s;
var isListBlock = (b) => /^\s*([-*]|\d+[.)])\s/.test(b);
function joinBlocks(blocks) {
  let s = "";
  blocks.forEach((b, i) => {
    if (i) s += isListBlock(blocks[i - 1]) && isListBlock(b) ? "\n" : "\n\n";
    s += b;
  });
  return s;
}
function renumberLists(md) {
  let stack = [];
  return md.split("\n").map((line) => {
    const m = /^(\s*)(\d+)([.)])(\s+)(.*)$/.exec(line);
    if (!m) {
      if (line.trim() !== "" && !/^\s*[-*]\s/.test(line)) stack = [];
      return line;
    }
    const indent = m[1].length;
    while (stack.length && stack[stack.length - 1].indent > indent) stack.pop();
    if (!stack.length || stack[stack.length - 1].indent < indent) stack.push({ indent, n: 0 });
    const top = stack[stack.length - 1];
    return m[1] + ++top.n + m[3] + m[4] + m[5];
  }).join("\n");
}
function htmlToMarkdown(html) {
  const doc = document.implementation.createHTMLDocument("");
  doc.body.innerHTML = String(html || "");
  doc.body.querySelectorAll("style, script, meta, title, link, head").forEach((e) => e.remove());
  const out = [];
  htmlBlocks(doc.body, out);
  return renumberLists(joinBlocks(out.filter(Boolean))).replace(/\n{3,}/g, "\n\n").trim();
}
function emitBlock(b, out) {
  if (b.nodeType !== 1) {
    if (b.nodeType === 3 && b.textContent !== "") out.push(b.textContent);
    return;
  }
  if (b.classList.contains("mde-ctl")) return;
  if (b.classList.contains("mde-fmwrap")) return;
  if (b.classList.contains("mde-tablewrap")) {
    serializeTable(b).forEach((l) => out.push(l));
    return;
  }
  if (b.classList.contains("mde-code")) {
    const code = blockText(b);
    if (b.dataset.code != null && code === b.dataset.code) out.push(b.dataset.md);
    else out.push((b.dataset.open || "```") + "\n" + code + (b.dataset.close ? "\n" + b.dataset.close : ""));
  } else if (b.dataset && b.dataset.md != null) out.push(b.dataset.md);
  else out.push((b.dataset && b.dataset.pre ? b.dataset.pre : "") + inlineMd(b));
}
function serializeBody(root) {
  const out = [];
  for (let b = root.firstChild; b; b = b.nextSibling) emitBlock(b, out);
  return out.join("\n");
}

// editor/md-editor/tables.js
function ctlBtn(txt, title, fn) {
  const b = el("span", "mde-ctl mde-tctl-btn", txt);
  b.title = title;
  b.setAttribute("contenteditable", "false");
  b.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    fn();
  });
  return b;
}
function editTable(ctx, ti, fn) {
  const lines = ctx.getBody().split("\n"), t = findTables(lines)[ti];
  if (!t) return;
  const m = readModel(lines, t);
  if (fn(m) === false) return;
  const repl = m.rows.length === 0 || m.specs.length === 0 ? [] : writeModel(m);
  ctx.setBody(lines.slice(0, t.s).concat(repl, lines.slice(t.e + 1)).join("\n"));
}
var DRAG_THRESH = 4;
function pressDragClick(handle, { onClick, onDragMove, onDragEnd }) {
  handle.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX, y0 = e.clientY;
    let dragging = false;
    const prevSel = document.body.style.userSelect, prevCur = document.body.style.cursor;
    const move = (ev) => {
      if (!dragging && Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) > DRAG_THRESH) {
        dragging = true;
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
      }
      if (dragging && onDragMove) onDragMove(ev);
    };
    const up = (ev) => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.style.userSelect = prevSel;
      document.body.style.cursor = prevCur;
      if (dragging) {
        if (onDragEnd) onDragEnd(ev);
      } else if (onClick) onClick(ev);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  });
}
function arrayMove(arr, from, insertAt) {
  const [x] = arr.splice(from, 1);
  arr.splice(insertAt > from ? insertAt - 1 : insertAt, 0, x);
}
function dropIndex(rects, pos, axis) {
  for (let k = 0; k < rects.length; k++) {
    const mid = axis === "x" ? rects[k].left + rects[k].width / 2 : rects[k].top + rects[k].height / 2;
    if (pos < mid) return k;
  }
  return rects.length;
}
function showLine(line, wrap, box, pos, axis) {
  const wr = wrap.getBoundingClientRect();
  line.style.display = "block";
  if (axis === "x") {
    line.style.left = pos - wr.left + "px";
    line.style.top = box.top - wr.top + "px";
    line.style.width = "2px";
    line.style.height = box.bottom - box.top + "px";
  } else {
    line.style.top = pos - wr.top + "px";
    line.style.left = box.left - wr.left + "px";
    line.style.height = "2px";
    line.style.width = box.right - box.left + "px";
  }
}
function closeMenus() {
  [].forEach.call(document.querySelectorAll(".mde-menu"), (mn) => {
    if (mn._cleanup) mn._cleanup();
    mn.remove();
  });
}
function openColMenu(anchor, ci, ti, ctx, curAlign) {
  closeMenus();
  const menu = el("div", "mde-ctl mde-menu");
  menu.setAttribute("contenteditable", "false");
  const item = (label, active, danger, fn) => {
    const row = el("div", "mde-menurow" + (active ? " mde-on" : "") + (danger ? " mde-danger" : ""), label);
    row.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeMenus();
      fn();
    });
    menu.appendChild(row);
  };
  const isL = (curAlign || "l") === "l";
  item("Align left", isL, false, () => editTable(ctx, ti, (m) => {
    if (m.specs[ci]) m.specs[ci].align = "l";
  }));
  item("Align center", curAlign === "c", false, () => editTable(ctx, ti, (m) => {
    if (m.specs[ci]) m.specs[ci].align = "c";
  }));
  item("Align right", curAlign === "r", false, () => editTable(ctx, ti, (m) => {
    if (m.specs[ci]) m.specs[ci].align = "r";
  }));
  menu.appendChild(el("div", "mde-menusep"));
  item("Delete column", false, true, () => editTable(ctx, ti, (m) => {
    m.specs.splice(ci, 1);
    m.rows.forEach((r) => r.splice(ci, 1));
  }));
  document.body.appendChild(menu);
  const br = anchor.getBoundingClientRect(), mw = menu.offsetWidth, mh = menu.offsetHeight, gap = 6;
  const left = Math.max(gap, Math.min(Math.round(br.left), window.innerWidth - mw - gap));
  let top = Math.round(br.bottom + 4);
  if (top + mh > window.innerHeight - gap) top = Math.round(br.top - mh - 4);
  menu.style.left = left + "px";
  menu.style.top = Math.max(gap, top) + "px";
  const onDoc = (e) => {
    if (!menu.contains(e.target)) closeMenus();
  };
  const onKey = (e) => {
    if (e.key === "Escape") closeMenus();
  };
  setTimeout(() => {
    document.addEventListener("mousedown", onDoc, true);
    document.addEventListener("keydown", onKey, true);
  }, 0);
  menu._cleanup = () => {
    document.removeEventListener("mousedown", onDoc, true);
    document.removeEventListener("keydown", onKey, true);
  };
}
var NEW_COL_W = 6;
function insertStarterTable(root, ref, ctx, headers) {
  const cols = headers && headers.length ? headers.map((w) => String(w).replace(/\|/g, "\\|")) : ["Column", "Column"];
  const dash = "-".repeat(NEW_COL_W);
  const run = [
    "| " + cols.join(" | ") + " |",
    "| " + cols.map(() => dash).join(" | ") + " |",
    "| " + cols.map(() => "").join(" | ") + " |"
    // one empty data row
  ];
  const wrap = buildTable(run, ctx.linkResolver, void 0, ctx.atLinks);
  if (ref) root.insertBefore(wrap, ref);
  else root.appendChild(wrap);
  ctx.commitDOM();
}
function colResize(grip, ci, ti, ctx, onMove) {
  grip.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const wrap = grip.closest(".mde-tablewrap"), table = wrap.querySelector("table.mde-table");
    const cols = [].slice.call(table.querySelectorAll("col")), a = cols[ci], b = cols[ci + 1];
    if (!b) return;
    const startX = e.clientX, aW0 = +a.dataset.w || 3, bW0 = +b.dataset.w || 3;
    const unit = grip.closest("td").getBoundingClientRect().width / aW0 || 1;
    const sum = cols.reduce((s, c) => s + (+c.dataset.w || 3), 0);
    const prevSel = document.body.style.userSelect, prevCur = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    let aW = aW0, bW = bW0;
    const apply = () => {
      a.style.width = (aW / sum * 100).toFixed(3) + "%";
      b.style.width = (bW / sum * 100).toFixed(3) + "%";
    };
    const move = (ev) => {
      let d = Math.round((ev.clientX - startX) / unit);
      d = Math.max(-(aW0 - 3), Math.min(bW0 - 3, d));
      aW = aW0 + d;
      bW = bW0 - d;
      a.dataset.w = aW;
      b.dataset.w = bW;
      apply();
      if (onMove) onMove();
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.style.userSelect = prevSel;
      document.body.style.cursor = prevCur;
      if (aW !== aW0) editTable(ctx, ti, (m) => {
        if (m.specs[ci]) m.specs[ci].width = aW;
        if (m.specs[ci + 1]) m.specs[ci + 1].width = bW;
      });
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  });
}
function decorateTables(root, ctx) {
  closeMenus();
  [].forEach.call(root.querySelectorAll(":scope > .mde-tablewrap"), (wrap, ti) => {
    const table = wrap.querySelector("table.mde-table"), tbody = table.querySelector("tbody");
    const cols = [].slice.call(table.querySelectorAll("col")), rows = [].slice.call(table.querySelectorAll("tr.mde-trow"));
    const dropline = el("div", "mde-ctl mde-dropline");
    wrap.appendChild(dropline);
    const colRects = () => [].map.call(rows[0].children, (td) => td.getBoundingClientRect());
    const rowRects = () => rows.map((tr) => tr.getBoundingClientRect());
    const bodyBox = () => {
      const rr = rowRects(), cr = colRects();
      return { top: rr[0].top, bottom: rr[rr.length - 1].bottom, left: cr[0].left, right: cr[cr.length - 1].right };
    };
    const ctlBar = el("div", "mde-ctl mde-tctlrow");
    ctlBar.setAttribute("contenteditable", "false");
    const ctlTds = [];
    const syncCtlBar = () => {
      const wr = wrap.getBoundingClientRect(), cr = colRects();
      cr.forEach((r, ci) => {
        const td = ctlTds[ci];
        if (td) {
          td.style.left = r.left - wr.left + "px";
          td.style.width = r.width + "px";
        }
      });
    };
    cols.forEach((col, ci) => {
      const td = el("div", "mde-tctlcell"), bar = el("div", "mde-tctlbar");
      const menuBtn = el("span", "mde-ctl mde-tctl-btn mde-tmenu", "\u22EF");
      menuBtn.setAttribute("contenteditable", "false");
      menuBtn.title = "Column options \u2014 drag to move";
      const del = el("span", "mde-ctl mde-tctl-btn mde-delcol", "\u2715");
      del.setAttribute("contenteditable", "false");
      del.title = "Delete column";
      bar.appendChild(menuBtn);
      bar.appendChild(del);
      td.appendChild(bar);
      ctlBar.appendChild(td);
      ctlTds.push(td);
      pressDragClick(td, {
        onDragMove: (ev) => {
          const cr = colRects(), to = dropIndex(cr, ev.clientX, "x");
          showLine(dropline, wrap, bodyBox(), to < cr.length ? cr[to].left : cr[cr.length - 1].right, "x");
        },
        onDragEnd: (ev) => {
          dropline.style.display = "none";
          const to = dropIndex(colRects(), ev.clientX, "x");
          if (to !== ci && to !== ci + 1) editTable(ctx, ti, (m) => {
            arrayMove(m.specs, ci, to);
            m.rows.forEach((r) => arrayMove(r, ci, to));
          });
        }
      });
      pressDragClick(menuBtn, { onClick: () => openColMenu(menuBtn, ci, ti, ctx, col.dataset.align || "") });
      pressDragClick(del, { onClick: () => editTable(ctx, ti, (m) => {
        m.specs.splice(ci, 1);
        m.rows.forEach((r) => r.splice(ci, 1));
      }) });
    });
    wrap.appendChild(ctlBar);
    rows.forEach((tr, ri) => {
      const cells = [].slice.call(tr.children);
      cells.forEach((td, ci) => {
        if (ci < cols.length - 1) {
          const grip = el("span", "mde-ctl mde-grip");
          grip.dataset.col = ci;
          grip.setAttribute("contenteditable", "false");
          grip.title = "Drag to resize column";
          colResize(grip, ci, ti, ctx, syncCtlBar);
          td.appendChild(grip);
        }
      });
      const handle = el("span", "mde-ctl mde-rowdel");
      handle.setAttribute("contenteditable", "false");
      handle.title = "Drag to move row";
      const rx = el("span", "mde-ctl mde-tctl-btn mde-rowdelx", "\u2715");
      rx.setAttribute("contenteditable", "false");
      rx.title = "Delete row";
      handle.appendChild(rx);
      pressDragClick(handle, {
        onDragMove: (ev) => {
          const rr = rowRects(), to = dropIndex(rr, ev.clientY, "y");
          showLine(dropline, wrap, bodyBox(), to < rr.length ? rr[to].top : rr[rr.length - 1].bottom, "y");
        },
        onDragEnd: (ev) => {
          dropline.style.display = "none";
          const to = dropIndex(rowRects(), ev.clientY, "y");
          if (to !== ri && to !== ri + 1) editTable(ctx, ti, (m) => {
            arrayMove(m.rows, ri, to);
          });
        }
      });
      pressDragClick(rx, { onClick: () => editTable(ctx, ti, (m) => {
        m.rows.splice(ri, 1);
        if (ri < m.headerCount) m.headerCount--;
        if (m.headerCount < 1 && m.rows.length) m.headerCount = 1;
      }) });
      cells[0].appendChild(handle);
    });
    const addCol = ctlBtn("\uFF0B", "Add column", () => editTable(ctx, ti, (m) => {
      m.specs.push({ align: "", width: NEW_COL_W });
      m.rows.forEach((r) => r.push(""));
    }));
    addCol.classList.add("mde-addcol");
    wrap.appendChild(addCol);
    const addRow = ctlBtn("\uFF0B", "Add row", () => editTable(ctx, ti, (m) => {
      m.rows.push(m.specs.map(() => ""));
    }));
    addRow.classList.add("mde-addrow");
    wrap.appendChild(addRow);
    const grips = wrap.querySelectorAll(".mde-grip");
    const setHover = (ci) => {
      syncCtlBar();
      ctlTds.forEach((td, i) => td.classList.toggle("mde-colon", i === ci));
      if (ci >= 0 && ctlTds[ci]) {
        const w = rows[0].children[ci].getBoundingClientRect().width;
        ctlTds[ci].classList.toggle("mde-narrow", w > 0 && w < 64);
      }
      [].forEach.call(grips, (g) => {
        const gc = +g.dataset.col;
        g.classList.toggle("mde-gripshow", ci >= 0 && (gc === ci || gc === ci - 1));
      });
    };
    wrap.addEventListener("mouseover", (e) => {
      const dtd = e.target.closest && e.target.closest("td.mde-cell");
      if (dtd && dtd.parentElement && dtd.parentElement.classList.contains("mde-trow")) {
        setHover(dtd.cellIndex);
        return;
      }
      const ctd = e.target.closest && e.target.closest(".mde-tctlcell");
      setHover(ctd ? ctlTds.indexOf(ctd) : -1);
    });
    wrap.addEventListener("mouseleave", () => setHover(-1));
  });
}

// editor/md-editor/mermaid.js
var FENCE_INFO = /^\s*(?:```|~~~)\s*([^\s`~]*)/;
function fenceLang(open) {
  const m = FENCE_INFO.exec(open || "");
  return m ? m[1].toLowerCase() : "";
}
function themeVarsFrom(root) {
  const cs = typeof window !== "undefined" && window.getComputedStyle ? window.getComputedStyle(root) : null;
  const v = (name, fallback) => {
    const x = cs ? cs.getPropertyValue(name).trim() : "";
    return x || fallback;
  };
  const fg = v("--kasi-fg", "#e8e8ea"), bg = v("--kasi-bg", "#0e0e0e"), cell = v("--kasi-cell-bg", "#1c1c1e");
  return {
    background: bg,
    edgeLabelBackground: cell,
    mainBkg: fg,
    primaryColor: fg,
    secondaryColor: fg,
    tertiaryColor: fg,
    primaryBorderColor: fg,
    nodeBorder: fg,
    clusterBorder: fg,
    primaryTextColor: bg,
    nodeTextColor: bg,
    lineColor: fg,
    textColor: fg,
    fontFamily: v("--kasi-font", "sans-serif"),
    fontSize: v("--kasi-size", "14px")
  };
}
function mmError(err) {
  return "Mermaid: " + (err && err.message || String(err));
}
function tintEdgeLabels(box) {
  const svg = box.querySelector("svg");
  if (!svg || typeof svg.getBoundingClientRect !== "function") return;
  const clusters = [].map.call(box.querySelectorAll(".cluster rect"), (r) => r.getBoundingClientRect());
  if (!clusters.length) return;
  [].forEach.call(box.querySelectorAll("g.edgeLabel"), (lbl) => {
    const b = lbl.getBoundingClientRect();
    if (!b.width && !b.height) return;
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    let depth = 0;
    clusters.forEach((c) => {
      if (cx >= c.left && cx <= c.right && cy >= c.top && cy <= c.bottom) depth++;
    });
    let color = "var(--kasi-cell-bg)";
    for (let i = 0; i < depth; i++) color = "color-mix(in srgb, var(--kasi-fg) 7%, " + color + ")";
    lbl.style.setProperty("--mmd-labelbg", color);
  });
}
function finalizeSvg(box) {
  [".edgePaths, .edges", ".subgraphs, .clusters", ".nodes", ".edgeLabels"].forEach((sel) => {
    [].forEach.call(box.querySelectorAll("svg " + sel), (g) => {
      if (g.parentNode) g.parentNode.appendChild(g);
    });
  });
  tintEdgeLabels(box);
}
function decorateMermaid(root, ctx) {
  if (!ctx.renderer) return;
  const blocks = [].filter.call(
    root.querySelectorAll(":scope > pre.mde-code"),
    (pre) => fenceLang(pre.dataset.open) === "mermaid"
  );
  if (!blocks.length) return;
  let editing = null;
  const softCls = ctx.softNodes ? "mde-mmd-soft" : "mde-mmd-contrast";
  const paint = (pre) => {
    const box = pre._mmBox, gen = pre._mmGen = (pre._mmGen || 0) + 1;
    box.classList.remove("mde-mermaid-err");
    const ready = ctx.renderer.render(blockText(pre), themeVarsFrom(root)).then(
      (svg) => {
        if (pre._mmGen === gen) {
          box.innerHTML = svg;
          finalizeSvg(box);
        }
      },
      (err) => {
        if (pre._mmGen === gen) {
          box.classList.add("mde-mermaid-err");
          box.textContent = mmError(err);
        }
      }
    );
    pre._mmReady = ready;
    return ready;
  };
  const showRest = (pre) => {
    pre.classList.add("mde-hidden");
    pre._mmOverlay.classList.remove("mde-hidden");
  };
  const showSource = (pre) => {
    pre.classList.remove("mde-hidden");
    pre._mmOverlay.classList.add("mde-hidden");
  };
  const enterEdit = (pre) => {
    if (editing && editing !== pre) exitEdit(editing);
    editing = pre;
    showSource(pre);
    const r = document.createRange();
    r.selectNodeContents(pre);
    r.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  };
  const exitEdit = (pre) => {
    if (editing === pre) editing = null;
    showRest(pre);
    paint(pre);
  };
  const openZoom = (pre) => {
    const svg = pre._mmBox.querySelector("svg");
    if (!svg) return;
    const modal = el("div", "mde-mmd-zoom");
    if (typeof window !== "undefined" && window.getComputedStyle) {
      const cs = window.getComputedStyle(root);
      ["--kasi-fg", "--kasi-fg-dim", "--kasi-bg", "--kasi-cell-bg", "--kasi-accent", "--kasi-radius", "--kasi-gap", "--kasi-font", "--kasi-mono", "--kasi-size"].forEach((k) => modal.style.setProperty(k, cs.getPropertyValue(k)));
    }
    const scroller = el("div", "mde-mmd-zoomscroll");
    const panel = el("div", "mde-mermaid mde-mmd-zoompanel");
    const stage = el("div", "mde-mermaid-svg " + softCls);
    const clone = svg.cloneNode(true);
    clone.style.maxWidth = "none";
    const vb = (svg.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number);
    if (vb.length === 4 && vb[2] && vb[3]) {
      clone.style.width = vb[2] + "px";
      clone.style.height = vb[3] + "px";
    }
    stage.appendChild(clone);
    panel.appendChild(stage);
    scroller.appendChild(panel);
    const close = el("button", "mde-ctl mde-mmd-zoomclose", "\u2715");
    close.type = "button";
    close.title = "Close";
    const dismiss = () => {
      modal.remove();
      document.removeEventListener("keydown", onKey);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss();
      }
    };
    close.addEventListener("click", dismiss);
    modal.addEventListener("mousedown", (e) => {
      if (e.target === modal) dismiss();
    });
    document.addEventListener("keydown", onKey);
    modal.appendChild(scroller);
    modal.appendChild(close);
    document.body.appendChild(modal);
    finalizeSvg(stage);
  };
  const mkBtn = (glyph, title, fn) => {
    const b = el("button", "mde-ctl mde-mmd-btn", glyph);
    b.type = "button";
    b.title = title;
    b.setAttribute("contenteditable", "false");
    b.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      fn();
    });
    return b;
  };
  blocks.forEach((pre) => {
    const overlay = el("div", "mde-ctl mde-mermaid");
    overlay.setAttribute("contenteditable", "false");
    overlay.appendChild(el("div", "mde-mermaid-svg " + softCls));
    const tools = el("div", "mde-ctl mde-mermaid-tools");
    tools.setAttribute("contenteditable", "false");
    if (ctx.editable) tools.appendChild(mkBtn("\u270E", "Edit diagram source", () => enterEdit(pre)));
    tools.appendChild(mkBtn("\u2922", "Enlarge", () => openZoom(pre)));
    overlay.appendChild(tools);
    pre._mmOverlay = overlay;
    pre._mmBox = overlay.firstChild;
    pre.after(overlay);
    showRest(pre);
    paint(pre);
  });
  if (ctx.editable) {
    ctx.on(document, "selectionchange", () => {
      if (!editing) return;
      const a = window.getSelection().anchorNode;
      if (!a || !editing.contains(a)) exitEdit(editing);
    });
  }
}

// editor/md-editor/mermaid-render.js
function createMermaidRenderer(mermaid) {
  if (!mermaid || typeof mermaid.render !== "function") return null;
  let seq = 0;
  return {
    // Re-initialize per call so a live theme change (light/dark) is picked up; mermaid supports repeated init and
    // it is cheap next to the render itself. `themeVariables` come from the editor's own --kasi-* theme surface.
    async render(text, themeVariables) {
      const cfg = {
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        // `padding` = NODE inner padding (text ↔ border); tight spacing so ELK doesn't open tall layer corridors
        flowchart: { rankSpacing: 12, nodeSpacing: 20, padding: 8, subGraphTitleMargin: { top: 8, bottom: 16 } },
        themeVariables: themeVariables || {}
      };
      const draw = async (extra) => {
        mermaid.initialize(Object.assign({}, cfg, extra));
        return (await mermaid.render("mde-mmd-" + ++seq, text)).svg;
      };
      return draw({ layout: "elk", elk: { mergeEdges: true, nodePlacementStrategy: "BRANDES_KOEPF" } }).catch(() => draw({}));
    }
  };
}

// editor/md-editor/history.js
function createHistory2(get, set) {
  const undo = [], redo = [];
  let burst = null;
  const MAX = 300;
  function pushPre() {
    const v = get();
    if (undo.length && undo[undo.length - 1] === v) return;
    undo.push(v);
    redo.length = 0;
    if (undo.length > MAX) undo.shift();
  }
  return {
    recordInput() {
      if (burst) {
        clearTimeout(burst);
        burst = setTimeout(() => {
          burst = null;
        }, 500);
        return;
      }
      pushPre();
      burst = setTimeout(() => {
        burst = null;
      }, 500);
    },
    batch(fn) {
      if (burst) {
        clearTimeout(burst);
        burst = null;
      }
      pushPre();
      return fn && fn();
    },
    undo() {
      if (!undo.length) return false;
      if (burst) {
        clearTimeout(burst);
        burst = null;
      }
      redo.push(get());
      set(undo.pop());
      return true;
    },
    redo() {
      if (!redo.length) return false;
      undo.push(get());
      set(redo.pop());
      return true;
    },
    get canUndo() {
      return undo.length > 0;
    },
    get canRedo() {
      return redo.length > 0;
    }
  };
}

// editor/md-editor/md-editor.js
var svgIcon = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
var ICON = {
  code: svgIcon(`<polyline points="8 8 4 12 8 16"/><polyline points="16 8 20 12 16 16"/>`),
  codeblock: svgIcon(`<rect x="3" y="5" width="18" height="14" rx="2"/><polyline points="9.5 10 7.5 12 9.5 14"/><polyline points="14.5 10 16.5 12 14.5 14"/>`),
  link: svgIcon(`<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>`),
  bullet: svgIcon(`<line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1.4" fill="currentColor" stroke="none"/>`),
  numbered: svgIcon(`<line x1="10" y1="6" x2="20" y2="6"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="10" y1="18" x2="20" y2="18"/><text x="2" y="8.5" font-size="7" font-family="sans-serif" fill="currentColor" stroke="none">1</text><text x="2" y="20" font-size="7" font-family="sans-serif" fill="currentColor" stroke="none">2</text>`),
  quote: svgIcon(`<line x1="5" y1="5" x2="5" y2="19" stroke-width="2.5"/><line x1="9" y1="8" x2="19" y2="8"/><line x1="9" y1="12" x2="19" y2="12"/><line x1="9" y1="16" x2="15" y2="16"/>`),
  table: svgIcon(`<rect x="4" y="4" width="16" height="16" rx="1.5"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="12" y1="4" x2="12" y2="20"/>`),
  // 2×2 grid
  remove: svgIcon(`<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>`),
  // ✕ over the active link
  linkgo: svgIcon(`<path d="M14 5h5v5"/><path d="M19 5l-8 8"/><path d="M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>`)
};
function renderGlyph(btn, f) {
  if (f.icon) btn.innerHTML = ICON[f.icon];
  else btn.textContent = f.l;
}
var FMT = [
  { l: "B", cls: "alpha bold", b: "**", a: "**", key: "bold", name: "Bold", hot: "\u2318B" },
  { l: "I", cls: "alpha italic", b: "*", a: "*", key: "italic", name: "Italic", hot: "\u2318I" },
  { l: "U", cls: "alpha underline", b: "++", a: "++", key: "underline", name: "Underline", hot: "\u2318U" },
  { l: "S", cls: "alpha strike", b: "~~", a: "~~", key: "strike", name: "Strikethrough", hot: "\u2318\u21E7S" },
  { sep: 1 },
  { l: "H1", cls: "hd hd1", b: "# ", a: "", pre: 1, key: "h1", name: "Heading 1" },
  { l: "H2", cls: "hd hd2", b: "## ", a: "", pre: 1, key: "h2", name: "Heading 2" },
  { l: "H3", cls: "hd hd3", b: "### ", a: "", pre: 1, key: "h3", name: "Heading 3" },
  { sep: 1 },
  { icon: "bullet", b: "- ", a: "", pre: 1, key: "bullet", name: "Bullet list" },
  { icon: "numbered", b: "1. ", a: "", pre: 1, key: "number", name: "Numbered list" },
  { icon: "quote", b: "> ", a: "", pre: 1, key: "quote", name: "Quote" },
  { sep: 1 },
  { icon: "code", b: "`", a: "`", key: "code", name: "Code", hot: "\u2318\u21E7C" },
  { icon: "codeblock", key: "codeblock", name: "Code block", hot: "\u21E7\u2318\u2325C" },
  { sep: 1 },
  { icon: "link", cls: "sm", b: "[", a: "](url)", key: "link", name: "Link", hot: "\u2318K" },
  { icon: "table", key: "table", name: "Insert table" }
];
var FMT_TAG = { bold: /^(B|STRONG)$/, italic: /^(I|EM)$/, underline: /^(U|INS)$/, strike: /^(S|DEL|STRIKE)$/, code: /^CODE$/ };
var WRAP_TAG = { bold: "B", italic: "I", underline: "U", strike: "S", code: "CODE" };
var HOTKEY = { b: "bold", i: "italic", u: "underline", k: "link" };
var MarkdownEditor = class {
  constructor(host, opts = {}) {
    this.host = host;
    this.opts = opts;
    this._value = opts.value || "";
    this.editable = opts.editable !== false;
    this.linkResolver = opts.linkResolver || null;
    this.followLinks = opts.followLinks === true;
    this.atLinks = opts.atLinks !== false;
    this.showFrontmatter = opts.frontmatter !== false;
    this.pathProvider = opts.pathProvider || null;
    this.onSave = opts.onSave || null;
    this._fm = "";
    this._listeners = [];
    this._persist = [];
    this.historyOn = opts.history !== false;
    this.history = this.historyOn ? createHistory2(() => this.getValue(), (v) => {
      this._value = v;
      this._render();
      this._emit();
    }) : { recordInput() {
    }, batch(fn) {
      opts.onBeforeChange && opts.onBeforeChange();
      fn();
    }, undo() {
    }, redo() {
    } };
    this._render();
  }
  // ---- public API ----
  getValue() {
    return this.root ? this._fm + serializeBody(this.root) : this._value;
  }
  setValue(v) {
    this._value = v;
    this._render();
  }
  focus(opts) {
    this.root && this.root.focus(opts);
  }
  // opts (e.g. {preventScroll:true}) forwarded so a host can focus without yanking scroll
  destroy() {
    this._teardown();
    this._persist.forEach(([t, e, f, o]) => t.removeEventListener(e, f, o));
    this._persist = [];
    if (this._ppTimer) {
      clearTimeout(this._ppTimer);
      this._ppTimer = null;
    }
    this._closePathPicker();
    closeMenus();
    const dm = document.getElementById("mde-diffmodal");
    if (dm) dm.remove();
    this.host.innerHTML = "";
    if (this._bar) {
      this._bar.remove();
      this._bar = null;
    }
    if (this._tip) {
      this._tip.remove();
      this._tip = null;
    }
  }
  // ---- internals ----
  _emit() {
    const v = this.getValue();
    this._value = v;
    this.opts.onChange && this.opts.onChange(v);
  }
  _on(target, ev, fn, opt) {
    target.addEventListener(ev, fn, opt);
    this._listeners.push([target, ev, fn, opt]);
  }
  // per-render
  _onPersist(target, ev, fn, opt) {
    target.addEventListener(ev, fn, opt);
    this._persist.push([target, ev, fn, opt]);
  }
  // survives re-renders
  _teardown() {
    this._listeners.forEach(([t, e, f, o]) => t.removeEventListener(e, f, o));
    this._listeners = [];
  }
  _syncFrontmatter() {
    const g = this.root && this.root.querySelector(".mde-fmwrap.mde-fm-editable");
    if (g) this._fm = serializeFrontmatter(g);
  }
  // editable grid is the source now; keep _fm in step so getValue and _tableCtx stay correct
  _tableCtx(root) {
    return {
      editable: true,
      linkResolver: this.linkResolver,
      atLinks: this.atLinks,
      getBody: () => serializeBody(root),
      setBody: (body) => {
        this.history.batch(() => {
          this._value = this._fm + body;
        });
        this._render();
        this._emit();
      },
      commitDOM: () => {
        this.history.batch(() => {
          this._value = this.getValue();
        });
        this._render();
        this._emit();
      }
    };
  }
  // Mermaid renderer is lazy and re-attempted while absent: a CDN <script> may land after the editor mounts, so
  // as long as window.Mermaid is missing createMermaidRenderer returns null and we retry on the next render.
  _mermaidRenderer() {
    if (!this._mmr) this._mmr = createMermaidRenderer(typeof window !== "undefined" ? window.Mermaid : null);
    return this._mmr;
  }
  _mermaidCtx() {
    return {
      editable: this.editable,
      renderer: this._mermaidRenderer(),
      on: (t, e, f, o) => this._on(t, e, f, o),
      softNodes: this.opts.mermaidNodes !== "contrast"
    };
  }
  _render() {
    this._teardown();
    const parts = splitFront(this._value);
    this._fm = parts.fm;
    const root = el("div", "mde-root" + (this.editable ? " mde-editable" : " mde-readonly") + (this.followLinks ? " mde-follow-links" : ""));
    root.setAttribute("contenteditable", this.editable ? "true" : "false");
    root.setAttribute("spellcheck", "false");
    renderBody(root, parts.body, this.linkResolver, this.atLinks);
    const fmEl = this.showFrontmatter ? buildFrontmatter(parts.fm, this.editable) : null;
    if (fmEl) root.insertBefore(fmEl, root.firstChild);
    if (this.editable) decorateTables(root, this._tableCtx(root));
    decorateMermaid(root, this._mermaidCtx());
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
    this._on(root, "input", (e) => {
      if (e && e.target && e.target.closest && e.target.closest(".mde-fm-editable")) this._syncFrontmatter();
      else this._maybeListShortcut();
      this._emit();
      if (this.pathProvider) this._schedulePathPicker(root);
    });
    this._on(root, "paste", (e) => this._onPaste(e));
    this._on(root, "click", (e) => {
      if (this._focusFmCell(e)) return;
      if (this.followLinks && this._followLink(e)) return;
      this._onClick(e);
    });
    this._on(root, "keydown", (e) => this._onKeydown(e, root));
    this._on(document, "selectionchange", () => this._normalizeTableCaret());
  }
  _schedulePathPicker(root) {
    if (this._ppTimer) clearTimeout(this._ppTimer);
    this._ppTimer = setTimeout(() => {
      this._ppTimer = null;
      this._updatePathPicker(root);
    }, 120);
  }
  // Frontmatter cells are contenteditable="true" islands inside a contenteditable="false" wrap inside the
  // editable root. Blink/WebKit treat that non-editable wrap as an atomic object and refuse to drop the caret
  // INTO the island on click (you can select its text and the format bar fires, but no caret → no typing). So on
  // a click that landed a cell, if the selection didn't end up inside it, we place the caret ourselves. → true
  // when the click was on such a cell (handled), so the caller skips link-follow / token-select.
  _focusFmCell(e) {
    const cell = e.target && e.target.closest && e.target.closest(".mde-fm-editable .mde-fmkey, .mde-fm-editable .mde-fmval");
    if (!cell) return false;
    const sel = window.getSelection();
    const anchor = sel && sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
    if (anchor && cell.contains(anchor)) return true;
    cell.focus();
    const r = this._caretRangeIn(cell, e.clientX, e.clientY);
    sel.removeAllRanges();
    sel.addRange(r);
    return true;
  }
  _caretRangeIn(cell, x, y) {
    const doc = cell.ownerDocument;
    if (doc.caretRangeFromPoint) {
      const r2 = doc.caretRangeFromPoint(x, y);
      if (r2 && cell.contains(r2.startContainer)) return r2;
    } else if (doc.caretPositionFromPoint) {
      const p = doc.caretPositionFromPoint(x, y);
      if (p && cell.contains(p.offsetNode)) {
        const r2 = doc.createRange();
        r2.setStart(p.offsetNode, p.offset);
        r2.collapse(true);
        return r2;
      }
    }
    const r = doc.createRange();
    r.selectNodeContents(cell);
    r.collapse(false);
    return r;
  }
  _followLink(e) {
    const lk = e.target.closest && e.target.closest(".mde-link[data-href], .mde-atlink[data-href]");
    if (lk && this.linkResolver) {
      const r = this.linkResolver(lk.dataset.href);
      if (r && r.onClick) {
        e.preventDefault();
        r.onClick();
        return true;
      }
    }
    return false;
  }
  // 1st click on a run selects it whole (bold/code/link/heading text, or a table cell's label — which also
  // lands the caret INSIDE an empty cell); clicking the same run again drops the caret under the cursor.
  _onClick() {
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.getRangeAt(0).collapsed) return;
    const tok = this._tokenAt();
    if (tok && tok === this._selTok) {
      this._selTok = null;
      return;
    }
    if (tok) {
      this._selectToken(tok);
      this._selTok = tok;
    } else this._selTok = null;
  }
  _onKeydown(e, root) {
    if (this._pathdd) {
      const last = (this._ppItems ? this._ppItems.length : 1) - 1;
      if (e.key === "ArrowDown") {
        this._ppIdx = Math.min(this._ppIdx + 1, last);
        this._highlightPathPick();
        e.preventDefault();
        return;
      }
      if (e.key === "ArrowUp") {
        this._ppIdx = Math.max(this._ppIdx - 1, 0);
        this._highlightPathPick();
        e.preventDefault();
        return;
      }
      if (e.key === "Enter") {
        this._acceptPathPick(this._ppIdx);
        e.preventDefault();
        return;
      }
      if (e.key === "Escape") {
        this._closePathPicker();
        e.preventDefault();
        return;
      }
    }
    const meta = e.metaKey || e.ctrlKey;
    if (this.historyOn && meta && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.shiftKey ? this.history.redo() : this.history.undo();
      return;
    }
    if (this.historyOn && meta && e.key.toLowerCase() === "y") {
      e.preventDefault();
      this.history.redo();
      return;
    }
    if (meta && e.key.toLowerCase() === "s" && this.onSave) {
      e.preventDefault();
      this._openSaveDiff();
      return;
    }
    if (meta) {
      let key = null;
      const k = e.key.toLowerCase();
      if (e.shiftKey && e.altKey && k === "c") key = "codeblock";
      else if (e.shiftKey && k === "c") key = "code";
      else if (e.shiftKey && k === "s") key = "strike";
      else if (e.altKey && /^[123]$/.test(e.key)) key = "h" + e.key;
      else if (!e.shiftKey && !e.altKey && HOTKEY[k]) key = HOTKEY[k];
      if (key) {
        e.preventDefault();
        this._applyFmt(FMT.find((f) => f.key === key));
        return;
      }
    }
    {
      const s = window.getSelection();
      if (e.key === "Enter" && s.rangeCount) {
        const sc = s.getRangeAt(0).startContainer, n = sc.nodeType === 1 ? sc : sc.parentElement;
        if (n && n.closest && n.closest(".mde-fm-editable")) {
          e.preventDefault();
          return;
        }
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      const s = window.getSelection();
      if (s.rangeCount && this.root.contains(s.anchorNode)) {
        const sc = s.getRangeAt(0).startContainer, host = sc.nodeType === 1 ? sc : sc.parentElement;
        const special = host && host.closest && host.closest(".mde-trow > .mde-cell, .mde-code");
        if (!special) {
          e.preventDefault();
          const block = this._lineOf(s.getRangeAt(0).startContainer), info = block && parseListItem(block.dataset.pre);
          if (info) this._enterListItem(s, block, info);
          else this._enterFreshLine(s);
          return;
        }
      }
    }
    {
      const s = window.getSelection();
      if (s.rangeCount && this.root.contains(s.anchorNode)) {
        const block = this._lineOf(s.getRangeAt(0).startContainer), info = block && parseListItem(block.dataset.pre);
        if (info) {
          if (e.key === "Tab") {
            e.preventDefault();
            this._reindentListItem(block, indentListItem(info, e.shiftKey ? -1 : 1));
            return;
          }
          if (e.key === "Backspace" && s.isCollapsed && this._atBlockStart(block, s.getRangeAt(0))) {
            e.preventDefault();
            if (info.indent.length) this._reindentListItem(block, indentListItem(info, -1));
            else this._demoteToBody(block);
            return;
          }
        }
      }
    }
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    let node = sel.getRangeAt(0).startContainer;
    node = node.nodeType === 1 ? node : node.parentElement;
    const cell = node && node.closest ? node.closest(".mde-trow > .mde-cell") : null;
    if (!cell) return;
    const put = (td, mode) => {
      const cl = td.querySelector(".mde-clab") || td, r = document.createRange();
      r.selectNodeContents(cl);
      if (mode === "start") r.collapse(true);
      else if (mode === "end") r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
    };
    const tds = [].filter.call(cell.parentElement.children, (x) => x.classList && x.classList.contains("mde-cell"));
    const colIdx = tds.indexOf(cell);
    const edge = this._cellCaretEdge(cell.querySelector(".mde-clab") || cell);
    const wholeSel = !sel.isCollapsed && edge.atStart && edge.atEnd;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const target = tds[colIdx + (e.key === "ArrowRight" ? 1 : -1)];
      if (wholeSel) {
        if (target) {
          e.preventDefault();
          put(target, "whole");
        }
      } else if (e.key === "ArrowRight" && edge.atEnd && target) {
        e.preventDefault();
        put(target, "start");
      } else if (e.key === "ArrowLeft" && edge.atStart && target) {
        e.preventDefault();
        put(target, "end");
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const rows = [].slice.call(root.querySelectorAll("table.mde-table tr.mde-trow"));
      const target = rows[rows.indexOf(cell.parentElement) + (e.key === "ArrowDown" ? 1 : -1)];
      const tc = target && target.children[colIdx];
      if (tc) {
        e.preventDefault();
        put(tc, wholeSel ? "whole" : e.key === "ArrowDown" ? "start" : "end");
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
    } else if (e.key === "Tab") {
      e.preventDefault();
      const cells = [].slice.call(root.querySelectorAll(".mde-trow > .mde-cell"));
      const t = cells[cells.indexOf(cell) + (e.shiftKey ? -1 : 1)];
      if (t) {
        const clab = t.querySelector(".mde-clab") || t, r = document.createRange();
        r.selectNodeContents(clab);
        sel.removeAllRanges();
        sel.addRange(r);
      }
    } else if (e.key === "Backspace" || e.key === "Delete") {
      const tr = cell.closest("tr.mde-trow");
      const rowText = tr ? [].map.call(tr.querySelectorAll(":scope > td .mde-clab"), (c) => c.textContent).join("") : "x";
      if (rowText.length <= 1) {
        e.preventDefault();
        const rd = tr.querySelector(".mde-rowdelx");
        if (rd) {
          rd.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
          document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        }
      }
    }
  }
  _enterFreshLine(sel) {
    this.history.batch(() => {
      const r = sel.getRangeAt(0);
      if (!r.collapsed) r.deleteContents();
      const block = this._lineOf(r.startContainer);
      if (!block) return;
      const head = document.createRange();
      head.selectNodeContents(block);
      head.setEnd(r.startContainer, r.startOffset);
      if (head.toString() === "") {
        block.parentNode.insertBefore(el("div", "mde-ln mde-body"), block);
        return;
      }
      const tail = document.createRange();
      tail.selectNodeContents(block);
      tail.setStart(r.startContainer, r.startOffset);
      const moved = tail.extractContents();
      const fresh = el("div", "mde-ln mde-body");
      if (moved.textContent !== "") fresh.appendChild(moved);
      block.parentNode.insertBefore(fresh, block.nextSibling);
      const rg = document.createRange();
      rg.setStart(fresh, 0);
      rg.collapse(true);
      sel.removeAllRanges();
      sel.addRange(rg);
    });
    this._emit();
  }
  // ---- lists ----
  _listBlock(info) {
    const d = el("div", "mde-ln " + (info.kind === "bullet" ? "mde-li" : "mde-oli"));
    d.dataset.pre = listItemPre(info);
    if (info.kind === "ordered") d.dataset.num = info.num + info.dot;
    applyListDepth(d);
    return d;
  }
  // a line that can still turn into a list: no block prefix (heading/list/quote), not raw md (hr), not code/table.
  // Covers both `.mde-body` (typed line) and `.mde-blank` (fresh empty line the caret sits on) — the latter is why
  // the shortcut fires when you type "- " on a new line, the most common case.
  _isPlainLine(block) {
    return !!block && block.parentElement === this.root && block.dataset.pre == null && block.dataset.md == null && !block.classList.contains("mde-code") && !block.classList.contains("mde-tablewrap");
  }
  _isListItem(b) {
    return !!b && b.nodeType === 1 && (b.classList.contains("mde-li") || b.classList.contains("mde-oli"));
  }
  // renumber the whole contiguous list run `block` belongs to, hierarchically (each depth its own counter). Called
  // after any structural list edit so ordered markers stay 1,2,3… per level regardless of where the change landed.
  _renumberList(block) {
    if (!this._isListItem(block)) return;
    let first = block;
    while (this._isListItem(first.previousSibling)) first = first.previousSibling;
    const run = [];
    for (let b = first; this._isListItem(b); b = b.nextSibling) run.push(b);
    const infos = run.map((b) => parseListItem(b.dataset.pre));
    const nums = renumberOrdered(infos.map((info) => ({ ordered: info.kind === "ordered", depth: listDepth(listItemPre(info)) })));
    run.forEach((b, k) => {
      const info = infos[k];
      if (info.kind === "ordered" && nums[k] != null && info.num !== nums[k]) {
        b.dataset.pre = listItemPre({ ...info, num: nums[k] });
        b.dataset.num = nums[k] + info.dot;
      }
    });
  }
  _atBlockStart(block, r) {
    try {
      const pre = document.createRange();
      pre.selectNodeContents(block);
      pre.setEnd(r.startContainer, r.startOffset);
      return pre.toString().length === 0;
    } catch (_) {
      return false;
    }
  }
  _offsetInBlock(block, r) {
    try {
      const pre = document.createRange();
      pre.selectNodeContents(block);
      pre.setEnd(r.startContainer, r.startOffset);
      return pre.toString().length;
    } catch (_) {
      return -1;
    }
  }
  _reindentListItem(block, next) {
    this.history.batch(() => {
      block.dataset.pre = listItemPre(next);
      if (next.kind === "ordered") block.dataset.num = next.num + next.dot;
      applyListDepth(block);
      this._renumberList(block);
    });
    this._emit();
  }
  _demoteToBody(block) {
    this.history.batch(() => {
      const prev = block.previousSibling, nextSib = block.nextSibling;
      delete block.dataset.pre;
      delete block.dataset.num;
      block.className = "mde-ln mde-body";
      applyListDepth(block);
      this._renumberList(prev);
      this._renumberList(nextSib);
    });
    this._emit();
  }
  _enterListItem(sel, block, info) {
    const r = sel.getRangeAt(0);
    if (r.collapsed && block.textContent.trim() === "") {
      if (info.indent.length) this._reindentListItem(block, indentListItem(info, -1));
      else this._demoteToBody(block);
      return;
    }
    this.history.batch(() => {
      if (!r.collapsed) r.deleteContents();
      const tail = document.createRange();
      tail.selectNodeContents(block);
      tail.setStart(r.startContainer, r.startOffset);
      const moved = tail.extractContents();
      const next = this._listBlock(nextListItem(info));
      if (moved.textContent !== "") next.appendChild(moved);
      block.parentNode.insertBefore(next, block.nextSibling);
      this._renumberList(next);
      const rg = document.createRange();
      rg.setStart(next, 0);
      rg.collapse(true);
      sel.removeAllRanges();
      sel.addRange(rg);
    });
    this._emit();
  }
  // typing "- " / "* " / "N. " at the start of a plain line turns it into a list item the moment the space lands
  // (the caret must sit right after that prefix, so editing an existing "- word" line later never re-triggers).
  _maybeListShortcut() {
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed || !this.root.contains(sel.anchorNode)) return;
    const block = this._lineOf(sel.getRangeAt(0).startContainer);
    if (!this._isPlainLine(block)) return;
    const b = /^(\s*)([-*])( )/.exec(block.textContent), o = /^(\s*)(\d+)([.)])( )/.exec(block.textContent);
    const info = o ? { kind: "ordered", indent: o[1], num: parseInt(o[2], 10), dot: o[3], space: o[4] } : b ? { kind: "bullet", indent: b[1], bullet: b[2], space: b[3] } : null;
    if (!info) return;
    const prefixLen = (o || b)[0].length;
    const caret = sel.getRangeAt(0);
    if (this._offsetInBlock(block, caret) !== prefixLen) return;
    this.history.batch(() => {
      const del = document.createRange();
      del.selectNodeContents(block);
      del.setEnd(caret.startContainer, caret.startOffset);
      del.deleteContents();
      block.className = "mde-ln " + (info.kind === "bullet" ? "mde-li" : "mde-oli");
      block.dataset.pre = listItemPre(info);
      if (info.kind === "ordered") block.dataset.num = info.num + info.dot;
      applyListDepth(block);
      this._renumberList(block);
      const rg = document.createRange();
      rg.setStart(block, 0);
      rg.collapse(true);
      sel.removeAllRanges();
      sel.addRange(rg);
    });
  }
  // in a table, the caret must sit inside a cell — never in the gap between cells. Snap a stray collapsed caret
  // (from clicking the border-spacing gap, a bare <tr>, or a <td> outside its label) into the nearest cell.
  _normalizeTableCaret() {
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return;
    const a = sel.anchorNode;
    if (!a || !this.root.contains(a)) return;
    const anchorEl = a.nodeType === 1 ? a : a.parentElement;
    if (!anchorEl || anchorEl.closest(".mde-clab")) return;
    const table = anchorEl.closest("table.mde-table");
    if (!table) return;
    const dataRows = [].slice.call(table.querySelectorAll("tr.mde-trow"));
    let td = anchorEl.closest("td.mde-cell");
    if (!td) {
      const ctlCell = anchorEl.closest("td.mde-tctlcell"), tr = anchorEl.closest("tr.mde-trow");
      if (ctlCell) td = dataRows[0] && dataRows[0].children[ctlCell.cellIndex];
      else if (tr) {
        const cells = tr.querySelectorAll(":scope > td.mde-cell");
        const off = a === tr ? sel.anchorOffset : 0;
        td = cells[Math.max(0, Math.min(off - 1, cells.length - 1))];
      } else {
        const tbody = table.querySelector("tbody");
        const idx = anchorEl === tbody ? Math.max(0, sel.anchorOffset - 1) : 0;
        const row = dataRows[Math.min(idx, dataRows.length - 1)] || dataRows[0];
        td = row && row.children[0];
      }
    }
    const clab = td && td.querySelector(".mde-clab");
    if (!clab) return;
    const r = document.createRange();
    r.selectNodeContents(clab);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  }
  // is the caret at the very start / end of a cell's content? (used for edge-aware ←/→ cell hopping)
  _cellCaretEdge(clab) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return { atStart: false, atEnd: false };
    const r = sel.getRangeAt(0);
    let atStart = false, atEnd = false;
    try {
      const pre = document.createRange();
      pre.selectNodeContents(clab);
      pre.setEnd(r.startContainer, r.startOffset);
      atStart = pre.toString().length === 0;
    } catch (_) {
    }
    try {
      const post = document.createRange();
      post.selectNodeContents(clab);
      post.setStart(r.endContainer, r.endOffset);
      atEnd = post.toString().length === 0;
    } catch (_) {
    }
    return { atStart, atEnd };
  }
  // ---- run selection (click a run → select it whole) ----
  _tokenAt() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    const host = this.root, r = sel.getRangeAt(0);
    if (!host.contains(r.endContainer)) return null;
    const node = r.endContainer.nodeType === 3 ? r.endContainer.parentElement : r.endContainer;
    let tok = node;
    while (tok && tok !== host && !/^(B|STRONG|I|EM|U|INS|S|DEL|STRIKE|CODE)$/.test(tok.tagName) && !(tok.classList && tok.classList.contains("mde-link"))) tok = tok.parentElement;
    if (tok && tok !== host) return tok;
    let cell = node;
    while (cell && cell !== host && !(cell.classList && cell.classList.contains("mde-cell"))) cell = cell.parentElement;
    if (cell && cell !== host && cell.parentElement && cell.parentElement.classList.contains("mde-trow")) return cell.querySelector(".mde-clab") || cell;
    let ln = node;
    const head = (x) => x && x.classList && (x.classList.contains("mde-h") || x.classList.contains("mde-h2") || x.classList.contains("mde-h3"));
    while (ln && ln !== host && !head(ln)) ln = ln.parentElement;
    return ln && ln !== host ? ln : null;
  }
  _selectToken(tok) {
    const sel = window.getSelection(), rg = document.createRange();
    const whole = tok.classList && (tok.classList.contains("mde-clab") || tok.classList.contains("mde-h") || tok.classList.contains("mde-h2") || tok.classList.contains("mde-h3"));
    whole ? rg.selectNodeContents(tok) : rg.selectNode(tok);
    sel.removeAllRanges();
    sel.addRange(rg);
  }
  // ---- format bar ----
  _lineOf(nd) {
    let b = nd && (nd.nodeType === 1 ? nd : nd.parentElement);
    while (b && b.parentElement !== this.root) b = b.parentElement;
    return b && b.parentElement === this.root ? b : null;
  }
  // innermost element at the selection start — descends INTO the run when it's selectNode'd (start sits before the
  // wrapper), so a format nested inside the selection is seen. Without this, toggling B/I on a selected run walks
  // only up, misses the nested tag, and re-wraps instead of removing → runaway `**` nesting.
  _leafStart(r) {
    let e = r.startContainer;
    if (e.nodeType === 1) e = e.childNodes[r.startOffset] || e;
    while (e && e.nodeType === 1 && e.firstChild) e = e.firstChild;
    return e && e.nodeType === 3 ? e.parentElement : e;
  }
  _activeFormats(sel) {
    const res = {};
    if (!sel.rangeCount || !this.root.contains(sel.anchorNode)) return res;
    const r = sel.getRangeAt(0);
    for (let x = this._leafStart(r); x && x !== this.root; x = x.parentElement) {
      const tg = x.tagName;
      if (tg === "B" || tg === "STRONG") res.bold = 1;
      else if (tg === "CODE") res.code = 1;
      else if (tg === "I" || tg === "EM") res.italic = 1;
      else if (tg === "S" || tg === "DEL" || tg === "STRIKE") res.strike = 1;
      else if (tg === "U" || tg === "INS") res.underline = 1;
      if (x.classList && x.classList.contains("mde-link")) res.link = 1;
      if (x.classList && x.classList.contains("mde-code")) res.codeblock = 1;
      if (x.parentElement === this.root) {
        const pre = x.dataset && x.dataset.pre || "", hm = /^(#{1,6}) $/.exec(pre);
        if (hm) res["h" + Math.min(hm[1].length, 3)] = 1;
        else if (/^\s*[-*] /.test(pre)) res.bullet = 1;
        if (/^\s*\d+[.)] /.test(pre)) res.number = 1;
        if (/^\s*>+/.test(pre)) res.quote = 1;
      }
    }
    return res;
  }
  _linkAt(sel) {
    if (!sel.rangeCount || !this.root.contains(sel.anchorNode)) return null;
    const r = sel.getRangeAt(0);
    let x = r.startContainer.nodeType === 1 ? r.startContainer.childNodes[r.startOffset] || r.startContainer : r.startContainer.parentElement;
    for (; x && x !== this.root; x = x.parentElement) if (x.classList && x.classList.contains("mde-link")) return x;
    const c = r.commonAncestorContainer, host = c.nodeType === 1 ? c : c.parentElement;
    if (host) {
      for (const lk of host.querySelectorAll(".mde-link")) if (r.intersectsNode(lk)) return lk;
    }
    return null;
  }
  _buildFormatBar() {
    const bar = el("div", "mde-fmtbar");
    const tip = el("div", "mde-tip");
    document.body.appendChild(tip);
    this._tip = tip;
    const showTip = (btn, f) => {
      tip.textContent = f.name + (f.hot ? "  " + f.hot : "");
      tip.classList.add("on");
      const br = btn.getBoundingClientRect(), tr = tip.getBoundingClientRect();
      let left = Math.round(br.left + br.width / 2 - tr.width / 2);
      left = Math.max(4, Math.min(left, window.innerWidth - tr.width - 4));
      let top = Math.round(br.top - tr.height - 6);
      if (top < 4) top = Math.round(br.bottom + 6);
      tip.style.left = left + "px";
      tip.style.top = top + "px";
    };
    const hideTip = () => tip.classList.remove("on");
    const linkrow = el("div", "mde-fmtlink");
    const linkInput = el("input", "mde-fmturl");
    linkInput.type = "text";
    linkInput.placeholder = "URL";
    linkInput.addEventListener("input", () => this._applyLinkUrl(linkInput.value));
    linkInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        this.root.focus();
      }
    });
    const linkGo = el("button", "mde-fmtgo");
    linkGo.type = "button";
    linkGo.title = "\u041F\u0435\u0440\u0435\u0439\u0442\u0438 \u043F\u043E \u0441\u0441\u044B\u043B\u043A\u0435";
    linkGo.innerHTML = ICON.linkgo;
    linkGo.addEventListener("mousedown", (e) => {
      e.preventDefault();
      this._followActiveLink();
    });
    linkrow.appendChild(linkInput);
    linkrow.appendChild(linkGo);
    bar.appendChild(linkrow);
    this._linkrow = linkrow;
    this._linkInput = linkInput;
    const btnrow = el("div", "mde-fmtbtns");
    FMT.forEach((f) => {
      if (f.sep) {
        btnrow.appendChild(el("span", "mde-fmtsep"));
        return;
      }
      const cls = f.cls ? " " + f.cls.split(/\s+/).map((c) => "mde-" + c).join(" ") : "";
      const b = el("button", "mde-fmtbtn" + cls);
      b.dataset.key = f.key;
      renderGlyph(b, f);
      const removingLink = () => f.key === "link" && !!this._activeLink;
      b.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this._applyFmt(f);
        if (f.key === "link") renderGlyph(b, f);
      });
      b.addEventListener("mouseenter", () => {
        const rm = removingLink();
        showTip(b, rm ? { name: "\u0423\u0431\u0440\u0430\u0442\u044C \u0441\u0441\u044B\u043B\u043A\u0443" } : f);
        if (rm) b.innerHTML = ICON.remove;
      });
      b.addEventListener("mouseleave", () => {
        hideTip();
        if (f.key === "link") renderGlyph(b, f);
      });
      f._btn = b;
      btnrow.appendChild(b);
    });
    bar.appendChild(btnrow);
    document.body.appendChild(bar);
    this._bar = bar;
    const reposition = () => {
      if (bar.contains(document.activeElement)) return;
      const sel = window.getSelection();
      if (!this.editable || !sel.rangeCount || sel.isCollapsed || !this.root.contains(sel.anchorNode)) {
        bar.classList.remove("on");
        hideTip();
        return;
      }
      bar.classList.add("on");
      const active = this._activeFormats(sel);
      const link = this._linkAt(sel);
      active.link = !!link;
      FMT.forEach((f) => {
        if (f._btn) f._btn.classList.toggle("mde-active", !!active[f.key]);
      });
      this._activeLink = link;
      linkrow.classList.toggle("on", !!link);
      if (link) linkInput.value = link.dataset.href || "";
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      const bw = bar.offsetWidth, bh = bar.offsetHeight, m = 6;
      let left = Math.round(rect.left + rect.width / 2 - bw / 2);
      left = Math.max(m, Math.min(left, window.innerWidth - bw - m));
      let top = Math.round(rect.top - bh - 8);
      if (top < m) top = Math.round(rect.bottom + 8);
      top = Math.max(m, Math.min(top, window.innerHeight - bh - m));
      bar.style.left = left + "px";
      bar.style.top = top + "px";
    };
    this._onPersist(document, "selectionchange", reposition);
    this._onPersist(window, "scroll", reposition, true);
  }
  _applyFmt(f) {
    if (f.key === "table") {
      this._insertTableAtCaret();
      return;
    }
    const sel = window.getSelection();
    if (!sel.rangeCount || !this.root.contains(sel.anchorNode)) return;
    if (f.key === "link") {
      const lk = this._linkAt(sel);
      if (lk) {
        this._removeLink(lk);
        return;
      }
    }
    if (f.key === "codeblock") {
      this._toggleCodeBlock(sel);
      return;
    }
    if (f.pre) {
      this._applyLineFmt(f, sel);
      return;
    }
    if (sel.isCollapsed) return;
    const active = this._activeFormats(sel);
    if (active[f.key] && FMT_TAG[f.key]) {
      this._removeInlineFmt(f, sel);
      return;
    }
    if (f.key === "link") {
      this._insertLink(sel);
      return;
    }
    if (WRAP_TAG[f.key]) {
      this._wrapInline(f, sel);
    }
  }
  _wrapInline(f, sel) {
    this.history.batch(() => {
      const r = sel.getRangeAt(0), elm = document.createElement(WRAP_TAG[f.key]);
      if (f.key === "code") {
        elm.textContent = r.toString();
        r.deleteContents();
      } else elm.appendChild(r.extractContents());
      r.insertNode(elm);
      const rg = document.createRange();
      rg.selectNode(elm);
      sel.removeAllRanges();
      sel.addRange(rg);
    });
    this._emit();
  }
  _removeInlineFmt(f, sel) {
    const rx = FMT_TAG[f.key];
    if (!rx) return;
    const r = sel.getRangeAt(0);
    let fel = this._leafStart(r);
    while (fel && fel !== this.root && !rx.test(fel.tagName)) fel = fel.parentElement;
    if (!fel || fel === this.root) return;
    this.history.batch(() => {
      const parent = fel.parentNode, first = fel.firstChild, last = fel.lastChild;
      while (fel.firstChild) parent.insertBefore(fel.firstChild, fel);
      parent.removeChild(fel);
      if (first) {
        const rg = document.createRange();
        rg.setStartBefore(first);
        rg.setEndAfter(last);
        sel.removeAllRanges();
        sel.addRange(rg);
      }
    });
    this._emit();
  }
  _insertLink(sel) {
    const text = sel.toString();
    if (!text) return;
    const href = prompt("URL:", "https://");
    if (!href) return;
    this._insertLinkWith(sel.getRangeAt(0), text, href);
  }
  _makeLink(text, href) {
    const span = el("span", "mde-link" + (this.linkResolver && this.linkResolver(href) ? " mde-link-live" : " mde-link-plain"));
    span.textContent = text;
    span.dataset.md = "[" + text + "](" + href + ")";
    span.dataset.href = href;
    return span;
  }
  _insertLinkWith(range, text, href) {
    this.history.batch(() => {
      const span = this._makeLink(text, href);
      range.deleteContents();
      range.insertNode(span);
      const rg = document.createRange();
      rg.selectNode(span);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(rg);
    });
    this._emit();
  }
  _isUrl(s) {
    return /^https?:\/\/\S+$/i.test(s) || /^www\.\S+$/i.test(s);
  }
  // a lone URL token (no inner whitespace) — a paragraph won't match
  _onPaste(e) {
    const cd = e.clipboardData;
    if (!cd) return;
    const text = (cd.getData("text/plain") || cd.getData("text") || "").replace(/\r\n?/g, "\n");
    const html = cd.getData("text/html") || "";
    if (!text && !html) return;
    const sel = window.getSelection();
    if (!sel.rangeCount || !this.root.contains(sel.anchorNode)) return;
    const host = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    if (host && host.closest && host.closest(".mde-fmwrap")) return;
    const url = text.trim();
    e.preventDefault();
    if (this._isUrl(url)) {
      this._insertLinkWith(sel.getRangeAt(0), sel.toString() || url, url);
      return;
    }
    let md = text;
    if (html.trim()) {
      const conv = htmlToMarkdown(html);
      if (conv.trim()) md = conv;
    }
    this._pasteMarkdown(md, sel.getRangeAt(0));
  }
  // Paste = plain text spliced into the source at the caret, then re-rendered. Routing through render is what makes
  // pasted content match Kasimov: it drops any foreign inline styling (colour/size the browser would carry from HTML)
  // and turns markdown lines (`- `, `1.`, `#`) into real styled blocks. \uE000 marks the caret in the source; the
  // pasted text + \uE001 (end-of-paste caret) are spliced there; after render we drop \uE001 and land the caret on it.
  _pasteMarkdown(text, range) {
    this.history.batch(() => {
    });
    range.deleteContents();
    range.insertNode(document.createTextNode("\uE000"));
    const marked = this.getValue(), at = marked.indexOf("\uE000");
    if (at < 0) {
      this._render();
      return;
    }
    const before = marked.slice(0, at), after = marked.slice(at + 1);
    const block = /\n/.test(text) || /^\s*(#{1,6}\s|[-*]\s|\d+[.)]\s|>\s|```)/.test(text);
    const pre = block && before && !before.endsWith("\n") && !text.startsWith("\n") ? "\n" : "";
    const post = block && after && !after.startsWith("\n") && !text.endsWith("\n") ? "\n" : "";
    this._value = before + pre + text + "\uE001" + post + after;
    this._render();
    this._landCaretAtMark("\uE001");
    this._emit();
  }
  _landCaretAtMark(mark) {
    const walk = document.createTreeWalker(this.root);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (n.nodeType !== 3) continue;
      const i = n.data.indexOf(mark);
      if (i < 0) continue;
      n.data = n.data.slice(0, i) + n.data.slice(i + mark.length);
      const sel = window.getSelection(), rg = document.createRange();
      rg.setStart(n, i);
      rg.collapse(true);
      sel.removeAllRanges();
      sel.addRange(rg);
      break;
    }
    this._value = this.getValue();
  }
  _applyLinkUrl(href) {
    const lk = this._activeLink;
    if (!lk) return;
    this.history.recordInput();
    lk.dataset.href = href;
    const live = !!(this.linkResolver && this.linkResolver(href));
    lk.classList.toggle("mde-link-live", live);
    lk.classList.toggle("mde-link-plain", !live);
    this._emit();
  }
  _removeLink(lk) {
    this.history.batch(() => {
      const parent = lk.parentNode, first = lk.firstChild, last = lk.lastChild;
      while (lk.firstChild) parent.insertBefore(lk.firstChild, lk);
      parent.removeChild(lk);
      if (first) {
        const rg = document.createRange();
        rg.setStartBefore(first);
        rg.setEndAfter(last);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(rg);
      }
    });
    this._emit();
  }
  _followActiveLink() {
    const lk = this._activeLink;
    if (!lk) return;
    const href = lk.dataset.href || "";
    const r = this.linkResolver && this.linkResolver(href);
    if (r && r.onClick) {
      r.onClick();
      return;
    }
    if (href) window.open(href, "_blank", "noopener");
  }
  // toggle a line-level format on every line block the selection touches — rebuilt from source so it never double-prefixes
  _applyLineFmt(f, sel) {
    const r = sel.getRangeAt(0);
    let blocks = [].filter.call(this.root.children, (b) => b.nodeType === 1 && b.dataset.md == null && !b.classList.contains("mde-ctl") && !b.classList.contains("mde-table") && r.intersectsNode(b));
    if (!blocks.length) {
      const one = this._lineOf(r.startContainer);
      if (one && one.dataset.md == null) blocks = [one];
    }
    if (!blocks.length) return;
    const remove = !!this._activeFormats(sel)[f.key];
    this.history.batch(() => {
      let first = null, last = null;
      blocks.forEach((b) => {
        const content = inlineMd(b).replace(/^\d+\.\s+/, "").replace(/^>\s+/, "");
        const fresh = lineBlock(remove ? content : f.b + content, this.linkResolver, this.atLinks);
        if (!first) first = fresh;
        last = fresh;
        b.parentNode.replaceChild(fresh, b);
      });
      const rng = document.createRange();
      rng.setStart(first, 0);
      rng.setEnd(last, last.childNodes.length);
      sel.removeAllRanges();
      sel.addRange(rng);
    });
    this._emit();
  }
  // ``` fenced code block — a whole-line tag, distinct from inline `code`. Toggle: lines → fence, or fence → lines.
  _toggleCodeBlock(sel) {
    const r = sel.getRangeAt(0);
    const node = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
    const pre = node && node.closest ? node.closest("pre.mde-code") : null;
    if (pre) {
      this._unwrapCodeBlock(pre);
      return;
    }
    let blocks = [].filter.call(this.root.children, (b) => b.nodeType === 1 && b.dataset.md == null && !b.classList.contains("mde-ctl") && !b.classList.contains("mde-tablewrap") && r.intersectsNode(b));
    if (!blocks.length) {
      const one = this._lineOf(r.startContainer);
      if (one && one.dataset.md == null) blocks = [one];
    }
    if (!blocks.length) return;
    const text = blocks.map((b) => (b.dataset && b.dataset.pre ? b.dataset.pre : "") + inlineMd(b)).join("\n");
    this.history.batch(() => {
      const pre2 = el("pre", "mde-ln mde-code");
      pre2.dataset.open = "```";
      pre2.dataset.close = "```";
      pre2.textContent = text;
      blocks[0].parentNode.insertBefore(pre2, blocks[0]);
      blocks.forEach((b) => b.remove());
      const rg = document.createRange();
      rg.selectNodeContents(pre2);
      sel.removeAllRanges();
      sel.addRange(rg);
    });
    this._emit();
  }
  _unwrapCodeBlock(pre) {
    const lines = blockText(pre).replace(/\n$/, "").split("\n");
    this.history.batch(() => {
      const frag = document.createDocumentFragment();
      let first = null;
      lines.forEach((ln) => {
        const b = lineBlock(ln, this.linkResolver, this.atLinks);
        if (!first) first = b;
        frag.appendChild(b);
      });
      pre.parentNode.replaceChild(frag, pre);
      if (first) {
        const rg = document.createRange();
        rg.selectNodeContents(first);
        rg.collapse(true);
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(rg);
      }
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
        headers = text.split(/\s+/);
        range.deleteContents();
      }
      if (blk) {
        ref = blk.nextSibling;
        if (text && !blk.textContent.trim()) blk.remove();
      }
    }
    insertStarterTable(this.root, ref, this._tableCtx(this.root), headers);
  }
  // ---- path picker plugin ("/" path, "@" @import) ----
  _updatePathPicker(root) {
    this._closePathPicker();
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return;
    const node = sel.anchorNode;
    if (!node || node.nodeType !== 3) return;
    const before = node.textContent.slice(0, sel.anchorOffset);
    const m = /([\/@])([^\s\/@]*)$/.exec(before);
    if (!m) return;
    const mode = m[1] === "@" ? "import" : "path", query = m[2];
    const items = (this.pathProvider(query, mode) || []).slice(0, 8);
    if (!items.length) return;
    const dd = el("div", "mde-pathdd");
    dd.setAttribute("contenteditable", "false");
    this._ppItems = items;
    this._ppNode = node;
    this._ppMatch = m;
    this._ppMode = mode;
    this._ppRows = [];
    this._ppIdx = 0;
    items.forEach((it, i) => {
      const row = el("div", "mde-pathrow");
      row.appendChild(el("span", "mde-pathname", it.label || it.path));
      if (it.comment) row.appendChild(el("span", "mde-pathcmt", it.comment));
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this._acceptPathPick(i);
      });
      dd.appendChild(row);
      this._ppRows.push(row);
    });
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    dd.style.left = Math.round(rect.left) + "px";
    dd.style.top = Math.round(rect.bottom + 4) + "px";
    document.body.appendChild(dd);
    this._pathdd = dd;
    this._highlightPathPick();
  }
  _highlightPathPick() {
    if (this._ppRows) this._ppRows.forEach((r, i) => r.classList.toggle("mde-on", i === this._ppIdx));
  }
  // shared insert logic — used by both a mouse click on a row and Enter with a row keyboard-selected
  _acceptPathPick(i) {
    const it = this._ppItems && this._ppItems[i];
    if (!it) return;
    const node = this._ppNode, m = this._ppMatch, mode = this._ppMode;
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const insert = mode === "import" ? "@" + it.path : it.path;
    const start = sel.anchorOffset - m[0].length;
    this.history.batch(() => {
      node.textContent = node.textContent.slice(0, start) + insert + node.textContent.slice(sel.anchorOffset);
    });
    const r = document.createRange();
    r.setStart(node, start + insert.length);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    this._closePathPicker();
    this._emit();
  }
  _closePathPicker() {
    if (this._pathdd) {
      this._pathdd.remove();
      this._pathdd = null;
    }
    this._ppItems = null;
    this._ppRows = null;
  }
  // ---- save shell (diff confirm) ----
  _openSaveDiff() {
    if (document.getElementById("mde-diffmodal")) return;
    const cur = this.getValue();
    const box = el("div", "mde-modalbox");
    box.appendChild(el("div", "mde-modaltitle", "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F?"));
    const pre = el("pre", "mde-modaldiff");
    pre.textContent = cur;
    box.appendChild(pre);
    const btns = el("div", "mde-modalbtns");
    const mk = (label, cls, fn) => {
      const b = el("button", "mde-modalbtn" + (cls ? " " + cls : ""), label);
      b.addEventListener("click", fn);
      return b;
    };
    const wrap = el("div", "mde-modal");
    wrap.id = "mde-diffmodal";
    btns.appendChild(mk("\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C", "mde-primary", (e) => {
      const b = e.currentTarget;
      b.textContent = "\u0421\u043E\u0445\u0440\u0430\u043D\u044F\u044E\u2026";
      b.disabled = true;
      Promise.resolve(this.onSave(cur)).then(() => wrap.remove()).catch((err) => {
        b.disabled = false;
        b.textContent = "\u041E\u0448\u0438\u0431\u043A\u0430 \u2014 \u043F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C";
        if (window.console) console.error(err);
      });
    }));
    btns.appendChild(mk("\u041E\u0442\u043C\u0435\u043D\u0430", "", () => wrap.remove()));
    box.appendChild(btns);
    wrap.appendChild(box);
    document.body.appendChild(wrap);
  }
};

// editor/shell/composer-md-adapter.js
function createAdapter(env) {
  var legacy = createLegacyEditor(env);
  var instances = [];
  var sweepScheduled = false;
  var pendingCaretAt = null;
  function destroyEntry(e) {
    try {
      e.mde.destroy();
    } catch (err) {
    }
  }
  function sweep() {
    instances = instances.filter(function(e) {
      if (e.host.isConnected) return true;
      destroyEntry(e);
      return false;
    });
  }
  function scheduleSweep() {
    if (sweepScheduled) return;
    sweepScheduled = true;
    Promise.resolve().then(function() {
      sweepScheduled = false;
      sweep();
    });
  }
  function placeCaretAt(host, x, y) {
    if (!document.caretRangeFromPoint) return false;
    var range = document.caretRangeFromPoint(x, y);
    if (!range || !host.contains(range.startContainer)) return false;
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  }
  function mkLinkResolver(n, colIndex) {
    if (env.linkResolver) return env.linkResolver;
    var linkBy = {};
    (n.links || []).forEach(function(l) {
      if (l.label != null && !(l.label in linkBy)) linkBy[l.label] = l;
    });
    return function(href) {
      var l = linkBy[href];
      if (!l || !l.target) return null;
      var target = l.target.indexOf("root:") === 0 ? env.rootEntry(l.target.slice(5)) : env.node(l.target);
      if (!target) return null;
      return { label: target.name || href, onClick: function() {
        env.drillTo(colIndex, l.target);
      } };
    };
  }
  return {
    bodyOf: function(n, colIndex) {
      scheduleSweep();
      if (!n.editable) return legacy.bodyOf(n, colIndex);
      var live = env.getEditing() === n.id;
      if (!live) {
        var ro = env.el("div", "cg-sec cg-mdbody cg-mdhost");
        var roOpts = { value: env.contentOf(n), editable: false, linkResolver: mkLinkResolver(n, colIndex), frontmatter: env.frontmatter, atLinks: env.atLinks !== false };
        ro._mde = new MarkdownEditor(ro, roOpts);
        instances.push({ host: ro, mde: ro._mde });
        ro.addEventListener("mousedown", function(e) {
          if (e.target.closest && e.target.closest(".mde-link")) return;
          e.preventDefault();
          pendingCaretAt = { id: n.id, x: e.clientX, y: e.clientY };
          env.setSnapshot(env.contentOf(n));
          env.setEditing(n.id);
          env.render();
        });
        return ro;
      }
      var host = env.el("div", "cg-sec cg-mdbody cg-mdhost cg-edit cg-live");
      host.dataset.hkey = "body:" + n.id;
      host.addEventListener("beforeinput", env.recordInput, true);
      var mdeOpts = {
        value: env.contentOf(n),
        editable: true,
        history: false,
        // the app owns undo
        onBeforeChange: function() {
          env.record && env.record("edit");
        },
        // the format bar/tables/"/"-insert don't send beforeinput — checkpoint manually, before the mutation
        onChange: function(md) {
          env.edits[n.id] = md;
          env.noteEdit && env.noteEdit(n);
        },
        // commit (the value includes front matter); autosave hook (no-op in manual)
        pathProvider: env.pathProvider || function(query, mode) {
          return env.nodeMatches(query).map(function(nd) {
            return { path: nd.path, label: nd.name || nd.path.split("/").pop(), comment: nd.kind };
          });
        },
        linkResolver: mkLinkResolver(n, colIndex),
        // clicking a link in the body → drill into the graph (or env.linkResolver directly — minimal env)
        onSave: env.onSave || void 0,
        // minimal env (create-editor.js): ⌘S → md-editor's own save-diff dialog
        followLinks: env.followLinks,
        // clicking a link → navigates (linkResolver.onClick) instead of selecting the token
        frontmatter: env.frontmatter,
        // front matter as a grid (on by default; env.frontmatter=false doesn't show it at all)
        atLinks: env.atLinks !== false
        // `@path` (Claude @import) is recognized — on by default; env.atLinks=false → plain text
      };
      function settleCaret() {
        if (!host.isConnected) return;
        if (pendingCaretAt && pendingCaretAt.id === n.id) {
          host._mde.focus({ preventScroll: true });
          var landed = placeCaretAt(host, pendingCaretAt.x, pendingCaretAt.y);
          pendingCaretAt = null;
          if (landed) host._mde.root.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        }
      }
      host._mde = new MarkdownEditor(host, mdeOpts);
      instances.push({ host, mde: host._mde });
      Promise.resolve().then(settleCaret);
      return host;
    },
    setupFormatBar: function() {
    },
    // md-editor owns the format bar now — viewer's boot still calls this, keep it a no-op
    attachPathPicker: legacy.attachPathPicker,
    closeMenus: legacy.closeMenus
  };
}

// editor/create-editor.js
var NODE_ID = "root";
function createEditor(hostEl, opts) {
  opts = opts || {};
  var node = { id: NODE_ID, editable: true, links: [] };
  var draft = { value: opts.value != null ? opts.value : "" };
  var snapshot = draft.value;
  var editingId = opts.editable ? NODE_ID : null;
  function contentOf(n) {
    return Object.prototype.hasOwnProperty.call(env.edits, n.id) ? env.edits[n.id] : draft.value;
  }
  function getEditing() {
    return editingId;
  }
  function setEditing(v) {
    if (opts.editable) editingId = v;
  }
  function getSnapshot() {
    return snapshot;
  }
  function setSnapshot(v) {
    snapshot = v;
  }
  function closeModal() {
    var m = document.getElementById("cg-diffmodal");
    if (m) m.remove();
  }
  function el2(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }
  function render() {
    hostEl.innerHTML = "";
    hostEl.appendChild(adapter.bodyOf(node, 0));
  }
  var env = {
    el: el2,
    node: function(id) {
      return id === NODE_ID ? node : null;
    },
    // graph stand-in — unreachable: mkLinkResolver short-circuits on env.linkResolver
    rootEntry: function() {
      return null;
    },
    // graph stand-in — same as above
    contentOf,
    drillTo: function() {
    },
    // graph stand-in — same as above
    render,
    splitFront: function(s) {
      return { fm: "", body: s || "" };
    },
    // only reachable via KasiEditorLegacy, which this node's `editable: true` never routes to
    nodeMatches: function() {
      return [];
    },
    // only reachable when env.pathProvider is absent
    edits: {},
    getEditing,
    setEditing,
    getSnapshot,
    setSnapshot,
    closeModal,
    linkResolver: opts.linkResolver || null,
    followLinks: opts.followLinks === true,
    // clicking a link → navigates instead of selecting the token (see md-editor followLinks)
    atLinks: opts.atLinks !== false,
    // recognizing `@path` (Claude @import) — on by default; false → renders as plain text
    frontmatter: opts.frontmatter !== false,
    // front matter as a grid — on by default; pass false to not show it at all (the value is preserved)
    pathProvider: opts.pathProvider ? function(query, mode) {
      return opts.pathProvider(query, mode) || [];
    } : null,
    onSave: opts.onSave || null,
    noteEdit: function(n) {
      if (opts.onChange) opts.onChange(contentOf(n));
    }
    // delivered synchronously — see header comment on why this bypasses KasiEditShell's autosave hook
  };
  var history = createHistory({
    getState: function() {
      return { value: contentOf(node) };
    },
    setState: function(s) {
      draft.value = s.value;
      delete env.edits[NODE_ID];
    },
    render,
    blocked: function() {
      return false;
    }
  });
  env.record = history.record;
  env.recordInput = history.recordInput;
  env.batch = history.batch;
  createEditShell(env);
  var adapter = createAdapter(env);
  render();
  return {
    getValue: function() {
      return contentOf(node);
    },
    setValue: function(v) {
      draft.value = v == null ? "" : v;
      delete env.edits[NODE_ID];
      render();
    },
    focus: function(o) {
      var mounted = hostEl.firstElementChild;
      if (mounted && mounted._mde) mounted._mde.focus(o);
    },
    undo: function() {
      return history.undo();
    },
    destroy: function() {
      var mounted = hostEl.firstElementChild;
      if (mounted && mounted._mde) {
        try {
          mounted._mde.destroy();
        } catch (e) {
        }
      }
      hostEl.innerHTML = "";
      history.destroy();
    }
  };
}

// editor/shell/composer-workflow.js
var composer_workflow_exports = {};
__export(composer_workflow_exports, {
  EFFORTS: () => EFFORTS,
  MIRROR_OPEN: () => MIRROR_OPEN,
  MODELS: () => MODELS,
  MODES: () => MODES,
  blankAgent: () => blankAgent,
  blankContainer: () => blankContainer,
  blankPhase: () => blankPhase,
  blankTree: () => blankTree,
  compile: () => compile
});
var MIRROR_OPEN = "/* @composer-workflow";
var MIRROR_CLOSE = "*/";
var MODELS = ["", "sonnet", "opus", "haiku", "fable", "claude-opus-4-8", "claude-opus-5", "claude-sonnet-5", "claude-fable-5", "claude-haiku-4-5-20251001"];
var EFFORTS = ["", "low", "medium", "high", "xhigh", "max"];
var MODES = ["single", "parallel", "pipeline"];
function dq(s) {
  return JSON.stringify(String(s == null ? "" : s));
}
function promptLiteral(s, allowPrev) {
  var esc = String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
  esc = esc.replace(/\{\{prev\}\}/g, allowPrev ? "${prev}" : "");
  return "`" + esc + "`";
}
function pad(level) {
  return new Array(level + 1).join("  ");
}
function agentOpts(a) {
  var parts = [];
  if (a.label) parts.push("label: " + dq(a.label));
  if (a.agentType) parts.push("agentType: " + dq(a.agentType));
  if (a.model) parts.push("model: " + dq(a.model));
  if (a.effort) parts.push("effort: " + dq(a.effort));
  if (a.schema && a.schema.trim()) parts.push("schema: " + a.schema.trim());
  return parts.length ? "{ " + parts.join(", ") + " }" : "{}";
}
function agentExpr(a, allowPrev) {
  return "agent(" + promptLiteral(a.prompt, allowPrev) + ", " + agentOpts(a) + ")";
}
function stepExpr(step, level, allowPrev) {
  if (step.type === "container") return modeExpr(step.mode, step.steps, level);
  return agentExpr(step, allowPrev);
}
function modeExpr(mode, steps, level) {
  steps = steps || [];
  if (mode === "single" || steps.length === 1 && mode !== "pipeline" && mode !== "parallel")
    return stepExpr(steps[0] || blankAgent(), level, false);
  if (mode === "parallel") {
    var thunks = steps.map(function(s) {
      return pad(level + 1) + "() => " + stepExpr(s, level + 1, false);
    });
    return "parallel([\n" + thunks.join(",\n") + ",\n" + pad(level) + "])";
  }
  var stages = steps.map(function(s) {
    return pad(level + 1) + "(prev) => " + stepExpr(s, level + 1, s.type !== "container");
  });
  return "pipeline([null],\n" + stages.join(",\n") + ",\n" + pad(level) + ")";
}
function phaseBody(phase) {
  var steps = phase.steps && phase.steps.length ? phase.steps : [blankAgent()];
  var mode = phase.mode || "single";
  var expr = modeExpr(mode === "single" && steps.length > 1 ? "parallel" : mode, steps, 1);
  var lines = ["  phase(" + dq(phase.title || "Phase") + ")"];
  var budget = phase.repeatBudget;
  if (budget != null && budget > 0) {
    lines.push("  while (budget.total && budget.remaining() > " + Math.round(budget) + ") {");
    lines.push("    await " + indentContinuation(expr, 2));
    lines.push("  }");
  } else {
    lines.push("  await " + indentContinuation(expr, 1));
  }
  return lines.join("\n");
}
function indentContinuation(expr, level) {
  return expr;
}
function metaBlock(tree) {
  var phases = (tree.phases || []).map(function(p) {
    return "    { title: " + dq(p.title || "Phase") + " },";
  });
  var ph = phases.length ? "\n" + phases.join("\n") + "\n  " : "";
  return "export const meta = {\n  name: " + dq(tree.name || "workflow") + ",\n  description: " + dq(tree.description || "") + ",\n  phases: [" + ph + "],\n}";
}
function compile(tree) {
  tree = tree || blankTree("workflow");
  var body = (tree.phases || []).map(phaseBody).join("\n\n");
  var mirror = MIRROR_OPEN + "\n" + JSON.stringify(tree, null, 2) + "\n" + MIRROR_CLOSE + "\n";
  return metaBlock(tree) + "\n\n" + body + "\n\n" + mirror;
}
function blankAgent() {
  return { type: "agent", label: "", prompt: "", model: "", effort: "", agentType: "", schema: "" };
}
function blankContainer(mode) {
  return { type: "container", mode: mode || "parallel", steps: [blankAgent()] };
}
function blankPhase(title) {
  return { title: title || "Phase", mode: "single", repeatBudget: null, steps: [blankAgent()] };
}
function blankTree(name) {
  return { name: name || "workflow", description: "", phases: [blankPhase("Phase 1")] };
}
export {
  createEditor,
  composer_workflow_exports as workflow
};
