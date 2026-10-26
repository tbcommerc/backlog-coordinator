import unittest
from unittest.mock import Mock, patch
import p1_validation_contracts as baseline
service = baseline.service

class HeaderContracts(unittest.TestCase):
    def test_duplicate_headers_rejected(self):
        for headers in ['title;title;team_id', 'title; TITLE ;team_id']:
            with self.subTest(headers=headers), self.assertRaises(ValueError):
                service.parse_csv(headers + '\nA;B;C', ';')
    def test_alias_duplicates_stop_before_reference_reads(self):
        with patch.object(service, 'build_field_map', return_value=({'title':'title','название задачи':'title'}, {}, set())), patch.object(service, 'load_reference_indexes') as refs:
            with self.assertRaises(ValueError):
                service.import_tasks_from_csv(Mock(), 'title;Название задачи\nA;B'.encode(), Mock())
            refs.assert_not_called()
    def test_malformed_csv_and_nul_rejected(self):
        with self.assertRaises(ValueError): service.parse_csv('title;team_id\n"broken', ';')
        with self.assertRaises(ValueError): service.decode_content(b'title\nA\x00')
    def test_valid_multiline_and_escaped_quotes(self):
        rows = service.parse_csv('title;team_id\n"A ""B""\nC";Team', ';')
        self.assertEqual(rows[0]['title'], 'A "B"\nC')

if __name__ == '__main__': unittest.main()
