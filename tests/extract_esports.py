from pathlib import Path
import json

s = Path("tests/esports-schedule.html").read_text(encoding="utf-8")
marker = '\\"airtableMatches\\":'
i = s.index(marker) + len(marker)
start = s.index("[", i)
depth = 0
end = None
for j in range(start, len(s)):
    char = s[j]
    if char == "[":
        depth += 1
    elif char == "]":
        depth -= 1
        if depth == 0:
            end = j
            break

assert end is not None
escaped = s[start : end + 1]
decoded = json.loads('"' + escaped + '"')
groups = json.loads(decoded)
print("groups", len(groups), "matches", sum(len(group["matches"]) for group in groups))
print("end", repr(s[end + 1 : end + 120]))
print(json.dumps(groups[0]["matches"][0], ensure_ascii=False, indent=2)[:3000])

keys = {}
statuses = {}
regions = {}
for group in groups:
    for match in group["matches"]:
        fields = match["fields"]
        statuses[fields.get("matchStatus")] = statuses.get(fields.get("matchStatus"), 0) + 1
        regions[str(fields.get("region"))] = regions.get(str(fields.get("region")), 0) + 1
        for key in fields:
            keys[key] = keys.get(key, 0) + 1
print("statuses", statuses)
print("regions", regions)
print("keys", keys)

normalized = []
seen = set()
def first(value, fallback=""):
    if isinstance(value, list):
        return str(value[0]) if value else fallback
    return str(value) if value is not None else fallback

for group in groups:
    for match in group["matches"]:
        fields = match["fields"]
        match_id = str(fields.get("matchId") or match.get("id"))
        if match_id in seen:
            continue
        seen.add(match_id)
        normalized.append({
            "id": match_id,
            "datetime": str(fields.get("datetime", "")),
            "status": str(fields.get("matchStatus", "upcoming")),
            "team1": first(fields.get("team1Name"), "待定"),
            "team2": first(fields.get("team2Name"), "待定"),
            "team1Id": first(fields.get("team1Id")),
            "team2Id": first(fields.get("team2Id")),
            "team1Logo": first(fields.get("team1LogoDark") or fields.get("team1LogoLight")),
            "team2Logo": first(fields.get("team2LogoDark") or fields.get("team2LogoLight")),
            "score1": fields.get("Team 1 Score"),
            "score2": fields.get("Team 2 Score"),
            "event": str(fields.get("event", "OWCS")),
            "region": str(fields.get("region") or "global"),
            "phase": str(fields.get("Phase Name") or ""),
            "stage": str(fields.get("Stage Name") or ""),
            "youtube": str(fields.get("YouTube Stream Link") or ""),
            "twitch": str(fields.get("Twitch Stream Link") or ""),
        })
normalized.sort(key=lambda item: item["datetime"])
Path("src/esportsSnapshot.json").write_text(json.dumps(normalized, ensure_ascii=False, indent=2), encoding="utf-8")
print("wrote", len(normalized), "matches")
