// bb-plugin-threads-overview — backend.
//
// The list of threads that need attention is derived on the frontend from the
// live sidebar view, so the backend keeps no thread list of its own. The only
// durable state is the user's Postpone marks: which threads to hide from the
// section for now. They live in namespaced KV and are exposed over rpc.
//
// A postponed thread returns on its own once real work resumes in it — the mark
// is cleared when a thread goes active again — so Postpone reads as "not now",
// not "hide forever". Marks for threads that are archived or deleted are dropped
// so the map cannot grow without bound.
//
// All map branching lives in the pure `postpone` core; this file is read /
// change / write / notify wiring over `bb.storage.kv`.
//
// The preview window's footer also asks here for what the sidebar view does not
// carry: the thread's model, effort and mode, and its branch's git state.
//
// Nor does the sidebar view know what Flow runs in a thread without the agent —
// an automation or a pressed Action step — so the section asks Flow through here.
//
// A project's icon is its Tasks+ board's, the one bb's thread list wears; the
// section asks Tasks+ for it here, ready to draw.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  DEFAULT_PREVIEW_DELAY_SECONDS,
  MAX_PREVIEW_DELAY_SECONDS,
} from "./src/core/preview";
import { PREVIEW_SIZE_BOUNDS } from "./src/core/preview-size";
import {
  addMark,
  dropMark,
  toEntries,
  type PostponedMap,
} from "./src/core/postpone";

const POSTPONED_KEY = "postponed";
const POSTPONE_CHANGED_CHANNEL = "postpone-changed";

const postponedEntrySchema = z.object({ threadId: z.string(), at: z.number() });

/** Flow's plugin id and the RPC that lists threads running a step without the agent (bb-plugin-flow/shared/contract.ts). */
const FLOW_PLUGIN_ID = "flow";
const FLOW_RUNNING_METHOD = "runningThreads";
const flowRunSchema = z.object({ threadId: z.string(), icon: z.enum(["automation", "action"]) });

/** Tasks+'s plugin id and the RPC that draws each bb project's icon (bb-plugin-tasks-plus/shared/contract.ts). */
const TASKS_PLUGIN_ID = "tasks-plus";
const TASKS_ICONS_METHOD = "bbProjectIcons";
const iconPaintSchema = z.union([z.object({ color: z.string() }), z.enum(["foreground", "background"])]);
const projectIconDrawingSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("glyph"),
    nodes: z.array(z.tuple([z.string(), z.record(z.string(), z.union([z.string(), z.number()]))])),
    transform: z.string().optional(),
    ink: iconPaintSchema.optional(),
    tile: iconPaintSchema.optional(),
  }),
  z.object({ kind: z.literal("emoji"), char: z.string() }),
]);
const projectIconSchema = z.object({ bbProjectId: z.string(), drawing: projectIconDrawingSchema });
export type ProjectIconDrawing = z.infer<typeof projectIconDrawingSchema>;
export type IconPaint = z.infer<typeof iconPaintSchema>;

export const rpcContract = defineRpcContract({
  listPostponed: {
    input: z.null(),
    output: z.object({ postponed: z.array(postponedEntrySchema) }),
  },
  setPostponed: {
    input: z
      .object({ threadId: z.string().min(1), postponed: z.boolean() })
      .strict(),
    output: z.object({ ok: z.literal(true) }),
  },
  runningFlowSteps: {
    input: z.null(),
    output: z.object({ running: z.array(flowRunSchema) }),
  },
  projectIcons: {
    input: z.null(),
    // Null when Tasks+ did not answer: the section keeps the icons it shows.
    output: z.object({ icons: z.array(projectIconSchema).nullable() }),
  },
  threadDetails: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: z.object({
      // Plain strings, not the host's enums: a level or mode added later must
      // still reach the footer rather than fail the whole answer.
      execution: z
        .object({ model: z.string(), reasoningLevel: z.string(), permissionMode: z.string() })
        .nullable(),
      git: z.object({ commitsAhead: z.number(), uncommitted: z.boolean() }).nullable(),
    }),
  },
});

export default async function plugin(bb: BbPluginApi) {
  // The one thing the user configures. Declared here so bb renders it on the
  // plugin's own settings page; nothing on this side reads it back — the
  // section does, live, through `useSettings()` and `parsePreviewDelayMs`.
  // Setting descriptors carry no number type, hence a numeric string.
  bb.settings.define({
    previewDelaySeconds: {
      type: "string",
      label: "Задержка превью беседы, секунды",
      description: `Через сколько секунд наведения на строку показывать беседу треда. 0 — не показывать вовсе. Не больше ${MAX_PREVIEW_DELAY_SECONDS}.`,
      default: String(DEFAULT_PREVIEW_DELAY_SECONDS),
    },
    previewWidth: {
      type: "string",
      label: "Ширина превью, пиксели",
      description: `Ширина всплывающего окна с беседой треда. От ${PREVIEW_SIZE_BOUNDS.width.min} до ${PREVIEW_SIZE_BOUNDS.width.max}.`,
      default: String(PREVIEW_SIZE_BOUNDS.width.default),
    },
    previewHeight: {
      type: "string",
      label: "Высота превью, пиксели",
      description: `Предельная высота всплывающего окна: короткая беседа занимает меньше, окно не выше экрана. От ${PREVIEW_SIZE_BOUNDS.height.min} до ${PREVIEW_SIZE_BOUNDS.height.max}.`,
      default: String(PREVIEW_SIZE_BOUNDS.height.default),
    },
    experimentalSidePanel: {
      type: "boolean",
      label: "Экспериментально — боковая панель и стрелки",
      description:
        "Выбор, открывать ли тред на весь экран или в одной боковой панели; стрелки из пустого Composer в очередь и обратно. Держится на поведении bb, которого нет в SDK, поэтому может сломаться после обновления bb.",
      default: false,
    },
    invertOnPhone: {
      type: "boolean",
      label: "Инвертировать на телефоне",
      description:
        "На узком экране секция идёт снизу вверх: сразу над Composer число тредов и фильтры, выше ряд проектов, ещё выше треды — первый ближе всех к пальцу.",
      default: false,
    },
  });

  // A failed lookup leaves its part of the footer empty instead of failing the rpc.
  async function orNull<T>(read: () => Promise<T | null>): Promise<T | null> {
    try {
      return await read();
    } catch {
      return null;
    }
  }

  const readExecution = (threadId: string) =>
    orNull(async () => {
      const options = await bb.sdk.threads.defaultExecutionOptions({ threadId });
      if (!options) return null;
      const { model, reasoningLevel, permissionMode } = options;
      return { model, reasoningLevel, permissionMode };
    });

  const readGit = (threadId: string) =>
    orNull(async () => {
      const { environmentId } = await bb.sdk.threads.get({ threadId });
      if (!environmentId) return null;
      const status = await bb.sdk.environments.status({ environmentId });
      if (status.outcome !== "available") return null;
      return {
        commitsAhead: status.workspace.mergeBase?.aheadCount ?? 0,
        uncommitted: status.workspace.workingTree.hasUncommittedChanges,
      };
    });

  async function readMap(): Promise<PostponedMap> {
    return (await bb.storage.kv.get<PostponedMap>(POSTPONED_KEY)) ?? {};
  }

  /** Persist and notify only when the map actually changed. */
  async function commit(before: PostponedMap, after: PostponedMap): Promise<void> {
    if (after === before) return;
    await bb.storage.kv.set(POSTPONED_KEY, after);
    bb.realtime.publish(POSTPONE_CHANGED_CHANNEL, {});
  }

  async function forget(threadId: string): Promise<void> {
    const before = await readMap();
    await commit(before, dropMark(before, threadId));
  }

  bb.rpc.register(rpcContract, {
    async listPostponed() {
      return { postponed: toEntries(await readMap()) };
    },
    async setPostponed({ threadId, postponed }) {
      const before = await readMap();
      const after = postponed
        ? addMark(before, threadId, Date.now())
        : dropMark(before, threadId);
      await commit(before, after);
      return { ok: true } as const;
    },
    async runningFlowSteps() {
      // Flow not installed, disabled or too old: nothing runs on its behalf.
      const running = await orNull(() =>
        bb.sdk.plugins.callRpc({
          pluginId: FLOW_PLUGIN_ID,
          method: FLOW_RUNNING_METHOD,
          input: {},
          outputSchema: z.array(flowRunSchema),
        }),
      );
      return { running: running ?? [] };
    },
    async projectIcons() {
      // Tasks+ not installed, disabled or too old: no answer, and no icons.
      const answer = await orNull(() =>
        bb.sdk.plugins.callRpc({
          pluginId: TASKS_PLUGIN_ID,
          method: TASKS_ICONS_METHOD,
          input: {},
          outputSchema: z.object({ icons: z.array(z.unknown()) }),
        }),
      );
      // Each icon on its own: one this side cannot draw — a kind a newer Tasks+ added — takes no other off.
      const icons = answer?.icons.flatMap((icon) => {
        const parsed = projectIconSchema.safeParse(icon);
        return parsed.success ? [parsed.data] : [];
      });
      return { icons: icons ?? null };
    },
    async threadDetails({ threadId }) {
      const [execution, git] = await Promise.all([readExecution(threadId), readGit(threadId)]);
      return { execution, git };
    },
  });

  // Work resumed in a postponed thread — the snooze is spent, so it re-enters
  // the queue once it next goes idle.
  bb.events.on("thread.active", ({ thread }) => {
    void forget(thread.id);
  });
  // The thread is gone; forget its mark.
  bb.events.on("thread.archived", ({ thread }) => {
    void forget(thread.id);
  });
  bb.events.on("thread.deleted", ({ thread }) => {
    void forget(thread.id);
  });
}
