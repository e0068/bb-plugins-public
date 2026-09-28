import { describe, expect, it } from "vitest";

import { classifyFailure, RETRY_DELAYS_MS } from "./retry";

describe("classifyFailure", () => {
  it("временная — то, что проходит само: перегрузка, пересчёт, обрыв сети", () => {
    const transient = [
      "HTTP 500: Internal Server Error",
      "HTTP 502: Bad Gateway",
      "HTTP 503",
      "HTTP 429: too many requests",
      "HTTP 408",
      "could not compare bb/thr with main (HTTP 404)",
      "HTTP 409: Pull request is not currently mergeable",
      "fetch failed",
      "socket hang up",
      "connect ETIMEDOUT 140.82.121.5:443",
      "read ECONNRESET",
      "getaddrinfo EAI_AGAIN api.github.com",
      "getaddrinfo ENOTFOUND api.github.com",
    ];
    expect(transient.map(classifyFailure)).toEqual(transient.map(() => "transient"));
  });

  it("постоянная — то, что повтор не лечит: конфликт, отказ, отсутствие токена", () => {
    const permanent = [
      "app.tsx, server.ts — conflicts with origin/main. The merge was aborted",
      "No GitHub token: gh is not authorized and no token is set in the settings.",
      "The thread has no environment with git.",
      "the pull request is closed without a merge",
      "HTTP 401: Bad credentials",
      "HTTP 403: Resource not accessible",
      "HTTP 422: Reference already exists",
    ];
    expect(permanent.map(classifyFailure)).toEqual(permanent.map(() => "permanent"));
  });

  it("временная — проигранная гонка за ссылку: соседний fetch сдвинул origin/main посреди нашего", () => {
    const race =
      "From https://github.com/e0068/bb-plugins; * branch main -> FETCH_HEAD; error: cannot lock ref 'refs/remotes/origin/main': is at c5a2f5843a8186aad9b297ac7c834389b1a19268 but expected ae3f971418c4ddb85d7425b603dc002f35a4c4da; ! ae3f9714..c5a2f584 main -> origin/main (unable to update local ref)";
    expect(classifyFailure(race)).toBe("transient");
  });

  it("паузы растут, и их две — три попытки на шаг", () => {
    expect([...RETRY_DELAYS_MS]).toEqual([2_000, 8_000]);
  });
});
