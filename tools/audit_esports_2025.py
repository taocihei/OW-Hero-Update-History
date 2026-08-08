"""Fail-fast checks for the bundled 2025 professional-match archive.

The 2025 workbooks are a community map-composition log, not official hero
play-time telemetry.  These checks protect that distinction and catch the team
side inference bug that previously assigned lower-side players to other teams.
"""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / "src" / "esports2025Snapshot.json"
REPORT = ROOT / "data" / "owcs-2025" / "audit-report.json"


def count(rows: list[dict], **wanted: str) -> int:
    return sum(
        int(row.get("usage_count", 0))
        for row in rows
        if all(row.get(key) == value for key, value in wanted.items())
    )


def main() -> None:
    payload = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    failures: list[str] = []

    def check(condition: bool, message: str) -> None:
        if not condition:
            failures.append(message)

    check(payload.get("usageUnit") == "post_match_settlement_hero", "2025 usage unit must be post-match settlement hero")
    check(payload.get("usageOfficial") is False, "community workbook usage must not be marked official")
    check(payload.get("performanceOfficial") is False, "API-derived community export must not be marked official")
    check(not any(row.get("team_name") == "Unknown" for row in payload["playerHeroUsage"]), "Unknown player teams remain")
    check(not any(row.get("team_name") == "Unknown" for row in payload["teamHeroUsage"]), "Unknown team aggregates remain")
    check(not any(float(row.get("pick_rate", 0)) for row in payload["teamHeroUsage"]), "unsupported 2025 pick rates remain")
    check(not any(row.get("damage_verified") for row in payload["playerHeroUsage"]), "2025 rows must not claim per-hero damage verification")
    check(not any(row.get("metric") != "post_match_settlement_hero" for row in payload["playerHeroUsage"]), "2025 rows must use settlement-hero evidence")
    check(
        not any(row.get("team_name") not in {row.get("team_top"), row.get("team_bottom")} for row in payload["matchHeroUsage"]),
        "match hero usage contains a team outside its fixture",
    )
    check(
        not any(int(row.get("usage_count", 0)) < len(set(row.get("evidence_maps") or [])) for row in payload["matchHeroUsage"]),
        "match hero usage is smaller than its map evidence",
    )

    team_counts: dict[tuple[str, str], int] = {
        (row["team_name"], row["hero_name"]): int(row["usage_count"])
        for row in payload["teamHeroUsage"]
    }
    for row in payload["playerHeroUsage"]:
        player_count = int(row["usage_count"])
        team_count = team_counts.get((row["team_name"], row["hero_name"]), 0)
        check(player_count <= team_count, f"player count exceeds team count: {row}")

    match_team_counts: dict[tuple[str, str], int] = defaultdict(int)
    for row in payload["matchHeroUsage"]:
        match_team_counts[(row["team_name"], row["hero_name"])] += int(row["usage_count"])
    aggregate_mismatches = [
        (team, hero, total, match_team_counts.get((team, hero), 0))
        for (team, hero), total in team_counts.items()
        if total != match_team_counts.get((team, hero), 0)
    ]
    check(not aggregate_mismatches, f"team totals differ from match evidence: {aggregate_mismatches[:5]}")

    symmetra_players = {
        "Quartz": count(payload["playerHeroUsage"], player_name="Quartz", hero_name="Symmetra"),
        "Youbi": count(payload["playerHeroUsage"], player_name="Youbi", hero_name="Symmetra"),
        "Leave": count(payload["playerHeroUsage"], player_name="Leave", hero_name="Symmetra"),
    }
    symmetra_teams = {
        "Twisted Minds": count(payload["teamHeroUsage"], team_name="Twisted Minds", hero_name="Symmetra"),
        "Weibo Gaming": count(payload["teamHeroUsage"], team_name="Weibo Gaming", hero_name="Symmetra"),
        "Once Again": count(payload["teamHeroUsage"], team_name="Once Again", hero_name="Symmetra"),
    }
    check(symmetra_players == {"Quartz": 41, "Youbi": 25, "Leave": 34}, f"Symmetra player anchors changed: {symmetra_players}")
    check(symmetra_teams == {"Twisted Minds": 76, "Weibo Gaming": 51, "Once Again": 0}, f"Symmetra team anchors changed: {symmetra_teams}")
    check(symmetra_players["Quartz"] > symmetra_players["Leave"], "Quartz must rank above Leave in the audited 2025 map log")
    check(symmetra_teams["Twisted Minds"] > symmetra_teams["Weibo Gaming"], "Twisted Minds must rank above Weibo Gaming")
    check(symmetra_teams["Once Again"] == 0, "Once Again must not contain an unverified Symmetra composition")

    event_counts: dict[str, int] = defaultdict(int)
    for row in payload["tournamentHeroUsage"]:
        event_counts[row["tournament_sheet"]] += int(row["usage_count"])

    report = {
        "auditedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "snapshot": str(SNAPSHOT),
        "status": "failed" if failures else "passed",
        "failures": failures,
        "sourceClassification": {
            "heroUsage": "post-match settlement hero per player/map; no exact play time",
            "performance": "community export derived from FACEIT API; Stage 1 NA/EMEA only",
            "owl2018To2023": "separate Blizzard Stats Lab archive",
        },
        "counts": {
            "series": payload["matchCount"],
            "teams": payload["teamCount"],
            "players": payload["playerCount"],
            "playerPerformanceRows": len(payload["playerPerformance"]),
            "playerHeroRows": len(payload["playerHeroUsage"]),
            "teamHeroRows": len(payload["teamHeroUsage"]),
            "matchHeroRows": len(payload["matchHeroUsage"]),
        },
        "symmetraPlayers": symmetra_players,
        "symmetraTeams": symmetra_teams,
        "checks": {
            "nonParticipantMatchRows": sum(row.get("team_name") not in {row.get("team_top"), row.get("team_bottom")} for row in payload["matchHeroUsage"]),
            "aggregateMismatches": len(aggregate_mismatches),
        },
        "eventAggregateCounts": dict(sorted(event_counts.items())),
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
