import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatTakenAgo, type TakenBy } from "../shared/task-claim.js";

/** A take the server refused: the task and the mark of whoever holds it. */
export interface TakenRefusal {
  key: string;
  takenBy: TakenBy;
}

/** What a mutation answered — only what the refusal handler reads of it. */
export interface RefusableResult {
  ok: boolean;
  error?: { code: string; takenBy?: TakenBy };
}

export interface TakenRefusalApi {
  /** Opens the dialog for a refusal. */
  show(refusal: TakenRefusal): void;
  /** Opens the dialog when the result is a refused take and says so; any other result is left to the caller. */
  handle(result: RefusableResult, taskKey: string): boolean;
}

const OUTSIDE_PROVIDER: TakenRefusalApi = { show: () => {}, handle: () => false };

const TakenRefusalContext = createContext<TakenRefusalApi>(OUTSIDE_PROVIDER);

/** The refusal dialog of the screen: one for every place a task can be taken from. */
export function useTakenRefusal(): TakenRefusalApi {
  return useContext(TakenRefusalContext);
}

const defaultNow = (): Date => new Date();

/** Where the mark says the task is held: “in “thr_x””, or nothing without a thread. */
const inThread = (takenBy: TakenBy): string => (takenBy.threadId === null ? "" : ` in “${takenBy.threadId}”`);

export function TaskTakenDialog({
  refusal,
  now,
  onClose,
  onOpenThread,
}: {
  refusal: TakenRefusal | null;
  now: () => Date;
  onClose: () => void;
  onOpenThread: (threadId: string) => void;
}) {
  const threadId = refusal?.takenBy.threadId ?? null;
  return (
    <Dialog open={refusal !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      {refusal === null ? null : (
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{refusal.key} is already taken</DialogTitle>
            <DialogDescription>
              {refusal.takenBy.machine} took it {formatTakenAgo(refusal.takenBy.at, now())}
              {inThread(refusal.takenBy)}. The board now shows it in progress.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            {threadId === null ? null : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onClose();
                  onOpenThread(threadId);
                }}
              >
                Open thread
              </Button>
            )}
            <Button size="sm" onClick={onClose}>
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}

/**
 * Holds the refusal dialog above the screens. The way to a thread comes as a
 * prop: a component of this layer knows no router.
 */
export function TakenRefusalProvider({
  onOpenThread,
  now = defaultNow,
  children,
}: {
  onOpenThread: (threadId: string) => void;
  now?: () => Date;
  children: ReactNode;
}) {
  const [refusal, setRefusal] = useState<TakenRefusal | null>(null);
  const handle = useCallback((result: RefusableResult, taskKey: string): boolean => {
    const takenBy = result.error?.code === "task_already_taken" ? result.error.takenBy : undefined;
    if (result.ok || takenBy === undefined) return false;
    setRefusal({ key: taskKey, takenBy });
    return true;
  }, []);
  const api = useMemo<TakenRefusalApi>(() => ({ show: setRefusal, handle }), [handle]);
  return (
    <TakenRefusalContext.Provider value={api}>
      {children}
      <TaskTakenDialog refusal={refusal} now={now} onClose={() => setRefusal(null)} onOpenThread={onOpenThread} />
    </TakenRefusalContext.Provider>
  );
}
