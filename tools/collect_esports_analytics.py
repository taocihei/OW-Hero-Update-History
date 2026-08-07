from __future__ import annotations

import csv
import io
import json
import re
import time
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

import requests


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "src" / "esportsAnalyticsSnapshot.json"
REPORT = ROOT / "data" / "esports-current-audit.json"
BASE = "https://napori0929.github.io/owcs-stats/data/"
FILES = {
    "overallHeroUsageSource": "overall_hero_usage.csv",
    "teamHeroUsageSource": "hero_usage_by_team.csv",
    "playerHeroUsageSource": "hero_usage_by_player.csv",
    "playerHeroWinRates": "player_hero_win_rate.csv",
    "teamHeroWinRates": "team_hero_win_rate.csv",
    "mapSetHeroUsage": "hero_usage_by_map_set.csv",
    "rawMatches": "raw_matches.csv",
    "rawMapSetResults": "raw_map_set_results.csv",
}
PSEUDO_SHEETS = {"Partner Team Index", "Non-Partner Team Index"}


def fetch_csv(filename: str) -> tuple[bytes, list[dict[str, str]]]:
    error: Exception | None = None
    for attempt in range(5):
        try:
            response = requests.get(BASE + filename, timeout=90, headers={"User-Agent": "OWHeroUpdateHistory/0.10.16"})
            response.raise_for_status()
            content = response.content
            return content, list(csv.DictReader(io.StringIO(content.decode("utf-8-sig"))))
        except Exception as exc:
            error = exc
            time.sleep(attempt + 1)
    raise RuntimeError(f"failed to fetch {filename}: {error}")


def identity(value: str) -> str:
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]", "", ascii_value.lower())


def casing_rank(value: str) -> tuple[int, int, str]:
    letters = "".join(char for char in value if char.isalpha())
    if not letters:
        kind = 0
    elif letters.islower():
        kind = 1
    elif letters.isupper():
        kind = 2
    else:
        kind = 3
    return kind, len(value), value


def canonical_names(rows: Iterable[dict[str, str]], field: str) -> dict[str, str]:
    candidates: dict[str, set[str]] = defaultdict(set)
    for row in rows:
        value = row.get(field, "").strip()
        if value:
            candidates[identity(value)].add(value)
    return {key: max(values, key=casing_rank) for key, values in candidates.items()}


def make_usage_rows(counter: dict[tuple[str, ...], set[str]], fields: tuple[str, ...], roles: dict[str, str]) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for key, samples in counter.items():
        row: dict[str, object] = dict(zip(fields, key))
        hero = str(row.get("hero_name", ""))
        if "role" in fields:
            row["role"] = roles.get(hero, "")
        count = len(samples)
        row.update({
            "usage_count": str(count),
            "pick_count": str(count),
            "pick_rate": "0",
            "damage_verified": False,
            "metric": "post_match_settlement_hero",
        })
        rows.append(row)
    return rows


def main() -> None:
    downloaded: dict[str, list[dict[str, str]]] = {}
    source_version = ""
    for key, filename in FILES.items():
        content, rows = fetch_csv(filename)
        if key == "mapSetHeroUsage":
            version = 14695981039346656037
            for byte in content:
                version = ((version ^ byte) * 1099511628211) & 0xFFFFFFFFFFFFFFFF
            source_version = f"{version:016x}"
        downloaded[key] = rows
        print(f"{key}: {len(rows)}")

    raw_usage = downloaded["mapSetHeroUsage"]
    pseudo_rows = [row for row in raw_usage if row.get("tournament_sheet") in PSEUDO_SHEETS]
    usage = [row for row in raw_usage if row.get("tournament_sheet") not in PSEUDO_SHEETS]
    raw_matches = [row for row in downloaded["rawMatches"] if row.get("tournament_sheet") not in PSEUDO_SHEETS]
    raw_results = [row for row in downloaded["rawMapSetResults"] if row.get("tournament_sheet") not in PSEUDO_SHEETS]

    players = canonical_names(usage, "player_name")
    for row in usage:
        row["player_name"] = players[identity(row["player_name"])]
        row["team_name"] = row["team_name"].strip()

    # Roles are reference metadata only. Counts always come from the granular,
    # match/map/team/player rows below, never from the source's pre-aggregates.
    roles: dict[str, str] = {}
    for row in downloaded["teamHeroUsageSource"]:
        if row.get("hero_name") and row.get("role"):
            roles[row["hero_name"]] = row["role"]

    matches_by_id = {row["match_id"]: row for row in raw_matches}
    overall: dict[tuple[str, str], set[str]] = defaultdict(set)
    teams: dict[tuple[str, str, str], set[str]] = defaultdict(set)
    players_usage: dict[tuple[str, str, str], set[str]] = defaultdict(set)
    tournaments: dict[tuple[str, str, str], set[str]] = defaultdict(set)
    maps: dict[tuple[str, str, str], set[str]] = defaultdict(set)
    tournament_teams: dict[tuple[str, str, str, str], set[str]] = defaultdict(set)
    tournament_players: dict[tuple[str, str, str, str], set[str]] = defaultdict(set)
    match_hero: dict[tuple[str, str, str], set[str]] = defaultdict(set)

    duplicate_keys: list[str] = []
    seen_grain: set[str] = set()
    orphan_usage: list[str] = []
    wrong_team: list[str] = []
    for row in usage:
        tournament = row["tournament_sheet"]
        match_id = row["match_id"]
        map_index = row["map_set_index"]
        map_name = row["map_name"]
        team = row["team_name"]
        player = row["player_name"]
        hero = row["hero_name"]
        grain = "\0".join((tournament, match_id, map_index, team, identity(player), hero))
        if grain in seen_grain:
            duplicate_keys.append(grain)
            continue
        seen_grain.add(grain)
        match = matches_by_id.get(match_id)
        if not match:
            orphan_usage.append(grain)
        elif team not in {match.get("team_top"), match.get("team_bottom")}:
            wrong_team.append(grain)
        sample = f"{match_id}:{map_index}"
        team_sample = f"{sample}:{team}"
        player_sample = f"{sample}:{identity(player)}"
        overall[(hero, roles.get(hero, ""))].add(team_sample)
        teams[(team, hero, roles.get(hero, ""))].add(sample)
        players_usage[(player, team, hero)].add(sample)
        tournaments[(tournament, hero, roles.get(hero, ""))].add(team_sample)
        maps[(map_name, hero, roles.get(hero, ""))].add(team_sample)
        tournament_teams[(tournament, team, hero, roles.get(hero, ""))].add(sample)
        tournament_players[(tournament, player, team, hero)].add(sample)
        match_hero[(tournament, match_id, team, hero)].add(sample)

    match_rows: list[dict[str, object]] = []
    for (tournament, match_id, team, hero), samples in match_hero.items():
        match = matches_by_id.get(match_id, {})
        match_rows.append({
            "tournament_sheet": tournament,
            "match_id": match_id,
            "match_title": match.get("match_title", ""),
            "team_top": match.get("team_top", ""),
            "team_bottom": match.get("team_bottom", ""),
            "team_name": team,
            "hero_name": hero,
            "usage_count": str(len(samples)),
            "damage_verified": False,
            "metric": "post_match_settlement_hero",
        })

    def normalize_win_rows(rows: list[dict[str, str]], player_field: str | None = None) -> list[dict[str, str]]:
        if player_field:
            names = canonical_names(rows, player_field)
            for row in rows:
                row[player_field] = names.get(identity(row.get(player_field, "")), row.get(player_field, "").strip())
        return rows

    payload = {
        "schemaVersion": 2,
        "source": "OWCS scoresheet map log / OW Analytics",
        "sourceUrl": "https://github.com/napori0929/owcs-stats",
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "sourceVersion": source_version,
        "usageUnit": "post_match_settlement_hero",
        "usageRule": "post-match settlement hero first; positive-damage hero only as fallback",
        "usageOfficial": False,
        "excludedSheets": sorted(PSEUDO_SHEETS),
        "overallHeroUsage": make_usage_rows(overall, ("hero_name", "role"), roles),
        "teamHeroUsage": make_usage_rows(teams, ("team_name", "hero_name", "role"), roles),
        "playerHeroUsage": make_usage_rows(players_usage, ("player_name", "team_name", "hero_name"), roles),
        "tournamentHeroUsage": make_usage_rows(tournaments, ("tournament_sheet", "hero_name", "role"), roles),
        "mapHeroUsage": make_usage_rows(maps, ("map_name", "hero_name", "role"), roles),
        "tournamentTeamHeroUsage": make_usage_rows(tournament_teams, ("tournament_sheet", "team_name", "hero_name", "role"), roles),
        "tournamentPlayerHeroUsage": make_usage_rows(tournament_players, ("tournament_sheet", "player_name", "team_name", "hero_name"), roles),
        "playerHeroWinRates": normalize_win_rows(downloaded["playerHeroWinRates"], "player_name"),
        "teamHeroWinRates": downloaded["teamHeroWinRates"],
        "matchHeroUsage": match_rows,
        "mapSetHeroUsage": usage,
        "rawMatches": raw_matches,
        "rawMapSetResults": raw_results,
    }

    report = {
        "auditedAt": payload["generatedAt"],
        "sourceVersion": payload["sourceVersion"],
        "status": "passed" if not (duplicate_keys or orphan_usage or wrong_team) else "failed",
        "counts": {
            "sourceRows": len(raw_usage),
            "acceptedRows": len(usage),
            "excludedPseudoRows": len(pseudo_rows),
            "tournaments": len({row["tournament_sheet"] for row in usage}),
            "matches": len({row["match_id"] for row in usage}),
            "mapSets": len({(row["match_id"], row["map_set_index"]) for row in usage}),
            "teams": len({row["team_name"] for row in usage}),
            "players": len({identity(row["player_name"]) for row in usage}),
        },
        "checks": {
            "duplicatePlayerMapHeroRows": len(duplicate_keys),
            "usageRowsWithoutMatch": len(orphan_usage),
            "usageRowsAssignedToNonParticipant": len(wrong_team),
            "sameTeamFixtures": sum(row.get("team_top") == row.get("team_bottom") for row in raw_matches),
            "playerCaseVariantsAfterNormalization": sum(len(values) > 1 for values in ({k: {r["player_name"] for r in usage if identity(r["player_name"]) == k} for k in players}).values()),
        },
    }
    if report["checks"]["sameTeamFixtures"]:
        report["status"] = "failed"

    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    print(f"wrote {OUTPUT} ({OUTPUT.stat().st_size:,} bytes)")
    if report["status"] != "passed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
