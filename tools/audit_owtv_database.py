from __future__ import annotations

import argparse
import json
import re
import sqlite3
import unicodedata
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def identity(value: str) -> str:
    plain = unicodedata.normalize("NFKD", value).lower()
    return "".join(char for char in plain if char.isalnum())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("database", type=Path, nargs="?", default=ROOT / "data" / "owtv" / "owtv.sqlite3")
    parser.add_argument("--catalog", type=Path, default=ROOT / "src" / "owtvTeamCatalog.json")
    args = parser.parse_args()
    db = sqlite3.connect(args.database)
    db.row_factory = sqlite3.Row
    checks: dict[str, object] = {}
    checks["integrity"] = db.execute("PRAGMA integrity_check").fetchone()[0]
    tables = ("regions", "tournaments", "teams", "matches", "players", "map_catalog", "match_maps", "player_map_stats", "media_assets")
    checks["counts"] = {table: db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] for table in tables}
    checks["completedMatches"] = db.execute("SELECT COUNT(*) FROM matches WHERE complete=1").fetchone()[0]
    checks["detailedMatches"] = db.execute("SELECT COUNT(*) FROM matches WHERE detail_fetched_at IS NOT NULL").fetchone()[0]
    checks["matchesWithMapStats"] = db.execute("SELECT COUNT(DISTINCT match_id) FROM player_map_stats").fetchone()[0]
    checks["teamLogos"] = db.execute("SELECT COUNT(*) FROM teams WHERE image_url<>''").fetchone()[0]
    checks["cachedTeamLogos"] = db.execute("SELECT COUNT(*) FROM teams WHERE local_image_path<>''").fetchone()[0]
    checks["embeddedMedia"] = db.execute("SELECT COUNT(*) FROM media_assets WHERE content IS NOT NULL AND length(content)=bytes").fetchone()[0]
    checks["embeddedMediaBytes"] = db.execute("SELECT COALESCE(SUM(length(content)),0) FROM media_assets").fetchone()[0]
    checks["orphanStats"] = db.execute("SELECT COUNT(*) FROM player_map_stats s LEFT JOIN matches m ON m.id=s.match_id LEFT JOIN players p ON p.id=s.player_id WHERE m.id IS NULL OR p.id IS NULL").fetchone()[0]
    checks["orphanMatchMaps"] = db.execute("SELECT COUNT(*) FROM match_maps mm LEFT JOIN matches m ON m.id=mm.match_id WHERE m.id IS NULL").fetchone()[0]
    checks["orphanStatMaps"] = db.execute("SELECT COUNT(*) FROM player_map_stats s LEFT JOIN match_maps mm ON mm.id=s.match_map_id WHERE mm.id IS NULL OR mm.match_id<>s.match_id").fetchone()[0]
    checks["nonParticipantStats"] = db.execute("SELECT COUNT(*) FROM player_map_stats s JOIN matches m ON m.id=s.match_id WHERE s.team_id IS NOT NULL AND s.team_id NOT IN (m.team1_id,m.team2_id)").fetchone()[0]
    checks["invalidMatchLinks"] = db.execute("SELECT COUNT(*) FROM matches WHERE source_url NOT LIKE 'https://owtv.gg/matches/%'").fetchone()[0]
    checks["completedMissingScore"] = db.execute("SELECT COUNT(*) FROM matches WHERE complete=1 AND (team1_score IS NULL OR team2_score IS NULL)").fetchone()[0]
    checks["missingMediaFiles"] = sum(1 for row in db.execute("SELECT local_path FROM media_assets") if not Path(row[0]).exists())
    checks["knownTeams"] = [dict(row) for row in db.execute("SELECT id,name,initials,region,local_image_path FROM teams WHERE lower(name) LIKE '%twisted minds%' OR lower(name) LIKE '%weibo%' OR lower(name) LIKE '%once again%' OR lower(name) LIKE '%crazy raccoon%' ORDER BY name")]
    checks["latestRun"] = dict(db.execute("SELECT started_at,finished_at,status,counts_json,error FROM sync_runs ORDER BY id DESC LIMIT 1").fetchone())
    known_match = db.execute("SELECT id,slug,team1_score,team2_score,source_url FROM matches WHERE id=869").fetchone()
    checks["weiboYnbPlayoff"] = dict(known_match) if known_match else None
    catalog = json.loads(args.catalog.read_text(encoding="utf-8"))
    aliases = [identity(str(row.get("alias") or row.get("name") or "")) for row in catalog["players"]]
    checks["catalog"] = {
        "players": len(catalog["players"]),
        "rawPlayers": catalog["counts"].get("raw_players", catalog["counts"]["players"]),
        "duplicateAliases": len(aliases) - len(set(aliases)),
    }
    print(json.dumps(checks, ensure_ascii=False, indent=2))
    assert checks["integrity"] == "ok"
    assert checks["counts"]["matches"] >= 1000
    assert checks["counts"]["teams"] >= 150
    assert checks["counts"]["players"] >= 500
    assert checks["orphanStats"] == 0
    assert checks["orphanMatchMaps"] == 0
    assert checks["orphanStatMaps"] == 0
    assert checks["nonParticipantStats"] == 0
    assert checks["invalidMatchLinks"] == 0
    assert checks["missingMediaFiles"] == 0
    assert checks["embeddedMedia"] == checks["counts"]["media_assets"]
    assert checks["catalog"]["duplicateAliases"] == 0
    assert checks["weiboYnbPlayoff"] == {
        "id": 869,
        "slug": "owcs-2025-china-stage-3-playoffs-wei-vs-ynb",
        "team1_score": 3,
        "team2_score": 0,
        "source_url": "https://owtv.gg/matches/owcs-2025-china-stage-3-playoffs-wei-vs-ynb",
    }


if __name__ == "__main__":
    main()
