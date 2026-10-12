// @vitest-environment node
// Два файла workflow с одним именем в meta — parallel-dev.js и parallel-dev-full.js оба объявляют name "parallel-dev".
// Чип `workflow:parallel-dev` открывает файл, чьё имя совпадает с именем workflow, а не первый по алфавиту.
import { describe, expect, it } from "vitest";

import { readExecutorFile, type ExecutorFileSources } from "./stage-catalog";

const files: Record<string, string> = {
  "/home/owner/.claude/workflows/parallel-dev-full.js": "export const meta = { name: 'parallel-dev' }",
  "/home/owner/.claude/workflows/parallel-dev.js": 'export const meta = { name: "parallel-dev" }',
};

const sources: ExecutorFileSources = {
  projectIds: async () => [],
  skills: async () => [],
  listDir: async (dir) => {
    const names = Object.keys(files).filter((path) => path.startsWith(`${dir}/`)).map((path) => path.slice(dir.length + 1));
    if (names.length === 0) throw new Error(`ENOENT ${dir}`);
    return names;
  },
  readFile: async (path) => {
    const text = files[path];
    if (text === undefined) throw new Error(`ENOENT ${path}`);
    return text;
  },
  home: "/home/owner",
  primaryHostId: async () => "host_local",
};

describe("workflow с одним именем в двух файлах", () => {
  it("чип открывает файл, названный как сам workflow", async () => {
    expect(await readExecutorFile(sources, "workflow:parallel-dev")).toEqual({ hostId: "host_local", path: "/home/owner/.claude/workflows/parallel-dev.js" });
  });
});
