/**
 * The attached files of a board database: one `blobs` table for the task
 * board and every table beside it — an attachment id is unique on its own.
 * A file lies in parts small enough to travel in one request each, as base64
 * text: the plugin's Hrana client speaks text, and a 25 MB file in one
 * request would outgrow what a server takes in (BBPL-914).
 */

export const BLOBS_SCHEMA = `CREATE TABLE IF NOT EXISTS blobs (
  id TEXT NOT NULL,
  part INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (id, part)
)`;

/** Bytes in one part: about 1.4 MB of base64 in its request. */
export const BLOB_PART_BYTES = 1024 * 1024;

export const REMOVE_BLOB = "DELETE FROM blobs WHERE id = ?";
export const INSERT_BLOB_PART = "INSERT INTO blobs (id, part, data) VALUES (?, ?, ?)";
export const READ_BLOB_PART = "SELECT data FROM blobs WHERE id = ? AND part = ?";

/** The parts of a file in order — at least one, so an empty file is a file and not nothing. */
export const blobParts = (bytes: Uint8Array): string[] =>
  Array.from({ length: Math.max(1, Math.ceil(bytes.byteLength / BLOB_PART_BYTES)) }, (_, index) =>
    Buffer.from(bytes.subarray(index * BLOB_PART_BYTES, (index + 1) * BLOB_PART_BYTES)).toString("base64"),
  );

/** The file the parts make up. */
export const joinBlobParts = (parts: readonly string[]): Uint8Array =>
  new Uint8Array(Buffer.concat(parts.map((part) => Buffer.from(part, "base64"))));
