// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { editorStore } from "./store";
import { compile, blankTree, type Tree } from "./workflow-model";

// ui/outline-editor.tsx's AgentDetails renders the real MarkdownEditor
// (../packages/md-editor/react) for the agent instructions field, which mounts
// the vanilla md-editor onto a contenteditable host via window.getSelection
// / document.createRange — jsdom does not reproduce real contenteditable
// editing behavior, so mounting it for real here would not exercise
// anything meaningful. Per bb-plugin-shelf/app.test.tsx's precedent for the
// same package, mock the wrapper at the boundary: the instructions field
// becomes a plain controlled textarea (data-testid="agent-prompt-mock"), so
// the outline-editor tests can edit it directly, while the real wrapper stays
// untouched for the actual bb build (verified separately via `bb plugin build`).
vi.mock("./packages/md-editor/react", () => ({
  MarkdownEditor: ({
    value,
    onChange,
  }: {
    value: string;
    onChange?: (next: string) => void;
  }) => (
    <textarea
      data-testid="agent-prompt-mock"
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
}));

const loadedTree: Tree = { ...blankTree("loaded-wf"), description: "d" };

function handlers(over: Record<string, (input: any) => unknown> = {}) {
  return {
    models: () => ({ models: ["opus", "sonnet"] }),
    projects: () => [{ id: "p1", name: "Repo" }],
    agents: () => ({
      agents: [
        {
          value: "code-reviewer",
          model: "opus",
          effort: "",
          provider: "claude-code",
          description: "Adversarial reviewer",
          path: "/home/.claude/agents/code-reviewer.md",
          tools: ["Read", "Grep", "Glob"],
          scope: "user",
        },
        {
          value: "feature-dev:code-explorer",
          model: "inherit",
          effort: "",
          provider: "claude-code",
          tools: [],
          scope: "user",
        },
      ],
    }),
    writeAgent: (input: any) => ({ path: "/home/.claude/agents/" + input.name + ".md" }),
    providerCatalog: () => [
      {
        id: "claude-code",
        name: "Claude Code",
        models: [
          { id: "opus", efforts: ["low", "medium", "high", "max"] },
          { id: "sonnet", efforts: ["low", "medium", "high"] },
        ],
      },
      {
        id: "codex",
        name: "Codex",
        models: [{ id: "gpt-5.1", efforts: ["medium"] }],
      },
    ],
    list: () => ({
      items: [
        { name: "a", path: "/repo/.bb/workflows/a.js", store: "project", description: "", hasTree: true },
        { name: "g", path: "/home/.claude/workflows/g.js", store: "global", description: "", hasTree: true },
      ],
    }),
    read: () => ({ source: compile(loadedTree), tree: loadedTree }),
    save: () => ({ path: "/repo/.bb/workflows/workflow.js" }),
    agentRefs: (input: any) => {
      if (input.path === "/home/.claude/agents/code-reviewer.md") {
        return {
          content: "Uses SKILL.md",
          refs: [{ label: "skill-a", path: "/home/.claude/skills/skill-a/SKILL.md" }],
        };
      }
      if (input.path === "/home/.claude/skills/skill-a/SKILL.md") {
        return {
          content: "Deeper ref here",
          refs: [{ label: "nested", path: "/home/.claude/agents/nested.md" }],
        };
      }
      return { content: "leaf", refs: [] };
    },
    ...over,
  };
}

async function renderPanel(over?: Record<string, (input: any) => unknown>) {
  const app = await loadPluginApp(() => import("./app"));
  return renderSlot(app.navPanels[0]!, { subPath: "" }, { rpc: handlers(over), context: { projectId: "p1" } });
}

beforeEach(() => editorStore.newWorkflow());
afterEach(() => cleanup());

describe("project selector", () => {
  it("shows a project select seeded from context, and switching it re-lists for the new project", async () => {
    const slot = await renderPanel({
      projects: () => [
        { id: "p1", name: "Repo" },
        { id: "p2", name: "Other" },
      ],
    });
    const select = (await slot.findByLabelText("project")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("p1"));
    fireEvent.change(select, { target: { value: "p2" } });
    await waitFor(() => {
      const call = slot.inspection.rpcCalls.filter((c) => c.method === "list").pop();
      expect((call!.input as any).projectId).toBe("p2");
    });
  });
});

describe("workflow list", () => {
  it("shows workflows grouped by store", async () => {
    const slot = await renderPanel();
    expect(await slot.findByText(/Project/)).toBeTruthy();
    expect(await slot.findByText(/Global/)).toBeTruthy();
    expect(await slot.findByText("a")).toBeTruthy();
    expect(await slot.findByText("g")).toBeTruthy();
  });
});

describe("open", () => {
  it("loads the read tree into the editor", async () => {
    const slot = await renderPanel();
    fireEvent.click(await slot.findByText("a"));
    await waitFor(() => {
      const input = slot.getByLabelText("outline workflow name") as HTMLInputElement;
      expect(input.value).toBe("loaded-wf");
    });
  });
});

describe("code-only (hand-written) workflow", () => {
  const raw = "export const meta = {\n  name: 'hand',\n  description: 'does a thing',\n}\nphase('P')\nawait agent('hi', {})\n";
  const codeOnlyHandlers = {
    list: () => ({ items: [{ name: "hand", path: "/home/.claude/workflows/hand.js", store: "global", description: "does a thing", hasTree: false }] }),
    read: () => ({ source: raw, tree: null }),
  };

  it("opens hand-written source read-only instead of a blank tree", async () => {
    const slot = await renderPanel(codeOnlyHandlers);
    fireEvent.click(await slot.findByText("hand"));
    const pre = (await slot.findByLabelText("workflow source")) as HTMLElement;
    expect(pre.textContent).toContain("phase('P')");
    // the outline editor's own fields must NOT be mounted in code-only mode
    expect(slot.queryByLabelText("outline workflow name")).toBeFalsy();
  });

  it("disables Save so the constructor can't overwrite the file", async () => {
    const slot = await renderPanel(codeOnlyHandlers);
    fireEvent.click(await slot.findByText("hand"));
    await slot.findByLabelText("workflow source");
    const save = slot.getByText("Save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });
});

describe("save", () => {
  it("compiles the current tree and calls save with the source", async () => {
    const slot = await renderPanel();
    // bb store requires a description — set one so the save is not blocked
    fireEvent.change(slot.getByLabelText("outline workflow description"), { target: { value: "d" } });
    fireEvent.click(slot.getByText("Save")); // opens the dialog
    fireEvent.click(await slot.findByLabelText("confirm save"));
    await waitFor(() => {
      const call = slot.inspection.rpcCalls.find((c) => c.method === "save");
      expect(call).toBeTruthy();
      expect((call!.input as any).source).toContain("export const meta");
    });
  });

  it("blocks a bb save when the description is empty", async () => {
    const slot = await renderPanel();
    fireEvent.click(slot.getByText("Save"));
    fireEvent.click(await slot.findByLabelText("confirm save"));
    await waitFor(() => {
      expect(slot.inspection.rpcCalls.find((c) => c.method === "save")).toBeFalsy();
    });
  });
});

describe("new", () => {
  it("resets the editor to a blank workflow", async () => {
    const slot = await renderPanel();
    const input = () => slot.getByLabelText("outline workflow name") as HTMLInputElement;
    fireEvent.change(input(), { target: { value: "temp-name" } });
    expect(input().value).toBe("temp-name");
    fireEvent.click(slot.getByText("+ New workflow"));
    await waitFor(() => expect(input().value).toBe("workflow"));
  });
});

describe("outline editor", () => {
  async function openOutline(over?: Record<string, (input: any) => unknown>) {
    const slot = await renderPanel(over);
    await slot.findByText("+ Add Phase"); // wait for the outline to actually mount
    return slot;
  }

  it("renders the outline as the panel's only editor", async () => {
    const slot = await openOutline();
    expect(await slot.findByText("+ Add Phase")).toBeTruthy();
    expect(await slot.findByText("Phase 1")).toBeTruthy();
  });

  it("Add Agent under a phase adds a step to the phase in the store", async () => {
    const slot = await openOutline();
    expect(editorStore.getSnapshot().tree.phases[0].steps.length).toBe(1);
    fireEvent.click(slot.getAllByText("Add Agent")[0]);
    await waitFor(() => expect(editorStore.getSnapshot().tree.phases[0].steps.length).toBe(2));
  });

  it("clicking the phase mode glyph toggles between parallel and pipeline", async () => {
    const slot = await openOutline();
    fireEvent.click(await slot.findByLabelText(/sequential|parallel/));
    await waitFor(() => expect(editorStore.getSnapshot().tree.phases[0].mode).toBe("parallel"));
    fireEvent.click(slot.getByLabelText(/sequential|parallel/));
    await waitFor(() => expect(editorStore.getSnapshot().tree.phases[0].mode).toBe("pipeline"));
  });

  it("renaming the phase title inline updates the tree", async () => {
    const slot = await openOutline();
    fireEvent.click(await slot.findByText("Phase 1"));
    const input = (await slot.findByLabelText("phase title")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Renamed Phase" } });
    fireEvent.blur(input);
    await waitFor(() => expect(editorStore.getSnapshot().tree.phases[0].title).toBe("Renamed Phase"));
  });

  it("clicking an agent opens its details, and editing Instructions writes to its prompt", async () => {
    const slot = await openOutline();
    fireEvent.click(await slot.findByText("Agent")); // the blank agent's placeholder name
    expect(await slot.findByLabelText("agent detail name")).toBeTruthy();
    const textarea = (await slot.findByTestId("agent-prompt-mock")) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Do the thing" } });
    await waitFor(() => {
      const agent = editorStore.getSnapshot().tree.phases[0].steps[0] as any;
      expect(agent.prompt).toBe("Do the thing");
    });
  });

  it("Save as new agent writes a fresh user-scope agent", async () => {
    const slot = await openOutline();
    fireEvent.click(await slot.findByText("Agent"));
    const nameInput = (await slot.findByLabelText("agent detail name")) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "my-agent" } });
    fireEvent.click(await slot.findByText("Save as new agent"));
    await waitFor(() => {
      const call = slot.inspection.rpcCalls.find((c) => c.method === "writeAgent");
      expect(call).toBeTruthy();
      expect((call!.input as any).overwrite).toBe(false);
      expect((call!.input as any).scope).toBe("user");
      expect((call!.input as any).name).toBe("my-agent");
    });
  });

  it("Override Existing Agent writes back to the picked template once touched", async () => {
    const slot = await openOutline();
    fireEvent.click(await slot.findByText("Agent"));
    const templateInput = (await slot.findByLabelText("agent template")) as HTMLInputElement;
    fireEvent.focus(templateInput);
    fireEvent.click(await slot.findByText("code-reviewer"));
    await waitFor(() => expect(templateInput.value).toBe("code-reviewer"));
    const textarea = (await slot.findByTestId("agent-prompt-mock")) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Updated instructions" } });
    fireEvent.click(await slot.findByText("Override Existing Agent"));
    await waitFor(() => {
      const call = slot.inspection.rpcCalls.find((c) => c.method === "writeAgent" && (c.input as any).overwrite === true);
      expect(call).toBeTruthy();
      expect((call!.input as any).name).toBe("code-reviewer");
      expect((call!.input as any).scope).toBe("user");
    });
  });
});
