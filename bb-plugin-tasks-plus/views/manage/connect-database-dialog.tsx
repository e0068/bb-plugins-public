import { useEffect, useId, useState, type ReactNode } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type {
  BoardRow,
  ConnectDatabaseInput,
  FoldersRpcContract,
  GenerateTursoApiTokenResult,
  SyncedFolder,
  TursoDatabaseEntry,
} from "../../folders/contract.js";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TURSO_DASHBOARD_URL = "https://app.turso.tech";
const TURSO_LOGIN_COMMAND = "turso auth login";
const TURSO_INSTALL_COMMAND = "brew install tursodatabase/tap/turso";

type GenerateRefusal = Extract<GenerateTursoApiTokenResult, { ok: false }>;

/** The name start of the tokens Generate mints — the CLI module's, written here: the dialog does not import the server side. */
const GENERATED_TOKEN_NAME = "bb-tasks-plus-…";

const Command = ({ children }: { children: string }) => <code className="rounded bg-muted px-1 font-mono">{children}</code>;

/** What to do when the CLI could not mint a token. */
function refusalAdvice(refusal: GenerateRefusal): ReactNode {
  switch (refusal.reason) {
    case "cli_missing":
      return (
        <>
          Install the Turso CLI with <Command>{TURSO_INSTALL_COMMAND}</Command>, or create a token in the dashboard.
        </>
      );
    case "not_logged_in":
      return (
        <>
          Run <Command>{TURSO_LOGIN_COMMAND}</Command> in a terminal, then press Generate with Turso CLI again.
        </>
      );
    case "failed":
      return <>The Turso CLI refused: {refusal.message}</>;
  }
}

/** The advice, and the way around the CLI through the dashboard. */
function GenerateRefusalHint({ refusal }: { refusal: GenerateRefusal }) {
  return (
    <p role="alert" className="text-xs text-muted-foreground">
      {refusalAdvice(refusal)}{" "}
      <a href={TURSO_DASHBOARD_URL} target="_blank" rel="noreferrer" className="underline">
        Turso dashboard → Settings → API Tokens
      </a>
    </p>
  );
}

/** Turso no longer takes the account's token: the dialog asks for a new one. */
const TOKEN_REFUSED = "turso_token_refused";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What the person typed. Empty text is "not given". */
interface Form {
  copy: boolean;
  folderBoardId: string;
  address: string;
  token: string;
  board: string;
  prefix: string;
  tursoToken: string;
}

const EMPTY_FORM: Form = { copy: false, folderBoardId: "", address: "", token: "", board: "", prefix: "", tursoToken: "" };

/** A field with a label that focuses it, and an action on the label's row when it has one. */
function LabelledField({ label, htmlFor, action, children }: { label: string; htmlFor: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="block text-xs font-medium text-muted-foreground">
          {label}
        </label>
        {action}
      </div>
      {children}
    </div>
  );
}

const Hint = ({ children }: { children: ReactNode }) => <p className="text-xs text-muted-foreground">{children}</p>;

/** How long the address and token rest before the dialog asks what the database holds. */
const INSPECT_DELAY_MS = 400;

/** The board a database at this address holds, as the dialog last learned it. */
interface Inspected {
  url: string;
  board: BoardRow | null;
}

/** The name and prefix the board will connect with when the person does not choose them, and where they come from. */
interface LockedBoard extends BoardRow {
  from: "folder" | "database";
}

const LOCKED_HINT: Record<LockedBoard["from"], string> = {
  folder: "From the folder board",
  database: "From the database",
};

/** The Turso account token typed into the field, when one is. */
function typedAccountToken(form: Form): { tursoApiToken?: string } {
  return form.tursoToken.trim() === "" ? {} : { tursoApiToken: form.tursoToken.trim() };
}

/**
 * Why the Turso API token field is shown: hidden while the saved token serves;
 * asked when none is saved; replacing at the person's wish, who may keep the
 * saved one after all; refused when Turso no longer takes the saved one.
 */
type TokenField = "hidden" | "asked" | "replacing" | "refused";

/** The database token typed into the field, when one is. */
function typedDatabaseToken(form: Form): { token?: string } {
  return form.token.trim() === "" ? {} : { token: form.token.trim() };
}

/** The optional entries of the connect input: only the ones the person filled and may choose. */
function connectInput(form: Form, locked: LockedBoard | null): ConnectDatabaseInput {
  return {
    url: form.address.trim(),
    ...typedDatabaseToken(form),
    ...typedAccountToken(form),
    ...(form.copy ? { copyFromBoardId: form.folderBoardId } : {}),
    ...(form.copy || locked !== null || form.board.trim() === "" ? {} : { name: form.board.trim() }),
    ...(form.copy || locked !== null || form.prefix.trim() === "" ? {} : { prefix: form.prefix.trim() }),
  };
}

/** What the confirming button does in this case. */
function confirmLabel(form: Form, locked: LockedBoard | null): string {
  if (form.copy) return "Copy board";
  return locked === null ? "Create board" : "Open board";
}

export interface ConnectDatabaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected: () => void;
}

/**
 * "Connect database" — connects a board kept in an online database, or copies
 * a folder board into one and leaves the folder board as it is. The fields go
 * in the order they are filled: where the tasks come from, the database, then
 * the board — whose name and prefix are shown locked when the folder or the
 * database already gives them. Creating the database, taking one of the
 * account's and copying a folder are all done by the service; the dialog only
 * closes once the connection is real.
 */
export function ConnectDatabaseDialog({ open, onOpenChange, onConnected }: ConnectDatabaseDialogProps) {
  const rpc = useRpc<FoldersRpcContract>();
  const ids = { copy: useId(), folder: useId(), address: useId(), token: useId(), board: useId(), prefix: useId(), tursoToken: useId() };
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [folderBoards, setFolderBoards] = useState<SyncedFolder[]>([]);
  const [tursoTokenSaved, setTursoTokenSaved] = useState<boolean | null>(null);
  const [accountDatabases, setAccountDatabases] = useState<TursoDatabaseEntry[]>([]);
  const [listOpen, setListOpen] = useState(false);
  const [tokenField, setTokenField] = useState<TokenField>("hidden");
  /** Bumped when a new account token is taken, so the account's databases are listed again. */
  const [listVersion, setListVersion] = useState(0);
  const [inspected, setInspected] = useState<Inspected | null>(null);
  const [busy, setBusy] = useState<"generating" | "creating" | "connecting" | null>(null);
  const [generateRefusal, setGenerateRefusal] = useState<GenerateRefusal | null>(null);
  const [error, setError] = useState<string | null>(null);

  const change = (patch: Partial<Form>) => setForm((current) => ({ ...current, ...patch }));

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY_FORM);
    setError(null);
    setTokenField("hidden");
    setListOpen(false);
    setBusy(null);
    setGenerateRefusal(null);
    setTursoTokenSaved(null);
    setAccountDatabases([]);
    setInspected(null);
    rpc.call("listSyncedFolders", null).then(
      (result) => setFolderBoards(result.folders.filter((row) => row.source.kind === "folder")),
      (fetchError: unknown) => setError(describeError(fetchError)),
    );
    rpc.call("hasTursoApiToken", null).then(
      (result) => setTursoTokenSaved(result.saved),
      (fetchError: unknown) => setError(describeError(fetchError)),
    );
  }, [open, rpc]);

  // With the account's token saved, the account's databases are the address list;
  // a token Turso refuses is asked for anew before any Create database.
  useEffect(() => {
    if (!open || tursoTokenSaved !== true) return;
    let current = true;
    rpc.call("listTursoDatabases", null).then(
      (result) => {
        if (!current) return;
        setAccountDatabases(result.ok ? result.databases : []);
        if (!result.ok && result.error.code === TOKEN_REFUSED) showRefusal(result.error.message, {});
      },
      () => current && setAccountDatabases([]),
    );
    return () => {
      current = false;
    };
  }, [open, rpc, tursoTokenSaved, listVersion]);

  // Once the address and its tokens rest, the dialog learns which board the database holds.
  // A failure says nothing here: connecting names it. The account token typed in place of
  // a missing or refused one opens the account; a replacement is not sent before it is
  // confirmed, since the account keeps any token it accepts.
  const url = form.address.trim();
  const databaseToken = form.token.trim();
  const accountToken = tokenField === "asked" || tokenField === "refused" ? form.tursoToken.trim() : "";
  useEffect(() => {
    if (!open || url === "") return;
    let current = true;
    const timer = setTimeout(() => {
      const tokens = { ...(databaseToken === "" ? {} : { token: databaseToken }), ...(accountToken === "" ? {} : { tursoApiToken: accountToken }) };
      rpc.call("inspectDatabase", { url, ...tokens }).then(
        (result) => current && setInspected({ url, board: result.ok ? result.board : null }),
        () => current && setInspected({ url, board: null }),
      );
    }, INSPECT_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [open, rpc, url, databaseToken, accountToken]);

  const chosenFolder = folderBoards.find((row) => row.projectId === form.folderBoardId);
  const databaseBoard = inspected !== null && inspected.url === url ? inspected.board : null;
  const locked: LockedBoard | null = form.copy
    ? chosenFolder === undefined
      ? null
      : { name: chosenFolder.projectName, prefix: chosenFolder.projectPrefix, from: "folder" }
    : databaseBoard === null
      ? null
      : { ...databaseBoard, from: "database" };
  const prefixToCreate = form.copy ? (chosenFolder?.projectPrefix ?? "") : form.prefix.trim();
  const canConnect = url !== "" && (!form.copy || chosenFolder !== undefined) && busy === null;
  const canCreate = busy === null && (tokenField === "hidden" || form.tursoToken.trim() !== "");

  const listed = accountDatabases.filter((database) => {
    const wanted = url.toLowerCase();
    return wanted === "" || database.name.toLowerCase().includes(wanted) || database.url.toLowerCase().includes(wanted);
  });

  /**
   * Turso refused a token. The saved one, when none was typed: ask for a new
   * one with no way back to it. A typed one only says so.
   */
  function showRefusal(message: string, typed: { tursoApiToken?: string }) {
    setError(message);
    if (typed.tursoApiToken === undefined) setTokenField("refused");
  }

  const create = async () => {
    if (!canCreate) return;
    if (tursoTokenSaved !== true && tokenField === "hidden") {
      setTokenField("asked");
      return;
    }
    setBusy("creating");
    setError(null);
    try {
      const typed = typedAccountToken(form);
      const result = await rpc.call("createDatabase", { ...(prefixToCreate === "" ? {} : { prefix: prefixToCreate }), ...typed });
      if (!result.ok) {
        if (result.error.code === TOKEN_REFUSED) showRefusal(result.error.message, typed);
        else setError(result.error.message);
        return;
      }
      change({ address: result.url, token: "", tursoToken: "" });
      setTokenField("hidden");
      setTursoTokenSaved(true);
      if (typed.tursoApiToken !== undefined) setListVersion((version) => version + 1);
    } catch (createError) {
      setError(describeError(createError));
    } finally {
      setBusy(null);
    }
  };

  const generate = async () => {
    if (busy !== null) return;
    setBusy("generating");
    setGenerateRefusal(null);
    try {
      const result = await rpc.call("generateTursoApiToken", null);
      if (result.ok) change({ tursoToken: result.token });
      else setGenerateRefusal(result);
    } catch (generateError) {
      setGenerateRefusal({ ok: false, reason: "failed", message: describeError(generateError) });
    } finally {
      setBusy(null);
    }
  };

  const connect = async () => {
    if (!canConnect) return;
    setBusy("connecting");
    setError(null);
    try {
      const result = await rpc.call("connectDatabase", connectInput(form, locked));
      if (!result.ok) {
        if (result.error.code === TOKEN_REFUSED) showRefusal(result.error.message, typedAccountToken(form));
        else setError(result.error.message);
        return;
      }
      onConnected();
      onOpenChange(false);
    } catch (connectError) {
      setError(describeError(connectError));
    } finally {
      setBusy(null);
    }
  };

  const changeAccountToken =
    tursoTokenSaved === true && tokenField === "hidden" ? (
      <Button
        size="sm"
        variant="link"
        className="h-auto px-0 text-xs text-muted-foreground"
        disabled={busy !== null}
        onClick={() => setTokenField("replacing")}
      >
        Change Turso account token
      </Button>
    ) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Connect database</DialogTitle>
          <DialogDescription>
            Keeps a board in an online database that every machine opens by its address, instead of in files
            carried by git.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Checkbox id={ids.copy} checked={form.copy} onCheckedChange={(checked) => change({ copy: checked === true })} />
            <label htmlFor={ids.copy} className="text-sm">
              Copy tasks from a folder
            </label>
          </div>
          {form.copy ? (
            <LabelledField label="Folder" htmlFor={ids.folder}>
              <Select value={form.folderBoardId === "" ? undefined : form.folderBoardId} onValueChange={(value) => change({ folderBoardId: value })}>
                <SelectTrigger id={ids.folder} className="h-8">
                  <SelectValue placeholder={folderBoards.length === 0 ? "No connected folders" : "Select a folder"} />
                </SelectTrigger>
                <SelectContent>
                  {folderBoards.map((row) => (
                    <SelectItem key={row.projectId} value={row.projectId}>
                      {row.projectName} ({row.projectPrefix}) · {row.tasksFolder}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Hint>The folder board stays as it is; delete it yourself once the copy is right.</Hint>
            </LabelledField>
          ) : null}
          {tokenField !== "hidden" ? (
            <LabelledField label="Turso account token" htmlFor={ids.tursoToken}>
              <div className="flex gap-2">
                <Input
                  id={ids.tursoToken}
                  type="password"
                  value={form.tursoToken}
                  className="h-8"
                  onChange={(event) => change({ tursoToken: event.target.value })}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={busy !== null || form.tursoToken.trim() !== ""}
                  onClick={() => void generate()}
                >
                  {busy === "generating" ? "Generating…" : "Generate with Turso CLI"}
                </Button>
              </div>
              <Hint>
                The token of your Turso account creates and lists its databases; it is saved once and replaced by the next
                one Turso accepts. Generate with Turso CLI mints one named {GENERATED_TOKEN_NAME} with the Turso CLI of
                this machine; clear the field to mint another.
              </Hint>
              {generateRefusal ? <GenerateRefusalHint refusal={generateRefusal} /> : null}
              {tokenField === "replacing" ? (
                <Button
                  size="sm"
                  variant="link"
                  className="h-auto px-0 text-muted-foreground"
                  disabled={busy !== null}
                  onClick={() => {
                    setTokenField("hidden");
                    change({ tursoToken: "" });
                  }}
                >
                  Keep the saved token
                </Button>
              ) : null}
            </LabelledField>
          ) : null}
          <LabelledField label="Database address" htmlFor={ids.address} action={changeAccountToken}>
            <div className="flex items-start gap-2">
              <div className="relative flex-1">
                <Input
                  id={ids.address}
                  value={form.address}
                  placeholder="libsql://…"
                  className="h-8"
                  onChange={(event) => change({ address: event.target.value })}
                  onFocus={() => setListOpen(true)}
                  onClick={() => setListOpen(true)}
                  onBlur={() => setListOpen(false)}
                />
                {listOpen && listed.length > 0 ? (
                  <ul
                    role="listbox"
                    aria-label="Databases of the account"
                    className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border border-border bg-popover p-1 shadow-md"
                    // Keeps the focus in the input, so picking does not close the list before the click lands.
                    onMouseDown={(event) => event.preventDefault()}
                  >
                    {listed.map((database) => (
                      <li
                        key={database.url}
                        role="option"
                        aria-selected={database.url === form.address}
                        className="flex cursor-pointer items-baseline gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-state-hover"
                        onClick={() => {
                          change({ address: database.url });
                          setListOpen(false);
                        }}
                      >
                        <span className="truncate">{database.name}</span>
                        <span className="truncate text-xs text-muted-foreground">{database.url.replace(/^libsql:\/\//, "")}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <Button size="sm" variant="outline" className="h-8" disabled={!canCreate} onClick={() => void create()}>
                {busy === "creating" ? "Creating…" : "Create database"}
              </Button>
            </div>
            {error ? (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </LabelledField>
          <LabelledField label="Database token" htmlFor={ids.token}>
            <Input
              id={ids.token}
              type="password"
              value={form.token}
              className="h-8"
              onChange={(event) => change({ token: event.target.value })}
            />
            <Hint>Not needed for a Turso database: Create database or picking one gets a token by itself. Type one only for your own libSQL server.</Hint>
          </LabelledField>
          <LabelledField label="Board name" htmlFor={ids.board}>
            <Input
              id={ids.board}
              value={locked?.name ?? (form.copy ? "" : form.board)}
              disabled={form.copy || locked !== null}
              className="h-8"
              onChange={(event) => change({ board: event.target.value })}
            />
          </LabelledField>
          <LabelledField label="Key prefix" htmlFor={ids.prefix}>
            <Input
              id={ids.prefix}
              value={locked?.prefix ?? (form.copy ? "" : form.prefix)}
              disabled={form.copy || locked !== null}
              placeholder="e.g. TASKS"
              className="h-8"
              onChange={(event) => change({ prefix: event.target.value.toUpperCase() })}
            />
            {locked !== null ? <Hint>{LOCKED_HINT[locked.from]}</Hint> : null}
          </LabelledField>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={!canConnect} onClick={() => void connect()}>
            {busy === "connecting" ? "Connecting…" : confirmLabel(form, locked)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
