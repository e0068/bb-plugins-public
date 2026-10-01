// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { planned } from "../../test-support/planned.js";
import { PROJECT_ID, prepareBoardDom } from "../../test-support/board-harness.js";

prepareBoardDom();
await loadPluginApp(() => import("../../app"));
const dialogPath = "./connect-database-dialog.js";
const { ConnectDatabaseDialog } = await planned<typeof import("./connect-database-dialog.js")>(() => import(/* @vite-ignore */ dialogPath));

afterEach(cleanup);

const CREATED = "libsql://bb-tasks-rem-me.turso.io";
const ACCOUNT_DB = { name: "bb-tasks-web", url: "libsql://bb-tasks-web-me.turso.io" };
const folderRow = {
  projectId: PROJECT_ID,
  projectName: "Tasks Plugin",
  projectPrefix: "TSK",
  taskCount: 3,
  tasksFolder: "docs/tasks",
  linkedBbProjectId: "proj_x",
  linkedBbProjectName: "Repo",
  repoPath: "/repo",
  source: { kind: "folder" },
};

interface Rpc {
  saved?: boolean;
  connect?: () => unknown;
  generate?: () => unknown;
  create?: () => unknown;
  list?: () => unknown;
  inspect?: (input: { url: string }) => unknown;
}

function renderDialog({
  saved = false,
  connect = () => ({ ok: true }),
  generate = () => ({ ok: true, token: "cli-token" }),
  create = () => ({ ok: true, url: CREATED }),
  list = () => ({ ok: true, databases: [ACCOUNT_DB] }),
  inspect = () => ({ ok: true, board: null }),
}: Rpc = {}) {
  const calls = {
    inspectDatabase: vi.fn((input: unknown) => inspect(input as { url: string })),
    generateTursoApiToken: vi.fn((_input: unknown) => generate()),
    createDatabase: vi.fn((_input: unknown) => create()),
    connectDatabase: vi.fn((_input: unknown) => connect()),
    onConnected: vi.fn(),
    onOpenChange: vi.fn(),
  };
  renderSlot(
    { component: () => <ConnectDatabaseDialog open onOpenChange={calls.onOpenChange} onConnected={calls.onConnected} /> },
    {},
    {
      rpc: {
        listSyncedFolders: () => ({ folders: [folderRow] }),
        hasTursoApiToken: () => ({ saved }),
        listTursoDatabases: list,
        createDatabase: calls.createDatabase,
        connectDatabase: calls.connectDatabase,
        inspectDatabase: calls.inspectDatabase,
        generateTursoApiToken: calls.generateTursoApiToken,
      },
    },
  );
  return calls;
}

const field = (label: string) => screen.queryByLabelText(label) as HTMLInputElement | null;
const type = (label: string, value: string) => {
  const input = field(label);
  expect(input, `a field labelled ${label}`).not.toBeNull();
  fireEvent.change(input!, { target: { value } });
};
const press = (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button, `a button named ${name}`).not.toBeNull();
  fireEvent.click(button!);
};
const ready = () => waitFor(() => expect(screen.queryByRole("dialog")).not.toBeNull());

const labelsInOrder = () =>
  Array.from(document.querySelectorAll("label")).map((label) => label.textContent?.trim()).filter((text): text is string => Boolean(text));

describe("Connect database — the fields, in the order they are filled", () => {
  it("goes from where the tasks come from to the database, then to the board", async () => {
    renderDialog();
    await ready();
    expect(labelsInOrder()).toEqual(["Copy tasks from a folder", "Database address", "Database token", "Board name", "Key prefix"]);
    expect(screen.queryByRole("button", { name: "Create board" })?.hasAttribute("disabled")).toBe(true);
  });

  it("asks for the Turso account token above the database address it creates", async () => {
    renderDialog({ saved: false });
    await ready();
    press("Create database");
    await waitFor(() => expect(field("Turso account token")).not.toBeNull());
    expect(labelsInOrder()).toEqual(["Copy tasks from a folder", "Turso account token", "Database address", "Database token", "Board name", "Key prefix"]);
  });

  it("Create database needs no prefix, and names the database after one when it is typed", async () => {
    const calls = renderDialog({ saved: true });
    await ready();
    expect(screen.queryByRole("button", { name: "Create database" })?.hasAttribute("disabled")).toBe(false);
    press("Create database");
    await waitFor(() => expect(calls.createDatabase).toHaveBeenCalledTimes(1));
    expect((calls.createDatabase.mock.calls[0]![0] as Record<string, unknown>).prefix).toBeUndefined();
    type("Key prefix", "rem");
    press("Create database");
    await waitFor(() => expect(calls.createDatabase).toHaveBeenLastCalledWith(expect.objectContaining({ prefix: "REM" })));
  });
});

describe("Connect database — a database that already holds a board", () => {
  const HOLDING = { ok: true, board: { name: "Remote", prefix: "REM" } };

  it("locks Board name and Key prefix on the database's own, and opens that board", async () => {
    const calls = renderDialog({ saved: true, inspect: ({ url }) => (url === ACCOUNT_DB.url ? HOLDING : { ok: true, board: null }) });
    await ready();
    type("Board name", "Mine");
    type("Database address", ACCOUNT_DB.url);
    await waitFor(() => expect(field("Board name")?.value).toBe("Remote"));
    expect(field("Board name")?.disabled).toBe(true);
    expect(field("Key prefix")?.value).toBe("REM");
    expect(field("Key prefix")?.disabled).toBe(true);
    expect(screen.getByText("From the database")).toBeDefined();
    press("Open board");
    await waitFor(() => expect(calls.connectDatabase).toHaveBeenCalledTimes(1));
    const input = calls.connectDatabase.mock.calls[0]![0] as Record<string, unknown>;
    expect(input.name ?? null).toBeNull();
    expect(input.prefix ?? null).toBeNull();
  });

  it("gives the fields back once the address names an empty database", async () => {
    renderDialog({ inspect: ({ url }) => (url === ACCOUNT_DB.url ? HOLDING : { ok: true, board: null }) });
    await ready();
    type("Database address", ACCOUNT_DB.url);
    await waitFor(() => expect(field("Board name")?.disabled).toBe(true));
    type("Database address", "libsql://empty-me.turso.io");
    await waitFor(() => expect(field("Board name")?.disabled).toBe(false));
    expect(screen.queryByRole("button", { name: "Create board" })).not.toBeNull();
  });

  it("asks once the address rests, sending the typed database token", async () => {
    const calls = renderDialog();
    await ready();
    type("Database token", "tok");
    type("Database address", "libsql://board-me.turso.io");
    await waitFor(() => expect(calls.inspectDatabase).toHaveBeenCalledWith({ url: "libsql://board-me.turso.io", token: "tok" }));
    expect(calls.inspectDatabase).toHaveBeenCalledTimes(1);
  });
});

describe("Connect database — copying a folder", () => {
  it("shows the folder boards, says the folder board stays, and locks the board on the folder's name and prefix", async () => {
    renderDialog();
    await ready();
    fireEvent.click(screen.getByRole("checkbox", { name: "Copy tasks from a folder" }));
    fireEvent.click(await screen.findByLabelText("Folder"));
    fireEvent.click(await screen.findByRole("option", { name: /Tasks Plugin/ }));
    await waitFor(() => expect(field("Board name")?.value).toBe("Tasks Plugin"));
    expect(field("Board name")?.disabled).toBe(true);
    expect(field("Key prefix")?.value).toBe("TSK");
    expect(screen.getByText("From the folder board")).toBeDefined();
    expect(screen.getByText(/folder board stays/)).toBeDefined();
  });

  it("sends the folder board to copy and no name or prefix, and names the database after the folder's prefix", async () => {
    const calls = renderDialog({ saved: true });
    await ready();
    fireEvent.click(screen.getByRole("checkbox", { name: "Copy tasks from a folder" }));
    fireEvent.click(await screen.findByLabelText("Folder"));
    fireEvent.click(await screen.findByRole("option", { name: /Tasks Plugin/ }));
    press("Create database");
    await waitFor(() => expect(calls.createDatabase).toHaveBeenCalledWith(expect.objectContaining({ prefix: "TSK" })));
    await waitFor(() => expect(field("Database address")?.value).toBe(CREATED));
    press("Copy board");
    await waitFor(() => expect(calls.connectDatabase).toHaveBeenCalledTimes(1));
    const input = calls.connectDatabase.mock.calls[0]![0] as Record<string, unknown>;
    expect(input).toMatchObject({ url: CREATED, copyFromBoardId: PROJECT_ID });
    expect(input.moveFromBoardId ?? null).toBeNull();
    expect(input.name ?? null).toBeNull();
    expect(input.prefix ?? null).toBeNull();
  });
});

describe("Connect database — Create", () => {
  it("asks for a Turso account token when none is saved, then creates the database and fills the address", async () => {
    const calls = renderDialog({ saved: false });
    await ready();
    type("Board name", "Remote");
    type("Key prefix", "REM");
    press("Create database");
    await waitFor(() => expect(field("Turso account token")).not.toBeNull());
    expect(calls.createDatabase).not.toHaveBeenCalled();
    type("Turso account token", "account-token");
    press("Create database");
    await waitFor(() => expect(calls.createDatabase).toHaveBeenCalledWith(expect.objectContaining({ prefix: "REM", tursoApiToken: "account-token" })));
    await waitFor(() => expect(field("Database address")?.value).toBe(CREATED));
  });

  it("creates at once with the saved token and fills the address", async () => {
    const calls = renderDialog({ saved: true });
    await ready();
    type("Board name", "Remote");
    type("Key prefix", "REM");
    press("Create database");
    await waitFor(() => expect(calls.createDatabase).toHaveBeenCalledTimes(1));
    expect((calls.createDatabase.mock.calls[0]![0] as Record<string, unknown>).tursoApiToken).toBeUndefined();
    await waitFor(() => expect(field("Database address")?.value).toBe(CREATED));
  });
});

describe("Connect database — a database of the account", () => {
  it("picking it from the address list connects it without a token", async () => {
    const calls = renderDialog({ saved: true });
    await ready();
    fireEvent.click(screen.getByLabelText("Database address"));
    fireEvent.click(await screen.findByRole("option", { name: /bb-tasks-web/ }));
    await waitFor(() => expect(field("Database address")?.value).toBe(ACCOUNT_DB.url));
    press("Create board");
    await waitFor(() => expect(calls.connectDatabase).toHaveBeenCalledTimes(1));
    const input = calls.connectDatabase.mock.calls[0]![0] as Record<string, unknown>;
    expect(input.url).toBe(ACCOUNT_DB.url);
    expect(input.token ?? null).toBeNull();
    await waitFor(() => expect(calls.onConnected).toHaveBeenCalled());
    expect(calls.onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("Connect database — a failure", () => {
  it("stays in the dialog under the address and closes nothing", async () => {
    const calls = renderDialog({ connect: () => ({ ok: false, error: { code: "database_unreachable", message: "Cannot reach the database" } }) });
    await ready();
    type("Database address", "libsql://board-me.turso.io");
    type("Database token", "tok");
    type("Board name", "Remote");
    type("Key prefix", "REM");
    press("Create board");
    await waitFor(() => expect(screen.queryByText("Cannot reach the database")).not.toBeNull());
    expect(calls.onConnected).not.toHaveBeenCalled();
    expect(calls.onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

describe("Connect database — Generate with Turso CLI", () => {
  async function askedForTursoToken(rpc: Rpc) {
    const calls = renderDialog({ saved: false, ...rpc });
    await ready();
    type("Board name", "Remote");
    type("Key prefix", "REM");
    press("Create database");
    await waitFor(() => expect(field("Turso account token")).not.toBeNull());
    return calls;
  }

  it("no longer sends to the documentation", async () => {
    await askedForTursoToken({});
    expect(screen.queryByRole("link", { name: "Where to get it" })).toBeNull();
    expect(document.querySelector('a[href*="docs.turso.tech"]')).toBeNull();
  });

  it("Generate puts the token the CLI minted into the field, and Create sends it", async () => {
    const calls = await askedForTursoToken({});
    press("Generate with Turso CLI");
    await waitFor(() => expect(field("Turso account token")?.value).toBe("cli-token"));
    expect(calls.generateTursoApiToken).toHaveBeenCalledTimes(1);
    press("Create database");
    await waitFor(() => expect(calls.createDatabase).toHaveBeenCalledWith(expect.objectContaining({ tursoApiToken: "cli-token" })));
  });

  it("without a login, says which command to run and links the Turso dashboard", async () => {
    await askedForTursoToken({ generate: () => ({ ok: false, reason: "not_logged_in", message: "user not logged in" }) });
    press("Generate with Turso CLI");
    await waitFor(() => expect(screen.queryByText("turso auth login")).not.toBeNull());
    const link = screen.queryByRole("link", { name: /Turso dashboard/ });
    expect(link?.getAttribute("href")).toMatch(/^https:\/\/app\.turso\.tech/);
    expect(field("Turso account token")?.value).toBe("");
  });

  it("without the CLI, says to install it and links the Turso dashboard", async () => {
    await askedForTursoToken({ generate: () => ({ ok: false, reason: "cli_missing", message: "turso CLI not found" }) });
    press("Generate with Turso CLI");
    await waitFor(() => expect(screen.queryByText(/Install the Turso CLI/)).not.toBeNull());
    expect(screen.queryByRole("link", { name: /Turso dashboard/ })).not.toBeNull();
  });

  it("any other refusal shows the CLI's words and the dashboard link", async () => {
    await askedForTursoToken({ generate: () => ({ ok: false, reason: "failed", message: "quota exceeded" }) });
    press("Generate with Turso CLI");
    await waitFor(() => expect(screen.queryByText(/quota exceeded/)).not.toBeNull());
    expect(screen.queryByRole("link", { name: /Turso dashboard/ })).not.toBeNull();
  });
});

describe("Connect database — Generate mints one token at a time", () => {
  it("is off once the field holds a token, so a second press cannot leave a spare token in the account", async () => {
    renderDialog({ saved: false });
    await ready();
    type("Board name", "Remote");
    type("Key prefix", "REM");
    press("Create database");
    await waitFor(() => expect(field("Turso account token")).not.toBeNull());
    press("Generate with Turso CLI");
    await waitFor(() => expect(field("Turso account token")?.value).toBe("cli-token"));
    expect(screen.queryByRole("button", { name: "Generate with Turso CLI" })?.hasAttribute("disabled")).toBe(true);
  });

  it("names the token it makes, so it can be found and revoked in the dashboard", async () => {
    renderDialog({ saved: false });
    await ready();
    type("Board name", "Remote");
    type("Key prefix", "REM");
    press("Create database");
    await waitFor(() => expect(field("Turso account token")).not.toBeNull());
    expect(screen.queryByText(/bb-tasks-plus-/)).not.toBeNull();
  });

  it("without the CLI, shows the command that installs it", async () => {
    renderDialog({ saved: false, generate: () => ({ ok: false, reason: "cli_missing", message: "m" }) });
    await ready();
    type("Board name", "Remote");
    type("Key prefix", "REM");
    press("Create database");
    await waitFor(() => expect(field("Turso account token")).not.toBeNull());
    press("Generate with Turso CLI");
    await waitFor(() => expect(screen.queryByText("brew install tursodatabase/tap/turso")).not.toBeNull());
  });
});

describe("Connect database — a saved Turso token the account refuses", () => {
  const REFUSED = { ok: false, error: { code: "turso_token_refused", message: "Turso refused the saved API token." } };

  it("Create refused opens the Turso account token field, and the next Create sends the new token", async () => {
    const answers = [REFUSED, { ok: true, url: CREATED }];
    const calls = renderDialog({ saved: true, create: () => answers.shift() });
    await ready();
    type("Board name", "Remote");
    type("Key prefix", "REM");
    press("Create database");
    await waitFor(() => expect(field("Turso account token")).not.toBeNull());
    expect(screen.getByRole("button", { name: "Generate with Turso CLI" })).toBeDefined();
    expect(screen.getByText("Turso refused the saved API token.")).toBeDefined();
    type("Turso account token", "new-account-token");
    press("Create database");
    await waitFor(() => expect(calls.createDatabase).toHaveBeenLastCalledWith(expect.objectContaining({ prefix: "REM", tursoApiToken: "new-account-token" })));
    await waitFor(() => expect(field("Database address")?.value).toBe(CREATED));
  });

  it("opening the dialog with a refused token asks for a new one before any Create", async () => {
    renderDialog({ saved: true, list: () => REFUSED });
    await ready();
    await waitFor(() => expect(field("Turso account token")).not.toBeNull());
  });
});

describe("Connect database — Change Turso account token", () => {
  it("opens the Turso account token field while the saved token still works, and Create sends the new one", async () => {
    const calls = renderDialog({ saved: true });
    await ready();
    expect(field("Turso account token")).toBeNull();
    press("Change Turso account token");
    await waitFor(() => expect(field("Turso account token")).not.toBeNull());
    type("Key prefix", "REM");
    type("Turso account token", "other-account-token");
    press("Create database");
    await waitFor(() => expect(calls.createDatabase).toHaveBeenCalledWith(expect.objectContaining({ prefix: "REM", tursoApiToken: "other-account-token" })));
  });

  it("is not offered when no token is saved: Create asks for one anyway", async () => {
    renderDialog({ saved: false });
    await ready();
    expect(screen.queryByRole("button", { name: "Change Turso account token" })).toBeNull();
  });
});

describe("Connect database — after a refused or replaced token", () => {
  const REFUSED = { ok: false, error: { code: "turso_token_refused", message: "Turso refused the saved API token." } };

  it("says why the token field opened when the dialog finds the saved token refused", async () => {
    renderDialog({ saved: true, list: () => REFUSED });
    await ready();
    expect(await screen.findByText("Turso refused the saved API token.")).toBeDefined();
  });

  it("Connect sends the account token typed into the field", async () => {
    const calls = renderDialog({ saved: true, list: () => REFUSED });
    await ready();
    await waitFor(() => expect(field("Turso account token")).not.toBeNull());
    type("Database address", ACCOUNT_DB.url);
    type("Turso account token", "new-account-token");
    press("Create board");
    await waitFor(() => expect(calls.connectDatabase).toHaveBeenCalledWith(expect.objectContaining({ url: ACCOUNT_DB.url, tursoApiToken: "new-account-token" })));
  });

  it("lists the account's databases again once Create took the new token", async () => {
    const lists = [REFUSED, { ok: true, databases: [ACCOUNT_DB] }];
    renderDialog({ saved: true, list: () => lists.shift() ?? { ok: true, databases: [ACCOUNT_DB] } });
    await ready();
    await waitFor(() => expect(field("Turso account token")).not.toBeNull());
    type("Key prefix", "REM");
    type("Turso account token", "new-account-token");
    press("Create database");
    await waitFor(() => expect(field("Database address")?.value).toBe(CREATED));
    type("Database address", "");
    fireEvent.focus(field("Database address")!);
    expect(await screen.findByRole("option", { name: /bb-tasks-web/ })).toBeDefined();
  });

  it("Keep the saved token takes Change Turso account token back", async () => {
    const calls = renderDialog({ saved: true });
    await ready();
    press("Change Turso account token");
    await waitFor(() => expect(field("Turso account token")).not.toBeNull());
    press("Keep the saved token");
    await waitFor(() => expect(field("Turso account token")).toBeNull());
    type("Key prefix", "REM");
    press("Create database");
    await waitFor(() => expect(calls.createDatabase).toHaveBeenCalledTimes(1));
    expect((calls.createDatabase.mock.calls[0]![0] as Record<string, unknown>).tursoApiToken).toBeUndefined();
  });

  it("offers no way back to a saved token Turso refused", async () => {
    renderDialog({ saved: true, list: () => REFUSED });
    await ready();
    await waitFor(() => expect(field("Turso account token")).not.toBeNull());
    expect(screen.queryByRole("button", { name: "Keep the saved token" })).toBeNull();
  });
});

describe("Connect database — a mistyped replacement token", () => {
  it("is refused without giving up the saved token: Keep the saved token stays", async () => {
    const answers = [{ ok: false, error: { code: "turso_token_refused", message: "Turso refused this API token." } }];
    renderDialog({ saved: true, create: () => answers.shift() ?? { ok: true, url: CREATED } });
    await ready();
    press("Change Turso account token");
    await waitFor(() => expect(field("Turso account token")).not.toBeNull());
    type("Key prefix", "REM");
    type("Turso account token", "mistyped-token");
    press("Create database");
    expect(await screen.findByText("Turso refused this API token.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Keep the saved token" })).not.toBeNull();
  });
});

describe("Connect database — which board a database holds, with a new account token", () => {
  it("reads the database with the account token typed in place of a refused one", async () => {
    const REFUSED = { ok: false, error: { code: "turso_token_refused", message: "Turso refused the saved API token." } };
    const calls = renderDialog({
      saved: true,
      list: () => REFUSED,
      inspect: (input) => ((input as { tursoApiToken?: string }).tursoApiToken === "new-account-token" ? { ok: true, board: { name: "Remote", prefix: "REM" } } : { ok: true, board: null }),
    });
    await ready();
    await waitFor(() => expect(field("Turso account token")).not.toBeNull());
    type("Turso account token", "new-account-token");
    type("Database address", ACCOUNT_DB.url);
    await waitFor(() => expect(field("Board name")?.value).toBe("Remote"));
    expect(calls.inspectDatabase).toHaveBeenLastCalledWith({ url: ACCOUNT_DB.url, tursoApiToken: "new-account-token" });
  });

  it("does not send a replacement account token before it is confirmed", async () => {
    const calls = renderDialog({ saved: true });
    await ready();
    press("Change Turso account token");
    await waitFor(() => expect(field("Turso account token")).not.toBeNull());
    type("Turso account token", "other-account-token");
    type("Database address", ACCOUNT_DB.url);
    await waitFor(() => expect(calls.inspectDatabase).toHaveBeenCalled());
    expect(calls.inspectDatabase).toHaveBeenLastCalledWith({ url: ACCOUNT_DB.url });
  });
});

describe("Connect database — copying before a folder is picked", () => {
  it("keeps the board fields locked and empty, without saying where they come from", async () => {
    renderDialog();
    await ready();
    fireEvent.click(screen.getByRole("checkbox", { name: "Copy tasks from a folder" }));
    await waitFor(() => expect(field("Board name")?.disabled).toBe(true));
    expect(field("Board name")?.value).toBe("");
    expect(screen.queryByText("From the folder board")).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy board" })?.hasAttribute("disabled")).toBe(true);
  });
});
