// Opener layer 1 — what a failed bb.sdk.files.move or remove means. The host
// refuses on its own: move never overwrites (it throws `path_exists`), and
// both throw ENOENT for a source that is not there. Whether the code survives
// the trip to the plugin or only the message does is not part of the SDK's
// contract, so both are read.

export type FileErrorKind = "exists" | "not-found" | "other";

const codeOf = (err: unknown): string | null =>
  typeof err === "object" && err !== null && "code" in err && typeof err.code === "string"
    ? err.code
    : null;

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : "");

export function fileErrorKind(err: unknown): FileErrorKind {
  const code = codeOf(err);
  const message = messageOf(err);
  if (code === "path_exists" || /already exists/i.test(message)) return "exists";
  if (code === "ENOENT" || code === "path_not_found" || /ENOENT|no such file/i.test(message)) {
    return "not-found";
  }
  return "other";
}
