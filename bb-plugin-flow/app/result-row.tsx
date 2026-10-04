// Результат этапа одной строкой: имя открывает файл, путь за ним копируется в
// буфер. Ею раскрываются сделанные этапы в таблице брифа и результаты итога.
import { cn } from "../lib/utils";
import { DocumentName, RESULT_ROW } from "./cells";
import type { FileRoots } from "../core/result-link";
import { copyText, useFlash } from "./flash";
import { useMessages } from "./locale-context";

/** Сколько держится «Путь скопирован» на месте пути. */
const COPIED_MS = 1500;

/** Результат одной строкой: имя открывает файл, путь за ним копируется в буфер и на миг сменяется подтверждением. */
export function ResultRow({ result, roots, className }: { result: { label: string; target: string }; roots: FileRoots | null; className?: string }) {
  const t = useMessages();
  const [copied, flashCopied] = useFlash(COPIED_MS);
  const [failed, flashFailed] = useFlash(COPIED_MS);
  const copy = copied ? "copied" : failed ? "failed" : null;
  const onCopy = () => void copyText(result.target).then(flashCopied, flashFailed);
  return (
    <div data-result-row className={cn(RESULT_ROW, className)}>
      <DocumentName link={result} roots={roots} className="max-w-[50%] shrink-0 self-center" />
      <button
        type="button"
        aria-label={t.stages.copyPath(result.target)}
        title={result.target}
        onClick={onCopy}
        className={cn("min-w-0 flex-1 truncate text-left font-mono text-[11px] hover:text-foreground", copy === "failed" ? "text-destructive" : copy === "copied" ? "text-success" : "text-muted-foreground")}
      >
        {copy === "copied" ? t.stages.copied : copy === "failed" ? t.stages.copyFailed : result.target}
      </button>
      <span role="status" className="sr-only">
        {copy === "copied" ? t.stages.copied : copy === "failed" ? t.stages.copyFailed : ""}
      </span>
    </div>
  );
}
