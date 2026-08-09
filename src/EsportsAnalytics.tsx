import { useEffect, useMemo, useRef, useState } from "react";
import owtvTeamCatalog from "./owtvTeamCatalog.json";
import owtvMatchLinks from "./owtvMatchLinks.json";
import { Activity, BarChart3, Crosshair, HardDrive, Search, Shield, Swords, Trophy, UserRound, UsersRound } from "lucide-react";
import { bundledHeroRoster } from "./heroRosterData";
import type { EsportsAnalyticsPayload, HeroWinRate, PlayerHeroUsage, TeamHeroUsage } from "./esportsAnalyticsApi";
import type { EsportsMatch } from "./matchTypes";
import PlayerFiveEProfile from "./PlayerFiveEProfile";
import { localizeHeroName, localizeMapName, localizeTournamentName, type UiLocale } from "./esportsI18n";
import { compareNaturalText, compareUsageDesc } from "./sortAlgorithms";

export type AnalyticsMode = "teams" | "players" | "heroes";

interface Props {
  data: EsportsAnalyticsPayload;
  mode: AnalyticsMode;
  matches: EsportsMatch[];
  locale: UiLocale;
  onModeChange: (mode: AnalyticsMode) => void;
}

const number = new Intl.NumberFormat("zh-CN");

function n(value: string | number | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function teamDisplayName(team: string) {
  return team;
}

function teamInitials(team: string) {
  return team.split(/\s+/).map((part) => part[0]).join("");
}

function teamSearchText(team: string) {
  return `${team} ${teamInitials(team)}`;
}

const portraitByHero = new Map(bundledHeroRoster.map((hero) => [normalize(hero.englishName), hero.portrait]));

function HeroPortrait({ hero }: { hero: string }) {
  const portrait = portraitByHero.get(normalize(hero));
  return <span className="draft-hero-portrait">{portrait ? <img src={portrait} alt="" /> : <b>{hero.slice(0, 2).toUpperCase()}</b>}</span>;
}

function TeamMark({ team, logo }: { team: string; logo?: string }) {
  const initials = team.split(/\s+/).map((part) => part[0]).join("").slice(0, 3).toUpperCase();
  return <span className="draft-team-mark">{logo ? <img src={logo} alt="" /> : <><Shield size={20} /><b>{initials}</b></>}</span>;
}

function rate(value: string | number | undefined) {
  return `${(n(value) * 100).toFixed(1)}%`;
}

function playTimeLabel(row: PlayerHeroUsage) {
  const seconds = n(row.play_time_seconds);
  if (!seconds) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours ? `${hours} 小时 ${minutes} 分` : `${minutes} 分钟`;
}

function usageLabel(value: string | number, scope: string, locale: UiLocale) {
  const formatted = number.format(n(value));
  const isSettlementScope = scope === "2025" || scope.startsWith("2025 ") || scope.startsWith("2026 ");
  if (locale === "zh") return isSettlementScope ? `${formatted} 图赛后结算` : scope === "all" ? `${formatted} 次有效出场` : `${formatted} 场有效出场`;
  return isSettlementScope ? `${formatted} post-match map results` : scope === "all" ? `${formatted} valid appearances` : `${formatted} valid match appearances`;
}

function UsageRows({ rows, max, winRates, onSelectHero, selectedHero, locale }: { rows: TeamHeroUsage[] | PlayerHeroUsage[]; max: number; winRates?: Map<string, HeroWinRate>; onSelectHero?: (hero: string) => void; selectedHero?: string; locale: UiLocale }) {
  return <div className="draft-usage-rows">{rows.map((row) => {
    const usage = n(row.usage_count);
    const key = `${"player_name" in row ? row.player_name : row.team_name}|${row.hero_name}`;
    const win = winRates?.get(key);
    return <button type="button" className={`draft-usage-row${selectedHero === row.hero_name ? " active" : ""}`} data-hero={row.hero_name} data-usage={usage} key={key} onClick={() => onSelectHero?.(row.hero_name)}>
      <HeroPortrait hero={row.hero_name} />
      <div className="draft-usage-name"><strong>{localizeHeroName(row.hero_name, locale)}</strong><span>{"role" in row ? row.role : locale === "zh" ? "英雄使用" : "Hero usage"}</span></div>
      <div className="draft-bar"><i style={{ width: `${Math.max(3, usage / Math.max(1, max) * 100)}%` }} /></div>
      <b>{number.format(usage)}</b>
      <em>{win ? `${rate(win.win_rate)} 胜率` : "—"}</em>
    </button>;
  })}</div>;
}

interface TeamMatchEntry {
  id: string;
  tournament: string;
  title: string;
  datetime: string;
  opponent: string;
  scoreFor: number | null;
  scoreAgainst: number | null;
  phase: string;
  source: "schedule" | "archive";
}

function sameTeam(left: string, right: string) {
  return normalize(left) === normalize(right);
}

type MatchLinkKind = "owtv" | "bilibili" | "youtube" | "twitch" | "bilibili-search";

interface TeamHeroMatchLink {
  kind: MatchLinkKind;
  url: string;
}

interface MatchLinkCandidate {
  team1: string;
  team2: string;
  tournament: string;
  startDate: string;
  searchText: string;
  links: TeamHeroMatchLink[];
}

type UsageSortable = {
  usage_count?: string | number;
  team_name?: string;
  player_name?: string;
  hero_name?: string;
};

function compareUsageRows<T extends UsageSortable>(left: T, right: T) {
  return compareUsageDesc(
    left,
    right,
    (item) => n(item.usage_count),
    (item) => [item.team_name, item.player_name, item.hero_name].filter(Boolean).join("|"),
  );
}

function sameTeamPair(candidate: MatchLinkCandidate, team: string, opponent: string) {
  return (sameTeam(candidate.team1, team) && sameTeam(candidate.team2, opponent))
    || (sameTeam(candidate.team2, team) && sameTeam(candidate.team1, opponent));
}

function matchLinkScore(archiveText: string, candidateText: string) {
  const archive = archiveText.toLowerCase();
  const candidate = candidateText.toLowerCase();
  let score = 0;
  const archiveYear = archive.match(/\b20\d{2}\b/)?.[0];
  const candidateYear = candidate.match(/\b20\d{2}\b/)?.[0];
  if (archiveYear && archiveYear === candidateYear) score += 12;
  const archiveStage = archive.match(/(?:stage|阶段|s)\s*([1-9])/i)?.[1];
  const candidateStage = candidate.match(/(?:stage|阶段|s)\s*([1-9])/i)?.[1];
  if (archiveStage && archiveStage === candidateStage) score += 10;
  const archivePhase = /regular\s*season/i.test(archive) ? "regular"
    : /(upper|lower|grand|semi|quarter|playoff|final)/i.test(archive) ? "playoffs" : "";
  const candidatePhase = /(regular[-\s]*stage|regular[-\s]*season)/i.test(candidate) ? "regular"
    : /playoff/i.test(candidate) ? "playoffs" : "";
  if (archivePhase && archivePhase === candidatePhase) score += 18;
  else if (archivePhase && candidatePhase && archivePhase !== candidatePhase) score -= 30;
  for (const token of ["china", "korea", "japan", "emea", "pacific", "north america", "midseason", "world final", "grand final", "playoff", "regular", "bootcamp"]) {
    if (archive.includes(token) && candidate.includes(token)) score += 4;
  }
  return score;
}

function matchLinkLabel(kind: MatchLinkKind, locale: UiLocale) {
  if (kind === "owtv") return "OWTV";
  if (kind === "bilibili") return locale === "zh" ? "B站" : "Bilibili";
  if (kind === "youtube") return "YouTube";
  if (kind === "twitch") return "Twitch";
  return locale === "zh" ? "B站搜索" : "Bilibili search";
}

function stageRank(value: string) {
  const key = normalize(value);
  if (key.includes("grandfinal")) return 5;
  if (key.includes("final")) return 4;
  if (key.includes("semifinal")) return 3;
  if (key.includes("quarterfinal") || key.includes("qf")) return 2;
  if (key.includes("group")) return 1;
  return 0;
}

function placementLabel(entry: TeamMatchEntry, locale: UiLocale) {
  const key = normalize(`${entry.phase} ${entry.title}`);
  const won = entry.scoreFor != null && entry.scoreAgainst != null && entry.scoreFor > entry.scoreAgainst;
  if (key.includes("grandfinal")) return won ? (locale === "zh" ? "冠军" : "Champion") : entry.scoreFor != null ? (locale === "zh" ? "亚军" : "Runner-up") : (locale === "zh" ? "决赛" : "Grand final");
  if (key.includes("semifinal")) return locale === "zh" ? "四强" : "Top 4";
  if (key.includes("quarterfinal") || key.includes("qf")) return locale === "zh" ? "八强" : "Top 8";
  if (key.includes("group")) return locale === "zh" ? "小组赛" : "Group stage";
  return entry.phase || (locale === "zh" ? "已收录" : "Recorded");
}

function mergeRankRows(rows: TeamHeroUsage[], field: "team_name") {
  const merged = new Map<string, TeamHeroUsage>();
  for (const row of rows) {
    const key = `${normalize(row[field])}|${normalize(row.hero_name)}`;
    const current = merged.get(key);
    if (current) {
      current.usage_count = String(n(current.usage_count) + n(row.usage_count));
      current.pick_count = current.usage_count;
    } else merged.set(key, { ...row });
  }
  return Array.from(merged.values()).sort(compareUsageRows);
}

function mergePlayerRankRows(rows: PlayerHeroUsage[]) {
  const merged = new Map<string, PlayerHeroUsage>();
  for (const row of rows) {
    const key = normalize(row.player_name);
    const current = merged.get(key);
    if (current) current.usage_count = String(n(current.usage_count) + n(row.usage_count));
    else merged.set(key, { ...row });
  }
  return Array.from(merged.values()).sort(compareUsageRows);
}

function tournamentInScope(name: string, scope: string) {
  return scope === "all" || (/^20\d{2}$/.test(scope) ? name.startsWith(`${scope} `) : name === scope);
}

export default function EsportsAnalytics({ data, mode, matches, locale, onModeChange }: Props) {
  const scopedOverallUsage = data.overallHeroUsage;
  const pseudoTeams = useMemo(() => {
    const playerNames = new Set(data.playerHeroUsage.map((row) => normalize(row.player_name)));
    const grouped = new Map<string, { name: string; heroes: Set<string>; usage: number }>();
    for (const row of data.teamHeroUsage) {
      const key = normalize(row.team_name);
      const current = grouped.get(key) ?? { name: row.team_name, heroes: new Set<string>(), usage: 0 };
      current.heroes.add(normalize(row.hero_name));
      current.usage += n(row.usage_count);
      grouped.set(key, current);
    }
    return new Set(Array.from(grouped, ([key, value]) => playerNames.has(key) && value.heroes.size === 1 && value.usage <= 4 ? key : "").filter(Boolean));
  }, [data.playerHeroUsage, data.teamHeroUsage]);
  const scopedTeamUsage = useMemo(() => data.teamHeroUsage.filter((row) => !pseudoTeams.has(normalize(row.team_name))), [data.teamHeroUsage, pseudoTeams]);
  const scopedPlayerUsage = data.playerHeroUsage;
  const scopedTournamentUsage = data.tournamentHeroUsage;
  const scopedTournamentTeamUsage = data.tournamentTeamHeroUsage;
  const scopedTournamentPlayerUsage = data.tournamentPlayerHeroUsage;
  const scopedMapUsage = data.mapHeroUsage;
  const teams = useMemo(() => {
    const ordered: string[] = [...owtvTeamCatalog.teams.map((item) => item.name).filter((name): name is string => Boolean(name)), ...scopedTeamUsage.map((row) => row.team_name)];
    const seen = new Set<string>();
    return ordered.filter((name) => {
      const key = normalize(name);
      if (!key || seen.has(key) || pseudoTeams.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [scopedTeamUsage, pseudoTeams]);
  const players = useMemo(() => {
    // Prefer the canonical spelling from the statistics rows.  OWTV's roster
    // catalog occasionally stores an alias with different casing (for example
    // `guxue`), while hero usage stores `Guxue`; keeping the catalog spelling
    // made the exact player filter return an empty hero pool.
    const ordered: string[] = [...scopedPlayerUsage.map((row) => row.player_name), ...owtvTeamCatalog.players.map((item) => item.alias || item.name).filter((name): name is string => Boolean(name))];
    const seen = new Set<string>();
    return ordered.filter((name) => {
      const key = normalize(name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [scopedPlayerUsage]);
  const heroes = useMemo(() => {
    const unique = new Map<string, (typeof scopedOverallUsage)[number]>();
    for (const row of scopedOverallUsage) {
      const key = normalize(row.hero_name);
      const current = unique.get(key);
      if (!current || n(row.usage_count) > n(current.usage_count)) unique.set(key, row);
    }
    return Array.from(unique.values()).sort(compareUsageRows);
  }, [scopedOverallUsage]);
  const tournaments = useMemo(() => {
    const ordered: string[] = [...owtvTeamCatalog.tournaments.map((item) => item.name).filter((name): name is string => Boolean(name)), ...scopedTournamentUsage.map((row) => row.tournament_sheet)];
    const seen = new Set<string>();
    return ordered.filter((name) => {
      const key = normalize(name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [scopedTournamentUsage]);
  const logoByTeam = useMemo(() => {
    const logos = new Map<string, string>();
    for (const item of owtvTeamCatalog.teams) {
      if (item.name && item.imageUrl) logos.set(item.name, item.imageUrl);
    }
    for (const match of matches) {
      if (match.team1 && match.team1Logo) logos.set(match.team1, match.team1Logo);
      if (match.team2 && match.team2Logo) logos.set(match.team2, match.team2Logo);
    }
    return logos;
  }, [matches]);
  const playerProfileByName = useMemo(() => {
    const profiles = new Map<string, (typeof owtvTeamCatalog.players)[number]>();
    for (const item of owtvTeamCatalog.players) {
      const name = item.alias || item.name;
      if (name) profiles.set(normalize(name), item);
    }
    return profiles;
  }, []);
  const [query, setQuery] = useState("");
  const [team, setTeam] = useState(() => teams.includes("Team Falcons") ? "Team Falcons" : teams[0] ?? "");
  const [player, setPlayer] = useState(() => players.includes("Fielder") ? "Fielder" : players[0] ?? "");
  const [hero, setHero] = useState(() => heroes.find((row) => row.hero_name === "Lúcio")?.hero_name ?? heroes[0]?.hero_name ?? "");
  const [tournament, setTournament] = useState("all");
  const [selectedTeamHero, setSelectedTeamHero] = useState("");
  const teamHeroMatchesRef = useRef<HTMLDivElement>(null);
  const owtvPlayerProfile = useMemo(() => owtvTeamCatalog.players.find((item) => normalize(item.alias || item.name || "") === normalize(player)), [player]);
  const teamWin = useMemo(() => new Map(data.teamHeroWinRates.map((row) => [`${row.team_name}|${row.hero_name}`, row])), [data]);
  const playerWin = useMemo(() => new Map(data.playerHeroWinRates.map((row) => [`${row.player_name}|${row.hero_name}`, row])), [data]);

  const teamHeroRows = useMemo(() => {
    if (tournament === "all") return scopedTeamUsage.filter((row) => row.team_name === team).sort(compareUsageRows);
    return mergeRankRows(scopedTournamentTeamUsage.filter((row) => row.team_name === team && tournamentInScope(row.tournament_sheet, tournament)), "team_name")
      .sort(compareUsageRows);
  }, [scopedTeamUsage, scopedTournamentTeamUsage, team, tournament]);
  const teamPlayerRows = useMemo(() => {
    const grouped = new Map<string, PlayerHeroUsage[]>();
    const sourceRows = tournament === "all"
      ? scopedPlayerUsage.filter((item) => item.team_name === team)
      : scopedTournamentPlayerUsage.filter((item) => item.team_name === team && tournamentInScope(item.tournament_sheet, tournament));
    for (const row of sourceRows) grouped.set(row.player_name, [...(grouped.get(row.player_name) ?? []), row]);
    return Array.from(grouped, ([name, rows]) => ({ name, rows: rows.sort(compareUsageRows), total: rows.reduce((sum, row) => sum + n(row.usage_count), 0) })).sort((a, b) => b.total - a.total || compareNaturalText(a.name, b.name));
  }, [scopedPlayerUsage, scopedTournamentPlayerUsage, team, tournament]);
  const playerRows = useMemo(() => {
    const grouped = new Map<string, PlayerHeroUsage>();
    for (const row of scopedPlayerUsage.filter((item) => normalize(item.player_name) === normalize(player))) {
      const key = normalize(row.hero_name);
      const current = grouped.get(key);
      if (!current) {
        grouped.set(key, { ...row });
        continue;
      }
      current.usage_count = String(n(current.usage_count) + n(row.usage_count));
      current.appearance_count = String(n(current.appearance_count) + n(row.appearance_count));
      current.play_time_seconds = String(n(current.play_time_seconds) + n(row.play_time_seconds));
      current.damage_dealt = String(n(current.damage_dealt) + n(row.damage_dealt));
    }
    return Array.from(grouped.values()).sort(compareUsageRows);
  }, [scopedPlayerUsage, player]);
  const selectedPlayerTeam = useMemo(() => {
    const scheduledTeams = new Set(matches.flatMap((match) => [match.team1, match.team2]).map((value) => normalize(value)));
    const catalogTeam = owtvPlayerProfile?.teamNames.find((name) => scheduledTeams.has(normalize(name))) ?? owtvPlayerProfile?.teamNames[0];
    const current = data.playerHeroUsage
      .filter((row) => normalize(row.player_name) === normalize(player))
      .find((row) => scheduledTeams.has(normalize(row.team_name)));
    return catalogTeam ?? current?.team_name ?? playerRows[0]?.team_name ?? "";
  }, [data.playerHeroUsage, matches, owtvPlayerProfile, player, playerRows]);
  const heroTournamentMatches = useMemo(() => data.matchHeroUsage.filter((row) => row.hero_name === hero && tournamentInScope(row.tournament_sheet, tournament)), [data.matchHeroUsage, hero, tournament]);
  const heroTeamRows = useMemo(() => {
    if (tournament === "all") return scopedTeamUsage.filter((row) => row.hero_name === hero).sort(compareUsageRows);
    const exact = scopedTournamentTeamUsage.filter((row) => tournamentInScope(row.tournament_sheet, tournament) && row.hero_name === hero);
    if (exact.length) return mergeRankRows(exact, "team_name");
    const grouped = new Map<string, number>();
    for (const row of heroTournamentMatches) {
      for (const teamName of [row.team_top, row.team_bottom].filter(Boolean)) grouped.set(teamName, (grouped.get(teamName) ?? 0) + n(row.usage_count));
    }
    return Array.from(grouped, ([team_name, usage]) => ({ team_name, hero_name: hero, role: "", usage_count: String(usage), pick_count: String(usage), pick_rate: "0" })).sort(compareUsageRows);
  }, [scopedTeamUsage, scopedTournamentTeamUsage, hero, heroTournamentMatches, tournament]);
  const heroPlayerRows = useMemo(() => {
    if (tournament === "all") return scopedPlayerUsage.filter((row) => row.hero_name === hero).sort(compareUsageRows);
    const exact = scopedTournamentPlayerUsage.filter((row) => tournamentInScope(row.tournament_sheet, tournament) && row.hero_name === hero);
    if (exact.length) return mergePlayerRankRows(exact);
    const eligibleTeams = new Set(heroTeamRows.map((row) => row.team_name));
    return scopedPlayerUsage.filter((row) => row.hero_name === hero && eligibleTeams.has(row.team_name)).sort(compareUsageRows);
  }, [scopedPlayerUsage, scopedTournamentPlayerUsage, hero, heroTeamRows, tournament]);
  const heroTournamentRows = useMemo(() => scopedTournamentUsage.filter((row) => row.hero_name === hero && tournamentInScope(row.tournament_sheet, tournament)).sort(compareUsageRows), [scopedTournamentUsage, hero, tournament]);
  const heroMapRows = useMemo(() => {
    const grouped = new Map<string, (typeof scopedMapUsage)[number]>();
    for (const row of scopedMapUsage.filter((item) => item.hero_name === hero)) {
      const key = normalize(row.map_name);
      const current = grouped.get(key);
      if (current) current.usage_count = String(n(current.usage_count) + n(row.usage_count));
      else grouped.set(key, { ...row });
    }
    return Array.from(grouped.values()).sort(compareUsageRows);
  }, [scopedMapUsage, hero]);
  const heroMatchRows = useMemo(() => {
    const grouped = new Map<string, (typeof heroTournamentMatches)[number]>();
    for (const row of heroTournamentMatches) {
      const teams = [row.team_top, row.team_bottom].sort();
      const key = `${normalize(row.tournament_sheet)}|${normalize(row.match_id)}|${normalize(row.hero_name)}`;
      const current = grouped.get(key);
      if (current) current.usage_count = String(n(current.usage_count) + n(row.usage_count));
      else grouped.set(key, { ...row, team_top: teams[0] ?? "", team_bottom: teams[1] ?? "" });
    }
    return Array.from(grouped.values()).sort(compareUsageRows);
  }, [heroTournamentMatches]);
  const teamMatches = useMemo(() => {
    const entries = new Map<string, TeamMatchEntry>();
    for (const match of matches.filter((item) => sameTeam(item.team1, team) || sameTeam(item.team2, team))) {
      const isTeam1 = sameTeam(match.team1, team);
      entries.set(`schedule:${match.id}`, {
        id: `schedule:${match.id}`,
        tournament: match.event,
        title: `${match.team1} vs ${match.team2}`,
        datetime: match.datetime,
        opponent: isTeam1 ? match.team2 : match.team1,
        scoreFor: isTeam1 ? match.score1 : match.score2,
        scoreAgainst: isTeam1 ? match.score2 : match.score1,
        phase: [match.phase, match.stage].filter(Boolean).join(" · "),
        source: "schedule",
      });
    }
    for (const row of data.matchHeroUsage.filter((item) => item.tournament_sheet.startsWith("2025 ") && (sameTeam(item.team_top, team) || sameTeam(item.team_bottom, team)))) {
      const isTop = sameTeam(row.team_top, team);
      const opponent = isTop ? row.team_bottom : row.team_top;
      const key = `archive:${row.tournament_sheet}:${row.match_id}:${team}`;
      if (!entries.has(key)) entries.set(key, {
        id: key,
        tournament: row.tournament_sheet,
        title: row.match_title.replace(/^S\d+:[^:]+:/, "").replace(/\s+/g, " ").trim(),
        datetime: "",
        opponent,
        scoreFor: null,
        scoreAgainst: null,
        phase: row.match_title.replace(/^S\d+:[^:]+:/, "").split(/\n|\|/)[0].trim(),
        source: "archive",
      });
    }
    return Array.from(entries.values()).sort((a, b) => (b.datetime || b.tournament).localeCompare(a.datetime || a.tournament));
  }, [data.matchHeroUsage, matches, team]);
  const selectedTeamHeroMatches = useMemo(() => {
    if (!selectedTeamHero) return [];
    const grouped = new Map<string, { tournament: string; matchId: string; title: string; opponent: string; usage: number; links: TeamHeroMatchLink[]; evidenceMaps: string[]; evidencePlayers: string[]; metric: string }>();
    for (const row of data.matchHeroUsage) {
      if (row.hero_name !== selectedTeamHero || !tournamentInScope(row.tournament_sheet, tournament)) continue;
      if (!row.team_name || !sameTeam(row.team_name, team)) continue;
      const isTop = sameTeam(row.team_top, team);
      const opponent = isTop ? row.team_bottom : row.team_top;
      const key = `${normalize(row.tournament_sheet)}|${normalize(row.match_id)}|${normalize(row.team_name)}`;
      const current = grouped.get(key);
      if (current) {
        current.usage += n(row.usage_count);
        current.evidenceMaps = Array.from(new Set([...current.evidenceMaps, ...(row.evidence_maps ?? [])]));
        current.evidencePlayers = Array.from(new Set([...current.evidencePlayers, ...(row.evidence_players ?? [])]));
      }
      else grouped.set(key, {
        tournament: row.tournament_sheet,
        matchId: row.match_id,
        title: row.match_title.replace(/^S\d+:[^:]+:/, "").replace(/\s+/g, " ").trim(),
        opponent,
        usage: n(row.usage_count),
        links: [],
        evidenceMaps: row.evidence_maps ?? [],
        evidencePlayers: row.evidence_players ?? [],
        metric: row.metric ?? "",
      });
    }
    const candidates: MatchLinkCandidate[] = [
      ...matches.map((match) => ({
        team1: match.team1,
        team2: match.team2,
        tournament: match.event,
        startDate: match.datetime,
        searchText: [match.event, match.phase, match.stage, match.id, match.owtv, match.bilibili].filter(Boolean).join(" "),
        links: [
          ...(match.owtv ? [{ kind: "owtv" as const, url: match.owtv }] : []),
          ...(match.bilibili ? [{ kind: "bilibili" as const, url: match.bilibili }] : []),
          ...(match.youtube ? [{ kind: "youtube" as const, url: match.youtube }] : []),
          ...(match.twitch ? [{ kind: "twitch" as const, url: match.twitch }] : []),
        ],
      })),
      ...owtvMatchLinks.map((match) => ({
        team1: match.team1,
        team2: match.team2,
        tournament: match.tournament,
        startDate: match.startDate,
        searchText: `${match.tournament} ${match.startDate} ${match.slug} ${match.owtv}`,
        links: [{ kind: "owtv" as const, url: match.owtv }],
      })),
    ];
    for (const entry of grouped.values()) {
      const archiveText = `${entry.tournament} ${entry.title} ${entry.matchId}`;
      const best = candidates
        .filter((candidate) => sameTeamPair(candidate, team, entry.opponent) && candidate.links.length)
        .map((candidate) => ({ candidate, score: matchLinkScore(archiveText, candidate.searchText) }))
        .sort((a, b) => b.score - a.score)[0];
      if (best && best.score >= 18) {
        const seen = new Set<string>();
        entry.links = best.candidate.links.filter((link) => link.url && !seen.has(link.url) && seen.add(link.url));
      }
      if (!entry.links.length) {
        const query = `${teamDisplayName(team)} ${teamDisplayName(entry.opponent)} ${entry.tournament} ${entry.title || entry.matchId}`;
        entry.links = [{ kind: "bilibili-search", url: `https://search.bilibili.com/all?keyword=${encodeURIComponent(query)}` }];
      }
    }
    return Array.from(grouped.values()).sort((a, b) => `${b.tournament}|${b.matchId}`.localeCompare(`${a.tournament}|${a.matchId}`));
  }, [data.matchHeroUsage, matches, selectedTeamHero, team, tournament]);
  const selectedTeamHeroTotal = n(teamHeroRows.find((row) => row.hero_name === selectedTeamHero)?.usage_count);
  const selectedTeamHeroEvidenceTotal = selectedTeamHeroMatches.reduce((sum, entry) => sum + entry.usage, 0);
  const selectedTeamHeroEvidenceComplete = selectedTeamHeroTotal === selectedTeamHeroEvidenceTotal;
  useEffect(() => setSelectedTeamHero(""), [team, tournament]);
  const teamTournamentSummaries = useMemo(() => {
    const grouped = new Map<string, { tournament: string; matches: number; wins: number; losses: number; deepest: TeamMatchEntry }>();
    for (const entry of teamMatches) {
      const current = grouped.get(entry.tournament);
      const won = entry.scoreFor != null && entry.scoreAgainst != null && entry.scoreFor > entry.scoreAgainst;
      const lost = entry.scoreFor != null && entry.scoreAgainst != null && entry.scoreFor < entry.scoreAgainst;
      if (!current) grouped.set(entry.tournament, { tournament: entry.tournament, matches: 1, wins: won ? 1 : 0, losses: lost ? 1 : 0, deepest: entry });
      else {
        current.matches += 1;
        current.wins += won ? 1 : 0;
        current.losses += lost ? 1 : 0;
        if (stageRank(`${entry.phase} ${entry.title}`) > stageRank(`${current.deepest.phase} ${current.deepest.title}`)) current.deepest = entry;
      }
    }
    return Array.from(grouped.values()).sort((a, b) => b.tournament.localeCompare(a.tournament));
  }, [teamMatches]);

  const choices = mode === "teams" ? teams : mode === "players" ? players : heroes.map((row) => row.hero_name);
  const selected = mode === "teams" ? team : mode === "players" ? player : hero;
  const choose = mode === "teams" ? setTeam : mode === "players" ? setPlayer : setHero;
  const normalizedQuery = normalize(query.trim());
  const exactChoices = normalizedQuery ? choices.filter((item) => normalize(item) === normalizedQuery || (mode === "teams" && normalize(teamInitials(item)) === normalizedQuery)) : [];
  const filteredChoices = exactChoices.length ? exactChoices : choices.filter((item) => normalize(`${mode === "teams" ? teamSearchText(item) : item} ${mode === "heroes" ? localizeHeroName(item, locale) : ""}`).includes(normalizedQuery));
  const handleSearch = (value: string) => {
    setQuery(value);
    const search = normalize(value.trim());
    if (!search) return;
    const exact = choices.filter((item) => normalize(item) === search || (mode === "teams" && normalize(teamInitials(item)) === search));
    const matches = exact.length ? exact : choices.filter((item) => normalize(`${mode === "teams" ? teamSearchText(item) : item} ${mode === "heroes" ? localizeHeroName(item, locale) : ""}`).includes(search));
    if (matches.length && !matches.includes(selected)) choose(matches[0]);
  };
  const openHero = (heroName: string) => {
    setHero(heroName);
    setQuery("");
    onModeChange("heroes");
  };
  const openTeamHeroMatches = (heroName: string) => {
    setSelectedTeamHero(heroName);
    window.setTimeout(() => teamHeroMatchesRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  };

  return <section className="draft-room">
    <header className="draft-room-head">
      <div><p className="eyebrow">PRO META DATABASE</p><h2>{mode === "teams" ? "战队战术档案" : mode === "players" ? "选手英雄池" : "英雄职业赛场使用"}</h2></div>
      <div className="draft-source-strip owtv-source-order">
        <strong className="source-primary">{locale === "zh" ? "OWTV \u4e3b\u6570\u636e" : "OWTV primary"}</strong>
        <span><Trophy size={17} /><b>{owtvTeamCatalog.counts.tournaments}</b> {locale === "zh" ? "\u9879\u8d5b\u4e8b" : "tournaments"}</span>
        <span><Swords size={17} /><b>{number.format(owtvTeamCatalog.counts.matches)}</b> {locale === "zh" ? "\u573a\u6bd4\u8d5b" : "matches"}</span>
        <span><UsersRound size={17} /><b>{owtvTeamCatalog.counts.teams}</b> {locale === "zh" ? "\u652f\u6218\u961f" : "teams"}</span>
        <span><UserRound size={17} /><b>{number.format(owtvTeamCatalog.counts.players)}</b> {locale === "zh" ? "\u4f4d\u9009\u624b" : "players"}</span>
        <span title={data.history.coverage}><HardDrive size={17} />{locale === "zh" ? "\u672c\u5730\u6863\u6848 2018\u20142023 / 2025\u20142026" : "Local archive 2018\u20142023 / 2025\u20142026"}</span>
        <a className="output-source" href="https://owtv.gg/" target="_blank" rel="noreferrer"><Activity size={17} />{locale === "zh" ? "\u9010\u573a\u6570\u636e\uff1a2025\u20142026" : "Match data: 2025\u20142026"}</a>
      </div>
    </header>

    <div className="draft-layout">
      <aside className="draft-index">
        <label><Search size={17} /><input value={query} onChange={(event) => handleSearch(event.target.value)} placeholder={mode === "teams" ? "搜索战队" : mode === "players" ? "搜索选手" : "搜索英雄"} /></label>
        <div>{filteredChoices.slice(0, 80).map((item) => <button className={selected === item ? "active" : ""} key={item} onClick={() => choose(item)}>
          {mode === "heroes" ? <HeroPortrait hero={item} /> : mode === "teams" ? <TeamMark team={item} logo={logoByTeam.get(item)} /> : <span className="draft-player-dot">{playerProfileByName.get(normalize(item))?.imageUrl ? <img src={playerProfileByName.get(normalize(item))?.imageUrl || ""} alt="" /> : <UserRound size={17} />}</span>}
          <span>{mode === "heroes" ? localizeHeroName(item, locale) : mode === "teams" ? teamDisplayName(item) : item}</span>
        </button>)}</div>
      </aside>

      <div className="draft-detail">
        {mode === "teams" && <>
          <div className="draft-detail-title"><TeamMark team={team} logo={logoByTeam.get(team)} /><div><small>TEAM PROFILE</small><h3>{teamDisplayName(team)}</h3><p>{teamPlayerRows.length} {locale === "zh" ? "\u4f4d\u9009\u624b" : "players"} {"\u00b7"} {teamHeroRows.length} {locale === "zh" ? "\u4e2a\u82f1\u96c4\u8bb0\u5f55" : "hero records"}</p></div><label className="draft-tournament-filter"><span>{locale === "zh" ? "\u6570\u636e\u8303\u56f4" : "Data scope"}</span><select value={tournament} onChange={(event) => { setTournament(event.target.value); setSelectedTeamHero(""); }}><option value="all">{locale === "zh" ? "\u5168\u751f\u6daf\u7efc\u5408\u82f1\u96c4\u6863\u6848" : "Combined career hero archive"}</option><option value="2026">{locale === "zh" ? "2026 \u8d5b\u540e\u7ed3\u7b97\u6863\u6848" : "2026 post-match archive"}</option><option value="2025">{locale === "zh" ? "2025 \u8d5b\u540e\u7ed3\u7b97\u6863\u6848" : "2025 post-match archive"}</option>{tournaments.filter((item) => !item.startsWith("2025 ") && !item.startsWith("2026 ")).map((item) => <option key={item} value={item}>{localizeTournamentName(item, locale)}</option>)}</select></label></div>
          <div className="draft-kpi-grid">
            {teamHeroRows.slice(0, 4).map((row, index) => <button type="button" className={selectedTeamHero === row.hero_name ? "active" : ""} onClick={() => openTeamHeroMatches(row.hero_name)} key={row.hero_name}><span>0{index + 1}</span><HeroPortrait hero={row.hero_name} /><div><small>{index === 0 ? "第一选择" : "常用英雄"}</small><strong>{localizeHeroName(row.hero_name, locale)}</strong><p>{usageLabel(row.usage_count, tournament, locale)}{n(row.pick_rate) ? ` · ${rate(row.pick_rate)}` : ""}</p></div></button>)}
          </div>
          <div className="draft-two-columns">
            <section>
              <div className="draft-section-title"><BarChart3 size={18} /><h4>{locale === "zh" ? "\u82f1\u96c4\u4f7f\u7528\u8bb0\u5f55" : "Hero usage"}</h4></div>
              <UsageRows rows={teamHeroRows.slice(0, 12)} max={n(teamHeroRows[0]?.usage_count)} onSelectHero={openTeamHeroMatches} selectedHero={selectedTeamHero} locale={locale} />
              {selectedTeamHero && <div ref={teamHeroMatchesRef} className="team-hero-match-detail">
                <div className="draft-section-title"><Swords size={19} /><h4>{locale === "zh" ? "\u4f7f\u7528" : "Used"} {localizeHeroName(selectedTeamHero, locale)} {locale === "zh" ? "\u7684\u6bd4\u8d5b" : "matches"}</h4><span>{selectedTeamHeroMatches.length} {locale === "zh" ? "\u573a" : "matches"} \u00b7 {selectedTeamHeroEvidenceTotal}/{selectedTeamHeroTotal} {locale === "zh" ? "\u56fe" : "maps"}</span><button type="button" onClick={() => setSelectedTeamHero("")} aria-label={locale === "zh" ? "\u5173\u95ed" : "Close"}>{"\u00d7"}</button></div>
                {!selectedTeamHeroEvidenceComplete && <p className="team-hero-match-audit">{locale === "zh" ? `\u6392\u884c\u603b\u6570 ${selectedTeamHeroTotal} \u56fe\uff1b\u5f53\u524d\u6570\u636e\u6e90\u53ef\u4e0b\u94bb\u5230 ${selectedTeamHeroEvidenceTotal} \u56fe\u3002\u672a\u5f3a\u884c\u4f2a\u9020\u7f3a\u5931\u7684\u9010\u573a\u8bb0\u5f55\u3002` : `Ranking total: ${selectedTeamHeroTotal} maps; ${selectedTeamHeroEvidenceTotal} maps can be traced to match records in this source. Missing match rows are not fabricated.`}</p>}
                {selectedTeamHeroMatches.length ? <div className="team-hero-match-list">{selectedTeamHeroMatches.map((entry) => <article key={`${entry.tournament}-${entry.matchId}`} data-match-id={entry.matchId} data-tournament={entry.tournament} data-usage={entry.usage}>
                  <span><strong>{localizeTournamentName(entry.tournament, locale)}</strong><small>{entry.title || entry.matchId}</small></span>
                  <b>{teamDisplayName(team)} <em>VS</em> {teamDisplayName(entry.opponent) || (locale === "zh" ? "\u5bf9\u624b\u5f85\u6838" : "Opponent pending")}</b>
                  <p className="team-hero-match-evidence">{locale === "zh" ? "\u7ed3\u7b97\u4f9d\u636e" : "Result evidence"}\uff1a{entry.evidencePlayers.length ? entry.evidencePlayers.join(" / ") : (locale === "zh" ? "\u793e\u533a\u8d5b\u540e\u9635\u5bb9\u8868" : "community post-match composition sheet")}{entry.evidenceMaps.length ? ` \u00b7 ${entry.evidenceMaps.map((map) => localizeMapName(map, locale)).join(" / ")}` : ""}<small>{locale === "zh" ? "OWTV \u9875\u9762\u4ec5\u7528\u4e8e\u6838\u5bf9\u5bf9\u9635\u4e0e\u5730\u56fe\uff0c\u4e0d\u4fdd\u8bc1\u5c55\u793a\u82f1\u96c4\u9635\u5bb9\u3002" : "OWTV verifies the matchup and maps; it may not display hero compositions."}</small></p>
                  <div className="team-hero-match-actions"><mark>{entry.usage} {locale === "zh" ? "\u56fe\u8d5b\u540e\u7ed3\u7b97" : "post-match maps"}</mark>{entry.links.map((link) => <a key={`${link.kind}-${link.url}`} href={link.url} target="_blank" rel="noreferrer">{matchLinkLabel(link.kind, locale)} <span aria-hidden="true">{String.fromCodePoint(0x2197)}</span></a>)}</div>
                </article>)}</div> : <p className="team-hero-match-empty">{locale === "zh" ? "\u5f53\u524d\u7b5b\u9009\u8303\u56f4\u6ca1\u6709\u53ef\u5173\u8054\u5230\u5177\u4f53\u6bd4\u8d5b\u7684\u8d5b\u540e\u7ed3\u7b97\u8bb0\u5f55\u3002" : "No post-match result can be linked to a specific match in this scope."}</p>}
              </div>}
            </section>
            <section><div className="draft-section-title"><UsersRound size={18} /><h4>{locale === "zh" ? "\u961f\u5185\u9009\u624b\u82f1\u96c4\u6c60" : "Player hero pools"}</h4></div><div className="draft-roster-list">{teamPlayerRows.map((item) => <button key={item.name} onClick={() => { setPlayer(item.name); onModeChange("players"); }}><span><UserRound size={18} /></span><div><strong>{item.name}</strong><small>{item.rows.slice(0, 4).map((row) => localizeHeroName(row.hero_name, locale)).join(" \u00b7 ")}</small></div><b>{number.format(item.total)}</b></button>)}</div></section>
          </div>
          <section className="team-match-history">
            <div className="draft-section-title"><Trophy size={18} /><h4>{locale === "zh" ? "\u6bd4\u8d5b\u8bb0\u5f55\u4e0e\u8d5b\u4e8b\u4f4d\u6b21" : "Matches and tournament finishes"}</h4><span>{locale === "zh" ? `${teamMatches.length} \u573a\u5df2\u6536\u5f55\u6bd4\u8d5b` : `${teamMatches.length} recorded matches`}</span></div>
            <div className="team-placement-strip">{teamTournamentSummaries.map((item) => <article key={item.tournament}>
              <span>{localizeTournamentName(item.tournament, locale)}</span>
              <strong>{placementLabel(item.deepest, locale)}</strong>
              <small>{locale === "zh" ? `${item.matches} \u573a \u00b7 ${item.wins} \u80dc ${item.losses} \u8d1f` : `${item.matches} matches \u00b7 ${item.wins}W ${item.losses}L`}</small>
            </article>)}</div>
            <div className="team-match-list">{teamMatches.map((entry) => {
              const won = entry.scoreFor != null && entry.scoreAgainst != null && entry.scoreFor > entry.scoreAgainst;
              const lost = entry.scoreFor != null && entry.scoreAgainst != null && entry.scoreFor < entry.scoreAgainst;
              return <article key={entry.id}>
                <time>{entry.datetime ? new Date(entry.datetime).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US") : "2025"}</time>
                <span><strong>{localizeTournamentName(entry.tournament, locale)}</strong><small>{entry.phase || placementLabel(entry, locale)}</small></span>
                <b>{teamDisplayName(team)} <em>VS</em> {teamDisplayName(entry.opponent) || (locale === "zh" ? "\u5bf9\u624b\u5f85\u6838" : "Opponent pending")}</b>
                <mark className={won ? "win" : lost ? "loss" : "pending"}>{entry.scoreFor != null && entry.scoreAgainst != null ? `${entry.scoreFor} : ${entry.scoreAgainst}` : placementLabel(entry, locale)}</mark>
              </article>;
            })}</div>
          </section>
        </>}

        {mode === "players" && <PlayerFiveEProfile
          player={player}
          team={selectedPlayerTeam}
          playerRows={playerRows}
          allPlayerRows={scopedPlayerUsage}
          eventPlayerRows={scopedTournamentPlayerUsage}
          winRates={playerWin}
          catalogProfile={owtvPlayerProfile}
          matches={matches}
          locale={locale}
          logoByTeam={logoByTeam}
          onSelectHero={openHero}
          onSelectPlayer={setPlayer}
          renderHero={(name) => <HeroPortrait hero={name} />}
          renderTeam={(name, logo) => <TeamMark team={name} logo={logo} />}
        />}

        {mode === "heroes" && <>
          <div className="draft-detail-title"><HeroPortrait hero={hero} /><div><small>HERO SCOUTING</small><h3>{localizeHeroName(hero, locale)}</h3><p>{tournament === "all" ? usageLabel(n(heroes.find((row) => row.hero_name === hero)?.usage_count), tournament, locale) : `${/^20\d{2}$/.test(tournament) ? (locale === "zh" ? `${tournament} \u5168\u8d5b\u5b63` : `Full ${tournament} season`) : localizeTournamentName(tournament, locale)} · ${usageLabel(heroTournamentRows.reduce((sum, row) => sum + n(row.usage_count), 0), tournament, locale)}${/^20\d{2}$/.test(tournament) ? (locale === "zh" ? " · \u8d5b\u540e\u7ed3\u7b97\u82f1\u96c4" : " · post-match settlement hero") : ""}`}</p></div><label className="draft-tournament-filter"><span>{locale === "zh" ? "\u6570\u636e\u8303\u56f4" : "Data scope"}</span><select value={tournament} onChange={(event) => setTournament(event.target.value)}><option value="all">{locale === "zh" ? "\u5168\u751f\u6daf\u7efc\u5408\u82f1\u96c4\u6863\u6848" : "Combined career hero archive"}</option><option value="2026">{locale === "zh" ? "2026 \u8d5b\u540e\u7ed3\u7b97\u6863\u6848" : "2026 post-match archive"}</option><option value="2025">{locale === "zh" ? "2025 \u8d5b\u540e\u7ed3\u7b97\u6863\u6848" : "2025 post-match archive"}</option>{tournaments.filter((item) => !item.startsWith("2025 ") && !item.startsWith("2026 ")).map((item) => <option key={item} value={item}>{localizeTournamentName(item, locale)}</option>)}</select></label></div>
          <div className="hero-scout-grid">
            <section><div className="draft-section-title"><UsersRound size={18} /><h4>出现最多的战队</h4></div>{heroTeamRows.slice(0, 10).map((row, index) => <button type="button" className="scout-rank" key={row.team_name} onClick={() => { setTeam(row.team_name); setQuery(""); onModeChange("teams"); }}><b>{String(index + 1).padStart(2, "0")}</b><TeamMark team={row.team_name} logo={logoByTeam.get(row.team_name)} /><span><strong>{teamDisplayName(row.team_name)}</strong><small>{usageLabel(row.usage_count, tournament, locale)}{n(row.pick_rate) ? ` · ${rate(row.pick_rate)}` : ""}</small></span><em>{tournament !== "2025" && teamWin.get(`${row.team_name}|${hero}`) ? rate(teamWin.get(`${row.team_name}|${hero}`)?.win_rate) : "—"}</em></button>)}</section>
            <section><div className="draft-section-title"><UserRound size={18} /><h4>出现最多的选手</h4></div>{heroPlayerRows.slice(0, 10).map((row, index) => <div className="scout-rank" key={`${row.player_name}-${row.team_name}`}><b>{String(index + 1).padStart(2, "0")}</b><span className="draft-player-dot"><UserRound size={17} /></span><span><strong>{row.player_name}</strong><small>{teamDisplayName(row.team_name)} · {usageLabel(row.usage_count, tournament, locale)}{playTimeLabel(row) ? ` · ${playTimeLabel(row)}` : ""}</small></span><em>{tournament !== "2025" && playerWin.get(`${row.player_name}|${hero}`) ? rate(playerWin.get(`${row.player_name}|${hero}`)?.win_rate) : "—"}</em></div>)}</section>
            <section><div className="draft-section-title"><Trophy size={18} /><h4>赛事使用分布</h4></div>{heroTournamentRows.slice(0, 10).map((row) => <div className="scout-line" key={row.tournament_sheet}><span>{localizeTournamentName(row.tournament_sheet, locale)}</span><i><b style={{ width: `${n(row.usage_count) / Math.max(1, n(heroTournamentRows[0]?.usage_count)) * 100}%` }} /></i><strong>{n(row.usage_count)}</strong></div>)}</section>
            <section><div className="draft-section-title"><Crosshair size={18} /><h4>地图使用分布</h4></div>{heroMapRows.slice(0, 10).map((row) => <div className="scout-line" key={row.map_name}><span>{localizeMapName(row.map_name, locale)}</span><i><b style={{ width: `${n(row.usage_count) / Math.max(1, n(heroMapRows[0]?.usage_count)) * 100}%` }} /></i><strong>{n(row.usage_count)}</strong></div>)}</section>
          </div>
          <section className="draft-match-usage"><div className="draft-section-title"><Swords size={18} /><h4>包含该英雄的比赛记录</h4></div><div>{heroMatchRows.slice(0, 12).map((row) => <article key={`${row.match_id}-${row.team_top}-${row.team_bottom}`}><span>{row.tournament_sheet}</span><strong>{row.team_top} <em>VS</em> {row.team_bottom}</strong><small>{row.match_title || "职业比赛"}</small><b>{row.usage_count} 图</b></article>)}</div></section>
        </>}
      </div>
    </div>
  </section>;
}
