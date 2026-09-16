import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

import { CALLER_THREAD_FIELD } from "../shared/enums.js";

const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

const idSchema = z.string().regex(ULID_PATTERN, "must be a ULID");
/** Task.id is `<boardId>:<slug>` (see filesync/assemble.ts) — file-derived,
 *  not a ULID. Presets stay ULIDs: they are kv entities, not task files. */
const taskIdSchema = z.string().min(1, "must not be blank");
const threadIdSchema = z.string().startsWith("thr_");

export const delegationRpcContract = defineRpcContract({
  delegate: {
    input: z
      .object({
        taskId: taskIdSchema,
        presetId: idSchema,
        extraInstructions: z.string().optional(),
        // Тред, из которого нажали «Делегировать»: кнопка стоит в панели
        // треда, а задача может жить только в его рабочем дереве.
        [CALLER_THREAD_FIELD]: z.string().optional(),
      })
      .strict(),
    output: z.object({ threadId: threadIdSchema }).strict(),
  },
  // Plugin RPC names cannot contain dots, so this is the wire spelling of
  // the conceptual `taskThreads.attach` operation.
  taskThreadsAttach: {
    input: z.object({ taskId: taskIdSchema, threadId: threadIdSchema }).strict(),
    output: z.object({ threadId: threadIdSchema }).strict(),
  },
});

export type DelegationRpcContract = typeof delegationRpcContract;
