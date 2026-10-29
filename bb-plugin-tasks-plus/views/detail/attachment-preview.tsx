import { useEffect, useState, type ReactNode } from "react";
import { attachmentPreviewKind, type AttachmentPreviewKind } from "../../shared/attachment-preview.js";
import type { Attachment } from "../../shared/contract.js";
import { formatFileSize } from "../../shared/format.js";
import { TasksEditor, type TasksEditorProps } from "../../editor/tasks-editor.js";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/** Where links inside a previewed markdown file lead — the same places as in the task description. */
export type PreviewLinks = Pick<TasksEditorProps, "onOpenLink" | "onOpenTask" | "onOpenThread">;

type Loaded = { state: "loading" } | { state: "loaded"; text: string } | { state: "failed"; reason: string };

/**
 * The server knows the attachment but has its file neither on this machine's disk nor in the board's database:
 * it was uploaded on another machine and never shared. Only attaching it again brings it back.
 */
const MISSING_FILE = "the file is not on this machine — it was uploaded on another one and never shared. Attach it again.";

/** The text of the file at `url`, read once per address. */
function useFileText(url: string): Loaded {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  useEffect(() => {
    let current = true;
    setLoaded({ state: "loading" });
    fetch(url)
      .then(async (response) => {
        if (response.status === 404) throw new Error(MISSING_FILE);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then(
        (text) => current && setLoaded({ state: "loaded", text }),
        (error: unknown) => current && setLoaded({ state: "failed", reason: error instanceof Error ? error.message : String(error) }),
      );
    return () => {
      current = false;
    };
  }, [url]);
  return loaded;
}

/** Links that leave the preview close it first: a task or thread opens in its place, not under the dialog. */
function closingFirst({ onOpenLink, onOpenTask, onOpenThread }: PreviewLinks, close: () => void): PreviewLinks {
  const after =
    (open: (target: string) => void) =>
    (target: string) => {
      close();
      open(target);
    };
  return { onOpenLink, onOpenTask: onOpenTask && after(onOpenTask), onOpenThread: onOpenThread && after(onOpenThread) };
}

function PreviewBody({ kind, text, links }: { kind: AttachmentPreviewKind; text: string; links: PreviewLinks }) {
  switch (kind) {
    case "markdown":
      return <TasksEditor value={text} onChange={() => {}} readOnly {...links} />;
    case "text":
      return <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">{text}</pre>;
  }
}

/**
 * A text attachment read in place: markdown drawn as the task description draws it, any other text as written.
 * Escape closes the preview only — the dialog takes the key before the task behind it sees it.
 */
function AttachmentPreview({
  attachment,
  kind,
  url,
  links,
  onClose,
}: {
  attachment: Attachment;
  kind: AttachmentPreviewKind;
  url: string;
  links: PreviewLinks;
  onClose: () => void;
}) {
  const loaded = useFileText(url);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col gap-3">
        <DialogHeader className="pr-6">
          <DialogTitle className="truncate">{attachment.fileName}</DialogTitle>
          <DialogDescription>{formatFileSize(attachment.sizeBytes)}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loaded.state === "loading" ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : loaded.state === "failed" ? (
            <p className="text-sm text-destructive">Could not open the file: {loaded.reason}</p>
          ) : (
            <PreviewBody kind={kind} text={loaded.text} links={closingFirst(links, onClose)} />
          )}
        </div>
        <div className="flex justify-end">
          <Button asChild variant="outline" size="sm">
            <a href={url} download={attachment.fileName}>
              <Icon name="Download" className="size-4" />
              Download
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * What a file attachment card is clicked through: text opens in a preview, anything else downloads. The card's
 * look stays the caller's — `children` inside, `className` on the clickable element.
 */
export function AttachmentOpener({
  attachment,
  url,
  links = {},
  className,
  title,
  children,
}: {
  attachment: Attachment;
  url: string;
  links?: PreviewLinks;
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const kind = attachmentPreviewKind(attachment.fileName, attachment.mime);
  if (kind === undefined) {
    return (
      <a href={url} download={attachment.fileName} title={title} className={className}>
        {children}
      </a>
    );
  }
  return (
    <>
      <button type="button" title={title} className={cn("text-left", className)} onClick={() => setOpen(true)}>
        {children}
      </button>
      {open ? <AttachmentPreview attachment={attachment} kind={kind} url={url} links={links} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
