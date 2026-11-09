"""Import authorization dispatch with synthetic tasks/session; no DB or protected fixtures."""
import unittest
from types import SimpleNamespace as N
from contextlib import nullcontext
from unittest.mock import Mock,patch
import import_service as service
class ImportPolicy(unittest.TestCase):
 def test_each_validated_row_uses_object_policy_before_persistence(self):
  for scope in ['team','all','none','unknown']:
   for team in [7,8]:
    with self.subTest(scope=scope,team=team):
     user=N(id=101,team_id=7,role_name='Администратор',role=N(task_edit_scope=scope));task=N(id=123,team_id=team)
     db=N(begin_nested=lambda:nullcontext(),commit=Mock(),rollback=Mock())
     with patch.object(service,'build_field_map',return_value=({}, {'team_id':'Команда'}, set())),patch.object(service,'validate_import_headers'),patch.object(service,'load_reference_indexes',return_value={}),patch.object(service,'process_row',return_value=(task,[])),patch.object(service,'_jira_of',return_value=[]),patch.object(service,'persist_task') as persist:
      result=service.import_tasks_from_csv(db,b'title\nSynthetic',user)
      allowed=scope=='all' or scope=='team' and team==7
      self.assertEqual(result['created'],int(allowed));self.assertEqual(persist.call_count,int(allowed));self.assertEqual(result['skipped'],int(not allowed))
      if not allowed:self.assertEqual(result['errors'][0]['type'],'permission_denied')
if __name__=='__main__':unittest.main(verbosity=2)
