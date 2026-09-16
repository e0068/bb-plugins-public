// Слой 2 — оболочка: плавающая панель форматирования Касимова над композером BB.
//
// Разметка и классы — его же (.mde-fmtbar / .mde-fmtbtn / .mde-tip), стили
// приезжают из packages/kasimov/kasimov.css, которую плагин уже подключает.
// Логика показа и позиционирования повторяет _buildFormatBar Касимова: панель
// висит над невырожденным выделением и прячется, когда выделения нет.
//
// Отличие ровно одно и вынужденное: композер — чужой contenteditable со своей
// моделью документа, поэтому текст не собирается из DOM-узлов, как у Касимова,
// а вставляется через execCommand("insertText"). Это единственный способ
// заменить выделение так, чтобы редактор хоста увидел правку своим
// beforeinput и не потерял отмену.
import { FMT, ICON, applyFmt, isSeparator, type FmtButton } from "./composer-fmt";

function el(tag: string, cls: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

/** Редактируемый предок узла выделения, если он есть. */
function editableOf(node: Node | null): HTMLElement | null {
  const start = node?.nodeType === 1 ? (node as HTMLElement) : node?.parentElement ?? null;
  return start?.closest<HTMLElement>('[contenteditable="true"]') ?? null;
}

/** Глиф кнопки: иконка Касимова или его же буква. */
function renderGlyph(button: HTMLElement, item: FmtButton): void {
  if (item.icon) button.innerHTML = ICON[item.icon] ?? "";
  else button.textContent = item.l ?? "";
}

/** Кнопки Касимова с его классами: `cls: "alpha bold"` → `mde-alpha mde-bold`. */
function buttonClass(item: FmtButton): string {
  const extra = item.cls
    ? " " + item.cls.split(/\s+/).map((name) => "mde-" + name).join(" ")
    : "";
  return "mde-fmtbtn" + extra;
}

/** Показывает панель над выделением; возвращает функцию снятия. */
export function mountComposerFormatBar(): () => void {
  const bar = el("div", "mde-fmtbar");
  const tip = el("div", "mde-tip");
  const btnrow = el("div", "mde-fmtbtns");

  const hideTip = () => tip.classList.remove("on");

  const showTip = (button: HTMLElement, item: FmtButton) => {
    tip.textContent = item.name + (item.hot ? "  " + item.hot : "");
    tip.classList.add("on");
    const br = button.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    const left = Math.max(
      4,
      Math.min(Math.round(br.left + br.width / 2 - tr.width / 2), window.innerWidth - tr.width - 4),
    );
    const top = Math.round(br.top - tr.height - 6);
    tip.style.left = left + "px";
    tip.style.top = (top < 4 ? Math.round(br.bottom + 6) : top) + "px";
  };

  const apply = (item: FmtButton) => {
    const selection = window.getSelection();
    const host = editableOf(selection?.anchorNode ?? null);
    if (!selection || !host) return;
    host.focus();
    document.execCommand("insertText", false, applyFmt(selection.toString(), item));
  };

  for (const row of FMT) {
    if (isSeparator(row)) {
      btnrow.appendChild(el("span", "mde-fmtsep"));
      continue;
    }
    const button = el("button", buttonClass(row)) as HTMLButtonElement;
    button.type = "button";
    button.title = row.name;
    button.setAttribute("aria-label", row.name);
    renderGlyph(button, row);
    // mousedown с preventDefault, а не click: иначе нажатие уводит фокус и
    // выделение в композере схлопывается раньше, чем его успеют прочитать.
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      apply(row);
    });
    button.addEventListener("mouseenter", () => showTip(button, row));
    button.addEventListener("mouseleave", hideTip);
    btnrow.appendChild(button);
  }

  bar.appendChild(btnrow);
  document.body.appendChild(bar);
  document.body.appendChild(tip);

  const reposition = () => {
    const selection = window.getSelection();
    if (
      !selection ||
      !selection.rangeCount ||
      selection.isCollapsed ||
      !editableOf(selection.anchorNode)
    ) {
      bar.classList.remove("on");
      hideTip();
      return;
    }
    bar.classList.add("on");
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    const bw = bar.offsetWidth;
    const bh = bar.offsetHeight;
    const margin = 6;
    const left = Math.max(
      margin,
      Math.min(Math.round(rect.left + rect.width / 2 - bw / 2), window.innerWidth - bw - margin),
    );
    const wanted = Math.round(rect.top - bh - 8);
    const top = Math.max(
      margin,
      Math.min(wanted < margin ? Math.round(rect.bottom + 8) : wanted, window.innerHeight - bh - margin),
    );
    bar.style.left = left + "px";
    bar.style.top = top + "px";
  };

  document.addEventListener("selectionchange", reposition);
  window.addEventListener("scroll", reposition, true);

  return () => {
    document.removeEventListener("selectionchange", reposition);
    window.removeEventListener("scroll", reposition, true);
    bar.remove();
    tip.remove();
  };
}
