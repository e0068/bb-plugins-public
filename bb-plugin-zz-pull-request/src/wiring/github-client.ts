// Layer 3 — the single network effect point: fetch to api.github.com.
// Implements the CreatePrPorts port without throwing on an HTTP error code:
// the status and body go to the orchestrator (create-pr.ts), which decides
// whether it's a success or a failure.
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
