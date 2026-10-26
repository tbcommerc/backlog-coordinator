import unittest
from unittest.mock import Mock, patch
import p1_validation_contracts as baseline
s = baseline.service
class Customers(unittest.TestCase):
    def run_row(self, values, required=()):
        raw={'title':'Task','team_id':'Team',**values}
        refs={'teams':{'team':7},'business_customers':{},'contacts_by_name':{'same':[(10,1),(11,2)]},'departments':{'dept':2},'did_client_groups':{'known':3}}
        with patch.object(s,'_build_task',side_effect=lambda db,data,links,uid:data):
            return s.process_row(2,raw,{k:k for k in raw},{},refs,{'title','team_id',*required},Mock(),1)
    def test_unknown_optional_customer_and_client_warn(self):
        for field in ['business_customer_id','did_client_group_id']:
            task,errors=self.run_row({field:'missing'})
            self.assertIsNone(task[field]);self.assertFalse(errors[0]['fatal'])
    def test_unknown_required_customer_rejects(self):
        task,errors=self.run_row({'business_customer_id':'missing'},['business_customer_id'])
        self.assertIsNone(task);self.assertTrue(any(e['type']=='required_missing' for e in errors))
    def test_ambiguous_contact_and_department_resolution(self):
        task,errors=self.run_row({'business_customer_id':'same'})
        self.assertIsNone(task['business_customer_id']);self.assertFalse(errors[0]['fatal'])
        task,errors=self.run_row({'business_customer_id':'same','department_id':'dept','did_client_group_id':'known'})
        self.assertEqual(task['business_customer_id'],11);self.assertEqual(task['did_client_group_id'],3);self.assertEqual(errors,[])
    def test_delimiter_ignores_quoted_punctuation(self):
        self.assertEqual(s.detect_delimiter('"title,with,commas";team_id\nA;B'),';')
if __name__=='__main__':unittest.main()
