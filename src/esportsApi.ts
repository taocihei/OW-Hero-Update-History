import snapshot from "./esportsSnapshot.json";
import supplement from "./esportsSupplementSnapshot.json";
import type { EsportsMatch, EsportsSchedulePayload, OwtvMatchDetailPayload } from "./matchTypes";

const CACHE_KEY = "ow-hero-history:esports-schedule";
const supplementalMatches = supplement.matches as EsportsMatch[];

function matchKeys(match: EsportsMatch) {
  const aliases: Record<string, string> = { wbg: "weibogaming", wei: "weibogaming", jd: "jdgaming" };
  const team = (value: string) => {
    const key = value.normalize("NFKC").replace(/[^a-z0-9]/gi, "").toLowerCase();
    return aliases[key] ?? key;
  };
  const keys = [
    `id:${match.id}`,
    `fixture:${match.datetime.slice(0, 10)}|${[team(match.team1), team(match.team2)].sort().join("|")}`,
    `time:${match.datetime}|${match.region}`,
  ];
  if (match.owtvMatchId) keys.unshift(`owtv:${match.owtvMatchId}`);
  return keys;
}

function combineMatches(primary: EsportsMatch[]) {
  const merged: EsportsMatch[] = [];
  const aliases = new Map<string, number>();
  const register = (match: EsportsMatch, index: number) => matchKeys(match).forEach((key) => aliases.set(key, index));
  for (const match of supplementalMatches) {
    const index = merged.push(match) - 1;
    register(match, index);
  }
  for (const official of primary) {
    const index = matchKeys(official).map((key) => aliases.get(key)).find((value) => value !== undefined);
    if (index === undefined) {
      const newIndex = merged.push(official) - 1;
      register(official, newIndex);
      continue;
    }
    const extra = merged[index];
    merged[index] = {
      ...official,
      event: extra.event || official.event,
      region: extra.region || official.region,
      phase: extra.phase || official.phase,
      stage: extra.stage || official.stage,
      team1Logo: official.team1Logo || extra.team1Logo,
      team2Logo: official.team2Logo || extra.team2Logo,
      score1: official.score1 ?? extra.score1,
      score2: official.score2 ?? extra.score2,
      owtv: extra.owtv,
      bilibili: extra.bilibili,
      tournamentId: extra.tournamentId,
      owtvMatchId: extra.owtvMatchId ?? official.owtvMatchId,
      bracketSide: extra.bracketSide || official.bracketSide,
      bracketGroup: extra.bracketGroup || official.bracketGroup,
      bracketMatchNumber: extra.bracketMatchNumber ?? official.bracketMatchNumber,
      round: extra.round ?? official.round,
      nextMatchWinnerId: extra.nextMatchWinnerId ?? official.nextMatchWinnerId,
      nextMatchLoserId: extra.nextMatchLoserId ?? official.nextMatchLoserId,
      sources: Array.from(new Set([...(official.sources ?? ["OW Esports"]), ...(extra.sources ?? ["OWTV"])])),
    };
    register(merged[index], index);
    register(official, index);
  }
  return merged;
}

export function mergeEsportsMatches(matches: EsportsMatch[]) {
  return combineMatches(matches);
}

export const competitionCatalog = supplement.tournaments;
export const competitionVideos = supplement.videos;

function validMatches(value: unknown): value is EsportsMatch[] {
  return Array.isArray(value) && value.every((item) => {
    if (!item || typeof item !== "object") return false;
    const match = item as Record<string, unknown>;
    return typeof match.id === "string" && typeof match.datetime === "string"
      && typeof match.team1 === "string" && typeof match.team2 === "string";
  });
}

export function loadEsportsSchedule(): EsportsSchedulePayload {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null") as Partial<EsportsSchedulePayload> | null;
    if (cached && validMatches(cached.matches)) {
      return {
        source: "OW Esports + OWTV + B站",
        syncedAt: cached.syncedAt || "",
        matches: combineMatches(cached.matches),
      };
    }
  } catch {
    // Use the packaged combined snapshot when a local cache is unavailable.
  }
  return {
    source: "OW Esports + OWTV + B站（内置综合快照）",
    syncedAt: "2026-08-03T00:00:00.000Z",
    matches: combineMatches(snapshot as EsportsMatch[]),
  };
}

export async function syncEsportsSchedule(): Promise<EsportsSchedulePayload> {
  if (!("__TAURI_INTERNALS__" in window)) return loadEsportsSchedule();
  const { invoke } = await import("@tauri-apps/api/core");
  const payload = await invoke<EsportsSchedulePayload>("fetch_esports_schedule");
  if (!validMatches(payload.matches)) throw new Error("官方赛程返回的数据格式无效");
  const combined = { ...payload, source: "OW Esports + OWTV + B站", matches: combineMatches(payload.matches) };
  localStorage.setItem(CACHE_KEY, JSON.stringify(combined));
  return combined;
}

export async function loadOwtvMatchIndex(): Promise<EsportsSchedulePayload | null> {
  if (!("__TAURI_INTERNALS__" in window)) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  const payload = await invoke<EsportsSchedulePayload>("fetch_owtv_match_index");
  if (!validMatches(payload.matches)) throw new Error("本地 OWTV 比赛索引格式无效");
  return payload;
}

export async function fetchOwtvMatchDetail(match: EsportsMatch): Promise<OwtvMatchDetailPayload> {
  if (!("__TAURI_INTERNALS__" in window)) {
    return {
      match: {
        id: match.owtvMatchId ?? 0,
        slug: match.owtv?.split("/").filter(Boolean).pop() ?? match.id,
        startDate: match.datetime,
        complete: match.status === "completed",
        live: match.status === "live",
        tournament: match.event,
        region: match.region,
        team1: { id: Number(match.team1Id.replace(/\D/g, "")) || 0, name: match.team1, logo: match.team1Logo },
        team2: { id: Number(match.team2Id.replace(/\D/g, "")) || 0, name: match.team2, logo: match.team2Logo },
        score1: match.score1,
        score2: match.score2,
        sourceUrl: match.owtv ?? "",
      },
      maps: [],
      stats: [],
      source: "浏览器预览",
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<OwtvMatchDetailPayload>("fetch_owtv_match_detail", {
    matchId: match.owtvMatchId ?? null,
    slug: match.owtv?.split("/").filter(Boolean).pop() ?? null,
  });
}
