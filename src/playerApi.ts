import type { PlayerIntel } from "./matchTypes";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeRank(role: string, value: unknown) {
  const rank = asRecord(value);
  const tier = String(rank.division ?? rank.rank ?? "未定级");
  return { role, tier, division: asNumber(rank.tier) };
}

function normalizeIntel(playerId: string, payload: unknown): PlayerIntel {
  const root = asRecord(payload);
  const summary = asRecord(root.summary);
  const stats = asRecord(root.stats);
  const general = asRecord(stats.general);
  const average = asRecord(general.average);
  const competitive = asRecord(summary.competitive);
  const pc = asRecord(competitive.pc);
  const consoleRanks = asRecord(competitive.console);
  const ranksSource = Object.keys(pc).length ? pc : consoleRanks;
  const ranks = Object.entries(ranksSource)
    .filter(([role, value]) => role !== "season" && Boolean(value) && typeof value === "object")
    .map(([role, value]) => normalizeRank(role, value));
  const gamesPlayed = asNumber(general.games_played);
  const gamesWon = asNumber(general.games_won);

  return {
    playerId,
    username: String(summary.username ?? summary.name ?? playerId.split("-")[0]),
    avatar: typeof summary.avatar === "string" ? summary.avatar : undefined,
    title: typeof summary.title === "string" ? summary.title : undefined,
    endorsement: asNumber(summary.endorsement),
    lastUpdatedAt: asNumber(summary.last_updated_at),
    ranks,
    average: {
      eliminations: asNumber(average.eliminations),
      assists: asNumber(average.assists),
      deaths: asNumber(average.deaths),
      damage: asNumber(average.damage),
      healing: asNumber(average.healing),
    },
    gamesPlayed,
    gamesWon,
    winrate: gamesPlayed && gamesWon !== undefined ? (gamesWon / gamesPlayed) * 100 : undefined,
    kda: asNumber(general.kda),
  };
}

export async function fetchPlayerIntel(battleTag: string): Promise<PlayerIntel> {
  const playerId = battleTag.trim().replace("#", "-");
  if (!playerId) throw new Error("请输入 BattleTag，例如 TeKrop#2217");

  let payload: unknown;
  if ("__TAURI_INTERNALS__" in window) {
    const { invoke } = await import("@tauri-apps/api/core");
    payload = await invoke("fetch_player_intel", { playerId });
  } else {
    const encoded = encodeURIComponent(playerId);
    const [summaryResponse, statsResponse] = await Promise.all([
      fetch(`https://overfast-api.tekrop.fr/players/${encoded}/summary`),
      fetch(`https://overfast-api.tekrop.fr/players/${encoded}/stats/summary?gamemode=competitive&platform=pc`),
    ]);
    if (!summaryResponse.ok) throw new Error(`查询失败（HTTP ${summaryResponse.status}）`);
    payload = {
      summary: await summaryResponse.json(),
      stats: statsResponse.ok ? await statsResponse.json() : {},
    };
  }

  return normalizeIntel(playerId, payload);
}
