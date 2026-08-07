use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, USER_AGENT};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::time::Duration;
use tauri::Manager;

mod history;

fn first_text(value: Option<&Value>, fallback: &str) -> String {
    match value {
        Some(Value::Array(values)) => values
            .first()
            .and_then(Value::as_str)
            .unwrap_or(fallback)
            .to_string(),
        Some(Value::String(value)) => value.clone(),
        _ => fallback.to_string(),
    }
}

fn owtv_hero_name(id: Option<i64>) -> Option<&'static str> {
    match id? {
        1 => Some("Ana"), 2 => Some("Anran"), 3 => Some("Ashe"), 4 => Some("Baptiste"),
        5 => Some("Bastion"), 6 => Some("Brigitte"), 7 => Some("Cassidy"), 8 => Some("D.Va"),
        9 => Some("Domina"), 10 => Some("Doomfist"), 11 => Some("Echo"), 12 => Some("Emre"),
        13 => Some("Freja"), 14 => Some("Genji"), 15 => Some("Hanzo"), 16 => Some("Hazard"),
        17 => Some("Illari"), 18 => Some("Jetpack Cat"), 19 => Some("Junker Queen"), 20 => Some("Junkrat"),
        21 => Some("Juno"), 22 => Some("Kiriko"), 23 => Some("Lifeweaver"), 24 => Some("Lucio"),
        25 => Some("Mauga"), 26 => Some("Mei"), 27 => Some("Mercy"), 28 => Some("Mizuki"),
        29 => Some("Moira"), 30 => Some("Orisa"), 31 => Some("Pharah"), 32 => Some("Ramattra"),
        33 => Some("Reaper"), 34 => Some("Reinhardt"), 35 => Some("Roadhog"), 36 => Some("Sierra"),
        37 => Some("Sigma"), 38 => Some("Sojourn"), 39 => Some("Soldier: 76"), 40 => Some("Sombra"),
        41 => Some("Symmetra"), 42 => Some("Torbjorn"), 43 => Some("Tracer"), 44 => Some("Vendetta"),
        45 => Some("Venture"), 46 => Some("Widowmaker"), 47 => Some("Winston"), 48 => Some("Wrecking Ball"),
        49 => Some("Wuyang"), 50 => Some("Zarya"), 51 => Some("Zenyatta"), 52 => Some("Shion"),
        _ => None,
    }
}

#[tauri::command]
fn fetch_owtv_match_index(app: tauri::AppHandle) -> Result<Value, String> {
    let database = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位本地 OWTV 数据库：{error}"))?
        .join("owtv.sqlite3");
    let connection = Connection::open(&database)
        .map_err(|error| format!("无法读取本地 OWTV 数据库：{error}"))?;

    let mut statement = connection.prepare(r#"
        SELECT m.id, m.slug, COALESCE(m.start_date, ''), m.complete, m.is_live, m.has_started,
               COALESCE(t1.id, 0), COALESCE(t1.name, m.team1_placeholder, '待定'), COALESCE(t1.image_url, t1.thumbnail_url, ''),
               COALESCE(t2.id, 0), COALESCE(t2.name, m.team2_placeholder, '待定'), COALESCE(t2.image_url, t2.thumbnail_url, ''),
               CAST(m.team1_score AS INTEGER), CAST(m.team2_score AS INTEGER),
               COALESCE(tr.name, 'OWTV 职业比赛'), COALESCE(tr.slug, ''), COALESCE(m.region_slug, ''), m.source_url,
               (SELECT COUNT(*) FROM match_maps mm WHERE mm.match_id = m.id),
               (SELECT COUNT(*) FROM player_map_stats pms WHERE pms.match_id = m.id)
        FROM matches m
        LEFT JOIN tournaments tr ON tr.id = m.tournament_id
        LEFT JOIN teams t1 ON t1.id = m.team1_id
        LEFT JOIN teams t2 ON t2.id = m.team2_id
        WHERE COALESCE(m.start_date, '') <> ''
        ORDER BY m.start_date DESC, m.id DESC
    "#).map_err(|error| format!("读取本地比赛索引失败：{error}"))?;

    let rows = statement.query_map([], |row| {
        let complete = row.get::<_, i64>(3)? != 0;
        let live = row.get::<_, i64>(4)? != 0;
        let started = row.get::<_, i64>(5)? != 0;
        let status = if live { "live" } else if complete || started { "completed" } else { "upcoming" };
        let match_id = row.get::<_, i64>(0)?;
        let tournament_name = row.get::<_, String>(14)?;
        let tournament_slug = row.get::<_, String>(15)?;
        let map_count = row.get::<_, i64>(18)?;
        let stat_count = row.get::<_, i64>(19)?;
        Ok(json!({
            "id": format!("owtv:{match_id}"),
            "datetime": row.get::<_, String>(2)?,
            "status": status,
            "team1": row.get::<_, String>(7)?,
            "team2": row.get::<_, String>(10)?,
            "team1Id": format!("owtv-team:{}", row.get::<_, i64>(6)?),
            "team2Id": format!("owtv-team:{}", row.get::<_, i64>(9)?),
            "team1Logo": row.get::<_, String>(8)?,
            "team2Logo": row.get::<_, String>(11)?,
            "score1": row.get::<_, Option<i64>>(12)?,
            "score2": row.get::<_, Option<i64>>(13)?,
            "event": tournament_name,
            "region": row.get::<_, String>(16)?,
            "phase": if stat_count > 0 { "含选手数据" } else if map_count > 0 { "仅地图与赛果" } else { "仅赛果" },
            "stage": "OWTV 历史档案",
            "youtube": "",
            "twitch": "",
            "owtv": row.get::<_, String>(17)?,
            "sources": ["OWTV 本地数据库"],
            "tournamentId": tournament_slug,
            "owtvMatchId": match_id,
            "mapRecordCount": map_count,
            "playerStatCount": stat_count
        }))
    }).map_err(|error| format!("读取本地比赛索引失败：{error}"))?;
    let matches = rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("读取本地比赛索引失败：{error}"))?;

    Ok(json!({
        "source": "OWTV 本地历史数据库",
        "syncedAt": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
        "matches": matches
    }))
}

#[tauri::command]
fn fetch_owtv_match_detail(
    app: tauri::AppHandle,
    match_id: Option<i64>,
    slug: Option<String>,
) -> Result<Value, String> {
    let database = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位本地 OWTV 数据库：{error}"))?
        .join("owtv.sqlite3");
    let connection = Connection::open(&database)
        .map_err(|error| format!("无法读取本地 OWTV 数据库：{error}"))?;

    let select_match = r#"
        SELECT m.id, m.slug, m.start_date, m.complete, m.is_live,
               COALESCE(tr.name, ''), COALESCE(m.region_slug, ''),
               COALESCE(t1.id, 0), COALESCE(t1.name, m.team1_placeholder, ''), COALESCE(t1.image_url, ''),
               COALESCE(t2.id, 0), COALESCE(t2.name, m.team2_placeholder, ''), COALESCE(t2.image_url, ''),
               CAST(m.team1_score AS INTEGER), CAST(m.team2_score AS INTEGER), m.source_url
        FROM matches m
        LEFT JOIN tournaments tr ON tr.id = m.tournament_id
        LEFT JOIN teams t1 ON t1.id = m.team1_id
        LEFT JOIN teams t2 ON t2.id = m.team2_id
        WHERE "#;
    let read_match = |row: &rusqlite::Row<'_>| -> rusqlite::Result<Value> {
        Ok(json!({
            "id": row.get::<_, i64>(0)?, "slug": row.get::<_, String>(1)?,
            "startDate": row.get::<_, Option<String>>(2)?, "complete": row.get::<_, i64>(3)? != 0,
            "live": row.get::<_, i64>(4)? != 0, "tournament": row.get::<_, String>(5)?,
            "region": row.get::<_, String>(6)?,
            "team1": { "id": row.get::<_, i64>(7)?, "name": row.get::<_, String>(8)?, "logo": row.get::<_, String>(9)? },
            "team2": { "id": row.get::<_, i64>(10)?, "name": row.get::<_, String>(11)?, "logo": row.get::<_, String>(12)? },
            "score1": row.get::<_, Option<i64>>(13)?, "score2": row.get::<_, Option<i64>>(14)?,
            "sourceUrl": row.get::<_, String>(15)?,
        }))
    };
    let match_value = if let Some(id) = match_id {
        connection.query_row(&format!("{select_match} m.id = ?1"), params![id], read_match).optional()
    } else if let Some(value) = slug.filter(|value| !value.trim().is_empty()) {
        connection.query_row(&format!("{select_match} m.slug = ?1"), params![value], read_match).optional()
    } else {
        return Err("该比赛没有 OWTV 本地编号".to_string());
    }
    .map_err(|error| format!("读取比赛失败：{error}"))?
    .ok_or_else(|| "本地 OWTV 数据库中没有这场比赛".to_string())?;
    let resolved_match_id = match_value["id"].as_i64().unwrap_or_default();

    let mut map_statement = connection.prepare(r#"
        SELECT mm.id, mm.map_index, COALESCE(mc.name, 'TBD'), COALESCE(mc.mode, ''),
               CAST(mm.team1_score AS INTEGER), CAST(mm.team2_score AS INTEGER), mm.complete, mm.team1_ban, mm.team2_ban,
               mm.map_picker, mm.map_picker_type, COALESCE(mm.replay_code, '')
        FROM match_maps mm LEFT JOIN map_catalog mc ON mc.id = mm.map_id
        WHERE mm.match_id = ?1 ORDER BY mm.map_index
    "#).map_err(|error| format!("读取地图失败：{error}"))?;
    let map_rows = map_statement.query_map(params![resolved_match_id], |row| {
        let team1_ban = row.get::<_, Option<i64>>(7)?;
        let team2_ban = row.get::<_, Option<i64>>(8)?;
        Ok(json!({
            "id": row.get::<_, i64>(0)?, "index": row.get::<_, i64>(1)?,
            "name": row.get::<_, String>(2)?, "mode": row.get::<_, String>(3)?,
            "score1": row.get::<_, Option<i64>>(4)?, "score2": row.get::<_, Option<i64>>(5)?,
            "complete": row.get::<_, i64>(6)? != 0,
            "team1Ban": team1_ban.map(|id| json!({ "id": id, "name": owtv_hero_name(Some(id)).unwrap_or("Unknown") })),
            "team2Ban": team2_ban.map(|id| json!({ "id": id, "name": owtv_hero_name(Some(id)).unwrap_or("Unknown") })),
            "pickerTeamId": row.get::<_, Option<i64>>(9)?, "pickerType": row.get::<_, Option<String>>(10)?,
            "replayCode": row.get::<_, String>(11)?,
        }))
    }).map_err(|error| format!("读取地图失败：{error}"))?;
    let maps = map_rows.collect::<Result<Vec<_>, _>>().map_err(|error| format!("读取地图失败：{error}"))?;

    let mut stat_statement = connection.prepare(r#"
        SELECT pms.match_map_id, pms.team_id, pms.player_id, COALESCE(p.name, p.alias, 'Unknown'),
               COALESCE(p.role, pms.role, ''), COALESCE(p.image_url, ''),
               pms.eliminations, pms.assists, pms.deaths, pms.damage_dealt,
               pms.healing_done, pms.damage_mitigated, pms.fantasy_score,
               pms.objective_time, pms.final_blows
        FROM player_map_stats pms LEFT JOIN players p ON p.id = pms.player_id
        WHERE pms.match_id = ?1 ORDER BY pms.match_map_id, pms.team_id, p.name
    "#).map_err(|error| format!("读取选手数据失败：{error}"))?;
    let stat_rows = stat_statement.query_map(params![resolved_match_id], |row| Ok(json!({
        "matchMapId": row.get::<_, i64>(0)?, "teamId": row.get::<_, Option<i64>>(1)?,
        "playerId": row.get::<_, i64>(2)?, "name": row.get::<_, String>(3)?,
        "role": row.get::<_, String>(4)?, "image": row.get::<_, String>(5)?,
        "eliminations": row.get::<_, Option<f64>>(6)?, "assists": row.get::<_, Option<f64>>(7)?,
        "deaths": row.get::<_, Option<f64>>(8)?, "damage": row.get::<_, Option<f64>>(9)?,
        "healing": row.get::<_, Option<f64>>(10)?, "mitigation": row.get::<_, Option<f64>>(11)?,
        "fantasy": row.get::<_, Option<f64>>(12)?, "objectiveTime": row.get::<_, Option<f64>>(13)?,
        "finalBlows": row.get::<_, Option<f64>>(14)?,
    }))).map_err(|error| format!("读取选手数据失败：{error}"))?;
    let stats = stat_rows.collect::<Result<Vec<_>, _>>().map_err(|error| format!("读取选手数据失败：{error}"))?;

    Ok(json!({ "match": match_value, "maps": maps, "stats": stats, "source": "OWTV 本地数据库" }))
}

fn extract_airtable_matches(html: &str) -> Result<Vec<Value>, String> {
    let marker = "\\\"airtableMatches\\\":";
    let marker_index = html
        .find(marker)
        .ok_or_else(|| "Official schedule payload was not found".to_string())?;
    let start = html[marker_index + marker.len()..]
        .find('[')
        .map(|index| marker_index + marker.len() + index)
        .ok_or_else(|| "Official schedule payload was incomplete".to_string())?;

    let mut depth = 0_i32;
    let mut end = None;
    for (offset, character) in html[start..].char_indices() {
        match character {
            '[' => depth += 1,
            ']' => {
                depth -= 1;
                if depth == 0 {
                    end = Some(start + offset);
                    break;
                }
            }
            _ => {}
        }
    }
    let end = end.ok_or_else(|| "Official schedule payload was incomplete".to_string())?;
    let escaped = &html[start..=end];
    let decoded: String = serde_json::from_str(&format!("\"{escaped}\""))
        .map_err(|error| format!("Official schedule text could not be decoded: {error}"))?;
    let groups: Value = serde_json::from_str(&decoded)
        .map_err(|error| format!("Official schedule JSON was invalid: {error}"))?;

    let mut seen = HashSet::new();
    let mut matches = Vec::new();
    for group in groups.as_array().into_iter().flatten() {
        for item in group
            .get("matches")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let fields = match item.get("fields").and_then(Value::as_object) {
                Some(fields) => fields,
                None => continue,
            };
            let id = fields
                .get("matchId")
                .and_then(Value::as_str)
                .or_else(|| item.get("id").and_then(Value::as_str))
                .unwrap_or_default()
                .to_string();
            if id.is_empty() || !seen.insert(id.clone()) {
                continue;
            }

            matches.push(json!({
                "id": id,
                "datetime": fields.get("datetime").and_then(Value::as_str).unwrap_or_default(),
                "status": fields.get("matchStatus").and_then(Value::as_str).unwrap_or("upcoming"),
                "team1": first_text(fields.get("team1Name"), "待定"),
                "team2": first_text(fields.get("team2Name"), "待定"),
                "team1Id": first_text(fields.get("team1Id"), ""),
                "team2Id": first_text(fields.get("team2Id"), ""),
                "team1Logo": first_text(fields.get("team1LogoDark").or_else(|| fields.get("team1LogoLight")), ""),
                "team2Logo": first_text(fields.get("team2LogoDark").or_else(|| fields.get("team2LogoLight")), ""),
                "score1": fields.get("Team 1 Score").cloned().unwrap_or(Value::Null),
                "score2": fields.get("Team 2 Score").cloned().unwrap_or(Value::Null),
                "event": fields.get("event").and_then(Value::as_str).unwrap_or("OWCS"),
                "region": fields.get("region").and_then(Value::as_str).unwrap_or("global"),
                "phase": fields.get("Phase Name").and_then(Value::as_str).unwrap_or_default(),
                "stage": fields.get("Stage Name").and_then(Value::as_str).unwrap_or_default(),
                "youtube": fields.get("YouTube Stream Link").and_then(Value::as_str).unwrap_or_default(),
                "twitch": fields.get("Twitch Stream Link").and_then(Value::as_str).unwrap_or_default(),
            }));
        }
    }
    matches.sort_by(|a, b| {
        a.get("datetime")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .cmp(
                b.get("datetime")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
            )
    });
    if matches.is_empty() {
        return Err("Official schedule did not contain any matches".to_string());
    }
    Ok(matches)
}

fn visit_json<'a>(value: &'a Value, visitor: &mut impl FnMut(&'a Value)) {
    visitor(value);
    match value {
        Value::Array(values) => values.iter().for_each(|value| visit_json(value, visitor)),
        Value::Object(values) => values.values().for_each(|value| visit_json(value, visitor)),
        _ => {}
    }
}

fn extract_next_f_values(html: &str) -> Vec<Value> {
    let marker = "self.__next_f.push(";
    let mut cursor = 0;
    let mut values = Vec::new();
    while let Some(relative) = html[cursor..].find(marker) {
        let start = cursor + relative + marker.len();
        let Some(relative_end) = html[start..].find(")</script>") else {
            break;
        };
        let end = start + relative_end;
        if let Ok(flight) = serde_json::from_str::<Value>(&html[start..end]) {
            if let Some(text) = flight.get(1).and_then(Value::as_str) {
                for line in text.lines() {
                    let Some((_, json_text)) = line.split_once(':') else {
                        continue;
                    };
                    if let Ok(value) = serde_json::from_str::<Value>(json_text) {
                        values.push(value);
                    }
                }
            }
        }
        cursor = end + ")</script>".len();
    }
    values
}

fn team_from_value(value: Option<&Value>, teams: &HashMap<i64, Value>) -> Value {
    match value {
        Some(Value::Object(_)) => value.cloned().unwrap_or(Value::Null),
        Some(Value::Number(number)) => number
            .as_i64()
            .and_then(|id| teams.get(&id).cloned())
            .unwrap_or(Value::Null),
        _ => Value::Null,
    }
}

fn extract_owtv_matches(html: &str, tournament_id: &str, event: &str, region: &str) -> Vec<Value> {
    let roots = extract_next_f_values(html);
    let mut teams: HashMap<i64, Value> = HashMap::new();
    for root in &roots {
        visit_json(root, &mut |value| {
            let Some(object) = value.as_object() else {
                return;
            };
            if object.get("initials").is_some()
                && object.get("name").and_then(Value::as_str).is_some()
            {
                if let Some(id) = object.get("id").and_then(Value::as_i64) {
                    teams.insert(id, value.clone());
                }
            }
        });
    }

    let mut found: HashMap<String, Value> = HashMap::new();
    for root in &roots {
        visit_json(root, &mut |value| {
            let Some(object) = value.as_object() else {
                return;
            };
            let Some(slug) = object.get("slug").and_then(Value::as_str) else {
                return;
            };
            if !slug.starts_with(tournament_id)
                || !["team1", "team2", "team1Score", "team2Score", "startDate"]
                    .iter()
                    .all(|key| object.contains_key(*key))
            {
                return;
            }
            let team1 = team_from_value(object.get("team1"), &teams);
            let team2 = team_from_value(object.get("team2"), &teams);
            let team_name = |team: &Value, fallback: Option<&Value>| {
                team.get("name")
                    .and_then(Value::as_str)
                    .or_else(|| fallback.and_then(Value::as_str))
                    .unwrap_or("TBD")
                    .to_string()
            };
            let team_logo = |team: &Value| {
                team.get("image")
                    .and_then(|image| image.get("url"))
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string()
            };
            let phase = object.get("tournamentPhase").and_then(Value::as_object);
            let complete = object
                .get("complete")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            found.insert(slug.to_string(), json!({
                "id": format!("owtv:{slug}"),
                "datetime": object.get("startDate").and_then(Value::as_str).unwrap_or_default(),
                "status": if complete { "completed" } else { "upcoming" },
                "team1": team_name(&team1, object.get("team1Placeholder")),
                "team2": team_name(&team2, object.get("team2Placeholder")),
                "team1Id": format!("owtv-team:{}", team1.get("id").and_then(Value::as_i64).unwrap_or_default()),
                "team2Id": format!("owtv-team:{}", team2.get("id").and_then(Value::as_i64).unwrap_or_default()),
                "team1Logo": team_logo(&team1),
                "team2Logo": team_logo(&team2),
                "score1": object.get("team1Score").cloned().unwrap_or(Value::Null),
                "score2": object.get("team2Score").cloned().unwrap_or(Value::Null),
                "event": event,
                "region": region,
                "phase": phase.and_then(|value| value.get("title")).and_then(Value::as_str).unwrap_or_default(),
                "stage": phase.and_then(|value| value.get("name")).and_then(Value::as_str).unwrap_or_default(),
                "youtube": "",
                "twitch": "",
                "owtv": format!("https://owtv.gg/matches/{slug}"),
                "sources": ["OWTV"],
                "tournamentId": tournament_id,
            }));
        });
    }
    found.into_values().collect()
}

async fn fetch_owtv_tournament(
    client: &reqwest::Client,
    tournament_id: &str,
    event: &str,
    region: &str,
) -> Result<Vec<Value>, String> {
    let url = format!("https://owtv.gg/tournaments/{tournament_id}");
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|error| format!("OWTV request failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "OWTV request failed (HTTP {})",
            response.status().as_u16()
        ));
    }
    let html = response
        .text()
        .await
        .map_err(|error| format!("OWTV response was invalid: {error}"))?;
    Ok(extract_owtv_matches(&html, tournament_id, event, region))
}

fn extract_owtv_player_match(
    html: &str,
    player_name: &str,
    metadata: &Value,
) -> Option<(Value, Value)> {
    let roots = extract_next_f_values(html);
    let wanted = player_name.trim().to_lowercase();
    let mut seen = HashSet::new();
    let mut maps = Vec::new();
    let mut profile = Value::Null;
    for root in &roots {
        visit_json(root, &mut |value| {
            let Some(object) = value.as_object() else {
                return;
            };
            if ![
                "eliminations",
                "assists",
                "deaths",
                "damageDealt",
                "healingDone",
                "damageMitigated",
            ]
            .iter()
            .all(|key| object.contains_key(*key))
            {
                return;
            }
            let Some(person) = object.get("person").and_then(Value::as_object) else {
                return;
            };
            let alias = person
                .get("alias")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if alias.trim().to_lowercase() != wanted {
                return;
            }
            let stat_id = object
                .get("id")
                .map(Value::to_string)
                .unwrap_or_else(|| format!("{}:{}", alias, maps.len()));
            if seen.insert(stat_id) {
                maps.push(value.clone());
                if profile.is_null() {
                    profile = Value::Object(person.clone());
                }
            }
        });
    }
    if maps.is_empty() {
        return None;
    }
    let sum = |key: &str| {
        maps.iter()
            .filter_map(|row| row.get(key).and_then(Value::as_f64))
            .sum::<f64>()
    };
    Some((
        json!({
            "id": metadata.get("id").cloned().unwrap_or(Value::Null),
            "datetime": metadata.get("datetime").cloned().unwrap_or(Value::Null),
            "event": metadata.get("event").cloned().unwrap_or(Value::Null),
            "team1": metadata.get("team1").cloned().unwrap_or(Value::Null),
            "team2": metadata.get("team2").cloned().unwrap_or(Value::Null),
            "team1Logo": metadata.get("team1Logo").cloned().unwrap_or(Value::Null),
            "team2Logo": metadata.get("team2Logo").cloned().unwrap_or(Value::Null),
            "score1": metadata.get("score1").cloned().unwrap_or(Value::Null),
            "score2": metadata.get("score2").cloned().unwrap_or(Value::Null),
            "url": metadata.get("url").cloned().unwrap_or(Value::Null),
            "mapCount": maps.len(),
            "eliminations": sum("eliminations"),
            "assists": sum("assists"),
            "deaths": sum("deaths"),
            "damage": sum("damageDealt"),
            "healing": sum("healingDone"),
            "mitigation": sum("damageMitigated"),
            "fantasyScore": sum("cachedFantasyScore"),
        }),
        profile,
    ))
}

#[tauri::command]
async fn fetch_owtv_player_performance(
    app: tauri::AppHandle,
    player_name: String,
    matches: Vec<Value>,
) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(22))
        .user_agent("OWHeroUpdateHistory/0.10.0")
        .build()
        .map_err(|error| format!("Failed to initialize player statistics client: {error}"))?;

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to locate esports archive: {error}"))?;
    fs::create_dir_all(&data_dir)
        .map_err(|error| format!("Failed to create esports archive folder: {error}"))?;
    let archive_path = data_dir.join("esports-live-history.json");
    let mut archive: Value = fs::read_to_string(&archive_path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_else(|| json!({ "schemaVersion": 1, "updatedAt": 0, "players": {} }));
    if archive.get("players").and_then(Value::as_object).is_none() {
        archive["players"] = json!({});
    }
    let player_key: String = player_name
        .to_lowercase()
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect();
    let player_archive = archive["players"]
        .as_object_mut()
        .unwrap()
        .entry(player_key.clone())
        .or_insert_with(|| json!({ "displayName": player_name, "profile": null, "matches": {} }));
    if player_archive
        .get("matches")
        .and_then(Value::as_object)
        .is_none()
    {
        player_archive["matches"] = json!({});
    }
    let cached_ids: HashSet<String> = player_archive["matches"]
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect();

    let jobs = matches
        .into_iter()
        .filter(|metadata| {
            let id = metadata
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default();
            !cached_ids.contains(id)
        })
        .filter_map(|metadata| {
            let url = metadata.get("url").and_then(Value::as_str)?.to_string();
            if !url.starts_with("https://owtv.gg/matches/") {
                return None;
            }
            let client = client.clone();
            let player_name = player_name.clone();
            Some(async move {
                let response = client.get(&url).send().await.ok()?;
                if !response.status().is_success() {
                    return None;
                }
                let html = response.text().await.ok()?;
                extract_owtv_player_match(&html, &player_name, &metadata)
            })
        });
    let results = futures::future::join_all(jobs).await;
    let mut fresh_rows = Vec::new();
    let mut profile = Value::Null;
    for result in results.into_iter().flatten() {
        fresh_rows.push(result.0);
        if profile.is_null() {
            profile = result.1;
        }
    }
    let fetched_match_count = fresh_rows.len();
    let received_profile = !profile.is_null();
    let player_archive = archive["players"]
        .as_object_mut()
        .unwrap()
        .get_mut(&player_key)
        .unwrap();
    let cached_match_count = player_archive["matches"]
        .as_object()
        .map(|rows| rows.len())
        .unwrap_or_default();
    for row in fresh_rows {
        let id = row
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        if !id.is_empty() {
            player_archive["matches"]
                .as_object_mut()
                .unwrap()
                .insert(id, row);
        }
    }
    if !profile.is_null() {
        player_archive["profile"] = profile.clone();
    } else {
        profile = player_archive
            .get("profile")
            .cloned()
            .unwrap_or(Value::Null);
    }
    if fetched_match_count > 0 || received_profile {
        archive["updatedAt"] = json!(std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or_default());
        let serialized = serde_json::to_string_pretty(&archive)
            .map_err(|error| format!("Failed to serialize esports archive: {error}"))?;
        let temporary_path = archive_path.with_extension("json.tmp");
        fs::write(&temporary_path, serialized)
            .map_err(|error| format!("Failed to write esports archive: {error}"))?;
        if archive_path.exists() {
            fs::remove_file(&archive_path)
                .map_err(|error| format!("Failed to replace esports archive: {error}"))?;
        }
        fs::rename(&temporary_path, &archive_path)
            .map_err(|error| format!("Failed to finalize esports archive: {error}"))?;
    }

    let mut rows: Vec<Value> = archive["players"]
        .get(&player_key)
        .and_then(|value| value.get("matches"))
        .and_then(Value::as_object)
        .map(|values| values.values().cloned().collect())
        .unwrap_or_default();
    rows.sort_by(|a, b| {
        b.get("datetime")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .cmp(
                a.get("datetime")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
            )
    });
    let total = |key: &str| {
        rows.iter()
            .filter_map(|row| row.get(key).and_then(Value::as_f64))
            .sum::<f64>()
    };
    Ok(json!({
        "source": "OWTV 本地增量缓存",
        "player": player_name,
        "profile": profile,
        "archivePath": archive_path.to_string_lossy(),
        "cachedMatchCount": cached_match_count,
        "fetchedMatchCount": fetched_match_count,
        "matchCount": rows.len(),
        "mapCount": total("mapCount"),
        "totals": {
            "eliminations": total("eliminations"),
            "assists": total("assists"),
            "deaths": total("deaths"),
            "damage": total("damage"),
            "healing": total("healing"),
            "mitigation": total("mitigation"),
            "fantasyScore": total("fantasyScore"),
        },
        "matches": rows,
    }))
}

#[tauri::command]
async fn fetch_esports_schedule() -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .user_agent("OWHeroUpdateHistory/0.9.2")
        .build()
        .map_err(|error| format!("Failed to initialize network client: {error}"))?;
    let response = client
        .get("https://esports.overwatch.com/en-us/schedule")
        .send()
        .await
        .map_err(|error| format!("Official schedule request failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Official schedule request failed (HTTP {})",
            response.status().as_u16()
        ));
    }
    let html = response
        .text()
        .await
        .map_err(|error| format!("Official schedule response was invalid: {error}"))?;
    let mut matches = extract_airtable_matches(&html)?;
    const TOURNAMENTS: [(&str, &str, &str); 8] = [
        (
            "midseason-championship-owcs-2026",
            "2026 季中冠军赛",
            "global",
        ),
        (
            "china-stage-2-owcs-2026",
            "2026 OWCS S2 · 中国赛区",
            "china",
        ),
        (
            "korea-stage-2-owcs-2026",
            "2026 OWCS S2 · 韩国赛区",
            "korea",
        ),
        (
            "japan-stage-2-owcs-2026",
            "2026 OWCS S2 · 日本赛区",
            "japan",
        ),
        (
            "pacific-stage-2-owcs-2026",
            "2026 OWCS S2 · 太平洋赛区",
            "pacific",
        ),
        ("emea-stage-2-owcs-2026", "2026 OWCS S2 · EMEA", "emea"),
        ("na-stage-2-owcs-2026", "2026 OWCS S2 · 北美赛区", "na"),
        (
            "champions-clash-owcs-2026",
            "2026 Champions Clash",
            "global",
        ),
    ];
    let requests = TOURNAMENTS
        .into_iter()
        .map(|(tournament_id, event, region)| {
            fetch_owtv_tournament(&client, tournament_id, event, region)
        });
    for result in futures::future::join_all(requests).await {
        if let Ok(mut rows) = result {
            matches.append(&mut rows);
        }
    }
    Ok(json!({
        "source": "OW Esports 官方赛程",
        "syncedAt": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or_default(),
        "matches": matches,
    }))
}

fn parse_csv_rows(text: &str) -> Result<Vec<Value>, String> {
    let mut reader = csv::ReaderBuilder::new()
        .flexible(true)
        .from_reader(text.as_bytes());
    let headers = reader
        .headers()
        .map_err(|error| format!("CSV header was invalid: {error}"))?
        .clone();
    let mut rows = Vec::new();
    for record in reader.records() {
        let record = record.map_err(|error| format!("CSV row was invalid: {error}"))?;
        let mut row = serde_json::Map::new();
        for (header, value) in headers.iter().zip(record.iter()) {
            row.insert(
                header.trim_start_matches('\u{feff}').to_string(),
                Value::String(value.to_string()),
            );
        }
        rows.push(Value::Object(row));
    }
    Ok(rows)
}

async fn fetch_analytics_csv(
    client: reqwest::Client,
    key: &'static str,
    filename: &'static str,
) -> Result<(&'static str, Vec<Value>, String), String> {
    let url = format!("https://napori0929.github.io/owcs-stats/data/{filename}");
    let mut last_error = String::new();
    for _ in 0..4 {
        match client.get(&url).send().await {
            Ok(response) if response.status().is_success() => match response.bytes().await {
                Ok(bytes) => {
                    let version = analytics_source_version(&bytes);
                    let text = String::from_utf8_lossy(&bytes);
                    return Ok((key, parse_csv_rows(&text)?, version));
                }
                Err(error) => last_error = error.to_string(),
            },
            Ok(response) => last_error = format!("HTTP {}", response.status().as_u16()),
            Err(error) => last_error = error.to_string(),
        }
    }
    Err(format!("{filename} request failed: {last_error}"))
}

fn analytics_source_version(bytes: &[u8]) -> String {
    let mut hash = 14_695_981_039_346_656_037_u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(1_099_511_628_211);
    }
    format!("{hash:016x}")
}

#[tauri::command]
async fn probe_esports_analytics() -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(25))
        .user_agent("OWHeroUpdateHistory/0.10.16")
        .build()
        .map_err(|error| format!("Failed to initialize esports analytics probe: {error}"))?;
    let bytes = client
        .get("https://napori0929.github.io/owcs-stats/data/hero_usage_by_map_set.csv")
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .bytes()
        .await
        .map_err(|error| error.to_string())?;
    Ok(json!({ "sourceVersion": analytics_source_version(&bytes) }))
}

#[tauri::command]
async fn fetch_esports_analytics() -> Result<Value, String> {
    const FILES: [(&str, &str); 11] = [
        ("overallHeroUsage", "overall_hero_usage.csv"),
        ("teamHeroUsage", "hero_usage_by_team.csv"),
        ("playerHeroUsage", "hero_usage_by_player.csv"),
        ("tournamentHeroUsage", "hero_usage_by_tournament.csv"),
        ("mapHeroUsage", "hero_usage_by_map.csv"),
        ("playerHeroWinRates", "player_hero_win_rate.csv"),
        ("teamHeroWinRates", "team_hero_win_rate.csv"),
        ("matchHeroUsage", "hero_usage_by_match.csv"),
        ("mapSetHeroUsage", "hero_usage_by_map_set.csv"),
        ("rawMatches", "raw_matches.csv"),
        ("rawMapSetResults", "raw_map_set_results.csv"),
    ];
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(90))
        .user_agent("OWHeroUpdateHistory/0.10.16")
        .build()
        .map_err(|error| format!("Failed to initialize esports analytics client: {error}"))?;
    let mut payload = serde_json::Map::new();
    payload.insert(
        "source".into(),
        Value::String("OW Analytics / OWCS tournament scoresheets".into()),
    );
    payload.insert(
        "sourceUrl".into(),
        Value::String("https://napori0929.github.io/owcs-stats/".into()),
    );
    payload.insert(
        "generatedAt".into(),
        json!(std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or_default()),
    );
    for (key, filename) in FILES {
        let (key, rows, version) = fetch_analytics_csv(client.clone(), key, filename).await?;
        payload.insert(key.into(), Value::Array(rows));
        if key == "mapSetHeroUsage" {
            payload.insert("sourceVersion".into(), Value::String(version));
        }
    }
    Ok(Value::Object(payload))
}

#[tauri::command]
async fn fetch_player_intel(player_id: String) -> Result<Value, String> {
    let player_id = player_id.trim().replace('#', "-");
    if player_id.is_empty() || player_id.len() > 80 {
        return Err("Invalid BattleTag".to_string());
    }

    let encoded = urlencoding::encode(&player_id);
    let base_url = format!("https://overfast-api.tekrop.fr/players/{encoded}");
    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
    headers.insert(
        USER_AGENT,
        HeaderValue::from_static("OWHeroUpdateHistory/0.9.2"),
    );

    let client = reqwest::Client::builder()
        .default_headers(headers)
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("Failed to initialize network client: {error}"))?;

    let summary_response = client
        .get(format!("{base_url}/summary"))
        .send()
        .await
        .map_err(|error| format!("Player profile request failed: {error}"))?;

    if !summary_response.status().is_success() {
        return Err(format!(
            "Player lookup failed (HTTP {}). Check that the profile is public and the BattleTag is correct",
            summary_response.status().as_u16()
        ));
    }

    let summary: Value = summary_response
        .json()
        .await
        .map_err(|error| format!("Player profile request failed: {error}"))?;

    let stats = match client
        .get(format!(
            "{base_url}/stats/summary?gamemode=competitive&platform=pc"
        ))
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => {
            response.json::<Value>().await.unwrap_or_else(|_| json!({}))
        }
        _ => json!({}),
    };

    Ok(json!({ "summary": summary, "stats": stats }))
}

#[tauri::command]
async fn fetch_hero_roster() -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(20))
        .user_agent("OWHeroUpdateHistory/0.9.2")
        .build()
        .map_err(|error| format!("Failed to initialize network client: {error}"))?;

    let response = client
        .get("https://overfast-api.tekrop.fr/heroes?locale=en-us")
        .send()
        .await
        .map_err(|error| format!("Hero roster request failed: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Hero roster request failed (HTTP {})",
            response.status().as_u16()
        ));
    }

    response
        .json::<Value>()
        .await
        .map_err(|error| format!("Hero roster response was invalid: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            fs::create_dir_all(&data_dir)?;
            let career_archive = data_dir.join("esports-career-history.json");
            fs::write(
                &career_archive,
                include_bytes!("../../src/esportsHistorySnapshot.json"),
            )?;
            let archive_2025 = data_dir.join("esports-2025-history.json");
            fs::write(
                &archive_2025,
                include_bytes!("../../src/esports2025Snapshot.json"),
            )?;
            let bundled_live = data_dir.join("esports-live-snapshot.json");
            fs::write(
                &bundled_live,
                include_bytes!("../../src/esportsAnalyticsSnapshot.json"),
            )?;
            let owtv_database = data_dir.join("owtv.sqlite3");
            let bundled_owtv_database = include_bytes!("../../data/owtv/owtv.sqlite3");
            let installed_size = fs::metadata(&owtv_database).map(|item| item.len()).unwrap_or(0);
            if installed_size < bundled_owtv_database.len() as u64 {
                fs::write(&owtv_database, bundled_owtv_database)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fetch_player_intel,
            fetch_hero_roster,
            fetch_esports_schedule,
            fetch_esports_analytics,
            probe_esports_analytics,
            fetch_owtv_match_index,
            fetch_owtv_match_detail,
            fetch_owtv_player_performance,
            history::fetch_official_history
        ])
        .run(tauri::generate_context!())
        .expect("failed to run OW Hero Update History");
}

#[cfg(test)]
mod tests {
    use super::{extract_airtable_matches, fetch_esports_analytics, fetch_esports_schedule};

    #[test]
    fn parses_embedded_schedule_payload() {
        let html = r#"<script>1:{\"airtableMatches\":[{\"matches\":[{\"id\":\"m1\",\"fields\":{\"datetime\":\"2026-08-20T03:00:00Z\",\"matchStatus\":\"upcoming\",\"team1Name\":[\"Mexico\"],\"team2Name\":[\"Great Britain\"],\"event\":\"Group B\"}}]}],\"blok\":{}}</script>"#;
        let matches = extract_airtable_matches(html).expect("schedule should parse");
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0]["team1"], "Mexico");
    }

    #[test]
    #[ignore]
    fn downloads_esports_analytics_tables() {
        let payload = tauri::async_runtime::block_on(fetch_esports_analytics())
            .expect("analytics should download");
        assert!(payload["teamHeroUsage"]
            .as_array()
            .is_some_and(|rows| rows.len() > 100));
        assert!(payload["playerHeroUsage"]
            .as_array()
            .is_some_and(|rows| rows.len() > 100));
        assert!(payload["matchHeroUsage"]
            .as_array()
            .is_some_and(|rows| rows.len() > 100));
    }

    #[test]
    #[ignore]
    fn downloads_combined_esports_schedule() {
        let payload = tauri::async_runtime::block_on(fetch_esports_schedule())
            .expect("combined schedule should download");
        let matches = payload["matches"]
            .as_array()
            .expect("matches should be an array");
        assert!(matches.len() > 300);
        assert!(matches
            .iter()
            .any(|row| row.get("owtv").and_then(|value| value.as_str()).is_some()));
    }
}
