"""Filesystem boundary: native logs and isolated, incremental Claude projections."""
import glob
import hashlib
import json
import os
import re
import shutil
from pathlib import Path
import tempfile

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "core"))
from normalize import codex, kimi


def rows(path):
    try:
        with open(path, errors='replace') as stream:
            result = []
            for line in stream:
                try:
                    row = json.loads(line)
                    if isinstance(row, dict):
                        result.append(row)
                except (ValueError, TypeError):
                    pass
            return result
    except OSError:
        return []


def native_sessions(home=None):
    home = Path(home or Path.home())
    codex_home = Path(os.environ.get('CODEX_HOME', home / '.codex'))
    paths = list((codex_home / 'sessions').glob('**/*.jsonl')) + list((codex_home / 'archived_sessions').glob('**/*.jsonl'))
    discovered = {}
    for path in sorted(paths):
        # Rollout names contain the UUID; reading header only keeps discovery cheap.
        try:
            with path.open() as stream:
                meta = json.loads(stream.readline()).get('payload', {})
            if not isinstance(meta.get('id'), str) or not re.fullmatch(r'[A-Za-z0-9_-]+', meta['id']):
                continue
            source = meta.get('source')
            spawn = source.get('subagent', {}).get('thread_spawn', {}) if isinstance(source, dict) else {}
            discovered[meta['id']] = {'provider': 'codex', 'session': meta['id'], 'cwd': meta.get('cwd'),
                                      'parent': spawn.get('parent_thread_id'), 'files': [('main', str(path))]}
        except (OSError, ValueError, AttributeError):
            continue
    grouped = {}
    for identity, session in discovered.items():
        root, seen = identity, {identity}
        while discovered[root].get('parent') in discovered:
            parent = discovered[root]['parent']
            if parent in seen:
                break
            seen.add(parent)
            root = parent
        group = grouped.setdefault(root, dict(discovered[root], files=[]))
        group['files'].append(('main' if root == identity else identity, session['files'][0][1]))
    yield from grouped.values()
    roots = [home / '.kimi', Path(os.environ.get('KIMI_CODE_HOME', home / '.kimi-code'))]
    for root in roots:
        for directory in sorted((root / 'sessions').glob('*/*')):
            if not directory.is_dir() or not re.fullmatch(r'[A-Za-z0-9_-]+', directory.name):
                continue
            main = directory / 'wire.jsonl'
            if not main.exists():
                main = directory / 'agents' / 'main' / 'wire.jsonl'
            if not main.exists():
                continue
            files = [('main', str(main))]
            files += [(p.parent.name, str(p)) for p in sorted((directory / 'agents').glob('*/wire.jsonl')) if p != main]
            files += [(p.parent.name, str(p)) for p in sorted((directory / 'subagents').glob('*/wire.jsonl'))]
            # Historical model must come from session metadata, never today's global config.
            meta_path = directory / 'metadata.json'
            try:
                meta = json.loads(meta_path.read_text())
            except (OSError, ValueError):
                meta = {}
            yield {'provider': 'kimi', 'session': directory.name, 'cwd': meta.get('work_dir') or meta.get('workDir'),
                   'project': directory.parent.name, 'model': meta.get('model'), 'files': files}


def normalized(session):
    for agent, path in session['files']:
        data = rows(path)
        converted = codex(data) if session['provider'] == 'codex' else kimi(data, session['session'], agent, session.get('model'))
        yield agent, converted


def read_session(session_id, home=None):
    for session in native_sessions(home):
        if session['session'] == session_id:
            return [row for _, records in normalized(session) for row in records]
    return None


def atomic_write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            stream.write(text)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def usage_store(claude_root, home=None, cache=None):
    """Expose existing Claude directories plus projected native sessions to all analytics scripts."""
    home = Path(home or Path.home())
    fingerprint = hashlib.sha256(str(home).encode()).hexdigest()[:16]
    cache = Path(cache or Path(tempfile.gettempdir()) / f'bb-provider-usage-{os.getuid()}-{fingerprint}')
    cache.mkdir(parents=True, exist_ok=True, mode=0o700)
    claude = Path(claude_root)
    if claude.is_dir():
        for source in claude.iterdir():
            target = cache / source.name
            if source.is_dir() and not target.exists():
                try:
                    target.symlink_to(source.resolve(), target_is_directory=True)
                except FileExistsError:
                    pass
    adapter_version = hashlib.sha256((Path(__file__).read_bytes() + (Path(__file__).parent.parent / 'core/normalize.py').read_bytes())).hexdigest()
    active = {}
    for session in native_sessions(home):
        project = session.get('cwd') or session.get('project') or 'unknown'
        slug = session['provider'] + '-' + project.replace(os.sep, '-')
        base = cache / slug
        active.setdefault(slug, set()).add(session['session'])
        sources = session['files']
        try:
            signature = json.dumps([adapter_version, [(path, os.stat(path).st_mtime_ns, os.stat(path).st_size) for _, path in sources]])
        except OSError:
            continue
        stamp = base / (session['session'] + '.stamp')
        try:
            if stamp.read_text() == signature:
                continue
        except OSError:
            pass
        for agent, records in normalized(session):
            target = base / (session['session'] + '.jsonl') if agent == 'main' else base / session['session'] / 'subagents' / f'agent-{agent}.jsonl'
            atomic_write(target, ''.join(json.dumps(row) + '\n' for row in records))
            source_path = next(path for source_agent, path in sources if source_agent == agent)
            source_stat = os.stat(source_path)
            os.utime(target, ns=(source_stat.st_atime_ns, source_stat.st_mtime_ns))
            if records:
                atomic_write(target.with_suffix('.meta.json'), json.dumps({'model': records[-1]['message']['model'], 'agentType': session['provider']}))
        atomic_write(stamp, signature)
    # Remove obsolete native projections, including children now attributed to a parent.
    # Claude directories are symlinks and never enter this cleanup.
    for base in cache.iterdir():
        if base.is_symlink() or not base.is_dir() or not base.name.startswith(('codex-', 'kimi-')):
            continue
        for stamp in base.glob('*.stamp'):
            identity = stamp.stem
            if identity in active.get(base.name, set()):
                continue
            for suffix in ('.jsonl', '.meta.json', '.stamp'):
                (base / (identity + suffix)).unlink(missing_ok=True)
            shutil.rmtree(base / identity, ignore_errors=True)
    return str(cache)


if __name__ == '__main__':
    import sys
    result = read_session(sys.argv[1])
    if result is not None:
        for row in result:
            print(json.dumps(row))
