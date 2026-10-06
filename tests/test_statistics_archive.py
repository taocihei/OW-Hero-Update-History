import json
import unittest
from pathlib import Path


class StatisticsArchiveTest(unittest.TestCase):
    def test_2025_telemetry_does_not_invent_match_dates(self):
        path = Path(__file__).resolve().parents[1] / 'src' / 'esports2025Snapshot.json'
        rows = json.loads(path.read_text(encoding='utf-8'))['playerPerformance']
        self.assertGreater(len(rows), 0)
        for row in rows:
            self.assertEqual(row['season'], 2025)
            self.assertIs(row['dateKnown'], False)
            self.assertEqual(row['datetime'], '')


if __name__ == '__main__':
    unittest.main()
