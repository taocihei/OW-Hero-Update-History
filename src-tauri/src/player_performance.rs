use rusqlite::{params_from_iter, Connection, OptionalExtension};
use serde_json::{json, Value};

const METRICS: [(&str, &str); 7] = [
    ("eliminations", "eliminations"), ("assists", "assists"), ("deaths", "deaths"),
    ("damage", "damage_dealt"), ("healing", "healing_done"),
    ("mitigation", "damage_mitigated"), ("fantasyScore", "fantasy_score"),
];

fn identity(value: &str) -> String {
    value.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect()
}

pub fn updated_at(connection: &Connection) -> rusqlite::Result<Option<String>> {
    connection.query_row("SELECT value FROM metadata WHERE key='updated_at'", [], |r| r.get(0)).optional()
}

/// Read every local match for the selected person, retaining the team they represented in that match.
pub fn read(connection: &Connection, player: &str) -> rusqlite::Result<Value> {
    let mut statement = connection.prepare("SELECT id, COALESCE(alias, name, ''), raw_json FROM players ORDER BY seen_at DESC, id DESC")?;
    let candidates = statement.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))?;
    let wanted = identity(player);
    let mut ids = Vec::new();
    let mut profile = Value::Null;
    for candidate in candidates {
        let (id, alias, raw) = candidate?;
        if !wanted.is_empty() && identity(&alias) == wanted {
            ids.push(id);
            if profile.is_null() { profile = serde_json::from_str(&raw).unwrap_or(Value::Null); }
        }
    }
    let mut matches = Vec::new();
    if !ids.is_empty() {
        let placeholders = vec!["?"; ids.len()].join(",");
        let aggregates = METRICS.iter().map(|(_, column)| format!("SUM(s.{column}), COUNT(DISTINCT CASE WHEN s.{column} IS NOT NULL THEN s.match_map_id END)")).collect::<Vec<_>>().join(",");
        // DISTINCT map/player prevents accidental duplicate person records from doubling a map.
        // All-null roster rows remain visible with missing metrics rather than becoming zero damage.
        let sql = format!(r#"
            WITH ranked AS (
              SELECT pms.*, ROW_NUMBER() OVER (
                PARTITION BY match_id, match_map_id, team_id
                ORDER BY (damage_dealt IS NOT NULL) DESC, id DESC
              ) row_priority
              FROM player_map_stats pms WHERE player_id IN ({placeholders})
            )
            SELECT m.id, m.slug, COALESCE(m.start_date, ''), COALESCE(tr.name, ''),
              COALESCE(t1.name, m.team1_placeholder, ''), COALESCE(t2.name, m.team2_placeholder, ''),
              COALESCE(t1.image_url, ''), COALESCE(t2.image_url, ''),
              CAST(m.team1_score AS REAL), CAST(m.team2_score AS REAL), m.source_url,
              s.team_id, COALESCE(own.name, ''), COUNT(DISTINCT s.match_map_id),
              COUNT(DISTINCT CASE WHEN s.damage_dealt IS NOT NULL OR s.eliminations IS NOT NULL OR s.healing_done IS NOT NULL THEN s.match_map_id END),
              {aggregates}
            FROM ranked s JOIN matches m ON m.id=s.match_id
            LEFT JOIN tournaments tr ON tr.id=m.tournament_id
            LEFT JOIN teams t1 ON t1.id=m.team1_id LEFT JOIN teams t2 ON t2.id=m.team2_id
            LEFT JOIN teams own ON own.id=s.team_id
            WHERE s.row_priority=1 AND m.complete=1 AND s.team_id IN (m.team1_id,m.team2_id)
            GROUP BY m.id,s.team_id ORDER BY m.start_date DESC,m.id DESC
        "#);
        let mut statement = connection.prepare(&sql)?;
        let rows = statement.query_map(params_from_iter(ids.iter()), |r| {
            let map_count = r.get::<_, i64>(13)?;
            let data_map_count = r.get::<_, i64>(14)?;
            let mut row = json!({
                "id": format!("owtv:{}",r.get::<_, i64>(0)?), "slug": r.get::<_, String>(1)?,
                "datetime": r.get::<_, String>(2)?, "event": r.get::<_, String>(3)?,
                "team1": r.get::<_, String>(4)?, "team2": r.get::<_, String>(5)?,
                "team1Logo": r.get::<_, String>(6)?, "team2Logo": r.get::<_, String>(7)?,
                "score1": r.get::<_, Option<f64>>(8)?, "score2": r.get::<_, Option<f64>>(9)?,
                "url": r.get::<_, String>(10)?, "playerTeamId": r.get::<_, i64>(11)?,
                "playerTeam": r.get::<_, String>(12)?, "mapCount": map_count,
                "dataMapCount": data_map_count, "metricMapCounts": {}, "source": "OWTV",
                "dataStatus": if data_map_count==0 { "missing" } else if data_map_count<map_count { "partial" } else { "complete" },
            });
            for (index, (key, _)) in METRICS.iter().enumerate() {
                row[*key] = json!(r.get::<_, Option<f64>>(15+index*2)?);
                row["metricMapCounts"][*key] = json!(r.get::<_, i64>(16+index*2)?);
            }
            let complete = METRICS.iter().take(6).all(|(key, _)| row["metricMapCounts"][*key].as_i64() == Some(map_count));
            row["dataStatus"] = json!(if data_map_count == 0 { "missing" } else if complete { "complete" } else { "partial" });
            Ok(row)
        })?;
        matches = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    }
    let mut totals = json!({});
    let mut coverage = json!({});
    for (key, _) in METRICS {
        let values: Vec<f64> = matches.iter().filter_map(|r| r[key].as_f64()).collect();
        totals[key] = if values.is_empty() { Value::Null } else { json!(values.iter().sum::<f64>()) };
        coverage[key] = json!(matches.iter().filter_map(|r| r["metricMapCounts"][key].as_i64()).sum::<i64>());
    }
    Ok(json!({
        "source": "OWTV 本地数据库", "player": player, "profile": profile,
        "matchCount": matches.len(), "mapCount": matches.iter().filter_map(|r| r["mapCount"].as_i64()).sum::<i64>(),
        "dataMapCount": matches.iter().filter_map(|r| r["dataMapCount"].as_i64()).sum::<i64>(),
        "totals": totals, "metricMapCounts": coverage, "matches": matches,
        "syncedAt": updated_at(connection)?, "cachedMatchCount": matches.len(), "fetchedMatchCount": 0,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unicode_identities_keep_letters_numbers_and_thai_vowels() {
        assert_eq!(identity("  ตะวันฉาย!! "), "ตะวันฉาย");
        assert_ne!(identity("โตแมง"), identity("ตะวันฉาย"));
        assert_eq!(identity(" 中国—战队！１２3 "), "中国战队１２3");
        assert_eq!(identity(" 별빛달 "), "별빛달");
        assert_eq!(identity("PainCarrÚ!"), "paincarrú");
        assert_eq!(identity("Weibo Gaming / OA"), "weibogamingoa");
    }

    #[test]
    fn unicode_player_lookup_returns_only_the_selected_players_matches() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT); INSERT INTO metadata VALUES('updated_at','2026-10-06');
            CREATE TABLE players(id INTEGER,alias TEXT,name TEXT,raw_json TEXT,seen_at TEXT);
            INSERT INTO players VALUES(1,'ตะวันฉาย',NULL,'{}','2026-10-06'),(2,'โตแมง',NULL,'{}','2026-10-06'),(3,'孤雪',NULL,'{}','2026-10-06');
            CREATE TABLE tournaments(id INTEGER,name TEXT);
            CREATE TABLE teams(id INTEGER,name TEXT,image_url TEXT);
            INSERT INTO teams VALUES(1,'甲队',''),(2,'乙队','');
            CREATE TABLE matches(id INTEGER,slug TEXT,start_date TEXT,tournament_id INTEGER,team1_id INTEGER,team2_id INTEGER,
                team1_placeholder TEXT,team2_placeholder TEXT,team1_score INTEGER,team2_score INTEGER,source_url TEXT,complete INTEGER);
            INSERT INTO matches VALUES(10,'unicode-test','2026-10-06',NULL,1,2,NULL,NULL,3,1,'',1);
            CREATE TABLE player_map_stats(id INTEGER,player_id INTEGER,match_id INTEGER,match_map_id INTEGER,team_id INTEGER,
                eliminations REAL,assists REAL,deaths REAL,damage_dealt REAL,healing_done REAL,damage_mitigated REAL,fantasy_score REAL);
            INSERT INTO player_map_stats(id,player_id,match_id,match_map_id,team_id,damage_dealt) VALUES(1,1,10,100,1,100),(2,2,10,100,1,200),(3,3,10,100,2,300);").unwrap();
        for (alias, expected_damage) in [("ตะวันฉาย", 100.0), ("โตแมง", 200.0), ("孤雪", 300.0)] {
            let result = read(&connection, alias).unwrap();
            assert_eq!(result["matchCount"], 1, "{alias}");
            assert_eq!(result["totals"]["damage"].as_f64(), Some(expected_damage), "{alias}");
        }
        assert_eq!(read(&connection,"未收录的选手").unwrap()["matchCount"], 0);
    }

    #[test]
    fn bundled_guxue_uses_all_matches_and_actual_team() {
        let connection = Connection::open_with_flags(
            concat!(env!("CARGO_MANIFEST_DIR"), "/../data/owtv/owtv.sqlite3"),
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        ).unwrap();
        let result = read(&connection,"Guxue").unwrap();
        assert!(result["matchCount"].as_u64().unwrap()>18);
        let rows: Vec<_> = result["matches"].as_array().unwrap().iter().filter(|r| r["slug"].as_str().unwrap_or("").starts_with("midseason-championship-owcs-2026-")).collect();
        assert_eq!(rows.len(),5);
        let wins = rows.iter().filter(|r| {
            let left = r["playerTeam"]==r["team1"];
            let a = r["score1"].as_f64().unwrap(); let b = r["score2"].as_f64().unwrap();
            if left { a>b } else { b>a }
        }).count();
        assert_eq!(wins,3);
        assert_eq!(rows.len()-wins,2);
        assert!(rows.iter().all(|r| r["playerTeam"]=="Weibo Gaming"));
        assert_eq!(result["syncedAt"],updated_at(&connection).unwrap().unwrap());
    }

    #[test]
    fn missing_statistics_remain_null() {
        let connection = Connection::open_with_flags(
            concat!(env!("CARGO_MANIFEST_DIR"), "/../data/owtv/owtv.sqlite3"),
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        ).unwrap();
        let result=read(&connection,"Apr1ta").unwrap();
        let row=result["matches"].as_array().unwrap().iter().find(|r| r["id"]=="owtv:873").unwrap();
        assert!(row["damage"].is_null());
        assert_eq!(row["metricMapCounts"]["damage"],0);
        assert_eq!(row["dataStatus"],"missing");
    }
}
