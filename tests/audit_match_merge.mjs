/**
 * Read-only replay of the packaged schedule + real SQLite index merge.
 * Run: node tests/audit_match_merge.mjs
 * Options: --database <sqlite path> --python <python executable>
 * Uses the project's installed TypeScript and Python's standard-library sqlite3.
 * No database changes, generated modules, network calls or dependency installs.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let database = path.join(root, "data", "owtv", "owtv.sqlite3");
let python = process.env.PYTHON || "python";
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 1) {
  const option = args[index];
  if (option === "--help") {
    console.log("node tests/audit_match_merge.mjs [--database <sqlite path>] [--python <executable>]");
    process.exit(0);
  }
  if (!["--database", "--python"].includes(option) || !args[index + 1]) {
    throw new Error(`Unknown or incomplete argument: ${option}`);
  }
  const value = args[++index];
  if (option === "--database") database = path.resolve(value);
  else python = value;
}

// Match the dated-match index returned by fetch_owtv_match_index in lib.rs.
// SQLite mode=ro prevents an absent path from silently creating a new database.
const source = String.raw`
import json
import pathlib
import sqlite3
import sys

database = pathlib.Path(sys.argv[1]).resolve()
connection = sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)
connection.row_factory = sqlite3.Row
try:
    matches = []
    rows = connection.execute("""
        SELECT m.id, COALESCE(m.start_date, '') AS datetime,
               m.complete, m.is_live, m.has_started,
               COALESCE(t1.id, 0) AS team1_id,
               COALESCE(t1.name, m.team1_placeholder, '待定') AS team1,
               COALESCE(t1.image_url, t1.thumbnail_url, '') AS team1_logo,
               COALESCE(t2.id, 0) AS team2_id,
               COALESCE(t2.name, m.team2_placeholder, '待定') AS team2,
               COALESCE(t2.image_url, t2.thumbnail_url, '') AS team2_logo,
               CAST(m.team1_score AS REAL) AS score1,
               CAST(m.team2_score AS REAL) AS score2,
               COALESCE(tr.name, 'OWTV 职业比赛') AS event,
               COALESCE(tr.slug, '') AS tournament_id,
               COALESCE(m.region_slug, '') AS region, m.source_url,
               (SELECT COUNT(*) FROM match_maps mm WHERE mm.match_id = m.id) AS map_count,
               (SELECT COUNT(*) FROM player_map_stats pms WHERE pms.match_id = m.id) AS stat_count
        FROM matches m
        LEFT JOIN tournaments tr ON tr.id = m.tournament_id
        LEFT JOIN teams t1 ON t1.id = m.team1_id
        LEFT JOIN teams t2 ON t2.id = m.team2_id
        WHERE COALESCE(m.start_date, '') <> ''
        ORDER BY m.start_date DESC, m.id DESC
    """)
    for row in rows:
        status = 'live' if row['is_live'] else 'completed' if row['complete'] or row['has_started'] else 'upcoming'
        matches.append(dict(
            id='owtv:' + str(row['id']), owtvMatchId=row['id'],
            datetime=row['datetime'], status=status,
            team1=row['team1'], team2=row['team2'],
            team1Id='owtv-team:' + str(row['team1_id']),
            team2Id='owtv-team:' + str(row['team2_id']),
            team1Logo=row['team1_logo'], team2Logo=row['team2_logo'],
            score1=row['score1'], score2=row['score2'],
            event=row['event'], region=row['region'],
            phase='含选手数据' if row['stat_count'] else '仅地图与赛果' if row['map_count'] else '仅赛果',
            stage='OWTV 历史档案', youtube='', twitch='',
            owtv=row['source_url'], sources=['OWTV 本地数据库'],
            tournamentId=row['tournament_id'],
            mapRecordCount=row['map_count'], playerStatCount=row['stat_count'],
        ))
    undated = connection.execute("SELECT COUNT(*) FROM matches WHERE COALESCE(start_date, '') = ''").fetchone()[0]
    print(json.dumps(dict(matches=matches, excludedUndated=undated)))
finally:
    connection.close()
`;
const { matches: sqliteMatches, excludedUndated } = JSON.parse(execFileSync(
  python,
  ["-c", source, database],
  { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: "utf-8" } },
));
assert.ok(sqliteMatches.length > 0, "The SQLite index must contain dated matches");
assert.equal(new Set(sqliteMatches.map((match) => match.owtvMatchId)).size, sqliteMatches.length,
  "The source SQLite index contains duplicate match IDs");

// Load the actual application merge path, not a copied JavaScript implementation.
// ES2022 is intentional: Set/Map iteration must retain TypeScript's modern semantics.
const require = createRequire(import.meta.url);
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => {
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  });
  module._compile(compiled.outputText, filename);
};
globalThis.localStorage = { getItem: () => null };
const { loadEsportsSchedule, mergeEsportsMatches } = require(path.join(root, "src", "esportsApi.ts"));
const initial = loadEsportsSchedule().matches;
const before = JSON.stringify(sqliteMatches);
const combined = mergeEsportsMatches([...initial, ...sqliteMatches]);
const refreshed = mergeEsportsMatches([...combined, ...initial]);
const refreshedAgain = mergeEsportsMatches([...refreshed, ...initial]);
const identityFields = ["id", "team1Id", "team2Id", "team1", "team2", "score1", "score2", "owtv"];

function verify(phase, rows) {
  const byId = new Map();
  for (const row of rows) {
    if (row.owtvMatchId == null) continue;
    const matches = byId.get(row.owtvMatchId) ?? [];
    matches.push(row);
    byId.set(row.owtvMatchId, matches);
  }
  const missing = [];
  const duplicates = [];
  const mismatches = [];
  for (const original of sqliteMatches) {
    const retained = byId.get(original.owtvMatchId) ?? [];
    if (retained.length === 0) missing.push(original.owtvMatchId);
    else if (retained.length !== 1) duplicates.push(original.owtvMatchId);
    for (const match of retained) {
      for (const field of identityFields) {
        if (original[field] !== match[field]) {
          mismatches.push({ id: original.owtvMatchId, field, expected: original[field], actual: match[field] });
        }
      }
    }
  }
  console.log(JSON.stringify({
    phase, sqlite: sqliteMatches.length, total: rows.length, excludedUndated,
    lost: missing.length, duplicateIds: duplicates.length, identityScoreUrlMismatches: mismatches.length,
  }));
  assert.deepEqual(missing, [], `${phase}: SQLite match IDs were lost`);
  assert.deepEqual(duplicates, [], `${phase}: SQLite match IDs were duplicated`);
  assert.deepEqual(mismatches.slice(0, 20), [], `${phase}: SQLite identity, participants, scores or URL were changed`);
}

verify("load", combined);
verify("refresh", refreshed);
verify("repeat-refresh", refreshedAgain);
assert.equal(refreshed.length, combined.length, "Refreshing the same schedule increased the match count");
assert.equal(refreshedAgain.length, combined.length, "Repeated refresh was not idempotent");
assert.equal(JSON.stringify(sqliteMatches), before, "The merge mutated input SQLite rows");
console.log("PASS: every dated SQLite match retained its ID, participants, scores and OWTV URL after load and refresh.");
