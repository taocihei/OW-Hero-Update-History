from __future__ import annotations

import concurrent.futures
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from bs4 import BeautifulSoup


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "src" / "esportsSupplementSnapshot.json"
HEADERS = {"User-Agent": "OWHeroUpdateHistory/0.9 (+desktop archive)"}
TOURNAMENTS = [
    ("midseason-championship-owcs-2026", "2026 季中冠军赛", "global", "BV14NMd6dErt"),
    ("china-stage-2-owcs-2026", "2026 OWCS S2 · 中国赛区", "china", "BV1Gjjh6DECK"),
    ("korea-stage-2-owcs-2026", "2026 OWCS S2 · 韩国赛区", "korea", ""),
    ("japan-stage-2-owcs-2026", "2026 OWCS S2 · 日本赛区", "japan", ""),
    ("pacific-stage-2-owcs-2026", "2026 OWCS S2 · 太平洋赛区", "pacific", ""),
    ("emea-stage-2-owcs-2026", "2026 OWCS S2 · EMEA", "emea", ""),
    ("na-stage-2-owcs-2026", "2026 OWCS S2 · 北美赛区", "na", ""),
    ("champions-clash-owcs-2026", "2026 Champions Clash", "global", ""),
]

PRIZE_POOLS = {
    "midseason-championship-owcs-2026": "$1,000,000",
    "champions-clash-owcs-2026": "$200,000",
}


def get(url: str) -> str:
    last_error: Exception | None = None
    for attempt in range(8):
        try:
            response = requests.get(url, headers=HEADERS, timeout=60)
            response.raise_for_status()
            return response.text
        except Exception as exc:
            last_error = exc
            time.sleep(min(8, attempt + 1))
    raise RuntimeError(f"failed to download {url}: {last_error}")


def flight_objects(html: str) -> list[Any]:
    result: list[Any] = []
    for script in BeautifulSoup(html, "html.parser").find_all("script"):
        match = re.fullmatch(r"self\.__next_f\.push\((.*)\)", script.string or "", re.S)
        if not match:
            continue
        try:
            flight = json.loads(match.group(1))
        except json.JSONDecodeError:
            continue
        if len(flight) < 2 or not isinstance(flight[1], str):
            continue
        for line in flight[1].splitlines():
            if ":" not in line:
                continue
            try:
                result.append(json.loads(line.split(":", 1)[1]))
            except json.JSONDecodeError:
                pass
    return result


def walk(value: Any):
    yield value
    if isinstance(value, dict):
        for child in value.values():
            yield from walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk(child)


def image_url(team: dict[str, Any]) -> str:
    image = team.get("image")
    return image.get("url", "") if isinstance(image, dict) else ""


def collect_tournament(item: tuple[str, str, str, str]) -> dict[str, Any]:
    slug, display_name, region, seed_bvid = item
    url = f"https://owtv.gg/tournaments/{slug}"
    objects = flight_objects(get(url))
    teams: dict[int, dict[str, Any]] = {}
    phases: dict[int, dict[str, Any]] = {}
    raw_matches: dict[str, dict[str, Any]] = {}
    tournament_meta: dict[str, Any] = {}
    for root in objects:
        for value in walk(root):
            if not isinstance(value, dict):
                continue
            if isinstance(value.get("id"), int) and isinstance(value.get("name"), str) and "initials" in value:
                teams[value["id"]] = value
            if isinstance(value.get("id"), int) and isinstance(value.get("name"), str) and "type" in value and "startDate" in value and "endDate" in value:
                phases[value["id"]] = value
            if value.get("slug") == slug and isinstance(value.get("name"), str):
                tournament_meta = value
            required = {"slug", "team1", "team2", "team1Score", "team2Score", "startDate"}
            match_slug = value.get("slug")
            if required.issubset(value) and isinstance(match_slug, str) and match_slug.startswith(slug):
                previous = raw_matches.get(match_slug)
                if previous is None:
                    raw_matches[match_slug] = dict(value)
                else:
                    merged = dict(previous)
                    for key, current in value.items():
                        if key in {"team1", "team2"}:
                            if isinstance(current, dict):
                                merged[key] = current
                        elif key == "tournamentPhase":
                            if isinstance(current, dict) or key not in merged:
                                merged[key] = current
                        elif key in {"nextMatchWinner", "nextMatchLoser", "bracketSide", "bracketGroup", "bracketMatchNumber", "round"}:
                            if current not in (None, ""):
                                merged[key] = current
                        elif merged.get(key) in (None, "") and current not in (None, ""):
                            merged[key] = current
                    raw_matches[match_slug] = merged

    matches: list[dict[str, Any]] = []
    for match_slug, raw in raw_matches.items():
        def relation_id(value: Any) -> int | None:
            if isinstance(value, int):
                return value
            if isinstance(value, dict) and isinstance(value.get("id"), int):
                return value["id"]
            return None

        def resolve(value: Any) -> dict[str, Any]:
            if isinstance(value, dict):
                return value
            return teams.get(value, {}) if isinstance(value, int) else {}

        team1, team2 = resolve(raw.get("team1")), resolve(raw.get("team2"))
        team1_name = team1.get("name") or raw.get("team1Placeholder") or "TBD"
        team2_name = team2.get("name") or raw.get("team2Placeholder") or "TBD"
        phase_value = raw.get("tournamentPhase")
        phase = phase_value if isinstance(phase_value, dict) else phases.get(phase_value, {}) if isinstance(phase_value, int) else {}
        complete = bool(raw.get("complete"))
        matches.append({
            "id": f"owtv:{match_slug}",
            "datetime": raw.get("startDate") or "",
            "status": "completed" if complete else "upcoming",
            "team1": team1_name,
            "team2": team2_name,
            "team1Id": f"owtv-team:{team1.get('id', '')}",
            "team2Id": f"owtv-team:{team2.get('id', '')}",
            "team1Logo": image_url(team1),
            "team2Logo": image_url(team2),
            "score1": raw.get("team1Score"),
            "score2": raw.get("team2Score"),
            "event": display_name,
            "region": region,
            "phase": phase.get("title", "") if isinstance(phase, dict) else "",
            "stage": phase.get("name", "") if isinstance(phase, dict) else "",
            "youtube": "",
            "twitch": "",
            "owtv": f"https://owtv.gg/matches/{match_slug}",
            "bilibili": "",
            "sources": ["OWTV"],
            "tournamentId": slug,
            "owtvMatchId": raw.get("id"),
            "bracketSide": raw.get("bracketSide") or "",
            "bracketGroup": raw.get("bracketGroup") or "",
            "bracketMatchNumber": raw.get("bracketMatchNumber"),
            "round": raw.get("round"),
            "nextMatchWinnerId": relation_id(raw.get("nextMatchWinner")),
            "nextMatchLoserId": relation_id(raw.get("nextMatchLoser")),
        })
    matches.sort(key=lambda row: row["datetime"])
    logo = tournament_meta.get("image") if isinstance(tournament_meta.get("image"), dict) else {}
    dates = [match["datetime"] for match in matches if match["datetime"]]
    participants = sorted({match[side] for match in matches for side in ("team1", "team2") if match[side] != "TBD"})
    return {
        "id": slug,
        "name": display_name,
        "region": region,
        "url": url,
        "seedBvid": seed_bvid,
        "logo": logo.get("url") or "",
        "startDate": tournament_meta.get("startDate") or (min(dates) if dates else ""),
        "endDate": tournament_meta.get("endDate") or (max(dates) if dates else ""),
        "location": tournament_meta.get("location") or ("线上" if tournament_meta.get("online") else ""),
        "prizePool": PRIZE_POOLS.get(slug, ""),
        "participants": participants,
        "matches": matches,
    }


def collect_bilibili(seed_bvid: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    url = f"https://api.bilibili.com/x/web-interface/view?bvid={seed_bvid}"
    payload = json.loads(get(url)).get("data") or {}
    season = payload.get("ugc_season") or {}
    episodes: list[dict[str, Any]] = []
    for section in season.get("sections") or []:
        for episode in section.get("episodes") or []:
            arc = episode.get("arc") or {}
            bvid = episode.get("bvid") or arc.get("bvid") or ""
            episodes.append({
                "bvid": bvid,
                "title": episode.get("title") or arc.get("title") or "",
                "url": f"https://www.bilibili.com/video/{bvid}" if bvid else "",
                "publishedAt": arc.get("pubdate") or 0,
                "duration": arc.get("duration") or 0,
            })
    return {
        "id": season.get("id"),
        "title": season.get("title") or payload.get("title") or "",
        "seedBvid": seed_bvid,
        "url": f"https://www.bilibili.com/video/{seed_bvid}",
        "videoCount": len(episodes),
    }, episodes


ALIASES = {"wbg": "wei", "jdg": "jd", "zeta": "zeta", "flc": "flc", "t1": "t1"}


def token(value: str) -> str:
    value = re.sub(r"[^a-z0-9]", "", value.lower())
    return ALIASES.get(value, value)


def attach_videos(tournament: dict[str, Any], episodes: list[dict[str, Any]]) -> None:
    for episode in episodes:
        title = episode["title"]
        found = re.search(r"([A-Za-z0-9]+)\s*对阵\s*([A-Za-z0-9]+)", title, re.I)
        if not found:
            continue
        left, right = token(found.group(1)), token(found.group(2))
        for match in tournament["matches"]:
            candidates1 = {token(match["team1"]), token(match["team1Id"]), token(match["id"].split("-vs-")[0].rsplit("-", 1)[-1])}
            candidates2 = {token(match["team2"]), token(match["team2Id"]), token(match["id"].split("-vs-")[-1])}
            if (left in candidates1 and right in candidates2) or (right in candidates1 and left in candidates2):
                match["bilibili"] = episode["url"]
                match["sources"] = ["OWTV", "Bilibili"]


def main() -> None:
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        tournaments = list(executor.map(collect_tournament, TOURNAMENTS))

    series: list[dict[str, Any]] = []
    videos: list[dict[str, Any]] = []
    for tournament in tournaments:
        if not tournament["seedBvid"]:
            continue
        info, episodes = collect_bilibili(tournament["seedBvid"])
        info["tournamentId"] = tournament["id"]
        series.append(info)
        for episode in episodes:
            episode["tournamentId"] = tournament["id"]
        videos.extend(episodes)
        attach_videos(tournament, episodes)

    matches = [match for tournament in tournaments for match in tournament.pop("matches")]
    for tournament in tournaments:
        tournament["matchCount"] = sum(1 for match in matches if match["tournamentId"] == tournament["id"])
        tournament["videoCount"] = sum(1 for video in videos if video["tournamentId"] == tournament["id"])
        tournament.pop("seedBvid", None)

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "OW Esports + OWTV + Bilibili",
        "tournaments": tournaments,
        "series": series,
        "videos": videos,
        "matches": matches,
    }
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"tournaments={len(tournaments)} matches={len(matches)} videos={len(videos)}")
    print(f"wrote {OUTPUT} ({OUTPUT.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
