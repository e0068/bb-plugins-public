// @vitest-environment node
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { describe, expect, it } from "vitest";

import { createSkillLists, SKILL_LIST_TTL_MS } from "./skill-lists";
import { hostCatalogSources, hostSkillFileSources, readSkillFile, readStageCatalog } from "./stage-catalog";

type Skill = { name: string; description: string | null; filePath: string; pluginId: string | null };

/** bb, у которого список навыков проекта отвечает, когда скажет тест: так виден зависший bb. */
const hangingBb = (projects: readonly string[]) => {
  const calls: string[] = [];
  const pending: Array<{ resolve: (skills: Skill[]) => void; reject: (error: Error) => void }> = [];
  const bb = {
    sdk: {
      projects: { list: async () => projects.map((id) => ({ id, name: id, sources: [] })) },
      skills: {
        list: ({ projectId }: { projectId: string }) => {
          calls.push(projectId);
          return new Promise<{ skills: Skill[] }>((resolve, reject) => pending.push({ resolve: (skills) => resolve({ skills }), reject }));
        },
      },
      system: { config: async () => ({ primaryHostId: "host_local" }) },
    },
  } as unknown as Pick<BbPluginApi, "sdk">;
  return { bb, calls, pending };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const spec: Skill = { name: "spec", description: null, filePath: "/home/owner/.claude/skills/spec/SKILL.md", pluginId: null };

describe("список навыков проектов у Flow", () => {
  it("пока bb не ответил, каталог и файлы десяти навыков спрашивают список каждого проекта один раз", async () => {
    const { bb, calls, pending } = hangingBb(["prj_1", "prj_2", "prj_3"]);
    const lists = createSkillLists(bb, () => 0);
    const reads = [
      readStageCatalog(hostCatalogSources(bb, lists)),
      ...Array.from({ length: 10 }, (_, i) => readSkillFile(hostSkillFileSources(bb, lists), i === 0 ? "spec" : `skill-${i}`)),
    ];
    await settle();
    expect(calls.sort()).toEqual(["prj_1", "prj_2", "prj_3"]);
    pending.forEach(({ resolve }) => resolve([spec]));
    const [, file] = await Promise.all(reads);
    expect(file).toEqual({ hostId: "host_local", path: spec.filePath });
  });

  it("упавший список не спрашивается заново до конца срока, а после — спрашивается", async () => {
    const { bb, calls, pending } = hangingBb(["prj_1"]);
    let now = 0;
    const lists = createSkillLists(bb, () => now);
    const first = readSkillFile(hostSkillFileSources(bb, lists), "spec");
    await settle();
    pending[0]!.reject(new Error("Timed out waiting for command result"));
    expect(await first).toBeNull();
    now = SKILL_LIST_TTL_MS - 1;
    expect(await readSkillFile(hostSkillFileSources(bb, lists), "spec")).toBeNull();
    expect(calls).toEqual(["prj_1"]);
    now = SKILL_LIST_TTL_MS;
    const again = readSkillFile(hostSkillFileSources(bb, lists), "spec");
    await settle();
    pending[1]!.resolve([spec]);
    expect(await again).toEqual({ hostId: "host_local", path: spec.filePath });
    expect(calls).toEqual(["prj_1", "prj_1"]);
  });

  it("полученный список служит до конца срока без новых запросов", async () => {
    const { bb, calls, pending } = hangingBb(["prj_1"]);
    let now = 0;
    const lists = createSkillLists(bb, () => now);
    const first = readSkillFile(hostSkillFileSources(bb, lists), "spec");
    await settle();
    pending[0]!.resolve([spec]);
    await first;
    now = SKILL_LIST_TTL_MS - 1;
    expect(await readSkillFile(hostSkillFileSources(bb, lists), "spec")).toEqual({ hostId: "host_local", path: spec.filePath });
    expect(calls).toEqual(["prj_1"]);
  });
});
