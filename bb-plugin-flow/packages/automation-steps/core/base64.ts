// Layer 1 — the one primitive both server.ts's git-config decoding and the
// version-bump content round-trip need. Zero effects.

export function decodeBase64(content: string): string {
  return Buffer.from(content, "base64").toString("utf8");
}

export function encodeBase64(content: string): string {
  return Buffer.from(content, "utf8").toString("base64");
}
