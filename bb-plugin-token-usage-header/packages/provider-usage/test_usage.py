import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent / "core"))
sys.path.insert(0, str(Path(__file__).resolve().parent / "shell"))
from normalize import codex, kimi
from store import usage_store, read_session


class NativeUsageTest(unittest.TestCase):
    def test_codex_snapshots_count_each_increment_once_and_keep_cache_and_reasoning_separate(self):
        rows = [{'type':'session_meta','payload':{'id':'session','cwd':'/work'}},
                {'type':'turn_context','payload':{'model':'gpt-6.1-sol','effort':'high'}}]
        for i, usage in enumerate([(100,60,10,3),(100,60,10,3),(160,90,20,5)]):
            inp,cache,out,reason=usage
            rows.append({'type':'event_msg','timestamp':f'2026-10-11T10:0{i}:00Z','payload':{'type':'token_count','info':{'total_token_usage':{'input_tokens':inp,'cached_input_tokens':cache,'output_tokens':out,'reasoning_output_tokens':reason}}}})
        result=codex(rows)
        self.assertEqual(len(result),2)
        self.assertEqual([r['message']['usage']['input_tokens'] for r in result],[40,30])
        self.assertEqual(sum(r['message']['usage']['cache_read_input_tokens'] for r in result),90)
        self.assertEqual(sum(r['message']['usage']['output_tokens'] for r in result),20)
        self.assertEqual(result[0]['message']['model'],'gpt-6.1-sol')

    def test_kimi_legacy_ignores_context_and_mirrored_subagent_events(self):
        status={'timestamp':1790000000,'message':{'type':'StatusUpdate','payload':{'token_usage':{'input_other':10,'input_cache_read':50,'output':5}}}}
        result=kimi([{'role':'_usage','token_count':200},status,{'message':{'type':'SubagentEvent','payload':status}}, {'message':{'type':'StatusUpdate','payload':{'context_tokens':300}}}],'s')
        self.assertEqual(len(result),1)
        self.assertEqual(result[0]['message']['usage']['input_tokens'],10)
        self.assertIsNone(result[0]['message']['model'])
        self.assertTrue(result[0]['timestamp'].endswith('Z'))

    def test_current_kimi_adds_durable_records_only(self):
        event={'type':'usage.record','model':'kimi-k2.6','time':1790000000500,'usageScope':'session','usage':{'inputOther':10,'inputCacheRead':20,'output':5}}
        result=kimi([event,{'type':'agent.status.updated','usage':event['usage']},dict(event,usageScope='turn')],'s')
        self.assertEqual(len(result),2)
        self.assertNotEqual(result[0]['message']['id'],result[1]['message']['id'])
        self.assertEqual(result[0]['message']['usage']['input_tokens'],10)

    def test_projection_is_incremental_and_never_modifies_originals(self):
        with tempfile.TemporaryDirectory() as tmp:
            home=Path(tmp);root=home/'.codex/sessions/2026/10/11';root.mkdir(parents=True)
            log=root/'rollout.jsonl'
            rows=[{'type':'session_meta','payload':{'id':'s','cwd':'/work'}},{'type':'turn_context','payload':{'model':'gpt-6.1-sol'}},{'type':'event_msg','timestamp':'2026-10-11T10:00:00Z','payload':{'type':'token_count','info':{'total_token_usage':{'input_tokens':10,'output_tokens':2}}}}]
            original=''.join(json.dumps(r)+'\n' for r in rows);log.write_text(original)
            claude=home/'.claude/projects/project';claude.mkdir(parents=True);(claude/'c.jsonl').write_text('{}\n')
            with patch.dict(os.environ, {'CODEX_HOME':str(home/'.codex'),'KIMI_CODE_HOME':str(home/'.kimi-code')}):
                cache=usage_store(claude.parent,home,home/'cache')
                target=Path(cache)/'codex--work/s.jsonl';stamp=target.stat().st_mtime_ns
                usage_store(claude.parent,home,home/'cache')
                self.assertEqual(target.stat().st_mtime_ns,stamp)
                self.assertEqual(log.read_text(),original)
                self.assertEqual(read_session('s',home)[0]['message']['usage']['input_tokens'],10)
                self.assertIsNone(read_session('missing',home))
                self.assertTrue((Path(cache)/'project/c.jsonl').exists())

if __name__=='__main__':unittest.main()

class KimiProjectionTest(unittest.TestCase):
    def test_both_kimi_layouts_project_per_agent_usage_without_double_counting(self):
        with tempfile.TemporaryDirectory() as tmp:
            home=Path(tmp)
            legacy=home/'.kimi/sessions/work/legacy';legacy.mkdir(parents=True)
            (legacy/'wire.jsonl').write_text(json.dumps({'timestamp':1790000000,'message':{'type':'StatusUpdate','payload':{'token_usage':{'input_other':10,'input_cache_read':90,'output':5}}}})+'\n')
            current=home/'.kimi-code/sessions/work/current/agents'
            for agent in ('main','child'):
                (current/agent).mkdir(parents=True)
                (current/agent/'wire.jsonl').write_text(json.dumps({'type':'usage.record','model':'kimi-k2.6','time':1790000000000,'usage':{'inputOther':20,'inputCacheRead':30,'output':2}})+'\n')
            with patch.dict(os.environ, {'CODEX_HOME':str(home/'.codex'),'KIMI_CODE_HOME':str(home/'.kimi-code')}):
                self.assertEqual(len(read_session('current',home)),2)
                root=Path(usage_store(home/'.claude/projects',home,home/'cache'))
                self.assertTrue((root/'kimi-work/current.jsonl').exists())
                self.assertTrue((root/'kimi-work/current/subagents/agent-child.jsonl').exists())
                self.assertIsNone(read_session('legacy',home)[0]['message']['model'])

class CodexFamilyTest(unittest.TestCase):
    def test_children_are_counted_only_under_their_root_session(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            directory = home / '.codex/sessions'; directory.mkdir(parents=True)
            for identity, parent in [('root', None), ('child', 'root'), ('grandchild', 'child')]:
                meta = {'id': identity, 'cwd': '/work', 'git': {'branch': 'feature'}}
                if parent:
                    meta['source'] = {'subagent': {'thread_spawn': {'parent_thread_id': parent}}}
                records = [{'type':'session_meta','payload':meta}, {'type':'turn_context','payload':{'model':'gpt-6.1-sol'}}, {'type':'event_msg','payload':{'type':'token_count','info':{'total_token_usage':{'input_tokens':10,'output_tokens':2}}}}]
                path = directory / (identity + '.jsonl')
                path.write_text(''.join(json.dumps(r)+'\n' for r in records))
                os.utime(path, (1700000000, 1700000000))
            with patch.dict(os.environ, {'CODEX_HOME':str(home/'.codex'),'KIMI_CODE_HOME':str(home/'.kimi-code')}):
                records = read_session('root', home)
                self.assertEqual(len(records), 3)
                self.assertEqual(records[0]['gitBranch'], 'feature')
                self.assertIsNone(read_session('child', home))
                cache = Path(usage_store(home/'.claude/projects', home, home/'cache'))
                self.assertFalse((cache/'codex--work/child.jsonl').exists())
                self.assertTrue((cache/'codex--work/root/subagents/agent-grandchild.jsonl').exists())
                self.assertEqual((cache/'codex--work/root.jsonl').stat().st_mtime, 1700000000)

class CodexCompactionTest(unittest.TestCase):
    def test_compaction_adds_only_own_unique_durable_request_beyond_cumulative_counts(self):
        total = {'input_tokens':100,'cached_input_tokens':60,'output_tokens':10}
        snapshot = {'type':'event_msg','payload':{'type':'token_count','info':{'total_token_usage':total}}}
        ordinary = {'type':'token_usage_record','payload':{'thread_id':'s','response_id':'ordinary','usage':total}}
        compact = {'type':'token_usage_record','timestamp':'2026-10-11T10:00:00Z','payload':{'thread_id':'s','response_id':'compact','usage':{'input_tokens':230691,'cached_input_tokens':228864,'output_tokens':5406}}}
        inherited = {'type':'compacted','payload':{'compaction_response_id':'parent-request','latest_token_usage_record':{'thread_id':'parent','response_id':'parent-request','usage':total}}}
        foreign = {'type':'token_usage_record','payload':{'thread_id':'parent','response_id':'parent-request','usage':total}}
        result = codex([{'type':'session_meta','payload':{'id':'s'}},{'type':'turn_context','payload':{'model':'gpt-6.1-sol'}},ordinary,snapshot,compact,{'type':'compacted','payload':{'compaction_response_id':'compact'}},compact,snapshot,inherited,foreign])
        self.assertEqual(len(result),2)
        usages=[r['message']['usage'] for r in result]
        self.assertEqual(sum(u['input_tokens'] for u in usages),40+1827)
        self.assertEqual(sum(u['cache_read_input_tokens'] for u in usages),60+228864)
        self.assertEqual(sum(u['output_tokens'] for u in usages),10+5406)
        self.assertEqual(result[-1]['timestamp'],'2026-10-11T10:00:00Z')
        self.assertEqual(result[-1]['message']['model'],'gpt-6.1-sol')
