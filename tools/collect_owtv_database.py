from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import mimetypes
import random
import re
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "data" / "owtv" / "owtv.sqlite3"
BASE = "https://owtv.gg"
UA = "OWHeroUpdateHistory/0.10.18 (+local incremental archive)"
TOURNAMENT_ACTION = "78554873a769addd9eec0766a439ca0b88acc3e869"
RECENT_ACTION = "70e4e56ca4fe89764c1b1f4546ff52dbe9e424de60"
UPCOMING_ACTION = "70a3334a29ee008618bf7916ce528009e00e71853e"
THREAD = threading.local()


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def session() -> requests.Session:
    value = getattr(THREAD, "session", None)
    if value is None:
        value = requests.Session()
        value.headers.update({"User-Agent": UA, "Accept-Language": "en-US,en;q=0.8"})
        THREAD.session = value
    return value


def request(method: str, url: str, **kwargs: Any) -> requests.Response:
    last: Exception | None = None
    for attempt in range(7):
        try:
            response = session().request(method, url, timeout=(15, 75), **kwargs)
            response.raise_for_status()
            return response
        except Exception as exc:
            last = exc
            time.sleep(min(12, (2**attempt) * 0.35) + random.random() * 0.25)
    raise RuntimeError(f"request failed: {method} {url}: {last}")


def action(action_id: str, body: list[Any], referer: str) -> Any:
    response = request(
        "POST", referer,
        headers={
            "Accept": "text/x-component",
            "Content-Type": "text/plain;charset=UTF-8",
            "Next-Action": action_id,
            "Origin": BASE,
            "Referer": referer,
        },
        data=json.dumps(body, separators=(",", ":")),
    )
    values: dict[str, Any] = {}
    for line in response.text.splitlines():
        label, sep, payload = line.partition(":")
        if not sep:
            continue
        try:
            values[label] = json.loads(payload)
        except json.JSONDecodeError:
            continue

    resolving: set[str] = set()

    def resolve(value: Any) -> Any:
        if isinstance(value, str):
            match = re.fullmatch(r"\$(\d+)(?::(.+))?", value)
            if not match:
                return value
            label, path = match.group(1), match.group(2)
            if label in resolving or label not in values:
                return None
            resolving.add(label)
            target = resolve(values[label])
            resolving.discard(label)
            if path:
                for part in path.split(":"):
                    if isinstance(target, dict):
                        target = target.get(part)
                    elif isinstance(target, list) and part.isdigit():
                        index = int(part)
                        target = target[index] if index < len(target) else None
                    else:
                        return None
            return target
        if isinstance(value, list):
            return [resolve(item) for item in value]
        if isinstance(value, dict):
            return {key: resolve(item) for key, item in value.items()}
        return value

    candidates = [resolve(value) for key, value in values.items() if key != "0"]
    return next((item for item in candidates if isinstance(item, dict) and "rows" in item), candidates[-1] if candidates else {})


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


def walk(value: Any) -> Iterable[Any]:
    yield value
    if isinstance(value, dict):
        for child in value.values():
            yield from walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk(child)


def relation_id(value: Any) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    if isinstance(value, dict):
        return relation_id(value.get("id"))
    return None


def image_info(value: dict[str, Any]) -> tuple[str, str]:
    image = value.get("image")
    if isinstance(image, dict):
        return str(image.get("url") or ""), str(image.get("thumbnailURL") or "")
    return str(value.get("imageUrl") or ""), str(value.get("thumbnailURL") or "")


SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sync_runs(id INTEGER PRIMARY KEY,started_at TEXT NOT NULL,finished_at TEXT,status TEXT NOT NULL,counts_json TEXT,error TEXT);
CREATE TABLE IF NOT EXISTS regions(slug TEXT PRIMARY KEY,name TEXT,color TEXT,logo_url TEXT,raw_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tournaments(id INTEGER PRIMARY KEY,slug TEXT UNIQUE NOT NULL,name TEXT,tier TEXT,start_date TEXT,end_date TEXT,format TEXT,location TEXT,venue TEXT,country_code TEXT,has_drops INTEGER,image_url TEXT,local_image_path TEXT,source_url TEXT NOT NULL,raw_json TEXT NOT NULL,seen_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tournament_regions(tournament_id INTEGER NOT NULL,region_slug TEXT NOT NULL,PRIMARY KEY(tournament_id,region_slug));
CREATE TABLE IF NOT EXISTS teams(id INTEGER PRIMARY KEY,name TEXT NOT NULL,initials TEXT,region TEXT,tier TEXT,nationality TEXT,primary_colour TEXT,accent_colour TEXT,image_url TEXT,thumbnail_url TEXT,local_image_path TEXT,website_url TEXT,liquipedia_url TEXT,twitter_url TEXT,youtube_url TEXT,facebook_url TEXT,faceit_id TEXT,created_at TEXT,updated_at TEXT,raw_json TEXT NOT NULL,seen_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS matches(id INTEGER PRIMARY KEY,slug TEXT NOT NULL,start_date TEXT,complete INTEGER,is_live INTEGER,has_started INTEGER,tournament_id INTEGER,region_slug TEXT,team1_id INTEGER,team2_id INTEGER,team1_placeholder TEXT,team2_placeholder TEXT,team1_score INTEGER,team2_score INTEGER,source_url TEXT NOT NULL,detail_fetched_at TEXT,detail_sha256 TEXT,raw_json TEXT NOT NULL,seen_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tournament_teams(tournament_id INTEGER NOT NULL,team_id INTEGER NOT NULL,first_seen TEXT,last_seen TEXT,PRIMARY KEY(tournament_id,team_id));
CREATE TABLE IF NOT EXISTS map_catalog(id INTEGER PRIMARY KEY,name TEXT,mode TEXT,image_url TEXT,local_image_path TEXT,raw_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS match_maps(id INTEGER PRIMARY KEY,match_id INTEGER NOT NULL,map_id INTEGER,slug TEXT,map_index INTEGER,team1_score INTEGER,team2_score INTEGER,result_type TEXT,complete INTEGER,map_picker INTEGER,map_picker_type TEXT,team1_ban INTEGER,team2_ban INTEGER,ban_order_choice INTEGER,first_ban INTEGER,one_vs_one_winner INTEGER,replay_code TEXT,raw_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS players(id INTEGER PRIMARY KEY,name TEXT,alias TEXT,job TEXT,role TEXT,region TEXT,nationality TEXT,image_url TEXT,local_image_path TEXT,facebook_url TEXT,twitter_url TEXT,website_url TEXT,youtube_url TEXT,liquipedia_url TEXT,faceit_id TEXT,game_id TEXT,created_at TEXT,updated_at TEXT,raw_json TEXT NOT NULL,seen_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS player_teams(player_id INTEGER NOT NULL,team_id INTEGER NOT NULL,source TEXT NOT NULL,first_seen TEXT,last_seen TEXT,PRIMARY KEY(player_id,team_id,source));
CREATE TABLE IF NOT EXISTS player_map_stats(id INTEGER PRIMARY KEY,match_id INTEGER NOT NULL,match_map_id INTEGER NOT NULL,team_id INTEGER,player_id INTEGER NOT NULL,role TEXT,eliminations REAL,assists REAL,deaths REAL,damage_dealt REAL,healing_done REAL,damage_mitigated REAL,fantasy_score REAL,objective_time REAL,solo_kills REAL,environmental_kills REAL,multi_kills REAL,final_blows REAL,match_start_date TEXT,raw_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS media_assets(entity_type TEXT NOT NULL,entity_id INTEGER NOT NULL,source_url TEXT NOT NULL,local_path TEXT NOT NULL,mime_type TEXT,bytes INTEGER,sha256 TEXT,fetched_at TEXT NOT NULL,content BLOB,PRIMARY KEY(entity_type,entity_id,source_url));
CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(start_date);
CREATE INDEX IF NOT EXISTS idx_matches_slug ON matches(slug);
CREATE INDEX IF NOT EXISTS idx_matches_teams ON matches(team1_id,team2_id);
CREATE INDEX IF NOT EXISTS idx_matches_tournament ON matches(tournament_id);
CREATE INDEX IF NOT EXISTS idx_players_alias ON players(alias COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_stats_player ON player_map_stats(player_id,match_id);
CREATE INDEX IF NOT EXISTS idx_stats_team ON player_map_stats(team_id,match_id);
"""


def compact(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


class Store:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.db = sqlite3.connect(path)
        self.db.executescript(SCHEMA)
        if "content" not in {row[1] for row in self.db.execute("PRAGMA table_info(media_assets)")}:
            self.db.execute("ALTER TABLE media_assets ADD COLUMN content BLOB")
        self.db.execute("PRAGMA synchronous=NORMAL")

    def close(self) -> None:
        self.db.commit(); self.db.close()

    def upsert_region(self, row: dict[str, Any]) -> None:
        slug = row.get("slug") or row.get("name")
        if not slug: return
        self.db.execute("INSERT INTO regions VALUES(?,?,?,?,?) ON CONFLICT(slug) DO UPDATE SET name=excluded.name,color=excluded.color,logo_url=excluded.logo_url,raw_json=excluded.raw_json", (slug,row.get("name"),row.get("color"),row.get("logoUrl"),compact(row)))

    def upsert_tournament(self, row: dict[str, Any]) -> None:
        rid = relation_id(row.get("id"))
        if rid is None or not row.get("slug"): return
        image, _ = image_info(row)
        self.db.execute("""INSERT INTO tournaments(id,slug,name,tier,start_date,end_date,format,location,venue,country_code,has_drops,image_url,local_image_path,source_url,raw_json,seen_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET slug=excluded.slug,name=excluded.name,tier=excluded.tier,start_date=excluded.start_date,end_date=excluded.end_date,format=excluded.format,location=excluded.location,venue=excluded.venue,country_code=excluded.country_code,has_drops=excluded.has_drops,image_url=excluded.image_url,source_url=excluded.source_url,raw_json=excluded.raw_json,seen_at=excluded.seen_at""", (rid,row["slug"],row.get("name"),row.get("tier"),row.get("startDate"),row.get("endDate"),row.get("format"),row.get("location"),row.get("venue"),row.get("countryCode"),int(bool(row.get("hasDrops"))),image,None,f"{BASE}/tournaments/{row['slug']}",compact(row),utcnow()))
        for region in row.get("regions") or []:
            if isinstance(region, dict): self.upsert_region(region); region = region.get("slug") or region.get("name")
            if region: self.db.execute("INSERT OR IGNORE INTO tournament_regions VALUES(?,?)",(rid,str(region)))

    def upsert_team(self, row: dict[str, Any]) -> None:
        if not isinstance(row.get("id"), int) or not row.get("name"): return
        image, thumb = image_info(row)
        self.db.execute("""INSERT INTO teams(id,name,initials,region,tier,nationality,primary_colour,accent_colour,image_url,thumbnail_url,local_image_path,website_url,liquipedia_url,twitter_url,youtube_url,facebook_url,faceit_id,created_at,updated_at,raw_json,seen_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,initials=excluded.initials,region=excluded.region,tier=excluded.tier,nationality=excluded.nationality,primary_colour=excluded.primary_colour,accent_colour=excluded.accent_colour,image_url=excluded.image_url,thumbnail_url=excluded.thumbnail_url,website_url=excluded.website_url,liquipedia_url=excluded.liquipedia_url,twitter_url=excluded.twitter_url,youtube_url=excluded.youtube_url,facebook_url=excluded.facebook_url,faceit_id=excluded.faceit_id,created_at=excluded.created_at,updated_at=excluded.updated_at,raw_json=excluded.raw_json,seen_at=excluded.seen_at""", (row["id"],row["name"],row.get("initials"),row.get("region"),row.get("tier"),row.get("nationality"),row.get("primaryColour"),row.get("accentColour"),image,thumb,None,row.get("websiteUrl"),row.get("liquipediaUrl"),row.get("twitterUrl"),row.get("youtubeUrl"),row.get("facebookUrl"),row.get("faceitId"),row.get("createdAt"),row.get("updatedAt"),compact(row),utcnow()))

    def upsert_match(self, row: dict[str, Any]) -> None:
        if not isinstance(row.get("id"), int) or not row.get("slug"): return
        match_id = row["id"]
        tournament = row.get("tournament")
        if isinstance(tournament, dict): self.upsert_tournament(tournament)
        region = row.get("region")
        if isinstance(region, dict): self.upsert_region(region)
        for key in ("team1","team2"):
            if isinstance(row.get(key), dict): self.upsert_team(row[key])
        tid, t1, t2 = relation_id(tournament), relation_id(row.get("team1")), relation_id(row.get("team2"))
        region_slug = (region.get("slug") or region.get("name")) if isinstance(region,dict) else region
        self.db.execute("""INSERT INTO matches(id,slug,start_date,complete,is_live,has_started,tournament_id,region_slug,team1_id,team2_id,team1_placeholder,team2_placeholder,team1_score,team2_score,source_url,raw_json,seen_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET slug=excluded.slug,start_date=excluded.start_date,complete=excluded.complete,is_live=excluded.is_live,has_started=excluded.has_started,tournament_id=excluded.tournament_id,region_slug=excluded.region_slug,team1_id=excluded.team1_id,team2_id=excluded.team2_id,team1_placeholder=excluded.team1_placeholder,team2_placeholder=excluded.team2_placeholder,team1_score=excluded.team1_score,team2_score=excluded.team2_score,source_url=excluded.source_url,raw_json=excluded.raw_json,seen_at=excluded.seen_at""", (match_id,row["slug"],row.get("startDate"),int(bool(row.get("complete"))),int(bool(row.get("isLive"))),int(bool(row.get("hasStarted"))),tid,region_slug,t1,t2,row.get("team1Placeholder"),row.get("team2Placeholder"),row.get("team1Score"),row.get("team2Score"),f"{BASE}/matches/{row['slug']}",compact(row),utcnow()))
        for team_id in (t1,t2):
            if tid and team_id: self.db.execute("INSERT INTO tournament_teams VALUES(?,?,?,?) ON CONFLICT(tournament_id,team_id) DO UPDATE SET last_seen=excluded.last_seen",(tid,team_id,row.get("startDate"),row.get("startDate")))

    def ingest_detail(self, match_id: int, html: str) -> dict[str,int]:
        roots = flight_objects(html)
        objects = [item for root in roots for item in walk(root) if isinstance(item,dict)]
        teams: dict[int,dict[str,Any]] = {}; players: dict[int,dict[str,Any]] = {}; maps: dict[int,dict[str,Any]] = {}; match_maps: dict[int,dict[str,Any]] = {}; stats: dict[int,dict[str,Any]] = {}
        for row in objects:
            rid = row.get("id")
            if not isinstance(rid,int): continue
            if "initials" in row and "primaryColour" in row and row.get("name"): teams[rid]=row
            elif "alias" in row and "job" in row: players[rid]=row
            elif "mapIndex" in row and "team1Score" in row and "team2Score" in row: match_maps[rid]=row
            elif "damageDealt" in row and "healingDone" in row and "matchMap" in row: stats[rid]=row
            elif "mode" in row and "name" in row and "gameId" in row: maps[rid]=row
        for row in teams.values(): self.upsert_team(row)
        for row in players.values():
            image, _ = image_info(row)
            self.db.execute("""INSERT INTO players(id,name,alias,job,role,region,nationality,image_url,local_image_path,facebook_url,twitter_url,website_url,youtube_url,liquipedia_url,faceit_id,game_id,created_at,updated_at,raw_json,seen_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,alias=excluded.alias,job=excluded.job,role=excluded.role,region=excluded.region,nationality=excluded.nationality,image_url=excluded.image_url,facebook_url=excluded.facebook_url,twitter_url=excluded.twitter_url,website_url=excluded.website_url,youtube_url=excluded.youtube_url,liquipedia_url=excluded.liquipedia_url,faceit_id=excluded.faceit_id,game_id=excluded.game_id,updated_at=excluded.updated_at,raw_json=excluded.raw_json,seen_at=excluded.seen_at""",(row["id"],row.get("name"),row.get("alias"),row.get("job"),row.get("playerRole"),row.get("region"),row.get("nationality"),image,None,row.get("facebookUrl"),row.get("twitterUrl"),row.get("websiteUrl"),row.get("youtubeUrl"),row.get("liquipediaUrl"),row.get("faceitId"),row.get("gameId"),row.get("createdAt"),row.get("updatedAt"),compact(row),utcnow()))
            for team_id in row.get("cachedTeam") or []:
                if isinstance(team_id,int): self.db.execute("INSERT INTO player_teams VALUES(?,?,?,?,?) ON CONFLICT(player_id,team_id,source) DO UPDATE SET last_seen=excluded.last_seen",(row["id"],team_id,"cachedTeam",row.get("createdAt"),utcnow()))
        for row in maps.values():
            image,_=image_info(row); self.db.execute("INSERT INTO map_catalog(id,name,mode,image_url,local_image_path,raw_json) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,mode=excluded.mode,image_url=excluded.image_url,raw_json=excluded.raw_json",(row["id"],row.get("name"),row.get("mode"),image,None,compact(row)))
        for row in match_maps.values():
            map_id=relation_id(row.get("map")); self.db.execute("""INSERT INTO match_maps(id,match_id,map_id,slug,map_index,team1_score,team2_score,result_type,complete,map_picker,map_picker_type,team1_ban,team2_ban,ban_order_choice,first_ban,one_vs_one_winner,replay_code,raw_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET match_id=excluded.match_id,map_id=excluded.map_id,team1_score=excluded.team1_score,team2_score=excluded.team2_score,result_type=excluded.result_type,complete=excluded.complete,replay_code=excluded.replay_code,raw_json=excluded.raw_json""",(row["id"],match_id,map_id,row.get("slug"),row.get("mapIndex"),row.get("team1Score"),row.get("team2Score"),row.get("resultType"),int(bool(row.get("complete"))),relation_id(row.get("mapPicker")),row.get("mapPickerType"),relation_id(row.get("team1Ban")),relation_id(row.get("team2Ban")),relation_id(row.get("banOrderChoice")),relation_id(row.get("firstBan")),relation_id(row.get("oneVsOneWinner")),row.get("replayCode"),compact(row)))
        for row in stats.values():
            mm=relation_id(row.get("matchMap")); pid=relation_id(row.get("person")); team=relation_id(row.get("team"))
            if not mm or not pid: continue
            self.db.execute("""INSERT INTO player_map_stats(id,match_id,match_map_id,team_id,player_id,role,eliminations,assists,deaths,damage_dealt,healing_done,damage_mitigated,fantasy_score,objective_time,solo_kills,environmental_kills,multi_kills,final_blows,match_start_date,raw_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET eliminations=excluded.eliminations,assists=excluded.assists,deaths=excluded.deaths,damage_dealt=excluded.damage_dealt,healing_done=excluded.healing_done,damage_mitigated=excluded.damage_mitigated,fantasy_score=excluded.fantasy_score,raw_json=excluded.raw_json""",(row["id"],match_id,mm,team,pid,row.get("role"),row.get("eliminations"),row.get("assists"),row.get("deaths"),row.get("damageDealt"),row.get("healingDone"),row.get("damageMitigated"),row.get("cachedFantasyScore"),row.get("faceitObjectiveTime"),row.get("faceitSoloKills"),row.get("faceitEnvironmentalKills"),row.get("faceitMultiKills"),row.get("faceitFinalBlows"),row.get("matchStartDate"),compact(row)))
            if team: self.db.execute("INSERT INTO player_teams VALUES(?,?,?,?,?) ON CONFLICT(player_id,team_id,source) DO UPDATE SET last_seen=excluded.last_seen",(pid,team,"matchStats",row.get("matchStartDate"),row.get("matchStartDate")))
        sha=hashlib.sha256(html.encode()).hexdigest(); self.db.execute("UPDATE matches SET detail_fetched_at=?,detail_sha256=? WHERE id=?",(utcnow(),sha,match_id))
        return {"players":len(players),"maps":len(match_maps),"stats":len(stats)}


def media_extension(url: str, mime: str) -> str:
    suffix=Path(urlparse(url).path).suffix.lower()
    if suffix and len(suffix)<=6: return suffix
    return mimetypes.guess_extension(mime.split(";",1)[0]) or ".bin"


def download_media_job(row: tuple[str,int,str], root: Path) -> tuple[str,int,str,str,str,int,str,bytes] | None:
    kind, entity_id, url=row
    if not url: return None
    try:
        response=request("GET",url); mime=response.headers.get("content-type",""); data=response.content
        path=root/kind/f"{entity_id}{media_extension(url,mime)}"; path.parent.mkdir(parents=True,exist_ok=True); path.write_bytes(data)
        try:
            local_path = path.resolve().relative_to(ROOT.resolve())
        except ValueError:
            local_path = path.resolve()
        return kind,entity_id,url,str(local_path).replace("\\","/"),mime,len(data),hashlib.sha256(data).hexdigest(),data
    except Exception:
        return None


def export_catalog(db: sqlite3.Connection, output: Path) -> None:
    teams=[dict(zip(("id","name","initials","region","tier","nationality","imageUrl","localImagePath","websiteUrl","liquipediaUrl","twitterUrl","youtubeUrl","facebookUrl","updatedAt"),row)) for row in db.execute("SELECT id,name,initials,region,tier,nationality,image_url,local_image_path,website_url,liquipedia_url,twitter_url,youtube_url,facebook_url,updated_at FROM teams ORDER BY name COLLATE NOCASE")]
    player_rows=db.execute("""
        SELECT p.id,p.name,p.alias,p.job,p.role,p.region,p.nationality,p.image_url,
               p.local_image_path,p.website_url,p.liquipedia_url,p.twitter_url,p.youtube_url,
               p.updated_at,GROUP_CONCAT(DISTINCT t.name)
        FROM players p
        LEFT JOIN player_teams pt ON pt.player_id=p.id
        LEFT JOIN teams t ON t.id=pt.team_id
        GROUP BY p.id
        ORDER BY p.id
    """)
    players=[]
    for row in player_rows:
        item=dict(zip(("id","name","alias","job","role","region","nationality","imageUrl","localImagePath","websiteUrl","liquipediaUrl","twitterUrl","youtubeUrl","updatedAt","teamNames"),row))
        item["teamNames"]=[name for name in (item["teamNames"] or "").split(",") if name]
        players.append(item)
    tournaments=[dict(zip(("id","slug","name","tier","startDate","endDate","format","location","countryCode","imageUrl","localImagePath","sourceUrl"),row)) for row in db.execute("SELECT id,slug,name,tier,start_date,end_date,format,location,country_code,image_url,local_image_path,source_url FROM tournaments ORDER BY COALESCE(start_date,'') DESC,id DESC")]
    counts={table:db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] for table in ("tournaments","matches","teams","players","match_maps","player_map_stats")}
    payload={"generatedAt":utcnow(),"source":"OWTV local SQLite archive","counts":counts,"teamCount":len(teams),"playerCount":len(players),"tournamentCount":len(tournaments),"teams":teams,"players":players,"tournaments":tournaments}
    output.write_text(json.dumps(payload,ensure_ascii=False,separators=(",",":")),encoding="utf-8")


def main() -> None:
    parser=argparse.ArgumentParser(description="Collect OWTV into an incremental local SQLite database")
    parser.add_argument("--database",type=Path,default=DEFAULT_DB); parser.add_argument("--workers",type=int,default=10)
    parser.add_argument("--details",choices=("new","all","none"),default="new"); parser.add_argument("--download-media",action="store_true")
    parser.add_argument("--skip-index",action="store_true",help="reuse the existing database index")
    parser.add_argument("--limit-matches",type=int,default=0); args=parser.parse_args()
    store=Store(args.database); started=utcnow(); run_id=store.db.execute("INSERT INTO sync_runs(started_at,status) VALUES(?,?)",(started,"running")).lastrowid; store.db.commit()
    try:
        tournament_rows=[]; unique_matches={}
        if not args.skip_index:
            for variant in ("primary","secondary"):
                result=action(TOURNAMENT_ACTION,[1,1000,None,variant],f"{BASE}/tournaments")
                tournament_rows.extend(result.get("rows") or [])
            for row in tournament_rows:
                if isinstance(row,dict): store.upsert_tournament(row)
            match_rows=[]
            for action_id in (RECENT_ACTION,UPCOMING_ACTION):
                result=action(action_id,[1,2000,None],f"{BASE}/matches")
                match_rows.extend(result.get("rows") or [])
            unique_matches={row["id"]:row for row in match_rows if isinstance(row,dict) and isinstance(row.get("id"),int)}
            for row in unique_matches.values(): store.upsert_match(row)
        store.db.commit()
        query="SELECT id,slug FROM matches WHERE complete=1"
        if args.details=="new": query+=" AND detail_fetched_at IS NULL"
        if args.details=="none": detail_jobs=[]
        else: detail_jobs=list(store.db.execute(query+" ORDER BY start_date"))
        if args.limit_matches: detail_jobs=detail_jobs[:args.limit_matches]
        print(f"OWTV index: tournaments={len(tournament_rows)} matches={len(unique_matches)} detail_jobs={len(detail_jobs)}",flush=True)
        failures=[]; completed=0
        def fetch_detail(job: tuple[int,str]):
            mid,slug=job
            try: return mid,slug,request("GET",f"{BASE}/matches/{slug}").text,None
            except Exception as exc: return mid,slug,"",str(exc)
        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1,args.workers)) as pool:
            for mid,slug,html,error in pool.map(fetch_detail,detail_jobs):
                if error: failures.append({"id":mid,"slug":slug,"error":error})
                else:
                    try:
                        store.ingest_detail(mid,html)
                    except Exception as exc:
                        failures.append({"id":mid,"slug":slug,"error":f"ingest: {exc}"})
                completed+=1
                if completed%25==0 or completed==len(detail_jobs): store.db.commit(); print(f"details {completed}/{len(detail_jobs)} failures={len(failures)}",flush=True)
        if args.download_media:
            jobs=[]
            for kind,table in (("team","teams"),("player","players"),("tournament","tournaments"),("map","map_catalog")):
                jobs += [(kind,row[0],row[1]) for row in store.db.execute(f"SELECT id,image_url FROM {table} WHERE image_url IS NOT NULL AND image_url<>''")]
            root=args.database.resolve().parent/"media"; done=0
            with concurrent.futures.ThreadPoolExecutor(max_workers=max(1,args.workers)) as pool:
                for result in pool.map(lambda job: download_media_job(job,root),jobs):
                    if not result: continue
                    kind,eid,url,path,mime,size,sha,content=result
                    store.db.execute("INSERT INTO media_assets(entity_type,entity_id,source_url,local_path,mime_type,bytes,sha256,fetched_at,content) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(entity_type,entity_id,source_url) DO UPDATE SET local_path=excluded.local_path,mime_type=excluded.mime_type,bytes=excluded.bytes,sha256=excluded.sha256,fetched_at=excluded.fetched_at,content=excluded.content",(kind,eid,url,path,mime,size,sha,utcnow(),content))
                    table={"team":"teams","player":"players","tournament":"tournaments","map":"map_catalog"}[kind]; store.db.execute(f"UPDATE {table} SET local_image_path=? WHERE id=?",(path,eid)); done+=1
            store.db.commit(); print(f"media {done}/{len(jobs)}",flush=True)
        counts={table:store.db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] for table in ("tournaments","teams","matches","players","match_maps","player_map_stats","media_assets")}
        counts["detail_failures"]=len(failures)
        store.db.execute("INSERT INTO metadata VALUES('source_url',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(BASE,)); store.db.execute("INSERT INTO metadata VALUES('updated_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(utcnow(),)); store.db.execute("UPDATE sync_runs SET finished_at=?,status=?,counts_json=?,error=? WHERE id=?",(utcnow(),"complete" if not failures else "partial",compact(counts),compact(failures) if failures else None,run_id))
        export_catalog(store.db,ROOT/"src"/"owtvTeamCatalog.json"); store.db.commit(); print(compact(counts),flush=True)
    except Exception as exc:
        store.db.execute("UPDATE sync_runs SET finished_at=?,status='failed',error=? WHERE id=?",(utcnow(),str(exc),run_id)); store.db.commit(); raise
    finally: store.close()


if __name__=="__main__": main()
