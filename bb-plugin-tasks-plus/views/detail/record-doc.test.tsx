// @vitest-environment jsdom
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { prepareBoardDom } from "../../test-support/board-harness.js";

prepareBoardDom();
const app = await loadPluginApp(() => import("../../app"));
// After the app: a module that reaches the SDK must not load before loadPluginApp.
const { DetailView } = await import("./index.js");
const { TasksRefreshProvider } = await import("../../client/refresh.js");
const { loadedDoc, saveResult } = await import("./record-doc.js");

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const URL = "libsql://team-me.turso.io";
const DOCS_ID = "01HZZZZZZZZZZZZZZZZZZZZZT2";
const TEAM_ID = "01HZZZZZZZZZZZZZZZZZZZZZT1";
const project = (id: string, name: string, database: Record<string, unknown>) => ({
  id,
  name,
  prefix: name.slice(0, 3).toUpperCase(),
  nextTaskNumber: 2,
  color: "steelblue",
  folderId: null,
  linkedBbProjectId: null,
  tasksFolder: null,
  database,
  createdAt: "2026-07-15T00:00:00.000Z",
});

const record = (projectId: string, key: string) => ({
  id: `${projectId}:onboarding`,
  projectId,
  number: 1,
  key,
  title: "Onboarding",
  description: "First day at the team",
  status: "todo",
  priority: "none",
  dueDate: null,
  startDate: null,
  parentTaskId: null,
  position: 100,
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
  labelIds: [],
  type: null,
  estimate: null,
  plannedMinutes: null,
  actualMinutes: null,
  budget: null,
  budgetLimit: null,
  cost: null,
  source: null,
});

const SECTION_FIELDS = [{ name: "size", type: "number" }];

function renderDetail(
  task: Omit<ReturnType<typeof record>, "labelIds"> & { properties?: Record<string, string>; labelIds: string[] },
  fields: readonly Record<string, unknown>[] = SECTION_FIELDS,
  labels: readonly Record<string, unknown>[] = [],
  updateTask: () => unknown = () => ({ ok: true, task }),
) {
  return renderSlot(
    { ...app.navPanels[0]!, component: () => (
        <TasksRefreshProvider>
          <DetailView taskKey={task.key} />
        </TasksRefreshProvider>
      ) },
    { subPath: "all" },
    {
      rpc: {
        getTaskByKey: () => ({ task }),
        listProjects: () => ({ projects: [project(TEAM_ID, "Team", { url: URL }), project(DOCS_ID, "Docs", { url: URL, table: "docs0001", fields })] }),
        readTaskText: () => ({ text: { content: "---\ntitle: Onboarding\n---\n\nFirst day at the team\n", sha256: "abc" } }),
        getTask: () => ({ task: null }),
        listTasks: () => ({ tasks: [] }),
        listLabels: () => ({ labels }),
        listAttachments: () => ({ attachments: [] }),
        listTaskThreads: () => ({ taskThreads: [] }),
        listPresets: () => ({ presets: [] }),
        listComments: () => ({ comments: [] }),
        searchThreads: () => ({ threads: [] }),
        updateTask,
        changeFieldOption: () => ({ ok: true }),
      },
    },
  );
}

describe("a record of a table, opened", () => {
  it("is shown by the document view with its text, not by the task card", async () => {
    const slot = renderDetail(record(DOCS_ID, "DOC-1"));
    await slot.findByText(/First day at the team/);
    expect(slot.rpcCalls).toContainEqual(expect.objectContaining({ method: "readTaskText", input: expect.objectContaining({ taskId: `${DOCS_ID}:onboarding` }) }));
    expect(slot.queryByRole("button", { name: /add property/i })).toBeNull();
  });

  it("leaves a task of the task board to the task card, with no switch", async () => {
    const slot = renderDetail(record(TEAM_ID, "TEA-1"));
    await slot.findByRole("button", { name: /add property/i });
    expect(slot.rpcCalls.map((call) => call.method)).not.toContain("readTaskText");
    expect(slot.queryByRole("group", { name: "Open the record in" })).toBeNull();
  });

  it("opens in the task card once Card is picked, and stays so for the next record opened", async () => {
    const slot = renderDetail(record(DOCS_ID, "DOC-1"));
    await slot.findByRole("group", { name: "Open the record in" });
    expect(slot.getByRole("button", { name: "Kasimov" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(slot.getByRole("button", { name: "Card" }));

    await slot.findByRole("button", { name: /add property/i });
    cleanup();
    const next = renderDetail(record(DOCS_ID, "DOC-1"));
    await next.findByRole("button", { name: /add property/i });
    expect(next.getByRole("button", { name: "Card" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("stands in the card on the page itself, with no card frame or backdrop under its switch", async () => {
    window.localStorage.setItem("bb-tasks:record-viewer", "card");
    const slot = renderDetail(record(DOCS_ID, "DOC-1"));
    const properties = await slot.findByRole("region", { name: "Properties" });
    expect(slot.container.querySelector(".bg-surface-recessed-solid")).toBeNull();
    expect(properties.closest(".bg-card")).toBeNull();
  });

  it("shows in the card the section's columns as its Properties, and no field of a task", async () => {
    window.localStorage.setItem("bb-tasks:record-viewer", "card");
    const slot = renderDetail({ ...record(DOCS_ID, "DOC-1"), properties: { size: "3", mood: "calm" } });
    const properties = await slot.findByRole("region", { name: "Properties" });
    const rows = Array.from(properties.querySelectorAll("[data-property]")).map((row) => row.getAttribute("data-property"));

    expect(rows).toEqual(["Created", "Edited", "tags", "date", "size", "mood"]);
    expect((slot.getByRole("spinbutton", { name: "size" }) as HTMLInputElement).value).toBe("3");
    expect(slot.queryByText("No priority")).toBeNull();
    expect(slot.queryByText(/Budget/)).toBeNull();
  });

  it("saves a field edited in the card as the record's property", async () => {
    window.localStorage.setItem("bb-tasks:record-viewer", "card");
    const slot = renderDetail({ ...record(DOCS_ID, "DOC-1"), properties: { size: "3" } });
    const size = await slot.findByRole("spinbutton", { name: "size" });

    fireEvent.change(size, { target: { value: "5" } });
    fireEvent.blur(size);

    await vi.waitFor(() =>
      expect(slot.rpcCalls).toContainEqual(
        expect.objectContaining({ method: "updateTask", input: expect.objectContaining({ propertyPatch: { set: { size: "5" } } }) }),
      ),
    );
  });
});

describe("a section's field edited in the card", () => {
  const patches = (slot: ReturnType<typeof renderDetail>) =>
    slot.rpcCalls.filter((call) => call.method === "updateTask").map((call) => (call.input as { propertyPatch?: unknown }).propertyPatch);

  it("saves a date only once its year has four digits, not on every digit typed", async () => {
    window.localStorage.setItem("bb-tasks:record-viewer", "card");
    const slot = renderDetail(record(DOCS_ID, "DOC-1"));
    const date = await slot.findByLabelText("date");

    for (const typed of ["0002-10-13", "0020-10-13", "0202-10-13", "2026-10-13"]) fireEvent.change(date, { target: { value: typed } });

    await vi.waitFor(() => expect(patches(slot)).toEqual([{ set: { date: "2026-10-13" } }]));
  });

  it("takes a listed field away when emptied, and keeps a field only records have as empty", async () => {
    window.localStorage.setItem("bb-tasks:record-viewer", "card");
    const slot = renderDetail({ ...record(DOCS_ID, "DOC-1"), properties: { size: "3", mood: "calm" } });
    const size = await slot.findByRole("spinbutton", { name: "size" });
    fireEvent.change(size, { target: { value: "" } });
    fireEvent.blur(size);
    const mood = slot.getByRole("textbox", { name: "mood" });
    fireEvent.change(mood, { target: { value: "" } });
    fireEvent.blur(mood);

    await vi.waitFor(() => expect(patches(slot)).toEqual([{ remove: ["size"] }, { set: { mood: "" } }]));
  });
});

describe("a Select or Tags field in the card", () => {
  const CHOICES = [
    { name: "topics", type: "tags", options: ["a", "b"] },
    { name: "stage", type: "select", options: ["Idea", "Done"] },
  ];
  const patches = (slot: ReturnType<typeof renderDetail>) =>
    slot.rpcCalls.filter((call) => call.method === "updateTask").map((call) => (call.input as { propertyPatch?: unknown }).propertyPatch);
  const optionCalls = (slot: ReturnType<typeof renderDetail>) => slot.rpcCalls.filter((call) => call.method === "changeFieldOption").map((call) => call.input);

  it("picks a Select's one option from the field's options", async () => {
    window.localStorage.setItem("bb-tasks:record-viewer", "card");
    const slot = renderDetail(record(DOCS_ID, "DOC-1"), CHOICES);
    fireEvent.click(await slot.findByRole("button", { name: "stage" }));
    fireEvent.click(await slot.findByRole("option", { name: "Done" }));

    await vi.waitFor(() => expect(patches(slot)).toEqual([{ set: { stage: "Done" } }]));
  });

  it("adds a tag to a Tags value, keeping the ones it holds", async () => {
    window.localStorage.setItem("bb-tasks:record-viewer", "card");
    const slot = renderDetail({ ...record(DOCS_ID, "DOC-1"), properties: { topics: "a" } }, CHOICES);
    fireEvent.click(await slot.findByRole("button", { name: "topics" }));
    expect((await slot.findByRole("option", { name: "a" })).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(slot.getByRole("option", { name: "b" }));

    await vi.waitFor(() => expect(patches(slot)).toEqual([{ set: { topics: "a, b" } }]));
  });

  it("keeps the first of two tags picked before the record comes back", async () => {
    window.localStorage.setItem("bb-tasks:record-viewer", "card");
    const slot = renderDetail(record(DOCS_ID, "DOC-1"), CHOICES);
    fireEvent.click(await slot.findByRole("button", { name: "topics" }));
    fireEvent.click(await slot.findByRole("option", { name: "a" }));
    fireEvent.click(slot.getByRole("option", { name: "b" }));

    await vi.waitFor(() => expect(patches(slot)).toEqual([{ set: { topics: "a" } }, { set: { topics: "a, b" } }]));
  });

  it("makes a name typed and entered an option of the field, and picks it", async () => {
    window.localStorage.setItem("bb-tasks:record-viewer", "card");
    const slot = renderDetail(record(DOCS_ID, "DOC-1"), CHOICES);
    fireEvent.click(await slot.findByRole("button", { name: "stage" }));
    const find = await slot.findByRole("textbox", { name: "Find or add an option of stage" });
    fireEvent.change(find, { target: { value: "Review" } });
    fireEvent.keyDown(find, { key: "Enter" });

    await vi.waitFor(() => expect(patches(slot)).toEqual([{ set: { stage: "Review" } }]));
    expect(optionCalls(slot)).toEqual([expect.objectContaining({ boardId: DOCS_ID, field: "stage", option: "Review", change: "add" })]);
  });

  it("takes an option off the field by its bin, without touching the record", async () => {
    window.localStorage.setItem("bb-tasks:record-viewer", "card");
    const slot = renderDetail(record(DOCS_ID, "DOC-1"), CHOICES);
    fireEvent.click(await slot.findByRole("button", { name: "stage" }));
    fireEvent.click(await slot.findByRole("button", { name: "Delete option Idea" }));

    await vi.waitFor(() => expect(optionCalls(slot)).toEqual([expect.objectContaining({ field: "stage", option: "Idea", change: "remove" })]));
    expect(patches(slot)).toEqual([]);
  });

  it("picks the Tags every section has from the labels its records carry, and saves them as the record's labels", async () => {
    window.localStorage.setItem("bb-tasks:record-viewer", "card");
    const slot = renderDetail({ ...record(DOCS_ID, "DOC-1"), labelIds: ["hr"] }, CHOICES, [{ id: "hr", projectId: DOCS_ID, name: "hr", color: "#6b7280" }, { id: "urgent", projectId: DOCS_ID, name: "urgent", color: "#6b7280" }]);
    const tags = (await slot.findByRole("button", { name: "Edit labels" })).closest("[data-property]")!;
    expect(tags.getAttribute("data-property")).toBe("tags");
    expect(tags.textContent).toContain("hr");
    fireEvent.click(slot.getByRole("button", { name: "Edit labels" }));
    fireEvent.click(await slot.findByRole("option", { name: "urgent" }));

    await vi.waitFor(() => expect(slot.rpcCalls.filter((call) => call.method === "updateTask").map((call) => call.input)).toEqual([expect.objectContaining({ labelIds: ["hr", "urgent"] })]));
    expect(optionCalls(slot)).toEqual([]);
  });

  it("refuses an option with a comma without asking the database", async () => {
    window.localStorage.setItem("bb-tasks:record-viewer", "card");
    const slot = renderDetail(record(DOCS_ID, "DOC-1"), CHOICES);
    fireEvent.click(await slot.findByRole("button", { name: "topics" }));
    const find = await slot.findByRole("textbox", { name: "Find or add an option of topics" });
    fireEvent.change(find, { target: { value: "x,y" } });
    fireEvent.keyDown(find, { key: "Enter" });

    expect((await slot.findByRole("alert")).textContent).toMatch(/comma/);
    expect(optionCalls(slot)).toEqual([]);
  });
});

describe("the record's text between the view and the server", () => {
  it("hands the view the text and its hash, and an error for a record that is gone", () => {
    expect(loadedDoc("DOC-1.md", { content: "text", sha256: "abc" })).toEqual({ path: "DOC-1.md", content: "text", sha256: "abc", error: null });
    expect(loadedDoc("DOC-1.md", null)).toMatchObject({ path: "DOC-1.md", content: null, error: expect.any(String) });
  });

  it("tells the view a save that lost to another edit as a conflict, with a reason", () => {
    expect(saveResult({ outcome: "written", sha256: "def" })).toEqual({ outcome: "written", sha256: "def" });
    expect(saveResult({ outcome: "conflict" })).toMatchObject({ outcome: "conflict", message: expect.any(String) });
    expect(saveResult({ outcome: "not-found" })).toMatchObject({ outcome: "not-found" });
  });

  it("tells the view fields that do not read as a refused save, with a reason", () => {
    expect(saveResult({ outcome: "invalid" })).toMatchObject({ outcome: "denied", message: expect.stringMatching(/do not read/) });
  });
});

describe("a change in the card", () => {
  const LABELS = [{ id: "hr", projectId: DOCS_ID, name: "hr", color: "#6b7280" }, { id: "urgent", projectId: DOCS_ID, name: "urgent", color: "#6b7280" }];
  const CHOICES = [{ name: "stage", type: "select", options: ["Idea", "Done"] }];
  const never = () => new Promise(() => {});

  it("shows at once, while its write is still on its way", async () => {
    window.localStorage.setItem("bb-tasks:record-viewer", "card");
    const slot = renderDetail({ ...record(DOCS_ID, "DOC-1"), labelIds: ["hr"] }, CHOICES, LABELS, never);
    fireEvent.click(await slot.findByRole("button", { name: "stage" }));
    fireEvent.click(await slot.findByRole("option", { name: "Done" }));
    fireEvent.click(slot.getByRole("button", { name: "Edit labels" }));
    fireEvent.click(await slot.findByRole("option", { name: "urgent" }));

    const properties = slot.getByRole("region", { name: "Properties" });
    await vi.waitFor(() => expect(properties.querySelector('[data-property="stage"]')!.textContent).toContain("Done"));
    expect(properties.querySelector('[data-property="tags"]')!.textContent).toContain("urgent");
  });

  it("goes back, with the reason, when its write is refused", async () => {
    window.localStorage.setItem("bb-tasks:record-viewer", "card");
    const refused = () => ({ ok: false, error: { code: "database_unreachable", message: "The database cannot be reached" } });
    const slot = renderDetail(record(DOCS_ID, "DOC-1"), CHOICES, LABELS, refused);
    fireEvent.click(await slot.findByRole("button", { name: "stage" }));
    fireEvent.click(await slot.findByRole("option", { name: "Done" }));

    await slot.findByText("The database cannot be reached");
    const stage = slot.getByRole("region", { name: "Properties" }).querySelector('[data-property="stage"]')!;
    expect(stage.textContent).not.toContain("Done");
  });
});
