// Слой 3 — единственная точка сетевого эффекта: fetch к api.github.com.
// Реализует порт CreatePrPorts, не бросая на HTTP-коде: код и тело уходят
// в оркестратор (create-pr.ts), который и решает, успех это или ошибка.
import type { GithubRequest } from "../core/github-requests";
import type { CreatePrPorts, GithubResponse } from "./create-pr";

const API_BASE = "https://api.github.com";

export function githubClient(token: string): CreatePrPorts {
  return {
    async send(req: GithubRequest): Promise<GithubResponse> {
      const hasBody = req.body !== undefined;
      const res = await fetch(`${API_BASE}${req.path}`, {
        method: req.method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          ...(hasBody ? { "content-type": "application/json" } : {}),
        },
        body: hasBody ? JSON.stringify(req.body) : undefined,
      });
      return { status: res.status, data: await parseBody(res) };
    },
  };
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}
