#!/usr/bin/env python3
"""Incremental transcript index: read only what was appended.

Why. Transcripts are append-only and barely change: within an hour a
handful of files out of thousands get a few megabytes. Yet any slice that
cannot be narrowed (by day, agent, model) used to re-read all of them —
gigabytes per query.

What it does. Keeps the already-parsed records of every file on disk. On
the next query it compares each file's inode, size and mtime and reads
only the tail past the last complete line it has seen.

Stored shape — records, not ready-made sums. Sums would have to exist per
slice and be rebuilt for a new one, and a sum cannot drop the earlier
snapshot of a streamed response (see below). Records fold into any slice
on the spot. See docs/decisions/token-usage-index-shape.md.

Dedup: a record with a known key REPLACES the earlier one (the "last one
wins" rule, see tokens.file_records). So the tail is read on top of the
stored records, not next to them: a response finished after the index was
saved must replace its unfinished snapshot.

This module knows nothing about transcript lines: the caller passes
`read_file(path, start) -> (records, end)` — the same reader the direct
read uses, so both routes interpret a line in exactly one way.
"""
import json, os, tempfile, time

VERSION = 1

# Below this volume the direct read is cheaper than loading the index: a
# one-session slice is a few files and tens of milliseconds, while the index
# is always loaded whole. The threshold is in bytes, not files: volume decides.
DIRECT_READ_LIMIT_BYTES = 32 * 1024 * 1024

# Rewriting the index costs time proportional to its size, and an active
# session appends to its transcript all the time — saving on every query
# would pay that cost always. A tail that was not saved breaks nothing: it
# is simply read again, which is cheap while it is small.
SAVE_INTERVAL_S = 60
SAVE_DELTA_BYTES = 8 * 1024 * 1024


def default_path():
    """The index file path. Overridden by the TOKEN_USAGE_INDEX variable."""
    override = os.environ.get("TOKEN_USAGE_INDEX")
    if override:
        return override
    cache = os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache")
    return os.path.join(cache, "bb-plugin-token-usage-header", f"index-v{VERSION}.json")


def _empty():
    return {"version": VERSION, "files": {}}


def load(path):
    """Reads the index from disk. Broken, foreign-version or missing — empty."""
    try:
        with open(path) as f:
            data = json.load(f)
    except (OSError, ValueError):
        return _empty()
    if not isinstance(data, dict) or data.get("version") != VERSION:
        return _empty()
    if not isinstance(data.get("files"), dict):
        return _empty()
    return data


def save(path, index):
    """Writes the index atomically: a temp file next to it, then a rename.

    Files that no longer exist are dropped first — otherwise a deleted
    session would stay in the index forever, since only the paths of the
    current query are ever checked.

    Atomicity is not about transactions: a concurrent query must never see a
    half-written file. Two counters may run at once, and the loser simply
    overwrites the index whole.
    """
    files = index["files"]
    for gone in [p for p in files if not os.path.exists(p)]:
        del files[gone]
    directory = os.path.dirname(path)
    try:
        os.makedirs(directory, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=directory, prefix=".index-", suffix=".tmp")
        try:
            with os.fdopen(fd, "w") as f:
                json.dump(index, f, separators=(",", ":"))
            os.replace(tmp, path)
        except Exception:
            os.unlink(tmp)
            raise
    except OSError:
        # The index is a cache: failing to write it (no permission, disk
        # full) does not spoil the count, the next query just reads the
        # files again.
        pass


def should_save(index_path, fresh_bytes):
    """Whether to rewrite the index: much is new, or it was written long ago."""
    if not fresh_bytes:
        return False
    if fresh_bytes > SAVE_DELTA_BYTES:
        return True
    try:
        age = time.time() - os.path.getmtime(index_path)
    except OSError:
        return True  # no index on disk yet
    return age > SAVE_INTERVAL_S


def _pack(records):
    """{key: record} -> a compact list for storage."""
    packed = []
    for (msg_id, req), rec in records.items():
        # usage is already canonical — tokens.normalize_usage made it so
        u = rec["usage"]
        cc = u["cache_creation"]
        packed.append([
            msg_id, req, rec["model"], rec["effort"], rec["ts"],
            u["input_tokens"],
            cc["ephemeral_5m_input_tokens"], cc["ephemeral_1h_input_tokens"],
            u["cache_read_input_tokens"], u["output_tokens"],
            u["output_tokens_details"]["thinking_tokens"],
            u["api_context_input_tokens"], u["speed"],
        ])
    return packed


def _unpack(packed):
    """A compact list -> {key: record} with canonical usage.

    Exactly the shape tokens.file_records returns: the equivalence test
    compares whole records, not only the final sums.
    """
    records = {}
    for msg_id, req, model, effort, ts, inp, cw5, cw1h, cr, out, think, ctx, speed in packed:
        records[(msg_id, req)] = {
            "usage": {
                "input_tokens": inp,
                "cache_creation": {
                    "ephemeral_5m_input_tokens": cw5,
                    "ephemeral_1h_input_tokens": cw1h,
                },
                "cache_read_input_tokens": cr,
                "output_tokens": out,
                "output_tokens_details": {"thinking_tokens": think},
                "api_context_input_tokens": ctx,
                "speed": speed,
            },
            "model": model,
            "effort": effort,
            "ts": ts,
        }
    return records


def _stat(path):
    try:
        st = os.stat(path)
        return st.st_ino, st.st_size, st.st_mtime
    except OSError:
        return None


def refresh(index, paths, read_file):
    """Brings the index in line with the files. Returns (records, bytes re-read).

    Records — {path: {key: record}} for every given file that exists. The
    second value is how many bytes had to be read again; it decides whether
    the index is worth rewriting (see should_save).

    Per file:
      - not in the index                     → read whole;
      - same inode, same size and mtime      → stored records as they are;
      - same inode, grew                     → read the tail past `end` on top;
      - anything else (shrank, rewritten in place, replaced by a new file —
        the Codex and Kimi projections are rewritten atomically) → stored
        records cannot be trusted, read whole.
    """
    files = index["files"]
    out = {}
    fresh_bytes = 0

    for path in paths:
        st = _stat(path)
        if st is None:
            if files.pop(path, None) is not None:
                fresh_bytes += 1  # an entry left — the index on disk is stale
            continue
        ino, size, mtime = st
        entry = files.get(path)
        same_file = entry is not None and entry["ino"] == ino
        if same_file and size == entry["size"] and mtime == entry["mtime"]:
            out[path] = _unpack(entry["records"])
            continue
        if same_file and size > entry["size"]:
            records = _unpack(entry["records"])
            tail, end = read_file(path, entry["end"])
            # the tail on top of the stored records: an appended record with
            # the same key is the finished version of a stored snapshot
            records.update(tail)
            fresh_bytes += size - entry["end"]
        else:
            records, end = read_file(path, 0)
            fresh_bytes += size
        files[path] = {"ino": ino, "size": size, "mtime": mtime, "end": end,
                       "records": _pack(records)}
        out[path] = records

    return out, fresh_bytes


def read(paths, read_file, index_path=None):
    """{path: {key: record}} for the given files, through the index."""
    index_path = index_path or default_path()
    index = load(index_path)
    records, fresh_bytes = refresh(index, paths, read_file)
    if should_save(index_path, fresh_bytes):
        save(index_path, index)
    return records


def total_bytes(paths):
    """How many bytes a direct read would take — the route is chosen by it."""
    total = 0
    for path in paths:
        st = _stat(path)
        if st:
            total += st[1]
    return total


def should_use_index(paths):
    """The index pays off only on large slices; on small ones it slows them down."""
    return total_bytes(paths) > DIRECT_READ_LIMIT_BYTES
