from __future__ import annotations

import csv
import json
import posixpath
import re
import unicodedata
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from xml.etree import ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data" / "owcs-2025"
OUTPUT = ROOT / "src" / "esports2025Snapshot.json"
PERFORMANCE = DATA_DIR / "owcs_2025_stage1rr_de.csv"
WORKBOOKS = {1: DATA_DIR / "stage1.xlsx", 2: DATA_DIR / "stage2.xlsx", 3: DATA_DIR / "stage3.xlsx"}
SOURCE_URLS = [
    "https://docs.google.com/spreadsheets/d/1hduf3Wq8ct_Fw9Ndq-p8uF2l29KKG0l_rpcxRSl0oj8/edit",
    "https://docs.google.com/spreadsheets/d/1u7QQq5nJZQy_bb3QpukgoMVmiaaz1jP6umiDJfQSG5c/edit",
    "https://docs.google.com/spreadsheets/d/1peS5Avoh8_3LNr-KZDafdTh6IQ1-P7QypmpsdH5gY8o/edit",
    "https://github.com/qghop/OWCS-Stats-Lab/blob/main/owcs_2025_stage1rr_de.csv",
]

MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
DRAW_NS = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"

EXCLUDED_SHEETS = {
    "Landing Page", "Hero Ban Totals", "Map Pick Totals (Asia)", "Map Pick Totals (Non-Asia)",
    "Map Pick Totals (LAN)", "Self-Check", "Map Index", "Hero Index",
}

# The workbook portrait in each player/map slot is the post-match settlement
# hero.  OA/Symmetra has no matching settlement evidence, so keep the bad row
# out at source level instead of presenting it as a real lineup.
EXCLUDED_UNVERIFIED_APPEARANCES = {
    ("Once Again", "Symmetra"),
}


def resolve(base: str, target: str) -> str:
    return posixpath.normpath(posixpath.join(posixpath.dirname(base), target))


def relationships(bundle: zipfile.ZipFile, owner: str) -> dict[str, str]:
    rel_path = str(PurePosixPath(owner).parent / "_rels" / f"{PurePosixPath(owner).name}.rels")
    if rel_path not in bundle.namelist():
        return {}
    root = ET.fromstring(bundle.read(rel_path))
    return {item.attrib["Id"]: resolve(owner, item.attrib["Target"]) for item in root}


def shared_strings(bundle: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in bundle.namelist():
        return []
    root = ET.fromstring(bundle.read("xl/sharedStrings.xml"))
    return ["".join(node.text or "" for node in item.iter(f"{{{MAIN_NS}}}t")) for item in root]


def cell_position(reference: str) -> tuple[int, int]:
    match = re.fullmatch(r"([A-Z]+)(\d+)", reference)
    if not match:
        return 0, 0
    col = 0
    for character in match.group(1):
        col = col * 26 + ord(character) - 64
    return int(match.group(2)), col


def read_cells(bundle: zipfile.ZipFile, sheet_path: str, strings: list[str]) -> tuple[dict[tuple[int, int], object], str | None]:
    root = ET.fromstring(bundle.read(sheet_path))
    cells: dict[tuple[int, int], object] = {}
    for cell in root.iter(f"{{{MAIN_NS}}}c"):
        position = cell_position(cell.attrib.get("r", ""))
        value = cell.find(f"{{{MAIN_NS}}}v")
        inline = cell.find(f"{{{MAIN_NS}}}is")
        if cell.attrib.get("t") == "s" and value is not None:
            cells[position] = strings[int(value.text or 0)]
        elif inline is not None:
            cells[position] = "".join(node.text or "" for node in inline.iter(f"{{{MAIN_NS}}}t"))
        elif value is not None:
            cells[position] = value.text or ""
    drawing = root.find(f"{{{MAIN_NS}}}drawing")
    drawing_id = drawing.attrib.get(f"{{{REL_NS}}}id") if drawing is not None else None
    return cells, drawing_id


def read_drawings(bundle: zipfile.ZipFile, sheet_path: str, drawing_id: str | None) -> list[tuple[int, int, str]]:
    if not drawing_id:
        return []
    drawing_path = relationships(bundle, sheet_path).get(drawing_id)
    if not drawing_path:
        return []
    root = ET.fromstring(bundle.read(drawing_path))
    result = []
    for anchor in root:
        row = anchor.find(f".//{{{DRAW_NS}}}from/{{{DRAW_NS}}}row")
        col = anchor.find(f".//{{{DRAW_NS}}}from/{{{DRAW_NS}}}col")
        prop = anchor.find(f".//{{{DRAW_NS}}}cNvPr")
        if row is not None and col is not None and prop is not None:
            result.append((int(row.text or 0) + 1, int(col.text or 0) + 1, prop.attrib.get("name", "")))
    return result


def workbook_sheets(path: Path) -> dict[str, tuple[dict[tuple[int, int], object], list[tuple[int, int, str]]]]:
    with zipfile.ZipFile(path) as bundle:
        strings = shared_strings(bundle)
        workbook_path = "xl/workbook.xml"
        workbook = ET.fromstring(bundle.read(workbook_path))
        workbook_rels = relationships(bundle, workbook_path)
        result = {}
        for sheet in workbook.iter(f"{{{MAIN_NS}}}sheet"):
            name = sheet.attrib["name"]
            sheet_path = workbook_rels[sheet.attrib[f"{{{REL_NS}}}id"]]
            cells, drawing_id = read_cells(bundle, sheet_path, strings)
            result[name] = (cells, read_drawings(bundle, sheet_path, drawing_id))
        return result


def clean_player(value: object) -> str:
    text = re.sub(r"\s*[★☆]\s*", "", str(value or "")).strip()
    aliases = {"aprita": "Apr1ta"}
    return aliases.get(text.lower(), text)


def player_identity(value: str) -> str:
    plain = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]", "", plain.lower())


def preferred_player_name(values: set[str]) -> str:
    def rank(value: str) -> tuple[int, int, str]:
        letters = "".join(char for char in value if char.isalpha())
        kind = 1 if letters.islower() else 2 if letters.isupper() else 3
        return kind, len(value), value
    return max(values, key=rank)


def clean_team(value: object) -> str:
    text = str(value or "").strip()
    text = re.sub(r"\s*\[[^\]]*\]\s*$", "", text)
    aliases = {"ULT": "The Ultimates", "QAD": "Al Qadsiah", "TM": "Twisted Minds", "CC": "Team CC"}
    return aliases.get(text, text)


def load_performance() -> list[dict[str, str]]:
    with PERFORMANCE.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def number(value: str) -> float:
    try:
        return float(value or 0)
    except ValueError:
        return 0


def main() -> None:
    records: set[tuple[int, str, str, str, str, str, bool]] = set()
    role_by_hero: dict[str, str] = {}
    source_sheet_counts: dict[str, int] = {}

    for stage, path in WORKBOOKS.items():
        sheets = workbook_sheets(path)
        ban_cells, ban_drawings = sheets["Hero Ban Totals"]
        hero_by_image: dict[str, str] = {}
        for row, col, image_name in ban_drawings:
            hero = str(ban_cells.get((row - 1, col), "")).strip()
            if hero and hero not in {"Tank", "Damage", "Support", "Forfeit"}:
                hero_by_image[image_name] = hero
                role_by_hero[hero] = "Tank" if col % 25 in {4, 6, 8} else "Damage" if col % 25 in {11, 13, 15, 17} else "Support"

        for sheet_name, (cells, drawings) in sheets.items():
            if sheet_name in EXCLUDED_SHEETS:
                continue
            accepted = 0
            for row, col, image_name in drawings:
                hero = hero_by_image.get(image_name)
                if not hero:
                    continue
                base = 2 + 17 * ((row - 2) // 17)
                player_row = row - 1
                if player_row not in {base + 1, base + 4, base + 11, base + 14}:
                    continue
                segment = (col - 1) // 17
                centers = [7 + 17 * segment, 11 + 17 * segment, 15 + 17 * segment]
                center = next((item for item in centers if item - 1 <= col <= item + 2), None)
                if center is None:
                    continue
                player = clean_player(cells.get((player_row, center)))
                map_name = str(cells.get((base + 8, 3 + 17 * segment), "")).strip()
                header = str(cells.get((base, 4 + 17 * segment), "")).strip()
                top_team = clean_team(cells.get((base, 6 + 17 * segment)))
                if not player or not map_name or not header or not top_team:
                    continue
                is_top = player_row in {base + 1, base + 4}
                match_key = f"S{stage}:{sheet_name}:{header}"
                records.add((stage, sheet_name, match_key, map_name, player, hero, is_top))
                accepted += 1
            source_sheet_counts[f"Stage {stage} · {sheet_name}"] = accepted

    # Every 17-row map card contains both team names.  Resolve the team from the
    # same card instead of inferring it from a player's other appearances.  The
    # old inference corrupted transfers and every player seen only on the lower
    # side of a card.
    match_sides: dict[tuple[int, str, str], tuple[str, str]] = {}
    for stage, path in WORKBOOKS.items():
        sheets = workbook_sheets(path)
        for sheet_name, (cells, _drawings) in sheets.items():
            if sheet_name in EXCLUDED_SHEETS:
                continue
            max_row = max((row for row, _col in cells), default=0)
            max_col = max((col for _row, col in cells), default=0)
            for base in range(2, max_row + 1, 17):
                for segment in range((max_col + 16) // 17):
                    header = str(cells.get((base, 4 + 17 * segment), "")).strip()
                    top_team = clean_team(cells.get((base, 6 + 17 * segment)))
                    bottom_team = clean_team(cells.get((base + 15, 6 + 17 * segment)))
                    if not header or not top_team or not bottom_team:
                        continue
                    match_key = f"S{stage}:{sheet_name}:{header}"
                    match_sides[(stage, sheet_name, match_key)] = (top_team, bottom_team)

    detailed = []
    for stage, sheet, match_key, map_name, player, hero, is_top in records:
        sides = match_sides.get((stage, sheet, match_key))
        if not sides:
            continue
        team = sides[0] if is_top else sides[1]
        detailed.append((stage, sheet, match_key, map_name, player, team, hero))

    # The workbooks contain capitalization-only variants (Guxue/guxue,
    # WhoRU/Whoru, etc.). Collapse those identities before any aggregation so
    # rosters and player rankings cannot split one person into multiple rows.
    player_variants: dict[str, set[str]] = defaultdict(set)
    for _stage, _sheet, _match, _map, player, _team, _hero in detailed:
        player_variants[player_identity(player)].add(player)
    canonical_players = {key: preferred_player_name(values) for key, values in player_variants.items()}
    detailed = [
        (stage, sheet, match_key, map_name, canonical_players[player_identity(player)], team, hero)
        for stage, sheet, match_key, map_name, player, team, hero in detailed
        if (team, hero) not in EXCLUDED_UNVERIFIED_APPEARANCES
    ]

    player_usage: dict[tuple[str, str, str], set[str]] = defaultdict(set)
    team_usage: dict[tuple[str, str, str], set[str]] = defaultdict(set)
    tournament_usage: dict[tuple[str, str, str], set[str]] = defaultdict(set)
    tournament_players: dict[tuple[str, str, str, str], set[str]] = defaultdict(set)
    tournament_teams: dict[tuple[str, str, str, str], set[str]] = defaultdict(set)
    map_usage: dict[tuple[str, str, str], set[str]] = defaultdict(set)
    overall: dict[tuple[str, str], set[str]] = defaultdict(set)
    match_usage: dict[tuple[str, str, str, str], set[str]] = defaultdict(set)
    match_players: dict[tuple[str, str, str, str], set[str]] = defaultdict(set)
    match_teams: dict[tuple[str, str], set[str]] = defaultdict(set)
    for stage, sheet, match_key, map_name, player, team, hero in detailed:
        tournament = f"2025 OWCS Stage {stage} · {sheet}"
        sample = f"{match_key}:{map_name}"
        role = role_by_hero.get(hero, "")
        player_usage[(player, team, hero)].add(sample)
        team_usage[(team, hero, role)].add(sample)
        tournament_usage[(tournament, hero, role)].add(sample)
        tournament_players[(tournament, player, team, hero)].add(sample)
        tournament_teams[(tournament, team, hero, role)].add(sample)
        map_usage[(map_name, hero, role)].add(sample)
        overall[(hero, role)].add(sample)
        series_key = re.sub(r"\s*\|\s*Map\s+\d+\s*$", "", match_key, flags=re.IGNORECASE)
        match_usage[(tournament, series_key, team, hero)].add(map_name)
        match_players[(tournament, series_key, team, hero)].add(player)
        match_teams[(tournament, series_key)].add(team)

    performance_rows = load_performance()
    performance_groups: dict[tuple[str, str], list[dict[str, str]]] = defaultdict(list)
    for row in performance_rows:
        player = (row.get("name") or row.get("nickname") or "").strip()
        performance_groups[(player, row["match_id"])].append(row)
    player_performance = []
    for (player, match_id), group in performance_groups.items():
        first = group[0]
        won = sum(number(row.get("Result", "0")) for row in group)
        player_performance.append({
            "id": f"2025:{match_id}:{player}", "datetime": "2025-01-01T00:00:00Z",
            "event": f"2025 OWCS Stage 1 · {first.get('region', '')}", "player": player,
            "team1": first["team_name"], "team2": first["opposing_team_name"], "team1Logo": "", "team2Logo": "",
            "score1": int(won), "score2": max(0, len(group) - int(won)), "url": SOURCE_URLS[-1], "mapCount": len(group),
            "eliminations": int(sum(number(row.get("Eliminations", "0")) for row in group)),
            "assists": int(sum(number(row.get("Assists", "0")) for row in group)),
            "deaths": int(sum(number(row.get("Deaths", "0")) for row in group)),
            "damage": int(sum(number(row.get("Damage Dealt", "0")) for row in group)),
            "healing": int(sum(number(row.get("Healing Done", "0")) for row in group)),
            "mitigation": int(sum(number(row.get("Damage Mitigated", "0")) for row in group)),
            "fantasyScore": 0, "season": 2025,
        })

    def usage_rows(bucket, names):
        return [{**dict(zip(names, key)), "usage_count": str(len(samples)), "pick_count": str(len(samples)), "pick_rate": "0", "damage_verified": False, "metric": "post_match_settlement_hero"}
                for key, samples in sorted(bucket.items())]

    matches = {
        re.sub(r"\s*\|\s*Map\s+\d+\s*$", "", match_key, flags=re.IGNORECASE)
        for _stage, _sheet, match_key, _map, _player, _team, _hero in detailed
    }
    payload = {
        "schemaVersion": 2, "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": "OWCS 2025 community map-composition workbooks + FACEIT Stage 1 performance telemetry",
        "sourceUrls": SOURCE_URLS, "firstSeason": 2025, "lastSeason": 2025, "seasons": [2025],
        "matchCount": len(matches), "playerCount": len({row[4] for row in detailed}),
        "teamCount": len({row[5] for row in detailed if row[5] != "Unknown"}),
        "rawRowCount": len(detailed) + len(performance_rows),
        "coverage": "Post-match settlement heroes for 2025 OWCS Stage 1/2/3 and global events; FACEIT player performance is Stage 1 NA/EMEA only",
        "usageUnit": "post_match_settlement_hero",
        "usageRule": "post-match settlement hero first; positive-damage hero only as fallback",
        "usageOfficial": False,
        "performanceUnit": "faceit_map_telemetry",
        "performanceOfficial": False,
        "sourceSheetCounts": source_sheet_counts, "playerPerformance": player_performance,
        "overallHeroUsage": usage_rows(overall, ("hero_name", "role")),
        "teamHeroUsage": usage_rows(team_usage, ("team_name", "hero_name", "role")),
        "playerHeroUsage": usage_rows(player_usage, ("player_name", "team_name", "hero_name")),
        "tournamentHeroUsage": usage_rows(tournament_usage, ("tournament_sheet", "hero_name", "role")),
        "tournamentPlayerHeroUsage": usage_rows(tournament_players, ("tournament_sheet", "player_name", "team_name", "hero_name")),
        "tournamentTeamHeroUsage": usage_rows(tournament_teams, ("tournament_sheet", "team_name", "hero_name", "role")),
        "mapHeroUsage": usage_rows(map_usage, ("map_name", "hero_name", "role")),
        "matchHeroUsage": [
            {"tournament_sheet": key[0], "match_id": key[1], "match_title": key[1],
             "team_top": sorted(match_teams[(key[0], key[1])])[0] if match_teams[(key[0], key[1])] else "",
             "team_bottom": sorted(match_teams[(key[0], key[1])])[1] if len(match_teams[(key[0], key[1])]) > 1 else "",
             "team_name": key[2], "hero_name": key[3], "usage_count": str(len(maps)),
             "evidence_maps": sorted(maps), "evidence_players": sorted(match_players[key]),
             "damage_verified": False, "metric": "post_match_settlement_hero"}
            for key, maps in sorted(match_usage.items())
        ],
    }
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUTPUT} ({OUTPUT.stat().st_size:,} bytes)")
    print({key: len(value) for key, value in payload.items() if isinstance(value, list)})
    symmetra = sorted((row for row in payload["playerHeroUsage"] if row["hero_name"] == "Symmetra"), key=lambda row: int(row["usage_count"]), reverse=True)
    print("Symmetra leaders:", symmetra[:12])


if __name__ == "__main__":
    main()
