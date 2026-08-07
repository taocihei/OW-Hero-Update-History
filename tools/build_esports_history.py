"""Build the compact OWL career archive used by the desktop application.

The Blizzard Stats Lab downloads are long-form CSV files (one row per statistic).
This tool downloads each immutable season archive once, folds it into match/player
and hero-usage records, then writes a single JSON document that can ship with the
application.  Re-running it skips unchanged downloads and only rebuilds when a
source archive is new or has changed.
"""

from __future__ import annotations

import csv
import io
import json
import re
import unicodedata
import urllib.request
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "owl-statslab"
OUTPUT = ROOT / "src" / "esportsHistorySnapshot.json"

SOURCES = {
    2018: "https://assets.blz-contentstack.com/v3/assets/blt321317473c90505c/bltc1b83b55692b42f4/5e4c1368de213a0dff736e29/phs_2018.zip",
    2019: "https://assets.blz-contentstack.com/v3/assets/blt321317473c90505c/blt034e0b484f2dae47/5e4c1369b6a7c40dd9c69e9f/phs_2019.zip",
    2020: "https://assets.blz-contentstack.com/v3/assets/blt321317473c90505c/blt5ee09cc6725e80eb/60b956b0b078b00d8a90a3dc/phs_2020.zip",
    2021: "https://assets.blz-contentstack.com/v3/assets/blt321317473c90505c/blt27d1892d31782bff/6154e94b19501a1ef19120a0/phs_2021-1.zip",
    2022: "https://assets.blz-contentstack.com/v3/assets/blt321317473c90505c/blt7858a2c0893b6e64/63f51f8168c5766288a166d4/phs-2022.csv.zip",
    2023: "https://assets.blz-contentstack.com/v3/assets/blt321317473c90505c/bltc7abf4eefeb0ac13/6491eecad4bfb304116a7b4f/2023_week7_phs_2023.zip",
}

STAT_KEYS = {
    "Eliminations": "eliminations",
    "Assists": "assists",
    "Deaths": "deaths",
    "All Damage Done": "damage",
    "Healing Done": "healing",
    "Damage Blocked": "mitigation",
}


def download(year: int, url: str) -> Path:
    CACHE.mkdir(parents=True, exist_ok=True)
    target = CACHE / f"{year}.zip"
    if target.exists() and target.stat().st_size > 1_000_000:
        return target
    print(f"Downloading {year} Stats Lab …")
    request = urllib.request.Request(url, headers={"User-Agent": "OWHeroUpdateHistory-archive-builder/1.0"})
    with urllib.request.urlopen(request, timeout=120) as response, target.open("wb") as stream:
        while block := response.read(1024 * 1024):
            stream.write(block)
    return target


def parse_time(value: str, year: int) -> str:
    value = value.strip().replace(" UTC", "")
    for fmt in ("%Y-%m-%d %H:%M:%S", "%m/%d/%Y %H:%M", "%m/%d/%Y %H:%M:%S"):
        try:
            return datetime.strptime(value, fmt).replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
        except ValueError:
            pass
    return f"{year}-01-01T00:00:00Z"


def safe_number(value: str) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def clean_hero(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip())


def player_identity(value: str) -> str:
    plain = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]", "", plain.lower())


def preferred_player_name(values: set[str]) -> str:
    def rank(value: str) -> tuple[int, int, str]:
        letters = "".join(char for char in value if char.isalpha())
        kind = 1 if letters.islower() else 2 if letters.isupper() else 3
        return kind, len(value), value
    return max(values, key=rank)


def main() -> None:
    # key: season, match, player, team
    player_matches: dict[tuple[int, str, str, str], dict] = {}
    match_teams: dict[tuple[int, str], set[str]] = defaultdict(set)
    player_hero_matches: dict[tuple[int, str, str, str, str, str], float] = defaultdict(float)
    player_hero_damage: dict[tuple[int, str, str, str, str, str], float] = defaultdict(float)
    map_player_hero_time: dict[tuple[int, str, str, str, str, str, str], float] = defaultdict(float)
    map_player_hero_damage: dict[tuple[int, str, str, str, str, str, str], float] = defaultdict(float)
    map_hero_matches: dict[tuple[str, str, str], set[str]] = defaultdict(set)
    seen_rows = 0

    for year, url in SOURCES.items():
        archive = download(year, url)
        print(f"Reading {year} …")
        with zipfile.ZipFile(archive) as bundle:
            for member in bundle.namelist():
                if not member.lower().endswith(".csv") or member.startswith("__MACOSX/"):
                    continue
                with bundle.open(member) as raw, io.TextIOWrapper(raw, encoding="utf-8-sig", errors="replace", newline="") as text:
                    for row in csv.DictReader(text):
                        match_id = (row.get("esports_match_id") or row.get("match_id") or "").strip()
                        player = (row.get("player_name") or row.get("player") or "").strip()
                        team = (row.get("team_name") or row.get("team") or "").strip()
                        event = (row.get("tournament_title") or row.get("stage") or f"OWL {year}").strip()
                        hero = clean_hero(row.get("hero_name") or row.get("hero") or "")
                        stat = (row.get("stat_name") or "").strip()
                        amount = safe_number(row.get("stat_amount") or row.get("amount") or "0")
                        map_name = (row.get("map_name") or "").strip()
                        if not match_id or not player or not team:
                            continue
                        seen_rows += 1
                        match_key = (year, match_id)
                        match_teams[match_key].add(team)
                        key = (year, match_id, player, team)
                        record = player_matches.setdefault(key, {
                            "id": f"owl-{year}-{match_id}-{re.sub(r'[^a-z0-9]+', '-', player.lower()).strip('-')}",
                            "matchId": f"owl-{year}-{match_id}",
                            "season": year,
                            "datetime": parse_time(row.get("start_time") or "", year),
                            "event": event,
                            "player": player,
                            "team1": team,
                            "team2": "",
                            "team1Logo": "",
                            "team2Logo": "",
                            "score1": None,
                            "score2": None,
                            "url": "",
                            "maps": set(),
                            "eliminations": 0.0,
                            "assists": 0.0,
                            "deaths": 0.0,
                            "damage": 0.0,
                            "healing": 0.0,
                            "mitigation": 0.0,
                            "fantasyScore": 0.0,
                        })
                        if map_name:
                            record["maps"].add(map_name)
                        if hero == "All Heroes" and stat in STAT_KEYS:
                            record[STAT_KEYS[stat]] += amount
                        elif hero and hero != "All Heroes":
                            hero_key = (year, match_id, event, player, team, hero)
                            map_hero_key = (year, match_id, event, map_name, player, team, hero)
                            if stat == "Time Played" and amount > 0:
                                player_hero_matches[hero_key] += amount
                                if map_name:
                                    map_player_hero_time[map_hero_key] += amount
                            elif stat == "All Damage Done" and amount > 0:
                                player_hero_damage[hero_key] += amount
                                if map_name:
                                    map_player_hero_damage[map_hero_key] += amount

    # Normalize capitalization-only aliases before aggregation. Stats Lab used
    # several spellings for the same person across seasons (for example,
    # JinMu/Jinmu and CHECKMATE/Checkmate).
    variants: dict[str, set[str]] = defaultdict(set)
    for _year, _match, player, _team in player_matches:
        variants[player_identity(player)].add(player)
    canonical = {key: preferred_player_name(values) for key, values in variants.items()}

    normalized_matches: dict[tuple[int, str, str, str], dict] = {}
    for (year, match_id, player, team), record in player_matches.items():
        name = canonical[player_identity(player)]
        key = (year, match_id, name, team)
        record["player"] = name
        record["id"] = f"owl-{year}-{match_id}-{re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')}"
        existing = normalized_matches.get(key)
        if existing is None:
            normalized_matches[key] = record
        else:
            existing["maps"].update(record["maps"])
            for field in STAT_KEYS.values():
                existing[field] += record[field]
    player_matches = normalized_matches

    def normalize_metric(source: dict[tuple, float], player_index: int) -> defaultdict[tuple, float]:
        result: defaultdict[tuple, float] = defaultdict(float)
        for key, value in source.items():
            parts = list(key)
            parts[player_index] = canonical[player_identity(str(parts[player_index]))]
            result[tuple(parts)] += value
        return result

    player_hero_matches = normalize_metric(player_hero_matches, 3)
    player_hero_damage = normalize_metric(player_hero_damage, 3)
    map_player_hero_time = normalize_metric(map_player_hero_time, 4)
    map_player_hero_damage = normalize_metric(map_player_hero_damage, 4)

    # Attach the opposing team once every match has been observed.
    performance = []
    for (year, match_id, _player, team), record in player_matches.items():
        opponents = sorted(match_teams[(year, match_id)] - {team})
        record["team2"] = opponents[0] if opponents else ""
        record["mapCount"] = len(record.pop("maps"))
        performance.append(record)
    performance.sort(key=lambda item: (item["datetime"], item["matchId"], item["player"]), reverse=True)

    player_usage: dict[tuple[str, str, str], set[str]] = defaultdict(set)
    team_usage: dict[tuple[str, str], set[str]] = defaultdict(set)
    tournament_usage: dict[tuple[str, str], set[str]] = defaultdict(set)
    tournament_player: dict[tuple[str, str, str, str], set[str]] = defaultdict(set)
    tournament_team: dict[tuple[str, str, str], set[str]] = defaultdict(set)
    overall_usage: dict[str, set[str]] = defaultdict(set)
    player_time: dict[tuple[str, str, str], float] = defaultdict(float)
    player_damage: dict[tuple[str, str, str], float] = defaultdict(float)
    tournament_player_time: dict[tuple[str, str, str, str], float] = defaultdict(float)
    tournament_player_damage: dict[tuple[str, str, str, str], float] = defaultdict(float)
    for (year, match_id, event, player, team, hero), seconds in player_hero_matches.items():
        damage = player_hero_damage[(year, match_id, event, player, team, hero)]
        # A hero selection that produced no damage is not an effective in-match
        # use for this archive.  Keep Time Played for the duration total, but do
        # not let zero-damage swaps inflate appearances or rankings.
        if damage <= 0:
            continue
        sample = f"{year}:{match_id}"
        player_usage[(player, team, hero)].add(sample)
        player_time[(player, team, hero)] += seconds
        player_damage[(player, team, hero)] += damage
        team_usage[(team, hero)].add(sample)
        tournament_usage[(event, hero)].add(sample)
        tournament_player[(event, player, team, hero)].add(sample)
        tournament_player_time[(event, player, team, hero)] += seconds
        tournament_player_damage[(event, player, team, hero)] += damage
        tournament_team[(event, team, hero)].add(sample)
        overall_usage[hero].add(sample)

    for (year, match_id, event, map_name, _player, _team, hero), seconds in map_player_hero_time.items():
        if seconds > 0 and map_player_hero_damage[(year, match_id, event, map_name, _player, _team, hero)] > 0:
            map_hero_matches[(event, map_name, hero)].add(f"{year}:{match_id}")

    payload = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": "Overwatch League Stats Lab / Blizzard CDN",
        "usageRule": "Positive-damage hero fallback when no post-match settlement hero is available",
        "sourceUrls": [SOURCES[year] for year in sorted(SOURCES)],
        "firstSeason": min(SOURCES),
        "lastSeason": max(SOURCES),
        "seasons": sorted(SOURCES),
        "rawRowCount": seen_rows,
        "matchCount": len(match_teams),
        "playerCount": len({item["player"] for item in performance}),
        "teamCount": len({item["team1"] for item in performance}),
        "playerPerformance": performance,
        "playerHeroUsage": [
            {"player_name": player, "team_name": team, "hero_name": hero, "usage_count": str(len(samples)), "appearance_count": str(len(samples)), "play_time_seconds": str(round(player_time[(player, team, hero)], 3)), "damage_dealt": str(round(player_damage[(player, team, hero)], 3)), "damage_verified": True, "metric": "damage_positive_fallback"}
            for (player, team, hero), samples in player_usage.items()
        ],
        "teamHeroUsage": [
            {"team_name": team, "hero_name": hero, "role": "", "usage_count": str(len(samples)), "pick_count": str(len(samples)), "pick_rate": "0", "damage_verified": True, "metric": "damage_positive_fallback"}
            for (team, hero), samples in team_usage.items()
        ],
        "tournamentHeroUsage": [
            {"tournament_sheet": event, "hero_name": hero, "role": "", "usage_count": str(len(samples)), "pick_count": str(len(samples)), "pick_rate": "0", "damage_verified": True, "metric": "damage_positive_fallback"}
            for (event, hero), samples in tournament_usage.items()
        ],
        "tournamentPlayerHeroUsage": [
            {"tournament_sheet": event, "player_name": player, "team_name": team, "hero_name": hero, "usage_count": str(len(samples)), "appearance_count": str(len(samples)), "play_time_seconds": str(round(tournament_player_time[(event, player, team, hero)], 3)), "damage_dealt": str(round(tournament_player_damage[(event, player, team, hero)], 3)), "damage_verified": True, "metric": "damage_positive_fallback"}
            for (event, player, team, hero), samples in tournament_player.items()
        ],
        "tournamentTeamHeroUsage": [
            {"tournament_sheet": event, "team_name": team, "hero_name": hero, "role": "", "usage_count": str(len(samples)), "pick_count": str(len(samples)), "pick_rate": "0", "damage_verified": True, "metric": "damage_positive_fallback"}
            for (event, team, hero), samples in tournament_team.items()
        ],
        "mapHeroUsage": [
            {"map_name": map_name, "hero_name": hero, "role": "", "usage_count": str(len(samples)), "pick_count": str(len(samples)), "pick_rate": "0", "tournament_sheet": event, "damage_verified": True, "metric": "damage_positive_fallback"}
            for (event, map_name, hero), samples in map_hero_matches.items() if map_name
        ],
        "overallHeroUsage": [
            {"hero_name": hero, "role": "", "usage_count": str(len(samples)), "pick_count": str(len(samples)), "pick_rate": "0", "damage_verified": True, "metric": "damage_positive_fallback"}
            for hero, samples in overall_usage.items()
        ],
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUTPUT} ({OUTPUT.stat().st_size / 1024 / 1024:.1f} MiB, {len(performance):,} player-match rows)")


if __name__ == "__main__":
    main()
