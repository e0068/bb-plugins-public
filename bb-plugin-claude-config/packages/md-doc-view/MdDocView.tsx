// Общий слой: презентационный опыт MD Opener (редактор Kasimov) с инвертированными
// зависимостями. Компонент владеет стеком прыжков, режимом правки и CAS-нотой, а
// эффекты (чтение/запись файла, резолв цели ссылки) приходят функциями-пропсами —
// плагин-потребитель подставляет свой RPC. Ядро само по себе не знает ни про bb,
// ни про источник вкладки.
//
// Порт из bb-plugin-md-opener/app.tsx (DocOpener), где useRpc/source заменены на
// load/save/resolveLinkTarget. Любой файл — и markdown, и не-markdown — правится
// сырым текстом; отдельного «только чтение» для не-md нет по решению владельца
// (memory/decisions/claude-config-opener-setting.md).
import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { KasimovEditor } from "./KasimovEditor";
import "./md-doc-view.css";

export interface LoadedDoc {
  path: string;
  content: string | null;
  sha256: string | null;
  error?: string | null;
}

export interface SaveResult {
  outcome: "written" | "conflict" | "denied" | "not-found";
  sha256?: string | null;
  message?: string | null;
}

export interface MdDocViewProps {
  /** Абсолютный (или относительный первичный) путь первого показа. */
  initialPath: string;
  load: (path: string) => Promise<LoadedDoc>;
  save: (
    path: string,
    content: string,
    expectedSha256: string | null,
  ) => Promise<SaveResult>;
  /** Абсолютная цель внутривкладочной ссылки или null (ссылка некликабельна). */
  resolveLinkTarget: (href: string, fromPath: string) => string | null;
}

export function MdDocView({
  initialPath,
  load,
  save,
  resolveLinkTarget,
}: MdDocViewProps) {
  const [doc, setDoc] = useState<LoadedDoc | null>(null);
  const [stack, setStack] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saveNote, setSaveNote] = useState<string | null>(null);

  // Один резолвер загрузки. push=true — прыжок (кладём в стек), false — возврат
  // (стек уже подрезан вызывающим) или первичная загрузка.
  const runLoad = (target: string, push: boolean) => {
    setLoading(true);
    setEditing(false);
    setSaveNote(null);
    void load(target).then((res) => {
      setDoc(res);
      setStack((s) => (push ? [...s, res.path || target] : s));
      setLoading(false);
    });
  };
  const loadRef = useRef(runLoad);
  loadRef.current = runLoad;

  // Первичная загрузка — по initialPath. Смена пути сбрасывает вкладку/черновик.
  useEffect(() => {
    setStack([]);
    setLoading(true);
    setEditing(false);
    setSaveNote(null);
    void load(initialPath).then((res) => {
      setDoc(res);
      setStack([res.path || initialPath]);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPath]);

  const openAbs = (abs: string) => loadRef.current(abs, true);

  const back = () => {
    if (stack.length < 2) return;
    const prev = stack[stack.length - 2];
    setStack((s) => s.slice(0, -1));
    runLoad(prev, false);
  };

  const current = stack[stack.length - 1] ?? doc?.path ?? initialPath;

  // Внутривкладочная ссылка кликабельна, если resolveLinkTarget дал абсолютную
  // цель; клик по несуществующей вернёт ошибку из load.
  const linkResolver = (href: string) => {
    const abs = resolveLinkTarget(href, current);
    return abs ? { onClick: () => openAbs(abs) } : null;
  };

  const canEdit = !!doc && doc.content != null && !doc.error;

  const startEdit = () => {
    if (!canEdit) return;
    setDraft(doc?.content ?? "");
    setSaveNote(null);
    setEditing(true);
  };

  // CAS-сохранение: sha из последнего чтения. Конфликт — сообщение, правку не
  // теряем; успех — обновляем содержимое и свежий sha, выходим из правки.
  const runSave = (content: string) => {
    if (!doc || doc.content == null) return;
    setSaveNote(null);
    void save(doc.path, content, doc.sha256).then((res) => {
      if (res.outcome === "written") {
        setDoc({ ...doc, content, sha256: res.sha256 ?? null });
        setEditing(false);
      } else {
        setSaveNote(res.message ?? "Не удалось сохранить.");
      }
    });
  };

  // Клик по тексту в просмотре — вход в правку. Ссылку ведёт сам редактор через
  // linkResolver (класс .mde-link) — её клик не должен открывать правку.
  const onDocClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (editing) return;
    const el = event.target as HTMLElement;
    if (el.closest(".mde-link")) return;
    if (canEdit) startEdit();
  };

  const fileName = (doc?.path || initialPath).split("/").pop() ?? "";
  const showHeader = editing || stack.length > 1 || !!saveNote;

  return (
    <div className="mdo-root">
      {/* Шапки по умолчанию нет — как у родного. Появляется при возврате после
          прыжка, в режиме правки или при ошибке сохранения. */}
      {showHeader && (
        <div className="mdo-header">
          {!editing && stack.length > 1 && (
            <button
              type="button"
              onClick={back}
              className="mdo-back"
              aria-label="Назад"
            >
              ←
            </button>
          )}
          <div className="mdo-heading">
            <div className="mdo-title">{fileName}</div>
            {saveNote && <div className="mdo-note">{saveNote}</div>}
          </div>
          {editing && (
            <div className="mdo-actions">
              <button
                type="button"
                onClick={() => runSave(draft)}
                className="mdo-btn mdo-btn-primary"
              >
                Сохранить
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setSaveNote(null);
                }}
                className="mdo-btn"
              >
                Отмена
              </button>
            </div>
          )}
        </div>
      )}

      <div className="mdo-body">
        {loading && <p className="mdo-msg">Загрузка…</p>}
        {!loading && doc?.error && <p className="mdo-msg mdo-err">{doc.error}</p>}
        {!loading && doc?.content != null && (
          <div className="mdo-doc" onClick={onDocClick}>
            <KasimovEditor
              editable={editing}
              value={editing ? draft : doc.content}
              onChange={setDraft}
              linkResolver={linkResolver}
              onSave={(md) => {
                setDraft(md);
                runSave(md);
              }}
              className="mdo-mde"
            />
          </div>
        )}
      </div>
    </div>
  );
}
