import { describe, expect, it } from "vitest";
import { runCreatePr, type GithubResponse, type CreatePrPorts } from "./create-pr";
import type { ChangedFile, GithubRequest, RepoRef } from "../core/github-requests";

const repo: RepoRef = { owner: "e0068", repo: "bb-plugins" };

const files: ChangedFile[] = [
  { kind: "upsert", path: "a.ts", content: "A", encoding: "utf-8" },
  { kind: "delete", path: "old.ts" },
];

// Фейковый send: очередь ответов + запись обращений. Ответ выбирается функцией
// по запросу, что позволяет вернуть 200/404 на getBranch head в разных тестах.
function fakePorts(
  reply: (req: GithubRequest) => GithubResponse,
): { ports: CreatePrPorts; calls: GithubRequest[] } {
  const calls: GithubRequest[] = [];
  return {
    calls,
    ports: {
      async send(req) {
        calls.push(req);
        return reply(req);
      },
    },
  };
}

const base = {
  status: 200,
  data: { commit: { sha: "base-commit", commit: { tree: { sha: "base-tree" } } } },
};

function happyReply(headExists: boolean) {
  return (req: GithubRequest): GithubResponse => {
    if (req.method === "GET" && req.path.endsWith("/branches/main")) return base;
    if (req.method === "GET" && req.path.endsWith("/branches/feature")) {
      return headExists
        ? { status: 200, data: { name: "feature" } }
        : { status: 404, data: { message: "Branch not found" } };
    }
    if (req.path.endsWith("/git/blobs")) return { status: 201, data: { sha: "blob-a" } };
    if (req.path.endsWith("/git/trees")) return { status: 201, data: { sha: "tree-new" } };
    if (req.path.endsWith("/git/commits")) return { status: 201, data: { sha: "commit-new" } };
    if (req.path.endsWith("/git/refs")) return { status: 201, data: {} };
    if (req.method === "PATCH" && req.path.includes("/git/refs/heads/"))
      return { status: 200, data: {} };
    if (req.path.endsWith("/pulls"))
      return { status: 201, data: { html_url: "https://github.com/e0068/bb-plugins/pull/7", number: 7 } };
    throw new Error(`неожиданный запрос: ${req.method} ${req.path}`);
  };
}

const input = {
  repo,
  baseBranch: "main",
  headBranch: "feature",
  files,
  title: "Заголовок",
  body: "Тело",
};

describe("runCreatePr", () => {
  it("новая ветка: blob→tree→commit→createRef→pull, возвращает url и номер", async () => {
    const { ports, calls } = fakePorts(happyReply(false));
    const result = await runCreatePr(ports, input);

    expect(result).toEqual({
      url: "https://github.com/e0068/bb-plugins/pull/7",
      number: 7,
    });
    // Блоб создаётся только для upsert (не для delete).
    const blobCalls = calls.filter((c) => c.path.endsWith("/git/blobs"));
    expect(blobCalls).toHaveLength(1);
    // Дерево несёт base_tree базы, коммит — родителя базы.
    const tree = calls.find((c) => c.path.endsWith("/git/trees"))!;
    expect((tree.body as { base_tree: string }).base_tree).toBe("base-tree");
    const commit = calls.find((c) => c.path.endsWith("/git/commits"))!;
    expect((commit.body as { parents: string[] }).parents).toEqual(["base-commit"]);
    // Ветки не было — создаём ref, а не обновляем.
    expect(calls.some((c) => c.method === "POST" && c.path.endsWith("/git/refs"))).toBe(true);
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("ветка уже на remote: ref обновляется (PATCH), а не создаётся", async () => {
    const { ports, calls } = fakePorts(happyReply(true));
    await runCreatePr(ports, input);
    expect(calls.some((c) => c.method === "PATCH" && c.path.includes("/git/refs/heads/feature"))).toBe(true);
    expect(calls.some((c) => c.method === "POST" && c.path.endsWith("/git/refs"))).toBe(false);
  });

  it("база не найдена — понятная ошибка", async () => {
    const { ports } = fakePorts((req) =>
      req.path.endsWith("/branches/main")
        ? { status: 404, data: { message: "Not Found" } }
        : { status: 200, data: {} },
    );
    await expect(runCreatePr(ports, input)).rejects.toThrow(/база «main» не найдена/);
  });

  it("сбой создания блоба — ошибка с шагом и сообщением GitHub", async () => {
    const { ports } = fakePorts((req) => {
      if (req.path.endsWith("/branches/main")) return base;
      if (req.path.endsWith("/git/blobs"))
        return { status: 403, data: { message: "rate limited" } };
      return { status: 200, data: {} };
    });
    await expect(runCreatePr(ports, input)).rejects.toThrow(/создание блоба a\.ts.*rate limited/);
  });
});
