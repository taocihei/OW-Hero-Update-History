import snapshot from "./esportsAnalyticsSnapshot.json";
import history from "./esportsHistorySnapshot.json";
import history2025 from "./esports2025Snapshot.json";

export interface OverallHeroUsage { hero_name: string; role: string; usage_count: string; pick_count: string; pick_rate: string; damage_verified?: boolean; metric?: string }
export interface TeamHeroUsage { team_name: string; hero_name: string; role: string; usage_count: string; pick_count: string; pick_rate: string; damage_verified?: boolean; metric?: string }
export interface PlayerHeroUsage { player_name: string; team_name: string; hero_name: string; usage_count: string; appearance_count?: string; play_time_seconds?: string; damage_dealt?: string; damage_verified?: boolean; metric?: string }
export interface TournamentHeroUsage { tournament_sheet: string; hero_name: string; role: string; usage_count: string; pick_count: string; pick_rate: string; damage_verified?: boolean; metric?: string }
export interface MapHeroUsage { map_name: string; hero_name: string; role: string; usage_count: string; pick_count: string; pick_rate: string; damage_verified?: boolean; metric?: string }
export interface HeroWinRate { player_name?: string; team_name?: string; hero_name: string; matches_played: string; wins: string; losses: string; win_rate: string }
export interface MatchHeroUsage { tournament_sheet: string; match_id: string; match_title: string; team_top: string; team_bottom: string; team_name?: string; hero_name: string; usage_count: string; damage_verified?: boolean; metric?: string; evidence_maps?: string[]; evidence_players?: string[] }
export interface TournamentTeamHeroUsage extends TeamHeroUsage { tournament_sheet: string }
export interface TournamentPlayerHeroUsage extends PlayerHeroUsage { tournament_sheet: string }
export interface EsportsHistoryMeta {
  firstSeason: number;
  lastSeason: number;
  seasons: number[];
  matchCount: number;
  playerCount: number;
  teamCount: number;
  rawRowCount: number;
  source: string;
  generatedAt: string;
  archiveBytes?: number;
  coverage?: string;
  usageUnit?: string;
  usageOfficial?: boolean;
  usageRule?: string;
}

export interface EsportsAnalyticsPayload {
  source: string;
  sourceUrl: string;
  generatedAt: string | number;
  overallHeroUsage: OverallHeroUsage[];
  teamHeroUsage: TeamHeroUsage[];
  playerHeroUsage: PlayerHeroUsage[];
  tournamentHeroUsage: TournamentHeroUsage[];
  mapHeroUsage: MapHeroUsage[];
  playerHeroWinRates: HeroWinRate[];
  teamHeroWinRates: HeroWinRate[];
  matchHeroUsage: MatchHeroUsage[];
  tournamentTeamHeroUsage: TournamentTeamHeroUsage[];
  tournamentPlayerHeroUsage: TournamentPlayerHeroUsage[];
  mapSetHeroUsage?: Array<Record<string, string>>;
  rawMatches?: Array<Record<string, string>>;
  rawMapSetResults?: Array<Record<string, string>>;
  history: EsportsHistoryMeta;
  sourceVersion?: string;
}

const CACHE_KEY = "ow-hero-history:esports-analytics:v7";
const VERSION_KEY = "ow-hero-history:esports-analytics:source-version";
const CHECKED_KEY = "ow-hero-history:esports-analytics:last-checked";
const CHECK_INTERVAL = 24 * 60 * 60 * 1000;

function playerKey(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

function canonicalTeamName(value: string) {
  return value.trim();
}

function preferredPlayerName(current: string | undefined, candidate: string) {
  if (!current) return candidate;
  const rank = (value: string) => {
    const letters = value.replace(/[^\p{L}]/gu, "");
    if (!letters || letters === letters.toLocaleLowerCase()) return 1;
    if (letters === letters.toLocaleUpperCase()) return 2;
    return 3;
  };
  return rank(candidate) > rank(current) ? candidate : current;
}

const PSEUDO_TOURNAMENTS = new Set(["Partner Team Index", "Non-Partner Team Index"]);

function deriveCurrentFromMapSets(payload: EsportsAnalyticsPayload): EsportsAnalyticsPayload {
  if (!payload.mapSetHeroUsage?.length || !payload.rawMatches?.length) return payload;
  const usage = payload.mapSetHeroUsage.filter((row) => !PSEUDO_TOURNAMENTS.has(row.tournament_sheet));
  const matches = payload.rawMatches.filter((row) => !PSEUDO_TOURNAMENTS.has(row.tournament_sheet));
  const canonicalPlayers = new Map<string, string>();
  for (const row of usage) {
    const key = playerKey(row.player_name ?? "");
    canonicalPlayers.set(key, preferredPlayerName(canonicalPlayers.get(key), (row.player_name ?? "").trim()));
  }
  const roles = new Map<string, string>();
  payload.teamHeroUsage.forEach((row) => row.role && roles.set(playerKey(row.hero_name), row.role));
  const matchById = new Map(matches.map((row) => [row.match_id, row]));
  const counters = {
    overall: new Map<string, { keys: string[]; samples: Set<string> }>(),
    team: new Map<string, { keys: string[]; samples: Set<string> }>(),
    player: new Map<string, { keys: string[]; samples: Set<string> }>(),
    tournament: new Map<string, { keys: string[]; samples: Set<string> }>(),
    map: new Map<string, { keys: string[]; samples: Set<string> }>(),
    tournamentTeam: new Map<string, { keys: string[]; samples: Set<string> }>(),
    tournamentPlayer: new Map<string, { keys: string[]; samples: Set<string> }>(),
    matchHero: new Map<string, { keys: string[]; samples: Set<string> }>(),
  };
  const add = (target: Map<string, { keys: string[]; samples: Set<string> }>, keys: string[], sample: string) => {
    const id = keys.map(playerKey).join("\u0000");
    const current = target.get(id) ?? { keys, samples: new Set<string>() };
    current.samples.add(sample);
    target.set(id, current);
  };
  const seen = new Set<string>();
  for (const raw of usage) {
    const tournament = raw.tournament_sheet;
    const matchId = raw.match_id;
    const mapIndex = raw.map_set_index;
    const mapName = raw.map_name;
    const team = canonicalTeamName(raw.team_name);
    const player = canonicalPlayers.get(playerKey(raw.player_name)) ?? raw.player_name.trim();
    const hero = raw.hero_name;
    const role = roles.get(playerKey(hero)) ?? "";
    const grain = [tournament, matchId, mapIndex, team, playerKey(player), hero].join("\u0000");
    if (seen.has(grain)) continue;
    seen.add(grain);
    const sample = `${matchId}:${mapIndex}`;
    const teamSample = `${sample}:${team}`;
    add(counters.overall, [hero, role], teamSample);
    add(counters.team, [team, hero, role], sample);
    add(counters.player, [player, team, hero], sample);
    add(counters.tournament, [tournament, hero, role], teamSample);
    add(counters.map, [mapName, hero, role], teamSample);
    add(counters.tournamentTeam, [tournament, team, hero, role], sample);
    add(counters.tournamentPlayer, [tournament, player, team, hero], sample);
    add(counters.matchHero, [tournament, matchId, team, hero], sample);
  }
  const base = (count: number) => ({ usage_count: String(count), pick_count: String(count), pick_rate: "0", damage_verified: false, metric: "post_match_settlement_hero" });
  const values = (counter: Map<string, { keys: string[]; samples: Set<string> }>) => Array.from(counter.values());
  const currentMatchHero: MatchHeroUsage[] = values(counters.matchHero).map(({ keys, samples }) => {
    const [tournament_sheet, match_id, team_name, hero_name] = keys;
    const match = matchById.get(match_id) ?? {};
    return { tournament_sheet, match_id, team_name, hero_name, match_title: match.match_title ?? "", team_top: match.team_top ?? "", team_bottom: match.team_bottom ?? "", usage_count: String(samples.size), damage_verified: false, metric: "post_match_settlement_hero" };
  });
  return {
    ...payload,
    overallHeroUsage: values(counters.overall).map(({ keys, samples }) => ({ hero_name: keys[0], role: keys[1], ...base(samples.size) })),
    teamHeroUsage: values(counters.team).map(({ keys, samples }) => ({ team_name: keys[0], hero_name: keys[1], role: keys[2], ...base(samples.size) })),
    playerHeroUsage: values(counters.player).map(({ keys, samples }) => ({ player_name: keys[0], team_name: keys[1], hero_name: keys[2], ...base(samples.size) })),
    tournamentHeroUsage: values(counters.tournament).map(({ keys, samples }) => ({ tournament_sheet: keys[0], hero_name: keys[1], role: keys[2], ...base(samples.size) })),
    mapHeroUsage: values(counters.map).map(({ keys, samples }) => ({ map_name: keys[0], hero_name: keys[1], role: keys[2], ...base(samples.size) })),
    tournamentTeamHeroUsage: values(counters.tournamentTeam).map(({ keys, samples }) => ({ tournament_sheet: keys[0], team_name: keys[1], hero_name: keys[2], role: keys[3], ...base(samples.size) })),
    tournamentPlayerHeroUsage: values(counters.tournamentPlayer).map(({ keys, samples }) => ({ tournament_sheet: keys[0], player_name: keys[1], team_name: keys[2], hero_name: keys[3], ...base(samples.size) })),
    matchHeroUsage: currentMatchHero,
  };
}

function countKey(...values: string[]) {
  return values.map(playerKey).join("\u0000");
}

function mergeUsageRows<T extends object>(rows: T[], keys: Array<keyof T>): T[] {
  const merged = new Map<string, T>();
  for (const row of rows) {
    const key = countKey(...keys.map((field) => String((row as Record<string, unknown>)[String(field)] ?? "")));
    const existing = merged.get(key);
    if (!existing) merged.set(key, { ...row });
    else {
      for (const field of ["usage_count", "pick_count", "appearance_count", "play_time_seconds", "damage_dealt"] as const) {
        if (field in row) (existing as Record<string, string>)[field] = String(Number((existing as Record<string, string>)[field] ?? 0) + Number((row as Record<string, unknown>)[field] ?? 0));
      }
      if ("damage_verified" in row) (existing as Record<string, unknown>).damage_verified = Boolean((existing as Record<string, unknown>).damage_verified || (row as Record<string, unknown>).damage_verified);
    }
  }
  return Array.from(merged.values());
}

function withCareerArchive(payload: EsportsAnalyticsPayload): EsportsAnalyticsPayload {
  const archive = history as typeof history;
  const archive2025 = history2025 as typeof history2025;
  const seasons = Array.from(new Set([...archive.seasons, ...archive2025.seasons, 2026])).sort();
  return {
    ...payload,
    overallHeroUsage: mergeUsageRows([...payload.overallHeroUsage, ...archive.overallHeroUsage, ...archive2025.overallHeroUsage], ["hero_name", "damage_verified"]),
    teamHeroUsage: mergeUsageRows([...payload.teamHeroUsage, ...archive.teamHeroUsage, ...archive2025.teamHeroUsage], ["team_name", "hero_name", "damage_verified"]),
    playerHeroUsage: mergeUsageRows([...payload.playerHeroUsage, ...archive.playerHeroUsage, ...archive2025.playerHeroUsage], ["player_name", "team_name", "hero_name", "damage_verified"]),
    tournamentHeroUsage: mergeUsageRows([...payload.tournamentHeroUsage, ...archive.tournamentHeroUsage, ...archive2025.tournamentHeroUsage], ["tournament_sheet", "hero_name", "damage_verified"]),
    mapHeroUsage: mergeUsageRows([...payload.mapHeroUsage, ...archive.mapHeroUsage, ...archive2025.mapHeroUsage], ["map_name", "hero_name", "damage_verified"]),
    matchHeroUsage: mergeUsageRows([...payload.matchHeroUsage, ...archive2025.matchHeroUsage], ["tournament_sheet", "match_id", "team_name", "hero_name"]),
    tournamentTeamHeroUsage: mergeUsageRows([...payload.tournamentTeamHeroUsage, ...archive.tournamentTeamHeroUsage, ...archive2025.tournamentTeamHeroUsage], ["tournament_sheet", "team_name", "hero_name", "damage_verified"]),
    tournamentPlayerHeroUsage: mergeUsageRows([...payload.tournamentPlayerHeroUsage, ...archive.tournamentPlayerHeroUsage, ...archive2025.tournamentPlayerHeroUsage], ["tournament_sheet", "player_name", "team_name", "hero_name", "damage_verified"]),
    history: {
      firstSeason: Math.min(archive.firstSeason, archive2025.firstSeason),
      lastSeason: Math.max(2026, archive.lastSeason, archive2025.lastSeason),
      seasons,
      matchCount: archive.matchCount + archive2025.matchCount + new Set(payload.matchHeroUsage.map((row) => row.match_id)).size,
      playerCount: new Set([...payload.playerHeroUsage.map((row) => playerKey(row.player_name)), ...archive.playerHeroUsage.map((row) => playerKey(row.player_name)), ...archive2025.playerHeroUsage.map((row) => playerKey(row.player_name))]).size,
      teamCount: new Set([...payload.teamHeroUsage.map((row) => playerKey(row.team_name)), ...archive.teamHeroUsage.map((row) => playerKey(row.team_name)), ...archive2025.teamHeroUsage.map((row) => playerKey(row.team_name))]).size,
      rawRowCount: archive.rawRowCount + archive2025.rawRowCount + (payload.mapSetHeroUsage?.length ?? 0),
      source: `${archive.source} + ${archive2025.source} + ${payload.source}`,
      generatedAt: String(payload.generatedAt || archive2025.generatedAt),
      archiveBytes: 16_497_654 + 9_906_955 + 5_898_494,
      coverage: `${archive.firstSeason}—${archive.lastSeason} OWL Stats Lab；${archive2025.coverage}；2026 OWCS 逐地图阵容表`,
      usageUnit: archive2025.usageUnit,
      usageOfficial: archive2025.usageOfficial,
      usageRule: archive.usageRule,
    },
  };
}

function normalizePayload(payload: EsportsAnalyticsPayload): EsportsAnalyticsPayload {
  const canonicalPlayers = new Map<string, string>();
  for (const row of payload.playerHeroUsage) {
    const key = playerKey(row.player_name);
    canonicalPlayers.set(key, preferredPlayerName(canonicalPlayers.get(key), row.player_name.trim()));
  }

  const usage = new Map<string, PlayerHeroUsage>();
  for (const row of payload.playerHeroUsage) {
    const player = canonicalPlayers.get(playerKey(row.player_name)) ?? row.player_name.trim();
    const team = canonicalTeamName(row.team_name);
    const key = `${playerKey(player)}\u0000${playerKey(team)}\u0000${playerKey(row.hero_name)}\u0000${row.damage_verified === true ? "verified" : "unverified"}`;
    const existing = usage.get(key);
    if (existing) {
      existing.usage_count = String(Number(existing.usage_count) + Number(row.usage_count));
      if (row.appearance_count) existing.appearance_count = String(Number(existing.appearance_count ?? 0) + Number(row.appearance_count));
      if (row.play_time_seconds) existing.play_time_seconds = String(Number(existing.play_time_seconds ?? 0) + Number(row.play_time_seconds));
      if (row.damage_dealt) existing.damage_dealt = String(Number(existing.damage_dealt ?? 0) + Number(row.damage_dealt));
      existing.damage_verified = Boolean(existing.damage_verified || row.damage_verified);
    } else usage.set(key, { ...row, player_name: player, team_name: team });
  }

  const winRates = new Map<string, HeroWinRate>();
  for (const row of payload.playerHeroWinRates) {
    const player = canonicalPlayers.get(playerKey(row.player_name ?? "")) ?? (row.player_name ?? "").trim();
    const key = `${playerKey(player)}\u0000${playerKey(row.hero_name)}`;
    const existing = winRates.get(key);
    if (existing) {
      existing.matches_played = String(Number(existing.matches_played) + Number(row.matches_played));
      existing.wins = String(Number(existing.wins) + Number(row.wins));
      existing.losses = String(Number(existing.losses) + Number(row.losses));
    } else winRates.set(key, { ...row, player_name: player });
  }
  for (const row of winRates.values()) {
    row.win_rate = String(Number(row.matches_played) ? Number(row.wins) / Number(row.matches_played) : 0);
  }

  return {
    ...payload,
    teamHeroUsage: mergeUsageRows(payload.teamHeroUsage.map((row) => ({ ...row, team_name: canonicalTeamName(row.team_name) })), ["team_name", "hero_name", "damage_verified"]),
    playerHeroUsage: Array.from(usage.values()),
    playerHeroWinRates: Array.from(winRates.values()),
    teamHeroWinRates: payload.teamHeroWinRates.map((row) => ({ ...row, team_name: row.team_name ? canonicalTeamName(row.team_name) : row.team_name })),
    tournamentTeamHeroUsage: mergeUsageRows(payload.tournamentTeamHeroUsage.map((row) => ({ ...row, team_name: canonicalTeamName(row.team_name) })), ["tournament_sheet", "team_name", "hero_name", "damage_verified"]),
    tournamentPlayerHeroUsage: mergeUsageRows(payload.tournamentPlayerHeroUsage.map((row) => ({
      ...row,
      player_name: canonicalPlayers.get(playerKey(row.player_name)) ?? row.player_name.trim(),
      team_name: canonicalTeamName(row.team_name),
    })), ["tournament_sheet", "player_name", "team_name", "hero_name", "damage_verified"]),
    matchHeroUsage: payload.matchHeroUsage.map((row) => ({ ...row, team_name: row.team_name ? canonicalTeamName(row.team_name) : row.team_name, team_top: canonicalTeamName(row.team_top), team_bottom: canonicalTeamName(row.team_bottom) })),
  };
}

function valid(value: unknown): value is EsportsAnalyticsPayload {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<EsportsAnalyticsPayload>;
  return Array.isArray(data.teamHeroUsage) && Array.isArray(data.playerHeroUsage)
    && Array.isArray(data.tournamentHeroUsage) && Array.isArray(data.matchHeroUsage);
}

export function loadEsportsAnalytics(): EsportsAnalyticsPayload {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as unknown;
    if (valid(cached)) return normalizePayload(withCareerArchive(deriveCurrentFromMapSets(cached)));
  } catch {
    // Bundled data remains available when the cache is invalid.
  }
  return normalizePayload(withCareerArchive(deriveCurrentFromMapSets(snapshot as unknown as EsportsAnalyticsPayload)));
}

export async function syncEsportsAnalytics(): Promise<EsportsAnalyticsPayload> {
  if (!("__TAURI_INTERNALS__" in window)) return loadEsportsAnalytics();
  const { invoke } = await import("@tauri-apps/api/core");
  const lastChecked = Number(localStorage.getItem(CHECKED_KEY) ?? 0);
  if (Date.now() - lastChecked < CHECK_INTERVAL) return loadEsportsAnalytics();
  const probe = await invoke<{ sourceVersion: string }>("probe_esports_analytics");
  localStorage.setItem(CHECKED_KEY, String(Date.now()));
  const knownVersion = localStorage.getItem(VERSION_KEY) ?? (snapshot as unknown as EsportsAnalyticsPayload).sourceVersion ?? "";
  if (knownVersion && probe.sourceVersion === knownVersion) {
    localStorage.setItem(VERSION_KEY, probe.sourceVersion);
    return loadEsportsAnalytics();
  }
  const payload = await invoke<EsportsAnalyticsPayload>("fetch_esports_analytics");
  if (!valid(payload)) throw new Error("职业比赛统计数据格式不完整");
  localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  localStorage.setItem(VERSION_KEY, payload.sourceVersion ?? probe.sourceVersion);
  const normalized = normalizePayload(withCareerArchive(deriveCurrentFromMapSets(payload)));
  return normalized;
}
