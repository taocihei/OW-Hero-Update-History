use rusqlite::{Connection, OpenFlags, OptionalExtension, Transaction};
use std::{error::Error, fs, io, path::Path, time::Duration};

const FINGERPRINT_KEY: &str = "bundled_snapshot_fingerprint_v1";
const TABLES: &[&str] = &[
    "metadata",
    "regions",
    "tournaments",
    "teams",
    "players",
    "map_catalog",
    "matches",
    "match_maps",
    "player_map_stats",
    "tournament_regions",
    "tournament_teams",
    "player_teams",
    "media_assets",
    "sync_runs",
];

// A content change detector, not a security signature. Equal-sized SQLite pages
// can contain different results, so file length cannot be a snapshot version.
fn fingerprint(bytes: &[u8]) -> String {
    let hash = bytes.iter().fold(0xcbf29ce484222325_u64, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
    });
    format!("{}:{hash:016x}", bytes.len())
}

fn metadata(connection: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    connection
        .query_row("SELECT value FROM metadata WHERE key=?1", [key], |row| {
            row.get(0)
        })
        .optional()
}

fn ident(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn columns(
    connection: &Connection,
    schema: &str,
    table: &str,
) -> rusqlite::Result<Vec<(String, i64)>> {
    let mut statement =
        connection.prepare(&format!("PRAGMA {schema}.table_info({})", ident(table)))?;
    let result = statement
        .query_map([], |row| Ok((row.get(1)?, row.get(5)?)))?
        .collect();
    result
}

fn merge_table(
    transaction: &Transaction<'_>,
    table: &str,
    condition: &str,
    filter: &str,
) -> rusqlite::Result<()> {
    let fields = columns(transaction, "bundled", table)?;
    if fields.is_empty() {
        return Ok(());
    }
    let names: Vec<String> = fields.iter().map(|(name, _)| ident(name)).collect();
    let mut keys: Vec<_> = fields.iter().filter(|(_, pk)| *pk > 0).collect();
    keys.sort_by_key(|(_, pk)| *pk);
    let updates: Vec<_> = fields.iter().filter(|(_, pk)| *pk == 0).map(|(name, _)| {
        let name = ident(name);
        // A newer index-only row must not erase the local detail freshness marker.
        if table == "matches" && (name == "\"detail_fetched_at\"" || name == "\"detail_sha256\"") {
            format!("{name}=CASE WHEN COALESCE(julianday(excluded.detail_fetched_at),0)>=COALESCE(julianday(matches.detail_fetched_at),0) THEN excluded.{name} ELSE matches.{name} END")
        } else { format!("{name}=excluded.{name}") }
    }).collect();
    let conflict = if condition.is_empty() || updates.is_empty() {
        "DO NOTHING".to_owned()
    } else {
        format!("DO UPDATE SET {} WHERE {condition}", updates.join(","))
    };
    transaction.execute_batch(&format!(
        "INSERT INTO main.{table}({names}) SELECT {names} FROM bundled.{table} WHERE {filter} ON CONFLICT({keys}) {conflict};",
        table = ident(table), names = names.join(","),
        keys = keys.iter().map(|(name, _)| ident(name)).collect::<Vec<_>>().join(","),
    ))
}

fn merge_snapshot(
    connection: &mut Connection,
    staged: &Path,
    hash: &str,
) -> Result<(), Box<dyn Error>> {
    connection.execute(
        "ATTACH DATABASE ?1 AS bundled",
        [staged.to_string_lossy().as_ref()],
    )?;
    let transaction = connection.transaction()?;
    // Create tables newly supplied by the bundle, but never discard unknown user
    // tables or silently truncate columns when a schema migration is required.
    for table in TABLES {
        let ddl: Option<String> = transaction
            .query_row(
                "SELECT sql FROM bundled.sqlite_master WHERE type='table' AND name=?1",
                [table],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(ddl) = ddl {
            if columns(&transaction, "main", table)?.is_empty() {
                transaction.execute_batch(&ddl)?;
            }
            if columns(&transaction, "main", table)? != columns(&transaction, "bundled", table)? {
                return Err(io::Error::other(format!(
                    "OWTV 表 {table} 结构不同，已保留原数据库，未覆盖用户数据"
                ))
                .into());
            }
        }
    }
    let globally_newer: bool = transaction.query_row(
        "SELECT COALESCE(julianday((SELECT value FROM bundled.metadata WHERE key='updated_at')),0)>=COALESCE(julianday((SELECT value FROM main.metadata WHERE key='updated_at')),0)",
        [], |row| row.get(0)
    )?;
    transaction.execute_batch("CREATE TEMP TABLE snapshot_detail_matches AS
        SELECT b.id FROM bundled.matches b LEFT JOIN main.matches m ON m.id=b.id
        WHERE m.id IS NULL OR (b.detail_fetched_at IS NOT NULL AND
            COALESCE(julianday(b.detail_fetched_at),0)>=COALESCE(julianday(m.detail_fetched_at),0));")?;
    for table in TABLES {
        if matches!(
            *table,
            "metadata" | "matches" | "match_maps" | "player_map_stats"
        ) {
            continue;
        }
        let fields = columns(&transaction, "bundled", table)?;
        let timestamp = ["seen_at", "fetched_at", "last_seen"]
            .iter()
            .find(|field| fields.iter().any(|(name, _)| name == **field));
        let condition = if let Some(timestamp) = timestamp {
            format!("COALESCE(julianday(excluded.{timestamp}),0)>=COALESCE(julianday({}.{timestamp}),0)", ident(table))
        } else if globally_newer && matches!(*table, "regions" | "map_catalog") {
            "1".to_owned()
        } else {
            String::new()
        };
        merge_table(&transaction, table, &condition, "1")?;
    }
    merge_table(&transaction, "matches",
        "max(COALESCE(julianday(excluded.seen_at),0),COALESCE(julianday(excluded.detail_fetched_at),0))>=max(COALESCE(julianday(matches.seen_at),0),COALESCE(julianday(matches.detail_fetched_at),0))", "1")?;
    // Maps and player rows are a single match-detail snapshot. Replace only
    // selected matches; rows from a newer user fetch and user-only matches stay.
    transaction.execute_batch("DELETE FROM main.player_map_stats WHERE match_id IN (SELECT id FROM snapshot_detail_matches);
        DELETE FROM main.match_maps WHERE match_id IN (SELECT id FROM snapshot_detail_matches);")?;
    for table in ["match_maps", "player_map_stats"] {
        let collision: bool = transaction.query_row(&format!(
            "SELECT EXISTS(SELECT 1 FROM bundled.{table} b JOIN main.{table} m ON b.id=m.id WHERE b.match_id IN (SELECT id FROM snapshot_detail_matches))"
        ), [], |row| row.get(0))?;
        if collision {
            return Err(io::Error::other(format!(
                "OWTV {table} 编号与较新的本地比赛冲突，合并已回滚"
            ))
            .into());
        }
        merge_table(
            &transaction,
            table,
            "",
            "match_id IN (SELECT id FROM snapshot_detail_matches)",
        )?;
    }
    transaction.execute_batch("INSERT INTO main.metadata SELECT * FROM bundled.metadata WHERE key <> 'bundled_snapshot_fingerprint_v1' ON CONFLICT(key) DO NOTHING;")?;
    if globally_newer {
        transaction.execute_batch("UPDATE main.metadata SET value=(SELECT value FROM bundled.metadata WHERE key='updated_at') WHERE key='updated_at';")?;
    }
    transaction.execute("INSERT INTO metadata(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [FINGERPRINT_KEY, hash])?;
    transaction.execute_batch("DROP TABLE snapshot_detail_matches;")?;
    transaction.commit()?;
    connection.execute_batch("DETACH DATABASE bundled;")?;
    Ok(())
}

pub(crate) fn install_owtv_snapshot(path: &Path, bundled: &[u8]) -> Result<(), Box<dyn Error>> {
    let hash = fingerprint(bundled);
    let mut installed = if path.exists() {
        let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
        connection.busy_timeout(Duration::from_secs(15))?;
        if metadata(&connection, FINGERPRINT_KEY)?.as_deref() == Some(&hash) {
            return Ok(());
        }
        Some(connection)
    } else {
        None
    };
    let staged = path.with_extension(format!("bundled-install-{}.sqlite3", std::process::id()));
    fs::write(&staged, bundled)?;
    let result = (|| -> Result<(), Box<dyn Error>> {
        let snapshot = Connection::open_with_flags(&staged, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
        let check: String = snapshot.query_row("PRAGMA quick_check", [], |row| row.get(0))?;
        if check != "ok" {
            return Err(io::Error::other(format!("内置 OWTV 数据库校验失败：{check}")).into());
        }
        if let Some(ref mut connection) = installed {
            drop(snapshot);
            merge_snapshot(connection, &staged, &hash)?;
        } else {
            snapshot.execute("INSERT INTO metadata(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [FINGERPRINT_KEY, &hash])?;
            snapshot.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
            drop(snapshot);
            fs::rename(&staged, path)?;
        }
        Ok(())
    })();
    // Close ATTACH handles even after a rolled-back transaction before cleanup.
    drop(installed);
    if staged.exists() {
        let _ = fs::remove_file(&staged);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::{params, Connection};
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_ID: AtomicU64 = AtomicU64::new(0);

    struct Fixture(std::path::PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "owtv-snapshot-test-{}-{}",
                std::process::id(),
                NEXT_ID.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn db(&self, name: &str, timestamp: &str) -> Connection {
            let connection = Connection::open(self.0.join(name)).unwrap();
            connection.execute_batch("CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
                CREATE TABLE teams(id INTEGER PRIMARY KEY,name TEXT NOT NULL,seen_at TEXT NOT NULL);
                CREATE TABLE matches(id INTEGER PRIMARY KEY,team1_id INTEGER,team2_id INTEGER,team1_score INTEGER,detail_fetched_at TEXT,seen_at TEXT NOT NULL);
                CREATE TABLE match_maps(id INTEGER PRIMARY KEY,match_id INTEGER NOT NULL,map_id INTEGER);
                CREATE TABLE player_map_stats(id INTEGER PRIMARY KEY,match_id INTEGER NOT NULL,match_map_id INTEGER NOT NULL,player_id INTEGER,damage_dealt REAL);").unwrap();
            connection
                .execute("INSERT INTO metadata VALUES('updated_at',?1)", [timestamp])
                .unwrap();
            connection
        }
        fn row(connection: &Connection, id: i64, score: i64, timestamp: &str) {
            connection
                .execute(
                    "INSERT INTO matches VALUES(?1,1,2,?2,?3,?3)",
                    params![id, score, timestamp],
                )
                .unwrap();
            connection
                .execute("INSERT INTO match_maps VALUES(?1,?1,1)", [id])
                .unwrap();
            connection
                .execute(
                    "INSERT INTO player_map_stats VALUES(?1,?1,?1,1,?2)",
                    params![id, score * 100],
                )
                .unwrap();
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            // This directory is uniquely created above and contains test fixtures only.
            if let Ok(entries) = fs::read_dir(&self.0) {
                for entry in entries.flatten() {
                    let _ = fs::remove_file(entry.path());
                }
            }
            let _ = fs::remove_dir(&self.0);
        }
    }

    #[test]
    fn equal_size_snapshot_updates_corrected_match() {
        let fixture = Fixture::new();
        let old = fixture.db("installed.sqlite3", "2026-08-06T00:00:00Z");
        Fixture::row(&old, 1, 1, "2026-08-06T00:00:00Z");
        let new = fixture.db("bundled.sqlite3", "2026-10-06T00:00:00Z");
        Fixture::row(&new, 1, 3, "2026-10-06T00:00:00Z");
        drop(old);
        drop(new);
        let path = fixture.0.join("installed.sqlite3");
        let bytes = fs::read(fixture.0.join("bundled.sqlite3")).unwrap();
        assert_eq!(fs::metadata(&path).unwrap().len(), bytes.len() as u64);
        install_owtv_snapshot(&path, &bytes).unwrap();
        let connection = Connection::open(path).unwrap();
        let score: i64 = connection
            .query_row("SELECT team1_score FROM matches WHERE id=1", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(score, 3);
    }

    #[test]
    fn larger_snapshot_preserves_user_only_match() {
        let fixture = Fixture::new();
        let old = fixture.db("installed.sqlite3", "2026-08-06T00:00:00Z");
        Fixture::row(&old, 900, 2, "2026-10-07T00:00:00Z");
        let new = fixture.db("bundled.sqlite3", "2026-10-06T00:00:00Z");
        Fixture::row(&new, 1, 3, "2026-10-06T00:00:00Z");
        new.execute_batch(
            "CREATE TABLE padding(value BLOB); INSERT INTO padding VALUES(zeroblob(65536));",
        )
        .unwrap();
        drop(old);
        drop(new);
        let path = fixture.0.join("installed.sqlite3");
        let bytes = fs::read(fixture.0.join("bundled.sqlite3")).unwrap();
        install_owtv_snapshot(&path, &bytes).unwrap();
        let connection = Connection::open(path).unwrap();
        let retained: i64 = connection
            .query_row("SELECT COUNT(*) FROM matches WHERE id=900", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(retained, 1);
    }

    #[test]
    fn newer_local_detail_and_team_are_not_downgraded() {
        let fixture = Fixture::new();
        let old = fixture.db("installed.sqlite3", "2026-10-07T00:00:00Z");
        Fixture::row(&old, 1, 4, "2026-10-07T00:00:00Z");
        old.execute(
            "INSERT INTO teams VALUES(1,'User latest name','2026-10-07T00:00:00Z')",
            [],
        )
        .unwrap();
        let new = fixture.db("bundled.sqlite3", "2026-10-06T00:00:00Z");
        Fixture::row(&new, 1, 1, "2026-10-06T00:00:00Z");
        Fixture::row(&new, 2, 2, "2026-10-06T00:00:00Z");
        new.execute(
            "INSERT INTO teams VALUES(1,'Old name','2026-10-06T00:00:00Z')",
            [],
        )
        .unwrap();
        drop(old);
        drop(new);
        let path = fixture.0.join("installed.sqlite3");
        install_owtv_snapshot(&path, &fs::read(fixture.0.join("bundled.sqlite3")).unwrap())
            .unwrap();
        let connection = Connection::open(path).unwrap();
        assert_eq!(
            connection
                .query_row::<i64, _, _>("SELECT team1_score FROM matches WHERE id=1", [], |row| row
                    .get(0))
                .unwrap(),
            4
        );
        assert_eq!(
            connection
                .query_row::<f64, _, _>(
                    "SELECT damage_dealt FROM player_map_stats WHERE id=1",
                    [],
                    |row| row.get(0)
                )
                .unwrap(),
            400.0
        );
        assert_eq!(
            connection
                .query_row::<String, _, _>("SELECT name FROM teams WHERE id=1", [], |row| row
                    .get(0))
                .unwrap(),
            "User latest name"
        );
        assert_eq!(
            connection
                .query_row::<i64, _, _>("SELECT COUNT(*) FROM matches", [], |row| row.get(0))
                .unwrap(),
            2
        );
        assert_eq!(
            metadata(&connection, "updated_at").unwrap().as_deref(),
            Some("2026-10-07T00:00:00Z")
        );
    }

    #[test]
    fn detail_refresh_replaces_stale_rows_as_a_group() {
        let fixture = Fixture::new();
        let old = fixture.db("installed.sqlite3", "2026-08-06T00:00:00Z");
        Fixture::row(&old, 1, 1, "2026-08-06T00:00:00Z");
        old.execute_batch("INSERT INTO match_maps VALUES(10,1,10); INSERT INTO player_map_stats VALUES(10,1,10,2,10);").unwrap();
        let new = fixture.db("bundled.sqlite3", "2026-10-06T00:00:00Z");
        Fixture::row(&new, 1, 3, "2026-10-06T00:00:00Z");
        drop(old);
        drop(new);
        let path = fixture.0.join("installed.sqlite3");
        install_owtv_snapshot(&path, &fs::read(fixture.0.join("bundled.sqlite3")).unwrap())
            .unwrap();
        let connection = Connection::open(path).unwrap();
        assert_eq!(
            connection
                .query_row::<i64, _, _>("SELECT COUNT(*) FROM match_maps", [], |row| row.get(0))
                .unwrap(),
            1
        );
        assert_eq!(
            connection
                .query_row::<i64, _, _>("SELECT COUNT(*) FROM player_map_stats", [], |row| row
                    .get(0))
                .unwrap(),
            1
        );
        assert_eq!(
            connection
                .query_row::<f64, _, _>(
                    "SELECT damage_dealt FROM player_map_stats WHERE id=1",
                    [],
                    |row| row.get(0)
                )
                .unwrap(),
            300.0
        );
    }

    #[test]
    fn repeated_install_skips_already_applied_snapshot() {
        let fixture = Fixture::new();
        let bundled = fixture.db("bundled.sqlite3", "2026-10-06T00:00:00Z");
        Fixture::row(&bundled, 1, 3, "2026-10-06T00:00:00Z");
        drop(bundled);
        let path = fixture.0.join("installed.sqlite3");
        let bytes = fs::read(fixture.0.join("bundled.sqlite3")).unwrap();
        install_owtv_snapshot(&path, &bytes).unwrap();
        let connection = Connection::open(&path).unwrap();
        assert!(metadata(&connection, FINGERPRINT_KEY).unwrap().is_some());
        connection
            .execute("UPDATE matches SET team1_score=4", [])
            .unwrap();
        drop(connection);
        install_owtv_snapshot(&path, &bytes).unwrap();
        let connection = Connection::open(path).unwrap();
        assert_eq!(
            connection
                .query_row::<i64, _, _>("SELECT team1_score FROM matches WHERE id=1", [], |row| row
                    .get(0))
                .unwrap(),
            4
        );
    }

    #[test]
    fn conflicting_map_owner_rolls_back_without_touching_user_data() {
        let fixture = Fixture::new();
        let old = fixture.db("installed.sqlite3", "2026-10-07T00:00:00Z");
        Fixture::row(&old, 9, 4, "2026-10-07T00:00:00Z");
        old.execute("UPDATE match_maps SET id=1 WHERE id=9", [])
            .unwrap();
        old.execute("UPDATE player_map_stats SET match_map_id=1 WHERE id=9", [])
            .unwrap();
        let new = fixture.db("bundled.sqlite3", "2026-10-06T00:00:00Z");
        Fixture::row(&new, 1, 3, "2026-10-06T00:00:00Z");
        drop(old);
        drop(new);
        let path = fixture.0.join("installed.sqlite3");
        assert!(install_owtv_snapshot(
            &path,
            &fs::read(fixture.0.join("bundled.sqlite3")).unwrap()
        )
        .is_err());
        let connection = Connection::open(path).unwrap();
        assert_eq!(
            connection
                .query_row::<i64, _, _>("SELECT match_id FROM match_maps WHERE id=1", [], |row| row
                    .get(0))
                .unwrap(),
            9
        );
        assert_eq!(
            connection
                .query_row::<i64, _, _>("SELECT COUNT(*) FROM matches", [], |row| row.get(0))
                .unwrap(),
            1
        );
        assert!(metadata(&connection, FINGERPRINT_KEY).unwrap().is_none());
    }

    #[test]
    fn corrupt_bundle_does_not_replace_existing_database() {
        let fixture = Fixture::new();
        let old = fixture.db("installed.sqlite3", "2026-08-06T00:00:00Z");
        Fixture::row(&old, 1, 3, "2026-08-06T00:00:00Z");
        drop(old);
        let path = fixture.0.join("installed.sqlite3");
        assert!(install_owtv_snapshot(&path, &[0; 100_000]).is_err());
        let connection = Connection::open(path).unwrap();
        assert_eq!(
            connection
                .query_row::<i64, _, _>("SELECT team1_score FROM matches WHERE id=1", [], |row| row
                    .get(0))
                .unwrap(),
            3
        );
    }

    #[test]
    fn repository_snapshot_installs_and_merges_with_its_real_schema() {
        let fixture = Fixture::new();
        let bytes =
            fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("../data/owtv/owtv.sqlite3"))
                .unwrap();
        let path = fixture.0.join("installed.sqlite3");
        install_owtv_snapshot(&path, &bytes).unwrap();
        let connection = Connection::open(&path).unwrap();
        let before: i64 = connection
            .query_row("SELECT COUNT(*) FROM matches", [], |row| row.get(0))
            .unwrap();
        let stat_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM player_map_stats", [], |row| {
                row.get(0)
            })
            .unwrap();
        // An unmarked existing install drives the same merge used on an upgrade.
        connection
            .execute("DELETE FROM metadata WHERE key=?1", [FINGERPRINT_KEY])
            .unwrap();
        drop(connection);
        install_owtv_snapshot(&path, &bytes).unwrap();
        let connection = Connection::open(path).unwrap();
        assert_eq!(
            connection
                .query_row::<i64, _, _>("SELECT COUNT(*) FROM matches", [], |row| row.get(0))
                .unwrap(),
            before
        );
        assert_eq!(
            connection
                .query_row::<i64, _, _>("SELECT COUNT(*) FROM player_map_stats", [], |row| row
                    .get(0))
                .unwrap(),
            stat_count
        );
        assert_eq!(
            connection
                .query_row::<String, _, _>("PRAGMA integrity_check", [], |row| row.get(0))
                .unwrap(),
            "ok"
        );
    }
}
