import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { nearestEpicId, type EpicLink } from "./epic.js";

const link = (id: string, type: EpicLink["type"], parentTaskId: string | null = null): EpicLink => ({ id, type, parentTaskId });
const byIdOf = (links: EpicLink[]) => new Map(links.map((entry) => [entry.id, entry]));

describe("nearestEpicId", () => {
  it("is the closest ancestor typed epic, whatever lies between", () => {
    const byId = byIdOf([
      link("E", "epic"),
      link("B", "bugfix", "E"),
      link("U", null, "B"),
      link("E2", "epic", "U"),
      link("C", "feature", "E2"),
    ]);
    expect(nearestEpicId("U", byId)).toBe("E");
    expect(nearestEpicId("E2", byId)).toBe("E");
    expect(nearestEpicId("C", byId)).toBe("E2");
  });

  it("is null for a task with no epic above it, and for an epic at the top", () => {
    const byId = byIdOf([link("E", "epic"), link("F", "feature"), link("S", "spike", "F")]);
    expect(nearestEpicId("E", byId)).toBeNull();
    expect(nearestEpicId("S", byId)).toBeNull();
    expect(nearestEpicId("missing", byId)).toBeNull();
  });

  it("stops on a parent cycle instead of looping", () => {
    const byId = byIdOf([link("A", "feature", "B"), link("B", "feature", "A")]);
    expect(nearestEpicId("A", byId)).toBeNull();
  });

  it("never returns the task itself and always an epic on its parent chain", () => {
    const types = fc.constantFrom<EpicLink["type"]>("epic", "feature", "bugfix", null);
    fc.assert(
      fc.property(fc.array(fc.tuple(types, fc.nat()), { minLength: 1, maxLength: 12 }), (rows) => {
        // Parents only point to earlier rows, so the chain is a tree.
        const links = rows.map(([type, pick], index) =>
          link(`T${index}`, type, index === 0 ? null : `T${pick % index}`),
        );
        const byId = byIdOf(links);
        for (const entry of links) {
          const epic = nearestEpicId(entry.id, byId);
          if (epic === null) continue;
          expect(epic).not.toBe(entry.id);
          expect(byId.get(epic)!.type).toBe("epic");
          const chain: string[] = [];
          for (let at = entry.parentTaskId; at !== null; at = byId.get(at)!.parentTaskId) chain.push(at);
          expect(chain.indexOf(epic)).toBe(chain.findIndex((id) => byId.get(id)!.type === "epic"));
        }
      }),
    );
  });
});
