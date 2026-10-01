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
}

function renderDialog({
  saved = false,
  connect = () => ({ ok: true }),
  generate = () => ({ ok: true, token: "cli-token" }),
  create = () => ({ ok: true, url: CREATED }),
  list = () => ({ ok: true, databases: [ACCOUNT_DB] }),
}: Rpc = {}) {
  const calls = {
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

describe("Connect database — the fields", () => {
  it("offers Address, Token, Board and Prefix, and Connect stays off without an address", async () => {
    renderDialog();
    await ready();
    for (const label of ["Address", "Token", "Board", "Prefix"]) expect(field(label), label).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Connect" })?.hasAttribute("disabled")).toBe(true);
  });

  it("the move flag shows the folder boards to move and hides Board and Prefix", async () => {
    renderDialog();
    await ready();
    const flag = screen.queryByRole("checkbox", { name: "Move tasks from a folder" });
    expect(flag).not.toBeNull();
    fireEvent.click(flag!);
    await waitFor(() => expect(field("Board")).toBeNull());
    expect(field("Prefix")).toBeNull();
    fireEvent.click(screen.getByLabelText("Folder"));
    expect(await screen.findByRole("option", { name: /Tasks Plugin/ })).toBeDefined();
  });

  it("moving a folder sends its board and no name or prefix", async () => {
    const calls = renderDialog();
    await ready();
    fireEvent.click(screen.getByRole("checkbox", { name: "Move tasks from a folder" }));
    fireEvent.click(await screen.findByLabelText("Folder"));
    fireEvent.click(await screen.findByRole("option", { name: /Tasks Plugin/ }));
    type("Address", "libsql://board-me.turso.io");
    type("Token", "tok");
    press("Connect");
    await waitFor(() => expect(calls.connectDatabase).toHaveBeenCalledTimes(1));
    const input = calls.connectDatabase.mock.calls[0]![0] as Record<string, unknown>;
    expect(input).toMatchObject({ url: "libsql://board-me.turso.io", token: "tok", moveFromBoardId: PROJECT_ID });
    expect(input.name ?? null).toBeNull();
    expect(input.prefix ?? null).toBeNull();
  });
});

describe("Connect database — Create", () => {
  it("asks for a Turso API token when none is saved, then creates the database and fills the address", async () => {
    const calls = renderDialog({ saved: false });
    await ready();
    type("Board", "Remote");
    type("Prefix", "REM");
    press("Create");
    await waitFor(() => expect(field("Turso API token")).not.toBeNull());
    expect(calls.createDatabase).not.toHaveBeenCalled();
    type("Turso API token", "account-token");
    press("Create");
    await waitFor(() => expect(calls.createDatabase).toHaveBeenCalledWith(expect.objectContaining({ prefix: "REM", tursoApiToken: "account-token" })));
    await waitFor(() => expect(field("Address")?.value).toBe(CREATED));
  });

  it("creates at once with the saved token and fills the address", async () => {
    const calls = renderDialog({ saved: true });
    await ready();
    type("Board", "Remote");
    type("Prefix", "REM");
    press("Create");
    await waitFor(() => expect(calls.createDatabase).toHaveBeenCalledTimes(1));
    expect((calls.createDatabase.mock.calls[0]![0] as Record<string, unknown>).tursoApiToken).toBeUndefined();
    await waitFor(() => expect(field("Address")?.value).toBe(CREATED));
  });
});

describe("Connect database — a database of the account", () => {
  it("picking it from the address list connects it without a token", async () => {
    const calls = renderDialog({ saved: true });
    await ready();
    fireEvent.click(screen.getByLabelText("Address"));
    fireEvent.click(await screen.findByRole("option", { name: /bb-tasks-web/ }));
    await waitFor(() => expect(field("Address")?.value).toBe(ACCOUNT_DB.url));
    press("Connect");
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
    type("Address", "libsql://board-me.turso.io");
    type("Token", "tok");
    type("Board", "Remote");
    type("Prefix", "REM");
    press("Connect");
    await waitFor(() => expect(screen.queryByText("Cannot reach the database")).not.toBeNull());
    expect(calls.onConnected).not.toHaveBeenCalled();
    expect(calls.onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

describe("Connect database — Generate a Turso API token", () => {
  async function askedForTursoToken(rpc: Rpc) {
    const calls = renderDialog({ saved: false, ...rpc });
    await ready();
    type("Board", "Remote");
    type("Prefix", "REM");
    press("Create");
    await waitFor(() => expect(field("Turso API token")).not.toBeNull());
    return calls;
  }

  it("no longer sends to the documentation", async () => {
    await askedForTursoToken({});
    expect(screen.queryByRole("link", { name: "Where to get it" })).toBeNull();
    expect(document.querySelector('a[href*="docs.turso.tech"]')).toBeNull();
  });

  it("Generate puts the token the CLI minted into the field, and Create sends it", async () => {
    const calls = await askedForTursoToken({});
    press("Generate");
    await waitFor(() => expect(field("Turso API token")?.value).toBe("cli-token"));
    expect(calls.generateTursoApiToken).toHaveBeenCalledTimes(1);
    press("Create");
    await waitFor(() => expect(calls.createDatabase).toHaveBeenCalledWith(expect.objectContaining({ tursoApiToken: "cli-token" })));
  });

  it("without a login, says which command to run and links the Turso dashboard", async () => {
    await askedForTursoToken({ generate: () => ({ ok: false, reason: "not_logged_in", message: "user not logged in" }) });
    press("Generate");
    await waitFor(() => expect(screen.queryByText("turso auth login")).not.toBeNull());
    const link = screen.queryByRole("link", { name: /Turso dashboard/ });
    expect(link?.getAttribute("href")).toMatch(/^https:\/\/app\.turso\.tech/);
    expect(field("Turso API token")?.value).toBe("");
  });

  it("without the CLI, says to install it and links the Turso dashboard", async () => {
    await askedForTursoToken({ generate: () => ({ ok: false, reason: "cli_missing", message: "turso CLI not found" }) });
    press("Generate");
    await waitFor(() => expect(screen.queryByText(/Install the Turso CLI/)).not.toBeNull());
    expect(screen.queryByRole("link", { name: /Turso dashboard/ })).not.toBeNull();
  });

  it("any other refusal shows the CLI's words and the dashboard link", async () => {
    await askedForTursoToken({ generate: () => ({ ok: false, reason: "failed", message: "quota exceeded" }) });
    press("Generate");
    await waitFor(() => expect(screen.queryByText(/quota exceeded/)).not.toBeNull());
    expect(screen.queryByRole("link", { name: /Turso dashboard/ })).not.toBeNull();
  });
});

describe("Connect database — Generate mints one token at a time", () => {
  it("is off once the field holds a token, so a second press cannot leave a spare token in the account", async () => {
    renderDialog({ saved: false });
    await ready();
    type("Board", "Remote");
    type("Prefix", "REM");
    press("Create");
    await waitFor(() => expect(field("Turso API token")).not.toBeNull());
    press("Generate");
    await waitFor(() => expect(field("Turso API token")?.value).toBe("cli-token"));
    expect(screen.queryByRole("button", { name: "Generate" })?.hasAttribute("disabled")).toBe(true);
  });

  it("names the token it makes, so it can be found and revoked in the dashboard", async () => {
    renderDialog({ saved: false });
    await ready();
    type("Board", "Remote");
    type("Prefix", "REM");
    press("Create");
    await waitFor(() => expect(field("Turso API token")).not.toBeNull());
    expect(screen.queryByText(/bb-tasks-plus-/)).not.toBeNull();
  });

  it("without the CLI, shows the command that installs it", async () => {
    renderDialog({ saved: false, generate: () => ({ ok: false, reason: "cli_missing", message: "m" }) });
    await ready();
    type("Board", "Remote");
    type("Prefix", "REM");
    press("Create");
    await waitFor(() => expect(field("Turso API token")).not.toBeNull());
    press("Generate");
    await waitFor(() => expect(screen.queryByText("brew install tursodatabase/tap/turso")).not.toBeNull());
  });
});

describe("Connect database — a saved Turso token the account refuses", () => {
  const REFUSED = { ok: false, error: { code: "turso_token_refused", message: "Turso refused the saved API token." } };

  it("Create refused opens the Turso API token field, and the next Create sends the new token", async () => {
    const answers = [REFUSED, { ok: true, url: CREATED }];
    const calls = renderDialog({ saved: true, create: () => answers.shift() });
    await ready();
    type("Board", "Remote");
    type("Prefix", "REM");
    press("Create");
    await waitFor(() => expect(field("Turso API token")).not.toBeNull());
    expect(screen.getByRole("button", { name: "Generate" })).toBeDefined();
    expect(screen.getByText("Turso refused the saved API token.")).toBeDefined();
    type("Turso API token", "new-account-token");
    press("Create");
    await waitFor(() => expect(calls.createDatabase).toHaveBeenLastCalledWith(expect.objectContaining({ prefix: "REM", tursoApiToken: "new-account-token" })));
    await waitFor(() => expect(field("Address")?.value).toBe(CREATED));
  });

  it("opening the dialog with a refused token asks for a new one before any Create", async () => {
    renderDialog({ saved: true, list: () => REFUSED });
    await ready();
    await waitFor(() => expect(field("Turso API token")).not.toBeNull());
  });
});

describe("Connect database — Replace token", () => {
  it("opens the Turso API token field while the saved token still works, and Create sends the new one", async () => {
    const calls = renderDialog({ saved: true });
    await ready();
    expect(field("Turso API token")).toBeNull();
    press("Replace token");
    await waitFor(() => expect(field("Turso API token")).not.toBeNull());
    type("Prefix", "REM");
    type("Turso API token", "other-account-token");
    press("Create");
    await waitFor(() => expect(calls.createDatabase).toHaveBeenCalledWith(expect.objectContaining({ prefix: "REM", tursoApiToken: "other-account-token" })));
  });

  it("is not offered when no token is saved: Create asks for one anyway", async () => {
    renderDialog({ saved: false });
    await ready();
    expect(screen.queryByRole("button", { name: "Replace token" })).toBeNull();
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
    await waitFor(() => expect(field("Turso API token")).not.toBeNull());
    type("Address", ACCOUNT_DB.url);
    type("Turso API token", "new-account-token");
    press("Connect");
    await waitFor(() => expect(calls.connectDatabase).toHaveBeenCalledWith(expect.objectContaining({ url: ACCOUNT_DB.url, tursoApiToken: "new-account-token" })));
  });

  it("lists the account's databases again once Create took the new token", async () => {
    const lists = [REFUSED, { ok: true, databases: [ACCOUNT_DB] }];
    renderDialog({ saved: true, list: () => lists.shift() ?? { ok: true, databases: [ACCOUNT_DB] } });
    await ready();
    await waitFor(() => expect(field("Turso API token")).not.toBeNull());
    type("Prefix", "REM");
    type("Turso API token", "new-account-token");
    press("Create");
    await waitFor(() => expect(field("Address")?.value).toBe(CREATED));
    type("Address", "");
    fireEvent.focus(field("Address")!);
    expect(await screen.findByRole("option", { name: /bb-tasks-web/ })).toBeDefined();
  });

  it("Keep saved token takes Replace token back", async () => {
    const calls = renderDialog({ saved: true });
    await ready();
    press("Replace token");
    await waitFor(() => expect(field("Turso API token")).not.toBeNull());
    press("Keep saved token");
    await waitFor(() => expect(field("Turso API token")).toBeNull());
    type("Prefix", "REM");
    press("Create");
    await waitFor(() => expect(calls.createDatabase).toHaveBeenCalledTimes(1));
    expect((calls.createDatabase.mock.calls[0]![0] as Record<string, unknown>).tursoApiToken).toBeUndefined();
  });

  it("offers no way back to a saved token Turso refused", async () => {
    renderDialog({ saved: true, list: () => REFUSED });
    await ready();
    await waitFor(() => expect(field("Turso API token")).not.toBeNull());
    expect(screen.queryByRole("button", { name: "Keep saved token" })).toBeNull();
  });
});

describe("Connect database — a mistyped replacement token", () => {
  it("is refused without giving up the saved token: Keep saved token stays", async () => {
    const answers = [{ ok: false, error: { code: "turso_token_refused", message: "Turso refused this API token." } }];
    renderDialog({ saved: true, create: () => answers.shift() ?? { ok: true, url: CREATED } });
    await ready();
    press("Replace token");
    await waitFor(() => expect(field("Turso API token")).not.toBeNull());
    type("Prefix", "REM");
    type("Turso API token", "mistyped-token");
    press("Create");
    expect(await screen.findByText("Turso refused this API token.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Keep saved token" })).not.toBeNull();
  });
});
