#!/usr/bin/env python3
"""Лента тредов: последние N сессий Claude Code, разложенные по бинам времени.

Переиспользует tools/tokens.py (walk(), Bucket, _session_files, _file_mtime,
JsonAwareParser) для самого подсчёта токенов — здесь только отбор "последних N
сессий" и раскладка их usage-записей по бинам фиксированного размера,
внутри бина — по агенту (главный агент — ключ "main", субагенты — их
agentId, как в tokens.py --by agent).
"""
import json, os, sys
from collections import defaultdict
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tokens  # noqa: E402

# Версия формата отчёта --json этого скрипта. Отдельная от tokens.SCHEMA_VERSION
# — разные контракты, разные потребители (src/core/threads-timeline.ts
# сверяет именно эту версию). Поднимать при любой ломающей смене формата.
# 1 -> 2: добавлено верхнеуровневое поле agentLabels (человекочитаемые имена
# агентов по их ключу из bins) — форма отчёта расширилась.
# 2 -> 3: у треда добавлены totalCost (стоимость расхода в USD по тарифу
# tokens.py) и workflowCount (число различных workflow-прогонов в сессии).
SCHEMA_VERSION = 3

# Порог обрезки meta.description для agentLabels — легенда и подписи в UI не
# резиновые, длинное описание таска ломает вёрстку чипа/тултипа.
LABEL_DESCRIPTION_LIMIT = 60


def _session_main_files(root, project=None, session=None):
    """Главные .jsonl-файлы сессий (без субагентов) по каталогам проектов.

    Возвращает список (sessionId, project, path, mtime) — по одной записи на
    сессию, чтобы отобрать "последние N по активности" ДО чтения содержимого
    файлов. mtime — приближение "последней активности транскрипта" (то же
    допущение, что и в tokens.py::_filter_by_since).
    """
    if not os.path.isdir(root):
        return []
    try:
        entries = os.listdir(root)
    except OSError:
        return []
    project_dirs = [os.path.join(root, d) for d in entries if os.path.isdir(os.path.join(root, d))]
    if project:
        project_dirs = [d for d in project_dirs if project in os.path.basename(d)]

    out = []
    for pd in project_dirs:
        try:
            names = os.listdir(pd)
        except OSError:
            continue
        for name in names:
            if not name.endswith(".jsonl"):
                continue
            path = os.path.join(pd, name)
            if not os.path.isfile(path):
                continue
            sid = name[: -len(".jsonl")]
            if session is not None and sid != session:
                continue
            mtime = tokens._file_mtime(path)
            out.append((sid, os.path.basename(pd), path, mtime.timestamp() if mtime else 0))
    return out


def _bin_start_epoch(epoch, unit):
    return (int(epoch) // unit) * unit


def _epoch(ts):
    """Метка времени записи (см. tokens.walk) -> unix-секунды, либо None.

    Нестрогий разбор (как в самом walk()): кривая/отсутствующая метка — не
    ошибка пользователя, запись просто не попадает ни в один бин.
    """
    dt = tokens._parse_time_bound(ts)
    return dt.timestamp() if dt else None


def _iso_from_epoch(epoch):
    """unix-секунды -> ISO 8601 UTC с миллисекундами. Формат как tokens.iso()."""
    dt = datetime.fromtimestamp(epoch, tz=timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _truncate(s, limit=LABEL_DESCRIPTION_LIMIT):
    s = s.strip()
    if len(s) <= limit:
        return s
    return s[:limit].rstrip() + "…"


def _agent_label(agent_key, meta):
    """Человекочитаемая метка агента для agentLabels.

    "main" -> фиксированная метка "Главный агент", не завязанная на meta (у
    главного агента meta всегда None, см. tokens.walk). Для субагента —
    meta.description (обрезанное), иначе meta.agentType, иначе сам ключ как
    fallback — та же лестница приоритетов, что и в agent_timeline.py::_header.
    """
    if agent_key == "main":
        return "Главный агент"
    if meta:
        desc = meta.get("description")
        if desc:
            return _truncate(desc)
        atype = meta.get("agentType")
        if atype:
            return atype
    return agent_key


def _workflow_name(root, project, session, run_id):
    """Человекочитаемое имя workflow по его run_id.

    Скрипт прогона лежит в `<project>/<session>/workflows/scripts/` и назван
    `<имя>-<run_id>.js` (см. фактическую раскладку транскриптов) — имя берём,
    отрезав хвост `-<run_id>.js`. Скрипта нет/каталог недоступен — сам run_id
    как fallback (лучше показать id, чем пусто).
    """
    scripts_dir = os.path.join(root, project, session, "workflows", "scripts")
    suffix = "-" + run_id + ".js"
    try:
        for name in os.listdir(scripts_dir):
            if name.endswith(suffix):
                return name[: -len(suffix)]
    except OSError:
        pass
    return run_id


def _bin_key(rec, group_workflows):
    """Ключ сегмента бина для записи.

    По умолчанию — agentId субагента ("main" у главного). При group_workflows
    все агенты одного workflow-прогона сливаются в один сегмент `workflow:<run>`
    — так на странице сессии группа агентов, поднятая одним Workflow, рисуется
    единым сегментом (см. agentLabels: там ключ несёт имя workflow).
    """
    wf = rec["workflowRunId"]
    if group_workflows and wf:
        return "workflow:" + wf
    return rec["agentId"] or "main"


def build_timeline(root, limit=20, unit=300, project=None, session=None, group_workflows=False):
    """Собирает ленту последних `limit` сессий, разложенных на бины `unit` секунд.

    Логику подсчёта расхода не переопределяет — каждая usage-запись из
    tokens.walk() учитывается ровно один раз (дедуп уже сделан в walk()),
    поэтому сумма total всех бинов сессии равна её полному расходу.

    Возвращает {"threads": [...], "agentLabels": {...}} — agentLabels
    верхнеуровневый (не per-thread): один и тот же agentId в разных тредах
    (напр. повторный вызов одного workflow-агента) получает одну метку.
    """
    sessions = _session_main_files(root, project=project, session=session)
    # последние N сессий по последней активности транскрипта, самые свежие первыми
    sessions.sort(key=lambda row: row[3], reverse=True)
    sessions = sessions[: max(limit, 0)]

    project_dirs = {}
    # session id -> project dir basename (под `root`). Нужен для _workflow_name:
    # rec["project"] из walk() — это relpath от глобального tokens.ROOT, а не от
    # переданного root, и при root != ROOT (тесты) он неверен.
    sid_to_proj = {}
    for _sid, proj, _path, _mtime in sessions:
        project_dirs.setdefault(proj, os.path.join(root, proj))
        sid_to_proj[_sid] = proj

    files = []
    for sid, proj, _path, _mtime in sessions:
        files.extend(tokens._session_files(project_dirs[proj], sid))

    records_by_session = defaultdict(list)
    # agent_key -> label, populated from the meta of the FIRST record seen for
    # that key (across all sessions in this slice) — meta is the same for
    # every record of a given agent-<id>.jsonl file (one meta.json per agent
    # invocation), so which record "wins" doesn't change the label.
    agent_labels = {}
    for rec in tokens.walk(files):
        records_by_session[rec["session"]].append(rec)
        key = _bin_key(rec, group_workflows)
        if key not in agent_labels:
            if group_workflows and rec["workflowRunId"]:
                proj = sid_to_proj.get(rec["session"], rec["project"])
                agent_labels[key] = _workflow_name(root, proj, rec["session"], rec["workflowRunId"])
            else:
                agent_labels[key] = _agent_label(key, rec["meta"])

    threads = []
    for sid, proj, _path, _mtime in sessions:
        recs = records_by_session.get(sid, [])

        # bin_epoch -> agent_key -> Bucket. Bucket переиспользуется из
        # tokens.py, чтобы формула total (inp+cacheWrite+cacheRead+out) не
        # дублировалась и не расходилась с той, что уже применяет tokens.py.
        bin_buckets = defaultdict(lambda: defaultdict(tokens.Bucket))
        epochs = []
        for rec in recs:
            epoch = _epoch(rec["ts"])
            if epoch is None:
                continue
            epochs.append(epoch)
            bin_epoch = _bin_start_epoch(epoch, unit)
            agent_key = _bin_key(rec, group_workflows)
            bin_buckets[bin_epoch][agent_key].add(rec["usage"], rec["model"], rec["ts"])

        if not epochs:
            # Сессия без единой валидной usage-записи не несёт данных для
            # ленты (не с чем считать start/end/duration) — пропускается, а
            # не выводится с фиктивными нулями.
            continue

        start_epoch = min(epochs)
        end_epoch = max(epochs)

        # Непрерывная лента: по бину на КАЖДУЮ единицу времени интервала
        # [start, end], включая пустые (нет активности). Иначе число столбцов
        # зависело бы от плотности активности, а не от длительности, и тред,
        # шедший дольше, но с редкими всплесками, выглядел бы уже плотного
        # короткого. Пустые бины фронтенд рисует меткой «нет активности».
        start_bin = _bin_start_epoch(start_epoch, unit)
        end_bin = _bin_start_epoch(end_epoch, unit)
        bins_out = []
        for bin_epoch in range(start_bin, end_bin + unit, unit):
            agents = bin_buckets.get(bin_epoch)
            agents_out = (
                sorted(
                    ({"key": k, "total": b.total} for k, b in agents.items()),
                    key=lambda a: (-a["total"], a["key"]),
                )
                if agents
                else []
            )
            bins_out.append({"t": _iso_from_epoch(bin_epoch), "agents": agents_out})

        total_tokens = sum(a["total"] for bo in bins_out for a in bo["agents"])
        # Стоимость считается по тем же Bucket, что и токены (один тариф, одна
        # формула) — сумма по бакетам равна полной стоимости треда, как и
        # total_tokens равна сумме b.total.
        total_cost = round(sum(b.cost for agents in bin_buckets.values() for b in agents.values()), 2)
        # Различные workflow-прогоны сессии: agentId субагента, запущенного в
        # рамках workflow, несёт workflowRunId (см. tokens.walk); обычный
        # тред без workflow даёт пустое множество -> 0.
        workflow_count = len({r["workflowRunId"] for r in recs if r["workflowRunId"]})

        threads.append(
            {
                "session": sid,
                "project": proj,
                # человекочитаемое имя подставит сервис (src/service) позже
                "title": sid,
                "start": _iso_from_epoch(start_epoch),
                "end": _iso_from_epoch(end_epoch),
                "durationSec": end_epoch - start_epoch,
                "totalTokens": total_tokens,
                "totalCost": total_cost,
                "workflowCount": workflow_count,
                "bins": bins_out,
            }
        )

    return {"threads": threads, "agentLabels": agent_labels}


def main():
    ap = tokens.JsonAwareParser()
    ap.add_argument("--json", action="store_true", help="печатать один JSON-объект вместо таблицы")
    ap.add_argument("--limit", type=int, default=20, help="сколько последних сессий взять")
    ap.add_argument("--unit", type=int, required=True, help="размер бина в секундах")
    ap.add_argument("--project", help="подстрока пути проекта")
    ap.add_argument("--session", help="точный id сессии (страница одной сессии); отменяет отбор по свежести")
    ap.add_argument("--group-workflows", action="store_true", help="слить агентов одного workflow-прогона в один сегмент")
    a = ap.parse_args()

    if a.limit < 0:
        ap.error("--limit не может быть отрицательным")
    if a.unit <= 0:
        ap.error("--unit должен быть положительным числом секунд")

    result = build_timeline(
        tokens.ROOT, limit=a.limit, unit=a.unit, project=a.project, session=a.session, group_workflows=a.group_workflows
    )
    out = {"schemaVersion": SCHEMA_VERSION, "unit": a.unit, **result}

    if a.json:
        print(json.dumps(out, ensure_ascii=False))
        return

    print(f"{'сессия':<10} {'проект':<40} {'токенов':>10} {'сек':>8}")
    print("-" * 70)
    for t in result["threads"]:
        print(f"{t['session'][:8]:<10} {t['project'][:40]:<40} {t['totalTokens']:>10} {t['durationSec']:>8.0f}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        if "--json" in sys.argv:
            print(json.dumps({"error": str(e)}, ensure_ascii=False))
            sys.exit(1)
        raise
