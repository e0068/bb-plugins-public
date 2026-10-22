// Список навыков проекта у bb — один на весь Flow. Каталог этапов, файл навыка и корень плагина читают его по всем
// проектам на каждом шаге треда; без общего ответа зависший у bb список множился сотнями запросов и забивал сервер
// bb так, что с телефона не уходили ответы на брифы. Поэтому запрос в полёте общий, а его исход — список или
// отказ — служит до конца срока.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export type ProjectSkill = Awaited<ReturnType<BbPluginApi["sdk"]["skills"]["list"]>>["skills"][number];
export type SkillLists = (projectId: string) => Promise<readonly ProjectSkill[]>;

/** Срок исхода: навык, добавленный владельцем, виден через минуту, а зависший bb спрашивается не чаще раза в минуту. */
export const SKILL_LIST_TTL_MS = 60_000;

export const createSkillLists = (bb: Pick<BbPluginApi, "sdk">, now: () => number): SkillLists => {
  const known = new Map<string, { at: number; list: Promise<readonly ProjectSkill[]> }>();
  return (projectId) => {
    const seen = known.get(projectId);
    if (seen !== undefined && now() - seen.at < SKILL_LIST_TTL_MS) return seen.list;
    const list = bb.sdk.skills.list({ projectId, environmentId: null }).then(({ skills }) => skills);
    known.set(projectId, { at: now(), list });
    return list;
  };
};
