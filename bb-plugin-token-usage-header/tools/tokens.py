#!/usr/bin/env python3
"""Счётчик токенов по транскриптам Claude Code (~/.claude/projects).

Разрезы: сессия, субагент, workflow-прогон, модель, временное окно.
Источник истины — поле message.usage в каждой assistant-записи.
"""
import json, os, re, sys, glob, argparse
from collections import defaultdict
from datetime import datetime, timezone

ROOT = os.path.expanduser("~/.claude/projects")

# Версия формата отчёта --json. Поднимать при ЛЮБОЙ ломающей смене формата
# (новое обязательное поле, смена типа/имени существующего) — src/core/parse.ts
# сверяет её первой и по несовпадению зовёт пересобрать плагин, а не
# ругается на поле данных. См. memory/decisions/token-usage-json-schema-version.md.
SCHEMA_VERSION = 2

# Голая календарная дата без времени, как принимают --since/--until.
_DATE_ONLY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# базовая цена за 1M токенов, USD: вход / выход (прайс Anthropic API)
PRICES = {
    "fable":  (10.00, 50.00),
    "opus":   ( 5.00, 25.00),
    "sonnet": ( 3.00, 15.00),
    "haiku":  ( 1.00,  5.00),
}
# множители к цене входа: запись в кэш на 5 минут, на час, чтение из кэша
CACHE_5M, CACHE_1H, CACHE_READ = 1.25, 2.00, 0.10

def tier(model):
    m = (model or "").lower()
    for k in PRICES:
        if k in m:
            return k
    return "sonnet"

FIELDS = ("inp", "cw5", "cw1h", "cr", "out")


class ModelCounts:
    """Счётчики одной модели внутри бакета: сколько токенов на неё пришлось."""
    def __init__(self):
        self.inp = self.cw5 = self.cw1h = self.cr = self.out = 0

    @property
    def total(self):
        return self.inp + self.cw5 + self.cw1h + self.cr + self.out

    def add(self, inp, cw5, cw1h, cr, out):
        self.inp  += inp
        self.cw5  += cw5
        self.cw1h += cw1h
        self.cr   += cr
        self.out  += out

    def merge(self, other):
        for f in FIELDS:
            setattr(self, f, getattr(self, f) + getattr(other, f))


def models_json(models):
    """Разбивка расхода по тирам моделей для JSON-вывода.

    Убыванием расхода, а не по алфавиту: подпись строки читают слева
    направо, и первой должна стоять модель, на которую ушло больше. При
    равном расходе — по имени тира, для детерминированного порядка.
    """
    return [
        {"tier": t, "total": c.total}
        for t, c in sorted(models.items(), key=lambda kv: (-kv[1].total, kv[0]))
    ]


class Bucket:
    def __init__(self):
        self.inp = self.cw5 = self.cw1h = self.cr = self.out = self.think = 0
        self.msgs = 0
        # Разбивка того же расхода по тирам моделей. Бакет почти никогда не
        # однороден: главный агент за сессию успевает поработать на нескольких
        # моделях, и одно имя в подписи выбирало бы победителя произвольно.
        self.models = defaultdict(ModelCounts)
        self.t0 = self.t1 = None

    def add(self, u, model, ts):
        cc = u.get("cache_creation") or {}
        inp   = u.get("input_tokens", 0)
        cw5   = cc.get("ephemeral_5m_input_tokens", 0)
        cw1h  = cc.get("ephemeral_1h_input_tokens", 0)
        if not cc:
            cw5 += u.get("cache_creation_input_tokens", 0)
        cr    = u.get("cache_read_input_tokens", 0)
        out   = u.get("output_tokens", 0)

        self.inp   += inp
        self.cw5   += cw5
        self.cw1h  += cw1h
        self.cr    += cr
        self.out   += out
        self.think += (u.get("output_tokens_details") or {}).get("thinking_tokens", 0)
        self.msgs  += 1

        self.models[tier(model)].add(inp, cw5, cw1h, cr, out)

        if ts:
            self.t0 = min(self.t0, ts) if self.t0 else ts
            self.t1 = max(self.t1, ts) if self.t1 else ts

    @property
    def total(self):
        return self.inp + self.cw + self.cr + self.out

    @property
    def cw(self):
        return self.cw5 + self.cw1h

    def _tier_prices(self):
        # тариф берём по модели, давшей больше всего выхода в этом бакете —
        # это НЕ та же сортировка, что в "models" (там порядок по общему
        # расходу, в котором доминирует чтение кэша). Модель, идущая первой
        # в "models", и модель, по чьему тарифу считаем cost, могут разойтись.
        t = max(self.models, key=lambda k: self.models[k].out) if self.models else "sonnet"
        return PRICES[t]

    @property
    def cost(self):
        pi, po = self._tier_prices()
        return (self.inp*pi + self.cw5*pi*CACHE_5M + self.cw1h*pi*CACHE_1H
                + self.cr*pi*CACHE_READ + self.out*po) / 1e6

    @property
    def cost_parts(self):
        """Стоимость по видам токенов тем же тарифом, что и cost.

        input+cacheWrite+cacheRead+output в сумме дают cost; thinking — часть
        output (тарифицируется как выход) и в эту сумму не входит, идёт поверх.
        """
        pi, po = self._tier_prices()
        return {
            "input":      self.inp * pi / 1e6,
            "cacheWrite": (self.cw5 * CACHE_5M + self.cw1h * CACHE_1H) * pi / 1e6,
            "cacheRead":  self.cr * pi * CACHE_READ / 1e6,
            "output":     self.out * po / 1e6,
            "thinking":   self.think * po / 1e6,
        }


def merge_buckets(buckets):
    """Сливает несколько бакетов в один — для строки итогов ("ИТОГО").

    Складывает и сквозные счётчики бакета (inp/cw5/.../msgs), и разбивку по
    моделям внутри models — иначе итоговая строка теряла бы, на какие тиры
    ушёл суммарный расход.
    """
    grand = Bucket()
    for b in buckets:
        for attr in FIELDS + ("think", "msgs"):
            setattr(grand, attr, getattr(grand, attr) + getattr(b, attr))
        for t, c in b.models.items():
            grand.models[t].merge(c)
    return grand

def _parse_time_bound(s, *, strict=False, end_of_day=False):
    """Строку границы (дата или полный ISO-таймстамп) -> aware datetime UTC.

    Пустая строка/None -> None всегда: "граница не задана" — законный
    случай в обоих режимах.

    По умолчанию (strict=False) неразбираемая непустая строка тоже тихо
    даёт None. Этот режим — для меток времени самих записей транскрипта:
    там кривая строка — редкий брак данных, а не ошибка пользователя, и
    запись просто не пройдёт фильтр (см. walk()).

    strict=True — для пользовательских --since/--until (RPC и ручной
    запуск). Здесь тихий None недопустим: `datetime.fromisoformat`
    отвергает не только "2026-13-45" (разбор), но и календарно
    несуществующие даты вроде "2026-02-30" (число дней в месяце) — но само
    по себе исключение раньше проглатывалось, и фильтр беззвучно исчезал
    целиком, а не просто пропускал одну запись. strict=True поднимает
    ValueError вместо этого.

    end_of_day=True якорит голую календарную дату (без времени части) на
    последнюю микросекунду дня, а не на его полночь. Полночь — раньше
    любой реальной записи этого дня, поэтому "--until: весь такой-то
    день" без этой поправки выбрасывал названный день целиком (сравнение
    в строгом "позже" смысле). Полным ISO-таймстампам (не голым датам)
    эта поправка не нужна и не применяется.
    """
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except (ValueError, TypeError) as e:
        if strict:
            raise ValueError(
                f"Некорректная дата/время {s!r}: {e}. Ожидается YYYY-MM-DD или полный ISO-таймстамп."
            ) from e
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    if end_of_day and _DATE_ONLY_RE.match(s):
        dt = dt.replace(hour=23, minute=59, second=59, microsecond=999999)
    return dt

def _file_mtime(path):
    """mtime файла как aware datetime UTC, либо None, если недоступен."""
    try:
        return datetime.fromtimestamp(os.path.getmtime(path), tz=timezone.utc)
    except OSError:
        return None

def _filter_by_since(files, since):
    """Отбрасывает файлы, у которых mtime строго раньше границы `since`.

    Записи в транскрипте идут по возрастанию времени, поэтому mtime файла —
    верхняя граница времён внутри него: mtime < since гарантирует, что все
    записи файла тоже раньше since, и файл можно не открывать. mtime >= since
    ничего не гарантирует (файл могли тронуть позже последней записи) — такой
    файл остаётся в списке.

    `since` уже прошла пользовательский ввод (RPC или консоль) — разбор
    строгий: несуществующая календарная дата поднимает ValueError, а не
    молча отключает фильтр (см. _parse_time_bound).
    """
    since_dt = _parse_time_bound(since, strict=True)
    if since_dt is None:
        return files
    kept = []
    for f in files:
        mtime = _file_mtime(f)
        if mtime is not None and mtime < since_dt:
            continue
        kept.append(f)
    return kept

def _session_files(project_dir, session_prefix):
    """Файлы одной сессии (и её субагентов/workflow-прогонов) в каталоге проекта.

    Путь предсказуем: `<project_dir>/<sessionId>.jsonl` — главный транскрипт,
    `<project_dir>/<sessionId>/subagents/**/*.jsonl` — субагенты и вспомогательные
    файлы workflow-прогонов (agent-*.jsonl, journal.jsonl). session_prefix может
    быть неполным id — сопоставление по началу имени.
    """
    try:
        entries = os.listdir(project_dir)
    except OSError:
        return []

    matched_ids = set()
    files = []
    for name in entries:
        if name.endswith(".jsonl"):
            sid = name[:-len(".jsonl")]
            if sid.startswith(session_prefix):
                files.append(os.path.join(project_dir, name))
                matched_ids.add(sid)
        elif name.startswith(session_prefix):
            full = os.path.join(project_dir, name)
            if os.path.isdir(full):
                matched_ids.add(name)

    for sid in matched_ids:
        subagents_dir = os.path.join(project_dir, sid, "subagents")
        if os.path.isdir(subagents_dir):
            files.extend(glob.glob(f"{subagents_dir}/**/*.jsonl", recursive=True))

    return files

def select_files(root, project=None, session=None, since=None):
    """Сужает набор файлов транскриптов ДО чтения, по фильтрам среза.

    Не меняет логику подсчёта — только то, какие файлы дойдут до walk().
    Комбинация фильтров — их пересечение (project сужает каталоги, session
    сужает файлы внутри них, since отбрасывает по mtime поверх результата).
    """
    if not os.path.isdir(root):
        return []

    try:
        entries = os.listdir(root)
    except OSError:
        return []
    project_dirs = [os.path.join(root, d) for d in entries
                    if os.path.isdir(os.path.join(root, d))]
    if project:
        project_dirs = [d for d in project_dirs if project in os.path.basename(d)]

    files = []
    if session:
        for pd in project_dirs:
            files.extend(_session_files(pd, session))
    else:
        for pd in project_dirs:
            files.extend(glob.glob(f"{pd}/**/*.jsonl", recursive=True))

    if since:
        files = _filter_by_since(files, since)

    return files

def load_meta(jsonl_path):
    """Читает <agent-...>.meta.json рядом с транскриптом агента.

    None, если файла нет или он битый — это не ошибка, а нормальный случай
    (старые транскрипты записывались без meta-файла).
    """
    meta_path = jsonl_path[:-len(".jsonl")] + ".meta.json"
    if not os.path.exists(meta_path):
        return None
    try:
        with open(meta_path) as f:
            return json.load(f)
    except Exception:
        return None

def walk(paths, since=None, until=None):
    """Возвращает по одной записи на каждый usage-объект в транскриптах.

    Каждая запись — словарь с полями:
      project        — слепок пути проекта (имя каталога в ~/.claude/projects)
      session        — id сессии Claude Code
      agentId        — стабильный id вида "agent-<hash>" для вызовов
                        субагентов (в т.ч. агентов workflow-прогонов),
                        None для записей главного агента сессии
      workflowRunId  — имя каталога прогона, если agentId принадлежит
                        workflow-прогону, иначе None
      meta           — распарсенный agent-<id>.meta.json (agentType,
                        description, model, ...), либо None
      usage, model, ts — как в исходной assistant-записи

    since/until — пользовательские границы среза, разбираются здесь же
    строго (см. _parse_time_bound): несуществующая календарная дата
    поднимает ValueError вместо того, чтобы молча снять фильтр. until,
    заданный голой датой, якорится на конец дня, а не на его полночь —
    иначе весь названный день выпадал бы целиком. Сравнение с меткой
    времени записи идёт по разобранным datetime, а не по сырым строкам:
    строковое "2026-08-16T00:00:14.616Z" > "2026-08-16" истинно просто
    потому что первая строка длиннее, и это раньше выбрасывало весь день.
    """
    since_dt = _parse_time_bound(since, strict=True)
    until_dt = _parse_time_bound(until, strict=True, end_of_day=True)
    seen = set()
    # Порядок файлов фиксируем сортировкой: ключ дедупликации может встретиться
    # в двух файлах сразу (перенос тредов между окружениями), и от порядка
    # зависит, какому файлу — а значит какой сессии — достанется расход.
    # os.listdir/glob такого порядка не гарантируют.
    for f in sorted(paths):
        rel = os.path.relpath(f, ROOT)
        parts = rel.split(os.sep)
        project = parts[0]
        stem = os.path.basename(f)[:-len(".jsonl")]
        in_subagents = "subagents" in parts
        is_agent_file = in_subagents and stem.startswith("agent-")

        if in_subagents:
            session = parts[parts.index("subagents") - 1]
        else:
            session = stem

        workflow_run_id = parts[parts.index("workflows") + 1] if "workflows" in parts else None

        if is_agent_file:
            agent_id = stem
            meta = load_meta(f)
        else:
            # либо главная сессия, либо вспомогательный файл прогона
            # (напр. journal.jsonl) — не отдельный вызов агента
            agent_id = None
            meta = None

        # Свернуть записи файла по ключу дедупликации: побеждает последняя.
        # Пока ответ стримится, транскрипт пишет его несколько раз с одной
        # парой (message.id, requestId), наращивая output_tokens; финальное
        # значение — в последней записи, ранние это незавершённые снимки.
        # Раньше здесь оставалась первая запись — выход занижался.
        # См. decisions/token-usage-dedup-last-wins.md.
        records = {}
        with open(f, errors="ignore") as fh:
            for line in fh:
                try:
                    d = json.loads(line)
                except Exception:
                    continue
                msg = d.get("message") or {}
                u = msg.get("usage")
                if not u or d.get("type") != "assistant":
                    continue
                records[(msg.get("id"), d.get("requestId"))] = {
                    "usage": u,
                    "model": msg.get("model"),
                    "ts": d.get("timestamp"),
                }

        for dedup, rec in records.items():
            if dedup in seen:
                continue
            seen.add(dedup)
            ts = rec["ts"]
            if since_dt or until_dt:
                ts_dt = _parse_time_bound(ts)
                if since_dt and (ts_dt is None or ts_dt < since_dt):  continue
                if until_dt and (ts_dt is None or ts_dt > until_dt):  continue
            yield {
                "project": project,
                "session": session,
                "agentId": agent_id,
                "workflowRunId": workflow_run_id,
                "meta": meta,
                "usage": rec["usage"],
                "model": rec["model"],
                "ts": ts,
            }

def human(n):
    for unit, div in (("M", 1e6), ("k", 1e3)):
        if n >= div:
            return f"{n/div:.1f}{unit}"
    return str(n)

def iso(ts):
    """timestamp транскрипта -> ISO 8601 UTC, либо None."""
    if not ts:
        return None
    try:
        s = ts.replace("Z", "+00:00") if isinstance(ts, str) else ts
        dt = datetime.fromisoformat(s) if isinstance(s, str) else None
        if dt is None:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    except Exception:
        return ts if isinstance(ts, str) else None

def bucket_json(key, b, session_id, project, agent):
    d = {
        "key": key,
        "sessionId": session_id,
        "project": project,
        "agent": agent,
        "total": b.total,
        "input": b.inp,
        "cacheWrite5m": b.cw5,
        "cacheWrite1h": b.cw1h,
        "cacheRead": b.cr,
        "output": b.out,
        "thinking": b.think,
        "messages": b.msgs,
        "cost": round(b.cost, 2),
        "models": models_json(b.models),
    }
    d["firstAt"] = iso(b.t0)
    d["lastAt"] = iso(b.t1)
    return d

class JsonAwareParser(argparse.ArgumentParser):
    """В машинном режиме ошибка разбора аргументов — тоже JSON на stdout.

    argparse завершает работу через SystemExit, минуя перехват исключений в
    __main__, и печатает usage в stderr: потребитель получал пустой stdout.
    """

    def error(self, message):
        if "--json" in sys.argv:
            print(json.dumps({"error": message}, ensure_ascii=False))
            raise SystemExit(1)
        super().error(message)


def main():
    ap = JsonAwareParser()
    ap.add_argument("--by", default="session",
                    choices=["session", "project", "agent", "workflow", "model", "day"])
    ap.add_argument("--project", help="подстрока пути проекта")
    ap.add_argument("--session", help="id сессии (можно префикс)")
    ap.add_argument("--since", help="ISO-дата, напр. 2026-08-01")
    ap.add_argument("--until")
    ap.add_argument("--top", type=int, default=25)
    ap.add_argument("--json", action="store_true", help="печатать один JSON-объект вместо таблицы")
    a = ap.parse_args()
    # срез с отрицательным --top отбрасывал бы самые крупные бакеты, а не ограничивал вывод
    if a.top < 0:
        ap.error("--top не может быть отрицательным")
    # Невалидная или несуществующая календарная дата (--since/--until) не
    # должна тихо снять фильтр — ap.error даёт то же единообразное
    # поведение (usage-текст либо {"error": ...} в --json), что и проверка
    # --top выше; сама разбор-логика — в _parse_time_bound(strict=True),
    # которую заново вызовут select_files()/walk() ниже.
    try:
        _parse_time_bound(a.since, strict=True)
        _parse_time_bound(a.until, strict=True, end_of_day=True)
    except ValueError as e:
        ap.error(str(e))

    files = select_files(ROOT, project=a.project, session=a.session, since=a.since)

    buckets = defaultdict(Bucket)
    bucket_sessions = defaultdict(set)   # key -> {sessionId, ...}
    bucket_projects = defaultdict(set)   # key -> {project, ...}
    bucket_agent = {}                    # key -> agent-объект или None (только для --by agent)
    bucket_label = {}                    # key -> человекочитаемая подпись для таблицы

    for rec in walk(files, a.since, a.until):
        session, project = rec["session"], rec["project"]
        if a.session and not session.startswith(a.session):
            continue
        agent_id, workflow_run_id, meta = rec["agentId"], rec["workflowRunId"], rec["meta"]
        model, ts = rec["model"], rec["ts"]

        if a.by == "session":
            key = f"{session[:8]}  {project}"
            label = key
        elif a.by == "project":
            key = project
            label = key
        elif a.by == "agent":
            if agent_id:
                key = agent_id
                desc = (meta or {}).get("description")
                if desc:
                    label = desc
                else:
                    atype = (meta or {}).get("agentType") or "?"
                    amodel = (meta or {}).get("model") or "?"
                    label = f"{agent_id} [{atype}/{amodel}]"
            else:
                key = "main"
                label = "(главный агент)"
        elif a.by == "workflow":
            if not workflow_run_id:
                continue
            key = workflow_run_id
            label = key
        elif a.by == "model":
            key = model or "?"
            label = key
        else:
            key = (ts or "")[:10]
            label = key

        buckets[key].add(rec["usage"], model, ts)
        bucket_sessions[key].add(session)
        bucket_projects[key].add(project)
        bucket_label[key] = label

        if a.by == "agent" and key not in bucket_agent:
            if agent_id:
                bare_id = agent_id[len("agent-"):] if agent_id.startswith("agent-") else agent_id
                bucket_agent[key] = {
                    "id": bare_id,
                    "description": (meta or {}).get("description") if meta else None,
                    "agentType": (meta or {}).get("agentType") if meta else None,
                    "model": (meta or {}).get("model") if meta else None,
                    "workflowRunId": workflow_run_id,
                }
            else:
                bucket_agent[key] = None

    rows = sorted(buckets.items(), key=lambda kv: -kv[1].total)[:a.top]

    grand = merge_buckets(buckets.values())
    total_cost = float(sum(b.cost for b in buckets.values()))
    # Пофазная стоимость итога — сумма по бакетам (у каждого свой тир), а не
    # cost_parts объединённого бакета: только так input+cacheWrite+cacheRead+
    # output совпадают с total_cost, который тоже сумма по бакетам.
    total_costs = {"input": 0.0, "cacheWrite": 0.0, "cacheRead": 0.0, "output": 0.0, "thinking": 0.0}
    for b in buckets.values():
        for phase, value in b.cost_parts.items():
            total_costs[phase] += value

    if a.json:
        def one(k, b):
            sess = bucket_sessions[k]
            proj = bucket_projects[k]
            session_id = next(iter(sess)) if len(sess) == 1 else None
            project = next(iter(proj)) if len(proj) == 1 else None
            agent = bucket_agent.get(k)
            return bucket_json(k, b, session_id, project, agent)

        out = {
            "schemaVersion": SCHEMA_VERSION,
            "by": a.by,
            "buckets": [one(k, b) for k, b in rows],
            "totals": {
                "total": grand.total,
                "input": grand.inp,
                "cacheWrite5m": grand.cw5,
                "cacheWrite1h": grand.cw1h,
                "cacheRead": grand.cr,
                "output": grand.out,
                "thinking": grand.think,
                "messages": grand.msgs,
                "cost": round(total_cost, 2),
                "costs": {phase: round(value, 2) for phase, value in total_costs.items()},
                "models": models_json(grand.models),
                "buckets": len(buckets),
            },
            "truncated": len(buckets) > len(rows),
        }
        print(json.dumps(out, ensure_ascii=False))
        return

    print(f"{'ключ':<46} {'всего':>8} {'вход':>7} {'кэш-w':>7} {'кэш-r':>7} {'выход':>7} {'думал':>7} {'$':>7}")
    print("-" * 100)
    for k, b in rows:
        label = bucket_label[k]
        print(f"{label[:45]:<46} {human(b.total):>8} {human(b.inp):>7} {human(b.cw):>7} "
              f"{human(b.cr):>7} {human(b.out):>7} {human(b.think):>7} {b.cost:>7.2f}")
    print("-" * 100)
    print(f"{'ИТОГО (' + str(len(buckets)) + ' шт., ' + str(grand.msgs) + ' ответов)':<46} "
          f"{human(grand.total):>8} {human(grand.inp):>7} {human(grand.cw):>7} "
          f"{human(grand.cr):>7} {human(grand.out):>7} {human(grand.think):>7} {total_cost:>7.2f}")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        args_has_json = "--json" in sys.argv
        if args_has_json:
            print(json.dumps({"error": str(e)}, ensure_ascii=False))
            sys.exit(1)
        raise
