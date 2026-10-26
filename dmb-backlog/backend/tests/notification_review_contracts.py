import os,sys,unittest
from pathlib import Path
from types import SimpleNamespace as Obj
from unittest.mock import Mock,patch
os.environ['RUN_STARTUP_SEED']='false'
os.environ['RUN_STARTUP_MAINTENANCE']='false'
os.environ['RUN_NOTIFICATION_SCHEDULER']='false'
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from sqlalchemy.orm import Session
from schemas import NotificationTargetResponse
from notifications import _visible_notifications_query
import importlib
reports = importlib.import_module("routers.reports_router")
from routers.notifications_router import _notification_response
from datetime import datetime,timezone

class NotificationReviewTests(unittest.TestCase):
 def test_quarterly_serialization(self):
  n=Obj(id=1,task_id=None,type='reporting',category='reporting',title='Quarter',body='',importance='high',is_read=False,is_dismissed=False,is_resolved=False,action_url='#/quarterly-goals-update?source=notification',group_key='quarterly_goals_update',group_count=1,created_at=datetime.now(timezone.utc))
  self.assertEqual(_notification_response(n).target.kind,'quarterly_goals_update')
 def test_customer_query_owner_and_category(self):
  # Unbound session compiles SQL only: no database and no users are created.
  with Session() as session:
   user=Obj(id=17,role=Obj(customer_portal_only=True))
   query=_visible_notifications_query(session,17,user)
   sql=str(query.statement.compile(compile_kwargs={'literal_binds':True}))
   self.assertIn('notifications.user_id = 17',sql)
   self.assertIn("notifications.category = 'request'",sql)
   self.assertIn('notifications.task_id IS NULL',sql)
 def test_personal_api_requires_authentication(self):
  from fastapi import FastAPI
  from fastapi.testclient import TestClient
  from database import get_db
  from routers.notifications_router import router
  app=FastAPI();app.include_router(router)
  app.dependency_overrides[get_db]=lambda: Mock()
  client=TestClient(app)
  for path in ['/notifications','/notifications/snapshot','/notifications/summary','/notifications/unread-count','/notifications/preferences']:
   self.assertEqual(client.get(path).status_code,401,path)
 def test_customer_can_read_own_decisions(self):
  from fastapi import FastAPI
  from fastapi.testclient import TestClient
  from auth import get_current_user
  from database import get_db
  router_module=importlib.import_module('routers.notifications_router')
  app=FastAPI();app.include_router(router_module.router)
  user=Obj(id=17,role=Obj(customer_portal_only=True))
  app.dependency_overrides[get_db]=lambda: Mock()
  app.dependency_overrides[get_current_user]=lambda: user
  client=TestClient(app)
  for status in ['returned','rejected','in_progress','approved']:
   item=Obj(id=1,task_id=None,type='request',category='request',title=status,body='',importance='medium',is_read=False,is_dismissed=False,is_resolved=False,action_url='#/customer/request/14',group_key=None,group_count=1,created_at=datetime.now(timezone.utc))
   with patch.object(router_module,'get_notifications',return_value=([item],1)) as read:
    response=client.get('/notifications')
    self.assertEqual(response.status_code,200)
    self.assertEqual(response.json()['items'][0]['target']['request_id'],14)
    self.assertEqual(read.call_args.args[1],17)
    self.assertIs(read.call_args.kwargs['current_user'],user)
 def update(self,confirm=False,version=2,progress=25):
  task=Obj(id=1,version=2,progress=25,progress_updated_at=None,team=None,start_shift=None)
  db=Mock();db.query.return_value.filter.return_value.first.return_value=task
  with patch.object(reports,'_apply_quarterly_goals_scope',side_effect=lambda q,d,t:(q,0)),patch.object(reports,'task_read_scope_clause',return_value=True),patch.object(reports,'check_permission',return_value=True),patch.object(reports,'_quarterly_task_values',return_value={}):
   result=reports.update_quarterly_goal_task(1,reports.QuarterlyGoalTaskUpdate(progress=progress,version=version,confirm_progress=confirm),db,Obj(id=17))
  return task,db,result
 def test_confirm_same_fact_updates_timestamp(self):
  task,db,result=self.update(True)
  self.assertEqual(task.progress,25);self.assertIsNotNone(task.progress_updated_at);self.assertEqual(task.version,3);db.commit.assert_called_once()
 def test_passive_same_fact_does_not_confirm(self):
  task,db,result=self.update(False);self.assertIsNone(task.progress_updated_at)
 def test_conflict_preserved(self):
  with self.assertRaises(reports.HTTPException) as ctx:self.update(True,version=1)
  self.assertEqual(ctx.exception.status_code,409)
 def test_missing_fact_cannot_be_confirmed(self):
  with self.assertRaises(reports.HTTPException) as ctx:self.update(True,progress=None)
  self.assertEqual(ctx.exception.status_code,400)

if __name__=='__main__':unittest.main()
