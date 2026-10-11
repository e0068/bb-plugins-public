"""Pure native transcript adapters. Output is Claude-compatible JSONL."""
from datetime import datetime, timezone
import math


def count(value):
    return max(0, int(value)) if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else 0


def mapping(value):
    return value if isinstance(value, dict) else {}


def timestamp(value, milliseconds=False):
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(value / (1000 if milliseconds else 1), timezone.utc).isoformat().replace('+00:00', 'Z')
        except (ValueError, OverflowError, OSError):
            return None
    return None


def assistant(identity, model, usage, at, cwd=None, effort=None):
    return {'type': 'assistant', 'timestamp': at, 'requestId': identity, 'cwd': cwd,
            'effort': effort, 'message': {'id': identity, 'model': model, 'usage': usage}}


def codex(rows):
    model, effort, cwd, session, branch = None, None, None, '', None
    previous = {}
    # A compacted snapshot can be inherited by children. Only a matching, local
    # durable API record proves a billable compaction request. Ordinary records
    # already appear in cumulative token_count and must not be added again.
    compactions = {mapping(row.get('payload')).get('compaction_response_id')
                   for row in rows if row.get('type') == 'compacted'}
    billed_compactions = set()
    out = []
    for offset, row in enumerate(rows):
        payload = mapping(row.get('payload'))
        if row.get('type') == 'session_meta':
            cwd, session = payload.get('cwd'), payload.get('id', '')
            branch = mapping(payload.get('git')).get('branch')
        if row.get('type') == 'turn_context':
            model, effort = payload.get('model'), payload.get('effort')
        if row.get('type') == 'token_usage_record':
            response = payload.get('response_id')
            if (response and response in compactions and response not in billed_compactions
                    and payload.get('thread_id') == session):
                u = mapping(payload.get('usage'))
                cached, written, output = count(u.get('cached_input_tokens')), count(u.get('cache_write_input_tokens')), count(u.get('output_tokens'))
                usage = {'input_tokens': max(0, count(u.get('input_tokens')) - cached - written),
                         'cache_read_input_tokens': cached, 'cache_creation_input_tokens': written,
                         'output_tokens': output,
                         'output_tokens_details': {'thinking_tokens': min(output, count(u.get('reasoning_output_tokens')))},
                         'api_context_input_tokens': count(u.get('input_tokens'))}
                record = assistant(f'codex:{session}:{response}', model, usage, timestamp(row.get('timestamp')), cwd, effort)
                record['gitBranch'] = branch
                out.append(record)
                billed_compactions.add(response)
            continue
        if row.get('type') != 'event_msg' or payload.get('type') != 'token_count':
            continue
        info = mapping(payload.get('info'))
        total = info.get('total_token_usage')
        if not isinstance(total, dict):
            continue  # last_token_usage alone cannot distinguish repeated notifications
        current = {k: count(total.get(k)) for k in ('input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens')}
        # A reset establishes a new cumulative epoch. Same totals give no spend.
        delta = {k: (v - previous.get(k, 0) if v >= previous.get(k, 0) else v) for k, v in current.items()}
        previous = current
        if not any(delta.values()):
            continue
        cached, written = delta['cached_input_tokens'], delta['cache_write_input_tokens']
        usage = {'input_tokens': max(0, delta['input_tokens'] - cached - written),
                 'cache_read_input_tokens': cached, 'cache_creation_input_tokens': written,
                 'output_tokens': delta['output_tokens'],
                 'output_tokens_details': {'thinking_tokens': min(delta['reasoning_output_tokens'], delta['output_tokens'])},
                 'api_context_input_tokens': count(mapping(info.get('last_token_usage')).get('input_tokens'))}
        record = assistant(f'codex:{session}:{offset}', model, usage, timestamp(row.get('timestamp')), cwd, effort)
        record['gitBranch'] = branch
        out.append(record)
    return out


def kimi(rows, session, agent='main', model=None):
    out = []
    for offset, row in enumerate(rows):
        if row.get('type') == 'usage.record':
            u = mapping(row.get('usage'))
            keys = ('inputOther', 'inputCacheRead', 'inputCacheCreation', 'output')
            at = timestamp(row.get('time'), milliseconds=True)
            current_model = row.get('model')
        else:
            message = mapping(row.get('message'))
            payload = mapping(message.get('payload'))
            if message.get('type') != 'StatusUpdate' or not isinstance(payload.get('token_usage'), dict):
                continue
            u = payload['token_usage']
            keys = ('input_other', 'input_cache_read', 'input_cache_creation', 'output')
            at = timestamp(row.get('timestamp'))
            current_model = payload.get('model') or model
        inp, cached, written, output = (count(u.get(k)) for k in keys)
        if not any((inp, cached, written, output)):
            continue
        usage = {'input_tokens': inp, 'cache_read_input_tokens': cached,
                 'cache_creation_input_tokens': written, 'output_tokens': output}
        out.append(assistant(f'kimi:{session}:{agent}:{offset}', current_model, usage, at))
    return out
