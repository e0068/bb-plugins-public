// bb-plugin-prompt-drafts — сервер.
//
// Одно место правды для всех поверхностей: кнопки в композерах, секции Home и
// баннеров тредов. Список черновиков лежит в kv одним ключом; каждое
// изменение проходит функциями ядра, пишется целиком и публикует сигнал
// `drafts-changed`, по которому поверхности перечитывают список.
//
// Изменения идут строго по очереди: чтение-правка-запись двух одновременных
// вызовов иначе потеряла бы один из них.
import { randomUUID } from "node:crypto";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  composerKey,
  promoteStale,
  reclaimAuto,
  writeSlot,
  type Slot,
  type SlotMap,
} from "./core/autosave";
import { DRAFTS_CHANGED, addDraft, isBlank, removeDraft, swapDraft, type Draft, type DraftList } from "./core/drafts";
import { CARD_TEXT_OPTIONS, DEFAULT_SETTINGS, SETTING_BOUNDS } from "./core/settings";

const DRAFTS_KEY = "drafts";
const SLOTS_KEY = "autosave";
const MAX_TEXT = 100_000;

const placeSchema = z.object({
  threadId: z.string().nullable(),
  threadTitle: z.string().nullable(),
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  worktree: z.string().nullable(),
  branch: z.string().nullable(),
});

const draftSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  createdAt: z.number(),
  place: placeSchema,
  auto: z.boolean().optional(),
});

const slotSchema = z.object({
  text: z.string().max(MAX_TEXT),
  place: placeSchema,
  savedAt: z.number(),
  session: z.string().min(1),
});

/**
 * Карта слотов из kv — недоверенный ввод. Разбирается по одному слоту: одна
 * битая запись не должна уносить несохранённый текст остальных композеров.
 */
function parseSlots(value: unknown): SlotMap {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const slots: Record<string, Slot> = {};
  for (const [key, item] of Object.entries(value)) {
    const parsed = slotSchema.safeParse(item);
    if (parsed.success) slots[key] = parsed.data;
  }
  return slots;
}

const newDraftSchema = z
  .object({
    text: z.string().max(MAX_TEXT).refine((text) => !isBlank(text), "Draft text is empty"),
    place: placeSchema,
  })
  .strict();

export const rpcContract = defineRpcContract({
  list: {
    input: z.null(),
    output: z.object({ drafts: z.array(draftSchema) }),
  },
  save: {
    input: newDraftSchema,
    output: z.object({ draft: draftSchema }),
  },
  swap: {
    input: z.object({ takeId: z.string().min(1), put: newDraftSchema.nullable() }).strict(),
    output: z.object({ taken: draftSchema.nullable() }),
  },
  remove: {
    input: z.object({ id: z.string().min(1) }).strict(),
    output: z.object({ ok: z.literal(true) }),
  },
  /** Скрытый слот композера: пустой текст гасит слот, непустой переписывает. */
  autosave: {
    input: z.object({ text: z.string().max(MAX_TEXT), place: placeSchema }).strict(),
    output: z.object({ ok: z.literal(true) }),
  },
});

type NewDraft = z.infer<typeof newDraftSchema>;

/**
 * Запись из kv — недоверенный ввод: в работу идут только целые черновики.
 * Непонятые записи — например, от более новой версии плагина — не теряются:
 * они возвращаются в kv при каждой записи списка.
 */
function parseStored(value: unknown): { drafts: DraftList; foreign: readonly unknown[] } {
  if (!Array.isArray(value)) return { drafts: [], foreign: [] };
  const drafts: Draft[] = [];
  const foreign: unknown[] = [];
  for (const item of value) {
    const parsed = draftSchema.safeParse(item);
    if (parsed.success) drafts.push(parsed.data);
    else foreign.push(item);
  }
  return { drafts, foreign };
}

const materialize = ({ text, place }: NewDraft): Draft => ({ id: randomUUID(), text, createdAt: Date.now(), place });

/** Всплывший слот отличается от сохранённого рукой только пометкой. */
const materializeSlot = (slot: Slot): Draft => ({ ...materialize(slot), createdAt: slot.savedAt, auto: true });

export default async function plugin(bb: BbPluginApi) {
  bb.settings.define({
    cardLines: {
      type: "number",
      label: "Card text lines",
      description: "How many lines of a draft's text a card shows before cutting it off.",
      experimental_schema: z.number().int().min(SETTING_BOUNDS.cardLines.min).max(SETTING_BOUNDS.cardLines.max),
      default: DEFAULT_SETTINGS.cardLines,
    },
    cardWidth: {
      type: "number",
      label: "Card width, px",
      description: "Width of a draft card in pixels.",
      experimental_schema: z.number().int().min(SETTING_BOUNDS.cardWidth.min).max(SETTING_BOUNDS.cardWidth.max),
      default: DEFAULT_SETTINGS.cardWidth,
    },
    autosave: {
      type: "boolean",
      label: "Autosave drafts",
      description:
        "Keep what you type in a hidden slot of its composer. Nothing shows up while bb is running; if bb quits or crashes with the text still in the composer, it comes back as a card in Drafts on the next start. Sending the message or clearing the composer drops the slot.",
      default: DEFAULT_SETTINGS.autosave,
    },
    cardTextSize: {
      type: "select",
      label: "Card text size",
      description: "Font size of a draft's text inside a card. Default is the size bb uses for message text.",
      options: [...CARD_TEXT_OPTIONS],
      default: CARD_TEXT_OPTIONS[0],
    },
    showInThreads: {
      type: "boolean",
      label: "Show drafts in threads",
      description:
        "On: a draft saved in a thread shows above that thread's composer, and Home shows only drafts saved outside threads. Off: every draft shows on Home.",
      default: DEFAULT_SETTINGS.showInThreads,
    },
  });

  /**
   * Запуск бэкенда. Живёт ровно столько, сколько живёт хост bb, поэтому слот
   * с чужим запуском — это текст, переживший смерть приложения.
   */
  const session = randomUUID();

  const read = async () => ({
    ...parseStored(await bb.storage.kv.get(DRAFTS_KEY)),
    slots: parseSlots(await bb.storage.kv.get(SLOTS_KEY)),
  });

  interface State {
    readonly list: DraftList;
    readonly slots: SlotMap;
  }

  let queue: Promise<unknown> = Promise.resolve();

  /**
   * Правка списка и карты слотов по очереди. Каждый ключ пишется, только если
   * изменился, а сигнал шлётся только на изменение списка: правка невидимого
   * слота идёт на каждую паузу в наборе и дёргать поверхности не должна.
   */
  function mutate<T>(change: (state: State) => { list: DraftList; slots: SlotMap; result: T }): Promise<T> {
    const run = queue.then(async () => {
      const { drafts: before, foreign, slots: slotsBefore } = await read();
      const { list, slots, result } = change({ list: before, slots: slotsBefore });
      if (slots !== slotsBefore) await bb.storage.kv.set(SLOTS_KEY, slots);
      if (list !== before) {
        await bb.storage.kv.set(DRAFTS_KEY, [...list, ...foreign]);
        bb.realtime.publish(DRAFTS_CHANGED, {});
      }
      return result;
    });
    queue = run.catch(() => undefined);
    return run;
  }

  bb.rpc.register(rpcContract, {
    async list() {
      return { drafts: [...(await read()).drafts] };
    },
    async save(input) {
      const draft = materialize(input);
      return mutate(({ list, slots }) => ({ list: addDraft(list, draft), slots, result: { draft } }));
    },
    async swap({ takeId, put }) {
      const replacement = put === null ? null : materialize(put);
      return mutate(({ list, slots }) => {
        const { list: next, taken } = swapDraft(list, takeId, replacement);
        return { list: next, slots, result: { taken } };
      });
    },
    async remove({ id }) {
      return mutate(({ list, slots }) => {
        const next = removeDraft(list, id);
        return { list: next.length === list.length ? list : next, slots, result: { ok: true as const } };
      });
    },
    async autosave({ text, place }) {
      const key = composerKey(place);
      return mutate(({ list, slots }) => {
        if (isBlank(text)) return { list, slots: writeSlot(slots, key, null), result: { ok: true as const } };
        const slot: Slot = { text, place, savedAt: Date.now(), session };
        // Тот же текст уже висит карточкой этого композера — значит bb вернул
        // его в композер сам, и карточка стала двойником живого текста.
        return { list: reclaimAuto(list, key, text), slots: writeSlot(slots, key, slot), result: { ok: true as const } };
      });
    },
  });

  /**
   * Подъём на старте: слоты прошлых запусков становятся карточками. Идёт после
   * регистрации и своего сбоя наружу не отдаёт — недоступное хранилище должно
   * оставить плагин рабочим, а не снять его вызовы и настройки.
   */
  await mutate(({ list, slots }) => {
    const promoted = promoteStale(slots, list, session, materializeSlot);
    return { list: promoted.drafts, slots: promoted.slots, result: undefined };
  }).catch(() => undefined);
}
