"""Synthetic policy acceptance: no database, fixtures, seed or protected writes."""
from types import SimpleNamespace as N
import unittest
from auth import can_access_task, authorize_task, get_task_action_scope
class Policy(unittest.TestCase):
 def user(self,edit='team',comment='all',delete='none',team=7,portal=False):
  role=N(customer_portal_only=portal,task_edit_scope=edit,task_comment_scope=comment,task_delete_scope=delete,**{k+'_access':'read' if k=='backlog_dmb' else 'none' for k in ['backlog_dmb','backlog_team','reports','analytics','customer','settings','admin']})
  return N(team_id=team,role=role,role_name='Администратор')
 def test_team_actions_independent_and_transfer_denied(self):
  u=self.user()
  for team in [7,8,None]:
   t=N(team_id=team,metric_id=None)
   self.assertTrue(can_access_task('read',t,u));self.assertEqual(can_access_task('edit',t,u),team==7);self.assertTrue(can_access_task('comment',t,u));self.assertFalse(can_access_task('delete',t,u))
  self.assertFalse(can_access_task('edit',N(team_id=7),u,target_team_id=8))
  with self.assertRaises(Exception) as e:authorize_task('edit',N(team_id=8),u)
  self.assertEqual(e.exception.status_code,403)
 def test_explicit_none_unknown_and_missing_legacy(self):
  for value in ['none','unknown','']:
   u=self.user(edit=value);self.assertFalse(can_access_task('edit',N(team_id=7),u))
  self.assertEqual(get_task_action_scope(self.user(edit=None),'edit'),'all')
 def test_global_and_customer_and_metric(self):
  for team in [7,8,None]:self.assertTrue(can_access_task('edit',N(team_id=team),self.user(edit='all')))
  for action in ['read','edit','comment','delete']:self.assertFalse(can_access_task(action,N(team_id=7),self.user(portal=True)))
  for action in ['edit','comment','delete']:self.assertFalse(can_access_task(action,N(team_id=7,metric_id=1),self.user(edit='all',delete='all')))
if __name__=='__main__':unittest.main(verbosity=2)
