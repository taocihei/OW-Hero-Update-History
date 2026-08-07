"""Cross-source, fail-fast QA for the bundled professional-match archive."""

from __future__ import annotations

import json
import re
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
REPORT = ROOT / "data" / "esports-audit-report.json"
PSEUDO_SHEETS = {"Partner Team Index", "Non-Partner Team Index"}


def identity(value: str) -> str:
    plain = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]", "", plain.lower())


def load(name: str):
    return json.loads((SRC / name).read_text(encoding="utf-8"))


def duplicate_count(rows: list[dict], fields: tuple[str, ...]) -> int:
    keys = [tuple(identity(str(row.get(field, ""))) for field in fields) for row in rows]
    return len(keys) - len(set(keys))


def case_variant_count(rows: list[dict], field: str) -> int:
    values: dict[str, set[str]] = defaultdict(set)
    for row in rows:
        value = str(row.get(field, "")).strip()
        if value:
            values[identity(value)].add(value)
    return sum(len(group) > 1 for group in values.values())


def main() -> None:
    current = load("esportsAnalyticsSnapshot.json")
    history = load("esportsHistorySnapshot.json")
    y2025 = load("esports2025Snapshot.json")
    supplement = load("esportsSupplementSnapshot.json")
    official_schedule = load("esportsSnapshot.json")
    failures: list[str] = []

    def check(condition: bool, message: str) -> None:
        if not condition:
            failures.append(message)

    current_matches = {row["match_id"]: row for row in current["rawMatches"]}
    current_usage = current["mapSetHeroUsage"]
    check(not any(row["tournament_sheet"] in PSEUDO_SHEETS for row in current_usage), "pseudo index sheets remain in current usage")
    check(not any(row["tournament_sheet"] in PSEUDO_SHEETS for row in current["matchHeroUsage"]), "pseudo index sheets remain in current matches")
    check(not any(row["team_top"] == row["team_bottom"] for row in current["rawMatches"]), "same-team current fixtures remain")
    check(not any(row["match_id"] not in current_matches for row in current_usage), "current usage contains orphan matches")
    check(not any(row["team_name"] not in {current_matches[row["match_id"]]["team_top"], current_matches[row["match_id"]]["team_bottom"]} for row in current_usage), "current usage assigned to a non-participant")
    check(duplicate_count(current_usage, ("tournament_sheet", "match_id", "map_set_index", "team_name", "player_name", "hero_name")) == 0, "duplicate current player/map/hero rows")
    check(case_variant_count(current["playerHeroUsage"], "player_name") == 0, "current player casing variants remain")

    check(duplicate_count(history["playerPerformance"], ("matchId", "player", "team1")) == 0, "duplicate OWL player-match rows")
    check(case_variant_count(history["playerHeroUsage"], "player_name") == 0, "OWL player casing variants remain")
    check(not any(not row.get("team2") for row in history["playerPerformance"]), "OWL performance row missing opponent")
    check(not any(not row.get("damage_verified") for row in history["playerHeroUsage"]), "OWL verified usage lost its flag")
    check(not any(row.get("metric") != "damage_positive_fallback" for row in history["playerHeroUsage"]), "OWL fallback metric is not explicit")

    check(case_variant_count(y2025["playerHeroUsage"], "player_name") == 0, "2025 player casing variants remain")
    check(not any(row.get("team_name") == "Unknown" for row in y2025["playerHeroUsage"]), "2025 unknown player team remains")
    check(not any(row.get("damage_verified") for row in y2025["playerHeroUsage"]), "2025 community rows incorrectly marked damage-verified")
    check(not any(row.get("metric") != "post_match_settlement_hero" for row in y2025["playerHeroUsage"]), "2025 settlement metric is not explicit")
    check(duplicate_count(y2025["matchHeroUsage"], ("tournament_sheet", "match_id", "team_name", "hero_name")) == 0, "duplicate 2025 match/team/hero rows")

    supplement_ids = [row["id"] for row in supplement["matches"]]
    official_ids = [row["id"] for row in official_schedule]
    check(len(supplement_ids) == len(set(supplement_ids)), "duplicate OWTV match ids")
    check(len(official_ids) == len(set(official_ids)), "duplicate official schedule ids")

    # Stable cross-source anchors catch accidental identity/team merging without
    # asserting that two independent competition eras are directly comparable.
    current_players = {(row["player_name"], row["team_name"]) for row in current["playerHeroUsage"]}
    check(("Guxue", "Weibo Gaming") in current_players, "Guxue current team anchor missing")
    check(("Quartz", "Twisted Minds") in current_players, "Quartz current team anchor missing")
    teams_2025 = {row["team_name"] for row in y2025["teamHeroUsage"]}
    check({"Weibo Gaming", "Once Again"}.issubset(teams_2025), "Once Again and Weibo Gaming are not preserved as separate teams")

    report = {
        "auditedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "status": "failed" if failures else "passed",
        "failures": failures,
        "sources": {
            "currentOwcs": current.get("source"),
            "owlHistory": history.get("source"),
            "owcs2025": y2025.get("source"),
            "schedule": supplement.get("source"),
        },
        "counts": {
            "current": {
                "tournaments": len({row["tournament_sheet"] for row in current_usage}),
                "matches": len({row["match_id"] for row in current_usage}),
                "mapSets": len({(row["match_id"], row["map_set_index"]) for row in current_usage}),
                "usageRows": len(current_usage),
                "teams": len({row["team_name"] for row in current_usage}),
                "players": len({identity(row["player_name"]) for row in current_usage}),
            },
            "owl2018To2023": {
                "matches": history["matchCount"],
                "playerMatchRows": len(history["playerPerformance"]),
                "teams": history["teamCount"],
                "players": history["playerCount"],
            },
            "owcs2025": {
                "series": y2025["matchCount"],
                "usageRows": len(y2025["playerHeroUsage"]),
                "teams": y2025["teamCount"],
                "players": y2025["playerCount"],
            },
            "schedule": {
                "officialRows": len(official_schedule),
                "owtvRows": len(supplement["matches"]),
                "tournaments": len(supplement["tournaments"]),
            },
        },
        "checks": {
            "currentDuplicateGrain": duplicate_count(current_usage, ("tournament_sheet", "match_id", "map_set_index", "team_name", "player_name", "hero_name")),
            "currentPlayerCaseVariants": case_variant_count(current["playerHeroUsage"], "player_name"),
            "historyPlayerCaseVariants": case_variant_count(history["playerHeroUsage"], "player_name"),
            "owcs2025PlayerCaseVariants": case_variant_count(y2025["playerHeroUsage"], "player_name"),
            "orphanCurrentUsage": sum(row["match_id"] not in current_matches for row in current_usage),
            "nonParticipantCurrentUsage": sum(row["team_name"] not in {current_matches[row["match_id"]]["team_top"], current_matches[row["match_id"]]["team_bottom"]} for row in current_usage),
        },
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
