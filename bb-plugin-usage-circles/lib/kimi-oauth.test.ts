// Promises of lib/kimi-oauth.ts: which credentials file of a Kimi Code
// installation the plugin trusts, when a token still counts as fresh, and how
// a refresh response merges into the stored credentials.
import { describe, expect, it } from "vitest";
import {
  KIMI_CODE_CLIENT_ID,
  isTokenFresh,
  mergeRefreshedCredentials,
  refreshRequestBody,
  selectCredentialsFile,
} from "./kimi-oauth";

describe("isTokenFresh", () => {
  const now = 1_800_000_000_000;

  it("counts a token fresh while more than a minute remains", () => {
    expect(isTokenFresh({ expires_at: now + 120_000 }, now)).toBe(true);
  });

  it("counts a token stale inside the last minute and past its expiry", () => {
    expect(isTokenFresh({ expires_at: now + 30_000 }, now)).toBe(false);
    expect(isTokenFresh({ expires_at: now - 1 }, now)).toBe(false);
  });

  it("counts a token without an expiry as fresh — the API call decides", () => {
    expect(isTokenFresh({}, now)).toBe(true);
  });
});

describe("selectCredentialsFile", () => {
  it("picks the most recently written credentials file", () => {
    expect(
      selectCredentialsFile([
        { name: "kimi-code-env-aaa.json", mtimeMs: 100 },
        { name: "kimi-code-env-bbb.json", mtimeMs: 300 },
        { name: "kimi-code-env-ccc.json", mtimeMs: 200 },
      ]),
    ).toBe("kimi-code-env-bbb.json");
  });

  it("ignores files that are not environment credentials", () => {
    expect(
      selectCredentialsFile([
        { name: "kimi-code-env-aaa.json.tmp", mtimeMs: 300 },
        { name: "other.json", mtimeMs: 400 },
        { name: "kimi-code-env-bbb.json", mtimeMs: 100 },
      ]),
    ).toBe("kimi-code-env-bbb.json");
  });

  it("finds nothing in an empty directory", () => {
    expect(selectCredentialsFile([])).toBeUndefined();
  });
});

describe("refreshRequestBody", () => {
  it("is the refresh_token grant form of the kimi-code flow", () => {
    const params = new URLSearchParams(refreshRequestBody("rt abc"));
    expect(params.get("grant_type")).toBe("refresh_token");
    expect(params.get("client_id")).toBe(KIMI_CODE_CLIENT_ID);
    expect(params.get("refresh_token")).toBe("rt abc");
  });
});

describe("mergeRefreshedCredentials", () => {
  const old = { access_token: "old-at", refresh_token: "old-rt", expires_at: 100, scope: "read", token_type: "Bearer" };
  const now = 1_800_000_000_000;

  it("takes the new access token and its expiry", () => {
    expect(mergeRefreshedCredentials(old, { access_token: "new-at", expires_in: 3600 }, now)).toEqual({
      ...old,
      access_token: "new-at",
      expires_at: now + 3_600_000,
    });
  });

  it("keeps the old refresh token when the response brings none", () => {
    expect(mergeRefreshedCredentials(old, { access_token: "new-at", expires_in: 3600 }, now)?.refresh_token).toBe("old-rt");
  });

  it("takes the rotated refresh token when the response brings one", () => {
    expect(
      mergeRefreshedCredentials(old, { access_token: "new-at", refresh_token: "new-rt", expires_in: 3600 }, now)?.refresh_token,
    ).toBe("new-rt");
  });

  it("rejects a response without an access token", () => {
    expect(mergeRefreshedCredentials(old, { expires_in: 3600 }, now)).toBeUndefined();
    expect(mergeRefreshedCredentials(old, null, now)).toBeUndefined();
  });
});
