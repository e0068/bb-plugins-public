#!/usr/bin/env python3
"""Хронология одного вызова агента (главного или субагента) по транскриптам
Claude Code (~/.claude/projects).

Источник — тот же ROOT, что и у tools/tokens.py: `sys.path.insert` на
собственный каталог и `import tokens` переиспользуют его ROOT/JsonAwareParser/
load_meta, а не дублируют их здесь.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tokens import ROOT, Bucket, JsonAwareParser, load_meta  # noqa: E402

# Версия формата отчёта --json. Поднимать при ЛЮБОЙ ломающей смене формата —
# src/core/agent-timeline.ts сверяет её первой, как parse.ts делает для
# tools/tokens.py (см. memory/decisions/token-usage-json-schema-version.md,
# тот же приём применён здесь для нового скрипта).
#
# 1 -> 2: assistant-сообщения несут tokens/cost (решение владельца: стоимость
# считается на вызов модели, не на строку-инструмент) — см.
# memory/decisions/token-usage-cost-on-messages.md.
SCHEMA_VERSION = 2

# Инструменты, запускающие субагента, встречались под двумя именами в разных
# версиях Claude Code ("Task" в документации/спецификации, "Agent" — то, что
# реально пишут текущие транскрипты). Проверяем оба, чтобы не зависеть от
# конкретной версии.
AGENT_LAUNCH_TOOL_NAMES = ("Task", "Agent")

# Длина отрывка текста сообщения/промпта в событии. Полный текст сообщения
# может быть сколь угодно длинным (отчёты субагентов на десятки тысяч
# символов) — хронология показывает превью, не архив.
EXCERPT_MAX = 300


def excerpt(text):
    """Обрезает текст до EXCERPT_MAX символов, добавляя многоточие."""
    if not isinstance(text, str):
        return ""
    s = text.strip()
    if len(s) <= EXCERPT_MAX:
        return s
    return s[: EXCERPT_MAX - 1] + "…"


def tool_target(name, inp):
    """Один осмысленный аргумент вызова инструмента, либо None.

    Список полей — по конкретным инструментам, где известно, какой аргумент
    осмысленный; для инструментов вне списка — общий разбор по нескольким
    ходовым именам полей, чтобы не оставлять target пустым на ровном месте.
    """
    if not isinstance(inp, dict):
        return None
    if name in ("Read", "Edit", "Write"):
        v = inp.get("file_path")
        return v if isinstance(v, str) and v else None
    if name in ("Glob", "Grep"):
        v = inp.get("pattern")
        return v if isinstance(v, str) and v else None
    if name == "Bash":
        v = inp.get("command")
        return v if isinstance(v, str) and v else None
    if name == "Skill":
        v = inp.get("skill") or inp.get("command") or inp.get("name")
        return v if isinstance(v, str) and v else None
    if name in AGENT_LAUNCH_TOOL_NAMES:
        v = inp.get("description") or inp.get("subagent_type")
        return v if isinstance(v, str) and v else None
    for key in ("file_path", "pattern", "command", "description", "url", "path"):
        v = inp.get(key)
        if isinstance(v, str) and v:
            return v
    return None


def tool_events(record):
    """tool_use-блоки одной assistant-записи -> список событий kind="tool"."""
    if record.get("type") != "assistant":
        return []
    content = (record.get("message") or {}).get("content")
    if not isinstance(content, list):
        return []
    ts = record.get("timestamp")
    out = []
    for block in content:
        if not isinstance(block, dict) or block.get("type") != "tool_use":
            continue
        name = block.get("name")
        if not name:
            continue
        out.append({"ts": ts, "kind": "tool", "name": name, "target": tool_target(name, block.get("input"))})
    return out


def hook_event(record):
    """attachment.type=="hook_success" -> событие kind="hook", иначе None."""
    if record.get("type") != "attachment":
        return None
    attachment = record.get("attachment")
    if not isinstance(attachment, dict) or attachment.get("type") != "hook_success":
        return None
    return {
        "ts": record.get("timestamp"),
        "kind": "hook",
        "hookName": attachment.get("hookName"),
        "hookEvent": attachment.get("hookEvent"),
    }


def _is_real_user_message(record):
    """Настоящее сообщение человека, а не tool_result/meta/слэш-команда.

    Большинство записей type=="user" в транскрипте — это tool_result (ответ
    инструмента, поданный назад модели): у них message.content — СПИСОК
    блоков. Настоящее сообщение пользователя — content-СТРОКА. isMeta и
    isSidechain отсекают инжектированные системой и субагентские записи;
    "<local-command-stdout>" — вывод слэш-команды, который транскрипт тоже
    заворачивает в user-запись со строковым content, но isMeta там не
    выставлен, поэтому проверяется отдельно, текстом.
    """
    if record.get("type") != "user":
        return False
    if record.get("isMeta") or record.get("isSidechain"):
        return False
    content = (record.get("message") or {}).get("content")
    if not isinstance(content, str):
        return False
    if content.lstrip().startswith("<local-command-stdout>"):
        return False
    return True


def _assistant_text(record):
    """Текст assistant-записи (склейка text-блоков), либо None."""
    if record.get("type") != "assistant":
        return None
    if record.get("isMeta") or record.get("isSidechain"):
        return None
    content = (record.get("message") or {}).get("content")
    if not isinstance(content, list):
        return None
    text = "".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")
    text = text.strip()
    return text or None


def _message_usage(record):
    """Bucket с единственной usage-записью assistant-сообщения, либо None.

    Тарификация — тот же tokens.Bucket.add/.total/.cost, что считает
    tools/tokens.py целыми сессиями/бакетами; здесь просто вызывается на
    одной usage-записи вместо множества, а не переизобретается заново.
    """
    message = record.get("message") or {}
    usage = message.get("usage")
    if not isinstance(usage, dict):
        return None
    b = Bucket()
    b.add(usage, message.get("model"), record.get("timestamp"))
    return b


def message_event(record):
    """Настоящее сообщение (человек или ассистент) -> событие kind="message".

    Решение владельца: стоимость считается на вызов модели (assistant-запись
    целиком), не размазывается по её отдельным tool_use-блокам — поэтому
    tokens/cost появляются здесь, а не в tool_events. У user-сообщений цены
    нет: они не вызов модели, а вход для него.
    """
    ts = record.get("timestamp")
    if _is_real_user_message(record):
        text = excerpt((record.get("message") or {}).get("content"))
        return {"ts": ts, "kind": "message", "role": "user", "text": text}
    text = _assistant_text(record)
    if text is not None:
        event = {"ts": ts, "kind": "message", "role": "assistant", "text": excerpt(text)}
        bucket = _message_usage(record)
        if bucket is not None:
            event["tokens"] = bucket.total
            event["cost"] = round(bucket.cost, 2)
        return event
    return None


def read_records(path):
    """Читает .jsonl построчно, отбрасывая нечитаемые строки. [] при I/O-ошибке."""
    records = []
    try:
        with open(path, errors="ignore") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    d = json.loads(line)
                except Exception:
                    continue
                if isinstance(d, dict):
                    records.append(d)
    except OSError:
        return []
    return records


def extract_events(records):
    """Все события транскрипта, хронологически по ts (записи без ts — в конец)."""
    events = []
    for record in records:
        events.extend(tool_events(record))
        hook = hook_event(record)
        if hook:
            events.append(hook)
        message = message_event(record)
        if message:
            events.append(message)
    events.sort(key=lambda e: e["ts"] or "")
    return events


def find_task_prompt(main_records, tool_use_id):
    """Отрывок prompt из блока tool_use (Task/Agent), запустившего субагента.

    Сопоставление по id блока, а не по имени инструмента ("Task" в спецификации,
    "Agent" в реальных транскриптах — см. AGENT_LAUNCH_TOOL_NAMES) — id
    однозначен независимо от того, как инструмент называется в этой версии.
    """
    if not tool_use_id:
        return None
    for record in main_records:
        if record.get("type") != "assistant":
            continue
        content = (record.get("message") or {}).get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict) or block.get("type") != "tool_use":
                continue
            if block.get("id") != tool_use_id:
                continue
            prompt = (block.get("input") or {}).get("prompt")
            return excerpt(prompt) if isinstance(prompt, str) else None
    return None


def find_session(root, session):
    """Каталог проекта и полный id сессии по (возможно неполному) session.

    Совпадение по началу имени файла `<id>.jsonl`, как _session_files в
    tools/tokens.py. При нескольких совпадениях побеждает отсортированный
    первый — детерминированно, без обращения к mtime.
    """
    if not os.path.isdir(root):
        return None, None
    try:
        project_names = sorted(os.listdir(root))
    except OSError:
        return None, None

    for name in project_names:
        project_dir = os.path.join(root, name)
        if not os.path.isdir(project_dir):
            continue
        try:
            entries = sorted(os.listdir(project_dir))
        except OSError:
            continue
        for entry in entries:
            if entry.endswith(".jsonl") and entry[: -len(".jsonl")].startswith(session):
                return project_dir, entry[: -len(".jsonl")]
    return None, None


def build_timeline(root, session, agent):
    """Собирает {schemaVersion, agent, events} для одного (session, agent)."""
    project_dir, full_session = find_session(root, session)
    if project_dir is None:
        raise RuntimeError(f"Сессия не найдена: {session!r}")

    main_path = os.path.join(project_dir, f"{full_session}.jsonl")
    main_records = read_records(main_path)

    if agent == "main":
        events = extract_events(main_records)
        agent_info = {
            "key": "main",
            "agentType": None,
            "description": None,
            "model": None,
            "spawnDepth": None,
            "promptExcerpt": None,
        }
    else:
        agent_path = os.path.join(project_dir, full_session, "subagents", f"{agent}.jsonl")
        agent_records = read_records(agent_path)
        events = extract_events(agent_records)
        meta = load_meta(agent_path) or {}
        agent_info = {
            "key": agent,
            "agentType": meta.get("agentType"),
            "description": meta.get("description"),
            "model": meta.get("model"),
            "spawnDepth": meta.get("spawnDepth"),
            "promptExcerpt": find_task_prompt(main_records, meta.get("toolUseId")),
        }

    return {"schemaVersion": SCHEMA_VERSION, "agent": agent_info, "events": events}


def main():
    ap = JsonAwareParser()
    ap.add_argument("--session", required=True, help="id сессии (можно префикс)")
    ap.add_argument("--agent", default="main", help='"main" или "agent-<hash>"')
    ap.add_argument("--json", action="store_true", help="печатать JSON вместо текста")
    a = ap.parse_args()

    out = build_timeline(ROOT, a.session, a.agent)

    if a.json:
        print(json.dumps(out, ensure_ascii=False))
        return

    agent_info = out["agent"]
    header = agent_info["key"]
    if agent_info["description"]:
        header += f" — {agent_info['description']}"
    print(header)
    print("-" * min(len(header), 100))
    for event in out["events"]:
        if event["kind"] == "tool":
            line = f"[{event['ts']}] tool  {event['name']}"
            if event["target"]:
                line += f": {event['target']}"
        elif event["kind"] == "hook":
            line = f"[{event['ts']}] hook  {event['hookName']} ({event['hookEvent']})"
        else:
            line = f"[{event['ts']}] {event['role']:<9} {event['text']}"
        print(line)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        args_has_json = "--json" in sys.argv
        if args_has_json:
            print(json.dumps({"error": str(e)}, ensure_ascii=False))
            sys.exit(1)
        raise
