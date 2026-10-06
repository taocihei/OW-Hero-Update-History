import type { EsportsMatch } from "./matchTypes";

function normalized(value: string) {
  return value.normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
}

function teamKey(value: string) {
  const key = normalized(value);
  const aliases: Record<string, string> = { wbg: "weibogaming", wei: "weibogaming", jd: "jdgaming" };
  return aliases[key] ?? key;
}

function owtvId(match: EsportsMatch) {
  if (Number.isInteger(match.owtvMatchId) && Number(match.owtvMatchId) > 0) return match.owtvMatchId;
  const id = /^owtv:(\d+)$/.exec(match.id)?.[1];
  return id ? Number(id) : undefined;
}

function owtvUrl(match: EsportsMatch) {
  if (!match.owtv) return "";
  try {
    const url = new URL(match.owtv);
    if (url.hostname.toLowerCase() !== "owtv.gg" || !url.pathname.startsWith("/matches/")) return "";
    return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return "";
  }
}

function isNamedTeam(name: string) {
  return Boolean(teamKey(name)) && !/^(?:tbd|tba|unknown|待定|待晋级)$|^(?:winner|loser)\s+of\b/i.test(name.trim());
}

function fixtureKey(match: EsportsMatch) {
  const timestamp = Date.parse(match.datetime);
  if (!Number.isFinite(timestamp) || !isNamedTeam(match.team1) || !isNamedTeam(match.team2)) return "";
  const event = normalized(match.event);
  if (!event) return "";
  return `fixture:${timestamp}|${event}|${[teamKey(match.team1), teamKey(match.team2)].sort().join("|")}`;
}

function matchKeys(match: EsportsMatch) {
  const id = owtvId(match);
  const url = owtvUrl(match);
  return [id && `owtv:${id}`, url && `url:${url}`, match.id && `id:${match.id}`, fixtureKey(match)].filter(Boolean) as string[];
}

function compatible(left: EsportsMatch, right: EsportsMatch) {
  const leftId = owtvId(left);
  const rightId = owtvId(right);
  if (leftId && rightId) return leftId === rightId;
  const leftUrl = owtvUrl(left);
  const rightUrl = owtvUrl(right);
  if (leftUrl && rightUrl && leftUrl !== rightUrl) return false;
  if (left.tournamentId && right.tournamentId && normalized(left.tournamentId) !== normalized(right.tournamentId)) {
    return Boolean(leftUrl && leftUrl === rightUrl) || left.id === right.id;
  }
  return true;
}

function mergeRecord(previous: EsportsMatch, incoming: EsportsMatch): EsportsMatch {
  // Keep the participant order, scores and identity from the same OWTV record.
  // An official schedule can enrich its links, but cannot reverse the result.
  const priority = (match: EsportsMatch) => /^owtv:\d+$/.test(match.id) ? 3 : owtvId(match) ? 2 : owtvUrl(match) ? 1 : 0;
  const preferred = priority(incoming) >= priority(previous) ? incoming : previous;
  const other = preferred === incoming ? previous : incoming;
  const sameOrder = teamKey(preferred.team1) === teamKey(other.team1) && teamKey(preferred.team2) === teamKey(other.team2);
  const reversed = teamKey(preferred.team1) === teamKey(other.team2) && teamKey(preferred.team2) === teamKey(other.team1);
  const sameTeams = sameOrder || reversed;
  const otherScore1 = reversed ? other.score2 : other.score1;
  const otherScore2 = reversed ? other.score1 : other.score2;
  const useOtherScores = sameTeams && preferred.score1 == null && preferred.score2 == null;
  return {
    ...preferred,
    owtvMatchId: owtvId(preferred) ?? owtvId(other),
    owtv: preferred.owtv || other.owtv,
    bilibili: preferred.bilibili || other.bilibili,
    youtube: preferred.youtube || other.youtube,
    twitch: preferred.twitch || other.twitch,
    team1Logo: preferred.team1Logo || (sameTeams ? reversed ? other.team2Logo : other.team1Logo : ""),
    team2Logo: preferred.team2Logo || (sameTeams ? reversed ? other.team1Logo : other.team2Logo : ""),
    score1: useOtherScores ? otherScore1 : preferred.score1,
    score2: useOtherScores ? otherScore2 : preferred.score2,
    tournamentId: preferred.tournamentId || other.tournamentId,
    bracketSide: preferred.bracketSide || other.bracketSide,
    bracketGroup: preferred.bracketGroup || other.bracketGroup,
    bracketMatchNumber: preferred.bracketMatchNumber ?? other.bracketMatchNumber,
    round: preferred.round ?? other.round,
    nextMatchWinnerId: preferred.nextMatchWinnerId ?? other.nextMatchWinnerId,
    nextMatchLoserId: preferred.nextMatchLoserId ?? other.nextMatchLoserId,
    sources: Array.from(new Set([...(previous.sources ?? []), ...(incoming.sources ?? [])])),
  };
}

export function mergeMatchRecords(records: readonly EsportsMatch[]): EsportsMatch[] {
  const merged: EsportsMatch[] = [];
  const indexes = new Map<string, Set<number>>();
  const registered = new Map<number, string[]>();
  const register = (match: EsportsMatch, index: number) => {
    for (const key of registered.get(index) ?? []) indexes.get(key)?.delete(index);
    const keys = matchKeys(match);
    registered.set(index, keys);
    for (const key of keys) {
      const values = indexes.get(key) ?? new Set<number>();
      values.add(index);
      indexes.set(key, values);
    }
  };
  for (const match of records) {
    let index: number | undefined;
    for (const key of matchKeys(match)) {
      const candidates = [...(indexes.get(key) ?? [])].filter((candidate) => compatible(merged[candidate], match));
      if (candidates.length === 1) {
        index = candidates[0];
        break;
      }
    }
    if (index === undefined) {
      index = merged.length;
      merged.push({ ...match });
    } else merged[index] = mergeRecord(merged[index], match);
    register(merged[index], index);
  }
  return merged;
}
