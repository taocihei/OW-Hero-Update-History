import json
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

from tools.collect_owtv_database import Store, index_rows


def flight_html(payload):
    return '<script>self.__next_f.push(' + json.dumps([1, '0:' + json.dumps(payload) + '\n']) + ')</script>'


def fixture(mid=873, prefix='wei-vs-tcc'):
    maps = [dict(id=1294 + i, slug=f'{prefix}-map-{i}', mapIndex=i,
                 team1Score=2, team2Score=1, map={'id': i, 'name': f'Map {i}', 'mode': 'control', 'gameId': str(i)})
            for i in range(1, 5)]
    stat = dict(id=9001, matchMap=1295, person={'id': 77, 'alias': 'Player', 'job': 'PLAYER'},
                team={'id': 161, 'name': 'Weibo Gaming', 'initials': 'WEI', 'primaryColour': 'red'},
                damageDealt=None, healingDone=None, eliminations=3, matchStartDate='2025-10-05T09:00:00Z')
    return dict(id=mid, team1=161, team2=162, maps={'docs': maps}, playerStats={'docs': [stat]})


class IngestionTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.directory.name) / 'owtv.sqlite3')
        self.store.upsert_match(dict(id=873, slug='wei-vs-tcc', startDate='2025-10-05T09:00:00Z',
                                     team1=161, team2=162, complete=True, team1Score=3, team2Score=1))

    def tearDown(self):
        self.store.close()
        self.directory.cleanup()

    def test_keeps_score_only_maps_and_null_metrics(self):
        result = self.store.ingest_detail(873, flight_html({'match': fixture()}))
        self.assertEqual(result['maps'], 4)
        self.assertEqual(result['stats'], 1)
        self.assertEqual(self.store.db.execute('SELECT damage_dealt FROM player_map_stats').fetchone(), (None,))

    def test_flight_payload_split_across_script_chunks_keeps_all_maps(self):
        payload = '0:' + json.dumps({'match': fixture()}) + '\n'
        split = len(payload) // 2
        html = ''.join('<script>self.__next_f.push(' + json.dumps([1, chunk]) + ')</script>'
                       for chunk in [payload[:split], payload[split:]])
        result = self.store.ingest_detail(873, html)
        self.assertEqual(result['maps'], 4)
        self.assertEqual(result['stats'], 1)

    def test_ignores_sidebar_matches_even_with_same_teams_and_date(self):
        other = fixture(874, 'wei-vs-tcc-rematch')
        for row in other['maps']['docs']:
            row['id'] += 100
        other['playerStats']['docs'][0].update(id=9901, matchMap=1395)
        result = self.store.ingest_detail(873, flight_html({'match': fixture(), 'sidebar': other}))
        self.assertEqual(result['maps'], 4)
        self.assertEqual(result['stats'], 1)
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM match_maps WHERE id>=1395').fetchone()[0], 0)

    def test_target_match_maps_can_have_legacy_slugs(self):
        target = fixture()
        for row in target['maps']['docs']:
            row['slug'] = 'legacy-' + str(row['id'])
        result = self.store.ingest_detail(873, flight_html({'match': target}))
        self.assertEqual(result['maps'], 4)

    def test_existing_map_owner_is_not_overwritten(self):
        self.store.db.execute("INSERT INTO match_maps(id,match_id,raw_json) VALUES(1295,874,'{}')")
        with self.assertRaisesRegex(ValueError, 'belongs to match'):
            self.store.ingest_detail(873, flight_html({'match': fixture()}))
        self.assertEqual(self.store.db.execute('SELECT match_id FROM match_maps WHERE id=1295').fetchone()[0], 874)

    def test_explicit_match_identity_survives_rescheduling(self):
        target = fixture()
        target['playerStats']['docs'][0]['matchStartDate'] = '2025-10-08T09:00:00Z'
        result = self.store.ingest_detail(873, flight_html({'match': target}))
        self.assertEqual(result['maps'], 4)
        self.assertEqual(result['stats'], 1)

    def test_match_slug_is_trimmed_before_building_source_url(self):
        self.store.upsert_match(dict(id=14, slug='  final-match ', complete=True))
        self.assertEqual(self.store.db.execute('SELECT slug,source_url FROM matches WHERE id=14').fetchone(),
                         ('final-match', 'https://owtv.gg/matches/final-match'))

    def test_error_page_does_not_mark_match_as_fetched(self):
        with self.assertRaisesRegex(ValueError, 'no verified match payload'):
            self.store.ingest_detail(873, '<html>Temporarily unavailable</html>')
        self.assertIsNone(self.store.db.execute('SELECT detail_fetched_at FROM matches WHERE id=873').fetchone()[0])

    def test_current_owtv_metric_field_names(self):
        payload = fixture()
        payload['playerStats']['docs'][0].update(cachedFantasyScore=12.5, faceitObjectiveTime=7,
                                               faceitSoloKills=0, faceitEnvironmentalKills=2,
                                               faceitMultiKills=3, faceitFinalBlows=4)
        self.store.ingest_detail(873, flight_html({'match': payload}))
        self.assertEqual(self.store.db.execute('SELECT fantasy_score,objective_time,solo_kills,environmental_kills,multi_kills,final_blows FROM player_map_stats').fetchone(),
                         (12.5, 7, 0, 2, 3, 4))

    def test_index_paginates_and_normalizes_string_ids(self):
        replies = [{'rows': [{'id': '64', 'slug': 'event-a'}], 'total': 2},
                   {'rows': [{'id': 65, 'slug': 'event-b'}], 'total': 2}]
        with patch('tools.collect_owtv_database.action', side_effect=replies) as call:
            rows = index_rows('action-id', 'https://owtv.gg/tournaments', 'primary')
        self.assertEqual([r['id'] for r in rows], [64, 65])
        self.assertEqual(call.call_args_list[1].args[1], [2, 100, None, 'primary'])

    def test_index_repeated_page_is_not_reported_as_complete(self):
        with patch('tools.collect_owtv_database.action', return_value={'rows': [{'id': 64}], 'total': 2}):
            with self.assertRaisesRegex(ValueError, 'incomplete OWTV index'):
                index_rows('action-id', 'https://owtv.gg/matches')


if __name__ == '__main__':
    unittest.main()
