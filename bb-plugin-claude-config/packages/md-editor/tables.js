// tables.js — edit-mode controls for a native <table> (built by markdown.js). Nothing floats over the table:
// controls are real table elements. Column width, alignment and the resize grip all ride the <colgroup>, so
// they share the browser's column geometry — no manual sync, no overlay.
//
//   • a control ROW (first <tr>) holds each column's "⋯" menu (alignment + delete) and, when wide, an inline ✕
//   • a resize GRIP sits inside every cell on its right border (in the gap between columns)
//   • delete-row ✕ sits in each row's first cell, out in the left margin
//   • add-column / add-row live on the wrapper, out in the right / bottom margin
//
// The "⋯" cell and the delete-row ✕ double as drag handles: press-and-move REORDERS the column / row, while a
// press released without moving fires the click action (open menu / delete). Structure ops rewrite the markdown
// SOURCE (ctx.getBody/ctx.setBody) and let the editor re-render.

import { el, buildTable, findTables, readModel, writeModel } from "./markdown.js";

function ctlBtn(txt, title, fn) {
  const b = el("span", "mde-ctl mde-tctl-btn", txt); b.title = title; b.setAttribute("contenteditable", "false");
  b.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
  return b;
}

function editTable(ctx, ti, fn) {
  const lines = ctx.getBody().split("\n"), t = findTables(lines)[ti];
  if (!t) return; const m = readModel(lines, t); if (fn(m) === false) return;
  const repl = (m.rows.length === 0 || m.specs.length === 0) ? [] : writeModel(m);   // last row/column removed → drop the whole table
  ctx.setBody(lines.slice(0, t.s).concat(repl, lines.slice(t.e + 1)).join("\n"));
}

const DRAG_THRESH = 4;   // px of pointer movement before a press counts as a drag rather than a click

// A press on a control that acts as EITHER a click (menu / delete) or a drag (reorder): the action fires on
// mouseup only when the pointer didn't move past the threshold — any real drag suppresses it.
function pressDragClick(handle, { onClick, onDragMove, onDragEnd }) {
  handle.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, y0 = e.clientY;
    let dragging = false;
    const prevSel = document.body.style.userSelect, prevCur = document.body.style.cursor;
    const move = (ev) => {
      if (!dragging && Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) > DRAG_THRESH) {
        dragging = true; document.body.style.userSelect = "none"; document.body.style.cursor = "grabbing";
      }
      if (dragging && onDragMove) onDragMove(ev);
    };
    const up = (ev) => {
      document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up);
      document.body.style.userSelect = prevSel; document.body.style.cursor = prevCur;
      if (dragging) { if (onDragEnd) onDragEnd(ev); } else if (onClick) onClick(ev);
    };
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
  });
}

function arrayMove(arr, from, insertAt) {
  const [x] = arr.splice(from, 1);
  arr.splice(insertAt > from ? insertAt - 1 : insertAt, 0, x);   // insertAt is an insertion index in the ORIGINAL array
}

// where would a drop at pointer `pos` land? returns an insertion index in [0..n] (before element k, or after last)
function dropIndex(rects, pos, axis) {
  for (let k = 0; k < rects.length; k++) {
    const mid = axis === "x" ? rects[k].left + rects[k].width / 2 : rects[k].top + rects[k].height / 2;
    if (pos < mid) return k;
  }
  return rects.length;
}
// `box` is the DATA-body bounding rect (excludes the control ⋯ row and the outer spacing), so the indicator stays
// strictly inside the table: a column line spans the body's height, a row line spans the body's width.
function showLine(line, wrap, box, pos, axis) {
  const wr = wrap.getBoundingClientRect(); line.style.display = "block";
  if (axis === "x") { line.style.left = (pos - wr.left) + "px"; line.style.top = (box.top - wr.top) + "px"; line.style.width = "2px"; line.style.height = (box.bottom - box.top) + "px"; }
  else { line.style.top = (pos - wr.top) + "px"; line.style.left = (box.left - wr.left) + "px"; line.style.height = "2px"; line.style.width = (box.right - box.left) + "px"; }
}

export function closeMenus() {
  [].forEach.call(document.querySelectorAll(".mde-menu"), (mn) => { if (mn._cleanup) mn._cleanup(); mn.remove(); });
}

// dropdown for a column's "⋯": all options (alignment + delete), since three icons no longer fit inline
function openColMenu(anchor, ci, ti, ctx, curAlign) {
  closeMenus();
  const menu = el("div", "mde-ctl mde-menu"); menu.setAttribute("contenteditable", "false");
  const item = (label, active, danger, fn) => {
    const row = el("div", "mde-menurow" + (active ? " mde-on" : "") + (danger ? " mde-danger" : ""), label);
    row.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); closeMenus(); fn(); });
    menu.appendChild(row);
  };
  const isL = (curAlign || "l") === "l";
  item("Align left", isL, false, () => editTable(ctx, ti, (m) => { if (m.specs[ci]) m.specs[ci].align = "l"; }));
  item("Align center", curAlign === "c", false, () => editTable(ctx, ti, (m) => { if (m.specs[ci]) m.specs[ci].align = "c"; }));
  item("Align right", curAlign === "r", false, () => editTable(ctx, ti, (m) => { if (m.specs[ci]) m.specs[ci].align = "r"; }));
  menu.appendChild(el("div", "mde-menusep"));
  item("Delete column", false, true, () => editTable(ctx, ti, (m) => { m.specs.splice(ci, 1); m.rows.forEach((r) => r.splice(ci, 1)); }));
  document.body.appendChild(menu);
  const br = anchor.getBoundingClientRect(), mw = menu.offsetWidth, mh = menu.offsetHeight, gap = 6;
  const left = Math.max(gap, Math.min(Math.round(br.left), window.innerWidth - mw - gap));
  let top = Math.round(br.bottom + 4); if (top + mh > window.innerHeight - gap) top = Math.round(br.top - mh - 4);
  menu.style.left = left + "px"; menu.style.top = Math.max(gap, top) + "px";
  const onDoc = (e) => { if (!menu.contains(e.target)) closeMenus(); };
  const onKey = (e) => { if (e.key === "Escape") closeMenus(); };
  setTimeout(() => { document.addEventListener("mousedown", onDoc, true); document.addEventListener("keydown", onKey, true); }, 0);
  menu._cleanup = () => { document.removeEventListener("mousedown", onDoc, true); document.removeEventListener("keydown", onKey, true); };
}

// headers: optional array of column titles (one per selected word). Falls back to a 2-column starter.
export function insertStarterTable(root, ref, ctx, headers) {
  const cols = (headers && headers.length) ? headers.map((w) => String(w).replace(/\|/g, "\\|")) : ["Column", "Column"];
  const run = [
    "| " + cols.join(" | ") + " |",
    "| " + cols.map(() => "---").join(" | ") + " |",
    "| " + cols.map(() => "").join(" | ") + " |",   // one empty data row
  ];
  const wrap = buildTable(run, ctx.linkResolver, ctx.atLinks);
  if (ref) root.insertBefore(wrap, ref); else root.appendChild(wrap);
  ctx.commitDOM();
}

// Drag the border between column ci and ci+1: it's a zero-sum TRANSFER — ci grows by exactly what ci+1 loses,
// the total stays constant, every other column stays put (so borders move independently, like a real table).
// onMove (optional): called after every live width change, so a caller can re-sync anything that mirrors the
// column geometry but isn't part of the table itself (the floating control-row overlay, see decorateTables).
function colResize(grip, ci, ti, ctx, onMove) {
  grip.addEventListener("mousedown", (e) => {
    e.preventDefault(); e.stopPropagation();
    const wrap = grip.closest(".mde-tablewrap"), table = wrap.querySelector("table.mde-table");
    const cols = [].slice.call(table.querySelectorAll("col")), a = cols[ci], b = cols[ci + 1];
    if (!b) return;                                          // last border has no neighbour to trade with
    const startX = e.clientX, aW0 = +a.dataset.w || 3, bW0 = +b.dataset.w || 3;
    const unit = (grip.closest("td").getBoundingClientRect().width / aW0) || 1;   // px per dash-unit
    const sum = cols.reduce((s, c) => s + (+c.dataset.w || 3), 0);
    const prevSel = document.body.style.userSelect, prevCur = document.body.style.cursor;
    document.body.style.userSelect = "none"; document.body.style.cursor = "col-resize";
    let aW = aW0, bW = bW0;
    const apply = () => { a.style.width = (aW / sum * 100).toFixed(3) + "%"; b.style.width = (bW / sum * 100).toFixed(3) + "%"; };   // only these two change; sum is constant
    const move = (ev) => {
      let d = Math.round((ev.clientX - startX) / unit);
      d = Math.max(-(aW0 - 3), Math.min(bW0 - 3, d));       // neither column may drop below 3
      aW = aW0 + d; bW = bW0 - d; a.dataset.w = aW; b.dataset.w = bW; apply();
      if (onMove) onMove();                                 // keep the floating control-row overlay glued to the live-resizing column
    };
    const up = () => {
      document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up);
      document.body.style.userSelect = prevSel; document.body.style.cursor = prevCur;
      if (aW !== aW0) editTable(ctx, ti, (m) => { if (m.specs[ci]) m.specs[ci].width = aW; if (m.specs[ci + 1]) m.specs[ci + 1].width = bW; });
    };
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
  });
}

export function decorateTables(root, ctx) {
  closeMenus();                                            // drop any dropdown left over from before this re-render
  [].forEach.call(root.querySelectorAll(":scope > .mde-tablewrap"), (wrap, ti) => {
    const table = wrap.querySelector("table.mde-table"), tbody = table.querySelector("tbody");
    const cols = [].slice.call(table.querySelectorAll("col")), rows = [].slice.call(table.querySelectorAll("tr.mde-trow"));

    const dropline = el("div", "mde-ctl mde-dropline"); wrap.appendChild(dropline);   // drop indicator during a reorder drag
    const colRects = () => [].map.call(rows[0].children, (td) => td.getBoundingClientRect());
    const rowRects = () => rows.map((tr) => tr.getBoundingClientRect());
    const bodyBox = () => { const rr = rowRects(), cr = colRects(); return { top: rr[0].top, bottom: rr[rr.length - 1].bottom, left: cr[0].left, right: cr[cr.length - 1].right }; };   // the data cells' bounding rect (no control row, no outer spacing)

    // control ROW: per column a "⋯" menu + (only where the column is wide enough) an inline delete ✕. NOT a real
    // <tr> — that used to add a real ~16px row (plus the extra border-spacing gap it introduced) that only
    // existed in edit mode, so the table grew taller on edit entry and shifted everything below it down. It's a
    // plain overlay `<div>` on `wrap` (absolute, pinned above the table via CSS — md-editor.css), so it takes
    // ZERO layout height; each cell's left/width is set inline here, mirrored off the real column geometry
    // (colRects()), so it still tracks the columns exactly — including live, during a resize drag.
    const ctlBar = el("div", "mde-ctl mde-tctlrow"); ctlBar.setAttribute("contenteditable", "false");
    const ctlTds = [];
    const syncCtlBar = () => {   // re-measure and re-place every column cell against the table's live geometry
      const wr = wrap.getBoundingClientRect(), cr = colRects();
      cr.forEach((r, ci) => { const td = ctlTds[ci]; if (td) { td.style.left = (r.left - wr.left) + "px"; td.style.width = r.width + "px"; } });
    };
    cols.forEach((col, ci) => {
      const td = el("div", "mde-tctlcell"), bar = el("div", "mde-tctlbar");
      const menuBtn = el("span", "mde-ctl mde-tctl-btn mde-tmenu", "⋯"); menuBtn.setAttribute("contenteditable", "false"); menuBtn.title = "Column options — drag to move";
      const del = el("span", "mde-ctl mde-tctl-btn mde-delcol", "✕"); del.setAttribute("contenteditable", "false"); del.title = "Delete column";
      bar.appendChild(menuBtn); bar.appendChild(del); td.appendChild(bar);
      ctlBar.appendChild(td); ctlTds.push(td);
      // grab the cell's EMPTY area (between the glyphs) to reorder the column; ⋯ and ✕ act on click and, by
      // stopping propagation in their own mousedown, never start the column drag
      pressDragClick(td, {
        onDragMove: (ev) => { const cr = colRects(), to = dropIndex(cr, ev.clientX, "x"); showLine(dropline, wrap, bodyBox(), to < cr.length ? cr[to].left : cr[cr.length - 1].right, "x"); },
        onDragEnd: (ev) => { dropline.style.display = "none"; const to = dropIndex(colRects(), ev.clientX, "x"); if (to !== ci && to !== ci + 1) editTable(ctx, ti, (m) => { arrayMove(m.specs, ci, to); m.rows.forEach((r) => arrayMove(r, ci, to)); }); },
      });
      pressDragClick(menuBtn, { onClick: () => openColMenu(menuBtn, ci, ti, ctx, col.dataset.align || "") });
      pressDragClick(del, { onClick: () => editTable(ctx, ti, (m) => { m.specs.splice(ci, 1); m.rows.forEach((r) => r.splice(ci, 1)); }) });   // last column → editTable drops the whole table
    });
    wrap.appendChild(ctlBar);
    // no initial syncCtlBar() call here: decorateTables runs before `root` is attached to the live document
    // (see md-editor.js _render — decorateTables, then host.appendChild(root)), so getBoundingClientRect()
    // would only see zeros this early. Every reveal path (setHover below) re-syncs first, so the bar is
    // always correctly placed by the time it's actually visible (opacity 0 until then, so nothing to see).

    rows.forEach((tr, ri) => {
      const cells = [].slice.call(tr.children);
      cells.forEach((td, ci) => {
        if (ci < cols.length - 1) { const grip = el("span", "mde-ctl mde-grip"); grip.dataset.col = ci; grip.setAttribute("contenteditable", "false"); grip.title = "Drag to resize column"; colResize(grip, ci, ti, ctx, syncCtlBar); td.appendChild(grip); }
      });
      // left-margin bar the height of its row: grab its EMPTY area to reorder the row; the ✕ glyph inside deletes it
      const handle = el("span", "mde-ctl mde-rowdel"); handle.setAttribute("contenteditable", "false"); handle.title = "Drag to move row";
      const rx = el("span", "mde-ctl mde-tctl-btn mde-rowdelx", "✕"); rx.setAttribute("contenteditable", "false"); rx.title = "Delete row";
      handle.appendChild(rx);
      pressDragClick(handle, {
        onDragMove: (ev) => { const rr = rowRects(), to = dropIndex(rr, ev.clientY, "y"); showLine(dropline, wrap, bodyBox(), to < rr.length ? rr[to].top : rr[rr.length - 1].bottom, "y"); },
        onDragEnd: (ev) => { dropline.style.display = "none"; const to = dropIndex(rowRects(), ev.clientY, "y"); if (to !== ri && to !== ri + 1) editTable(ctx, ti, (m) => { arrayMove(m.rows, ri, to); }); },
      });
      pressDragClick(rx, { onClick: () => editTable(ctx, ti, (m) => { m.rows.splice(ri, 1); if (ri < m.headerCount) m.headerCount--; if (m.headerCount < 1 && m.rows.length) m.headerCount = 1; }) });   // deleting the header promotes the next row, so the table keeps a header (never collapses to nothing)
      cells[0].appendChild(handle);
    });

    // add-column (right margin), add-row (bottom) — on the wrapper
    const addCol = ctlBtn("＋", "Add column", () => editTable(ctx, ti, (m) => { m.specs.push({ align: "", width: 3 }); m.rows.forEach((r) => r.push("")); })); addCol.classList.add("mde-addcol"); wrap.appendChild(addCol);
    const addRow = ctlBtn("＋", "Add row", () => editTable(ctx, ti, (m) => { m.rows.push(m.specs.map(() => "")); })); addRow.classList.add("mde-addrow"); wrap.appendChild(addRow);

    // per-column controls reveal only while that column is hovered; the resize bars show only on the separators
    // adjacent to the hovered column (its left = grip of col ci-1, its right = grip of col ci)
    const grips = wrap.querySelectorAll(".mde-grip");
    const setHover = (ci) => {
      syncCtlBar();   // re-measure before revealing — the table may have reflowed since the last hover
      ctlTds.forEach((td, i) => td.classList.toggle("mde-colon", i === ci));
      if (ci >= 0 && ctlTds[ci]) { const w = rows[0].children[ci].getBoundingClientRect().width; ctlTds[ci].classList.toggle("mde-narrow", w > 0 && w < 64); }   // measured live on hover (real geometry, no rAF/visibility dependency): too narrow → the inline ✕ folds into the ⋯ menu
      [].forEach.call(grips, (g) => { const gc = +g.dataset.col; g.classList.toggle("mde-gripshow", ci >= 0 && (gc === ci || gc === ci - 1)); });
    };
    wrap.addEventListener("mouseover", (e) => {
      const dtd = e.target.closest && e.target.closest("td.mde-cell");
      if (dtd && dtd.parentElement && dtd.parentElement.classList.contains("mde-trow")) { setHover(dtd.cellIndex); return; }
      const ctd = e.target.closest && e.target.closest(".mde-tctlcell");   // hovering the floating control cell itself keeps its own column revealed
      setHover(ctd ? ctlTds.indexOf(ctd) : -1);
    });
    wrap.addEventListener("mouseleave", () => setHover(-1));
  });
}
