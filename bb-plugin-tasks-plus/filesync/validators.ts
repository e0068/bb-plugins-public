import { createHash, randomBytes } from "node:crypto";
import { roundToCents } from "../shared/amounts.js";

/** Pure identity/validation helpers, carried over from the SQL store as-is —
 *  that file is deleted once U6 removes SQLite; until then these two copies
 *  briefly coexist rather than one importing the other's soon-to-be-gone
 *  module. See decisions/tasks-files-are-the-store.md. */

const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

let lastUlidMs = -1;
let lastUlidRandom = 0n;

export function createUlid(now = Date.now()): string {
  let random: bigint;
  if (now === lastUlidMs) {
    random = lastUlidRandom + 1n;
  } else {
    random = 0n;
    for (const byte of randomBytes(10)) random = (random << 8n) | BigInt(byte);
  }
  lastUlidMs = now;
  lastUlidRandom = random;
  let value = (BigInt(now) << 80n) | random;
  let id = "";
  for (let index = 0; index < 26; index += 1) {
    id = ULID_ALPHABET[Number(value & 31n)] + id;
    value >>= 5n;
  }
  return id;
}

export function createOrValidateUlid(id: string | undefined): string {
  if (id === undefined) return createUlid();
  if (!ULID_PATTERN.test(id)) throw new Error(`Invalid ULID: ${id}`);
  return id;
}

export function requireNonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} must not be empty`);
  return trimmed;
}

export function validateDueDate(dueDate: string | null): string | null {
  if (dueDate === null) return null;
  if (!ISO_DATE_PATTERN.test(dueDate)) {
    throw new Error("dueDate must be an ISO date in YYYY-MM-DD format");
  }
  const parsed = new Date(`${dueDate}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.valueOf()) ||
    parsed.toISOString().slice(0, 10) !== dueDate
  ) {
    throw new Error("dueDate must be a valid calendar date");
  }
  return dueDate;
}

export function validateMinutes(
  value: number | null,
  field: string,
): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return value;
}

export function validateDollars(
  value: number | null,
  field: string,
): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a non-negative amount`);
  }
  return roundToCents(value);
}

export function validateThreadId(id: string): string;
export function validateThreadId(id: null): null;
export function validateThreadId(id: string | null): string | null;
export function validateThreadId(id: string | null): string | null {
  if (id !== null && !id.startsWith("thr_")) {
    throw new Error("threadId must be a bb thr_* id");
  }
  return id;
}

export function validateBlobPath(blobPath: string): string {
  const path = requireNonEmpty(blobPath, "Attachment blobPath");
  const segments = path.split(/[\\/]/);
  if (
    path.startsWith("/") ||
    path.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/.test(path) ||
    segments.includes("..")
  ) {
    throw new Error("Attachment blobPath must be a relative path without '..'");
  }
  return path;
}

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
