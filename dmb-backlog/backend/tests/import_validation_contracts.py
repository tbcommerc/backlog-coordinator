"""Import validation regressions: in-memory doubles only, no database connection."""
import unittest
from unittest.mock import Mock, patch
from types import SimpleNamespace as Obj
from contextlib import nullcontext
import p1_validation_contracts as baseline
service = baseline.service


class ImportValidation(unittest.TestCase):
    def row(self, values):
        raw = {'title': 'Valid', 'team_id': 'Team', **values}
        refs = {'teams': {'team': 7}, 'team_ids': {7}}
        with patch.object(service, '_build_task', side_effect=lambda db, data, links, uid: data) as build:
            result = service.process_row(2, raw, {k:k for k in raw}, {}, refs,
                                         {'title','team_id'}, Mock(), 1)
        return result, build

    def test_finite_decimal_numbers_only(self):
        for value in ('NaN', 'Infinity', '-Infinity', '1e3', '1e309', '9'*400, '1,5'):
            for integer in (True, False):
                with self.subTest(value=value[:20], integer=integer):
                    self.assertEqual(service._parse_number(value, integer), (None, True))
        self.assertEqual(service._parse_number('1.00000000000000000001', True), (None, True))
        for value, expected in [('0',0), ('10000.0',10000), ('12.5',12.5)]:
            self.assertEqual(service._parse_number(value, False), (expected,None))

    def test_ranges_reuse_task_contract(self):
        for field,value in [('effort_days','10001'),('effort_days','-1'),
                            ('financial_effect','-0.1'),('effort_be','-1'),('progress','101')]:
            with self.subTest(field=field):
                (task, errors), build = self.row({field:value})
                self.assertIsNone(task)
                self.assertTrue(any(e['field']==field and e['fatal'] for e in errors))
                build.assert_not_called()
        for field,value in [('effort_days','10000'),('financial_effect','0'),('metric_kr_fact','-1')]:
            (task,errors),_ = self.row({field:value})
            self.assertIsNotNone(task,errors)

    def test_boolean_tokens(self):
        for token in ('true','1','yes','да','Y',' ДА '): self.assertIs(service._parse_bool(token), True)
        for token in ('false','0','no','нет','N',' НЕТ '): self.assertIs(service._parse_bool(token), False)
        (task, errors), build = self.row({'did_demo':'perhaps'})
        self.assertIsNone(task); build.assert_not_called()
        self.assertEqual(errors[0]['type'],'invalid_boolean')
        (task, errors), _ = self.row({'did_demo':'нет'})
        self.assertIs(task['did_demo'], False); self.assertEqual(errors, [])

    def test_involved_teams_must_exist(self):
        for value in ('999','7;999','missing'):
            (task,errors), build = self.row({'involved_teams':value})
            self.assertIsNone(task);build.assert_not_called()
            self.assertEqual(errors[0]['type'],'team_not_found')
        for value in ('7','Team'):
            (task,errors),_ = self.row({'involved_teams':value})
            self.assertEqual(task['involved_teams'],[7]);self.assertEqual(errors,[])

    def test_title_boundary_before_build(self):
        for char in ('A','Я','😀'):
            (task,errors),_ = self.row({'title':char*255})
            self.assertIsNotNone(task,errors)
            (task,errors),build = self.row({'title':char*256})
            self.assertIsNone(task);build.assert_not_called()
            self.assertEqual((errors[0]['row'],errors[0]['field'],errors[0]['type']), (2,'title','invalid_length'))

    def test_internal_errors_never_escape_response(self):
        secret = 'SQL INSERT INTO tasks password=DO_NOT_EXPOSE'
        for stage in ('process','persist','commit'):
            with self.subTest(stage=stage):
                db=Mock();db.begin_nested.side_effect=lambda:nullcontext()
                if stage=='commit': db.commit.side_effect=RuntimeError(secret)
                with patch.object(service,'build_field_map',return_value=({}, {}, set())), \
                     patch.object(service,'load_reference_indexes',return_value={}), \
                     patch.object(service,'process_row',return_value=(Obj(id=1,link_jira=[]),[])) as process, \
                     patch.object(service,'persist_task') as persist:
                    if stage=='process':process.side_effect=RuntimeError(secret)
                    if stage=='persist':persist.side_effect=RuntimeError(secret)
                    result=service.import_tasks_from_csv(db,b'title;team_id\nA;T',Obj(id=1))
                self.assertEqual((result['total'],result['created'],result['skipped']), (1,0,1))
                self.assertNotIn(secret,str(result))
                self.assertEqual(result['errors'][0]['type'],'unknown_error')

if __name__=='__main__':unittest.main(verbosity=2)
