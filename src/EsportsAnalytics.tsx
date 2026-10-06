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
import { buildUsageView, chooseClubTeam, chooseMatchReference, groupHeroMatches, mergeSameUsage, normalizeAnalyticsText, placementLabel, stageRank, statisticsMatchSource, tournamentInScope, type UsageSource } from "./analyticsUsage";

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
  return normalizeAnalyticsText(value);
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

function usageLabel(value: string | number, _scope: string, locale: UiLocale, source: UsageSource) {
  const formatted = number.format(n(value));
  return source === "settlement"
    ? `${formatted} ${locale === "zh" ? "图赛后结算" : "post-match map appearances"}`
    : `${formatted} ${locale === "zh" ? "条有伤害记录" : "damage-positive records"}`;
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

function matchLinkLabel(kind: MatchLinkKind, locale: UiLocale) {
  if (kind === "owtv") return locale === "zh" ? "OWTV 对阵参考" : "OWTV matchup reference";
  if (kind === "bilibili") return locale === "zh" ? "B站" : "Bilibili";
  if (kind === "youtube") return "YouTube";
  if (kind === "twitch") return "Twitch";
  return locale === "zh" ? "B站搜索" : "Bilibili search";
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

export default function EsportsAnalytics({ data: allData, mode, matches, locale, onModeChange }: Props) {
  const [sourceKind, setSourceKind] = useState<UsageSource>("settlement");
  const data = useMemo(() => buildUsageView(allData, sourceKind), [allData, sourceKind]);
  const resultSource = useMemo(() => statisticsMatchSource(matches), [matches]);
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
      if (!current) unique.set(key, { ...row });
      else current.usage_count = String(n(current.usage_count) + n(row.usage_count));
    }
    return Array.from(unique.values()).sort(compareUsageRows);
  }, [scopedOverallUsage]);
  const tournaments = useMemo(() => {
    const ordered = scopedTournamentUsage.map((row) => row.tournament_sheet);
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
    for (const row of mergeSameUsage(sourceRows, ["player_name", "team_name", "hero_name"])) grouped.set(row.player_name, [...(grouped.get(row.player_name) ?? []), row]);
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
  const selectedPlayerTeam = useMemo(() => chooseClubTeam(
    owtvPlayerProfile?.teamNames ?? [],
    allData.playerHeroUsage.filter((row) => normalize(row.player_name) === normalize(player)),
    owtvTeamCatalog.teams,
    matches,
  ), [allData.playerHeroUsage, matches, owtvPlayerProfile, player]);
  const heroTournamentMatches = useMemo(() => data.matchHeroUsage.filter((row) => row.hero_name === hero && tournamentInScope(row.tournament_sheet, tournament)), [data.matchHeroUsage, hero, tournament]);
  const heroTeamRows = useMemo(() => {
    if (tournament === "all") return scopedTeamUsage.filter((row) => row.hero_name === hero).sort(compareUsageRows);
    const exact = scopedTournamentTeamUsage.filter((row) => tournamentInScope(row.tournament_sheet, tournament) && row.hero_name === hero);
    return mergeRankRows(exact, "team_name");
  }, [scopedTeamUsage, scopedTournamentTeamUsage, hero, heroTournamentMatches, tournament]);
  const heroPlayerRows = useMemo(() => {
    if (tournament === "all") return scopedPlayerUsage.filter((row) => row.hero_name === hero).sort(compareUsageRows);
    const exact = scopedTournamentPlayerUsage.filter((row) => tournamentInScope(row.tournament_sheet, tournament) && row.hero_name === hero);
    return mergePlayerRankRows(exact);
  }, [scopedPlayerUsage, scopedTournamentPlayerUsage, hero, heroTeamRows, tournament]);
  const heroTournamentRows = useMemo(() => scopedTournamentUsage.filter((row) => row.hero_name === hero && tournamentInScope(row.tournament_sheet, tournament)).sort(compareUsageRows), [scopedTournamentUsage, hero, tournament]);
  const heroMapRows = useMemo(() => {
    const grouped = new Map<string, (typeof scopedMapUsage)[number]>();
    for (const row of scopedMapUsage.filter((item) => item.hero_name === hero && tournamentInScope(item.tournament_sheet ?? "", tournament))) {
      const key = normalize(row.map_name);
      const current = grouped.get(key);
      if (current) current.usage_count = String(n(current.usage_count) + n(row.usage_count));
      else grouped.set(key, { ...row });
    }
    return Array.from(grouped.values()).sort(compareUsageRows);
  }, [scopedMapUsage, hero, tournament]);
  const heroMatchRows = useMemo(() => groupHeroMatches(heroTournamentMatches).sort(compareUsageRows), [heroTournamentMatches]);
  const teamMatches = useMemo(() => {
    const entries = new Map<string, TeamMatchEntry>();
    for (const match of resultSource.matches.filter((item) => (sameTeam(item.team1, team) || sameTeam(item.team2, team)) && tournamentInScope([item.event, item.region, item.stage, item.phase].filter(Boolean).join(" "), tournament, item.datetime) && (sourceKind === "settlement" ? /^202[56]-/.test(item.datetime) : /^20(?:18|19|2[0-3])-/.test(item.datetime)))) {
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
    return Array.from(entries.values()).sort((a, b) => (b.datetime || b.tournament).localeCompare(a.datetime || a.tournament));
  }, [resultSource, team, tournament, sourceKind]);
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
        searchText: [match.event, match.datetime, match.phase, match.stage, match.id, match.owtv, match.bilibili].filter(Boolean).join(" "),
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
      const reference = chooseMatchReference(archiveText, candidates.filter((candidate) => sameTeamPair(candidate, team, entry.opponent) && candidate.links.length));
      if (reference) {
        const seen = new Set<string>();
        entry.links = reference.links.filter((link) => link.url && !seen.has(link.url) && seen.add(link.url));
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
  const scopeOptions = <>
    <option value="all">{sourceKind === "settlement" ? (locale === "zh" ? "全部结算记录（2025—2026）" : "All settlement records (2025–2026)") : (locale === "zh" ? "全部伤害记录（2018—2023）" : "All damage records (2018–2023)")}</option>
    {sourceKind === "settlement" && <><option value="2026">2026</option><option value="2025">2025</option></>}
    {tournaments.map((item) => <option key={item} value={item}>{localizeTournamentName(item, locale)}</option>)}
  </>;
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
      <div><p className="eyebrow">PRO META DATABASE</p><h2>{mode === "teams" ? (locale === "zh" ? "战队战术档案" : "Team hero usage") : mode === "players" ? (locale === "zh" ? "选手英雄池" : "Player hero pools") : (locale === "zh" ? "英雄职业赛场使用" : "Hero usage in pro play")}</h2></div>
      <label className="usage-source-selector"><span>{locale === "zh" ? "英雄统计来源" : "Hero usage source"}</span><select value={sourceKind} onChange={(event) => { setSourceKind(event.target.value as UsageSource); setTournament("all"); setSelectedTeamHero(""); }} aria-label={locale === "zh" ? "英雄统计来源" : "Hero usage source"}>
        <option value="settlement">{locale === "zh" ? "赛后结算 · 2025—2026" : "Settlement · 2025–2026"}</option>
        <option value="damage">{locale === "zh" ? "Stats Lab 有伤害记录 · 2018—2023" : "Stats Lab damage · 2018–2023"}</option>
      </select></label>
      <div className="draft-source-strip owtv-source-order">
        <strong className="source-primary">{locale === "zh" ? (sourceKind === "settlement" ? "赛后阵容记录" : "Stats Lab 伤害记录") : (sourceKind === "settlement" ? "Post-match compositions" : "Stats Lab damage")}</strong>
        <span><Trophy size={17} /><b>{new Set(data.tournamentHeroUsage.map((row) => row.tournament_sheet)).size}</b> {locale === "zh" ? "\u9879\u8d5b\u4e8b" : "tournaments"}</span>
        <span><Swords size={17} /><b>{sourceKind === "settlement" ? number.format(new Set(data.matchHeroUsage.map((row) => `${row.tournament_sheet}|${row.match_id}`)).size) : "—"}</b> {locale === "zh" ? "\u573a\u6bd4\u8d5b" : "matches"}</span>
        <span><UsersRound size={17} /><b>{new Set(data.teamHeroUsage.map((row) => normalize(row.team_name))).size}</b> {locale === "zh" ? "\u652f\u6218\u961f" : "teams"}</span>
        <span><UserRound size={17} /><b>{number.format(new Set(data.playerHeroUsage.map((row) => normalize(row.player_name))).size)}</b> {locale === "zh" ? "\u4f4d\u9009\u624b" : "players"}</span>
        <span title={data.history.coverage}><HardDrive size={17} />{locale === "zh" ? (sourceKind === "settlement" ? "2025—2026" : "2018—2023") : (sourceKind === "settlement" ? "2025–2026" : "2018–2023")}</span>
        <a className="output-source" href="https://owtv.gg/" target="_blank" rel="noreferrer"><Activity size={17} />{locale === "zh" ? "OWTV 赛事资料" : "OWTV match reference"}</a>
      </div>
    </header>

    <p className="usage-scope-note">{sourceKind === "settlement" ? (locale === "zh" ? "2025—2026 社区赛后阵容；按战队、比赛、地图、英雄计数。OWTV 提供对阵与赛果链接。" : "2025–2026 community post-match compositions; counted by team, match, map and hero. OWTV supplies matchup and result links.") : (locale === "zh" ? "2018—2023 Stats Lab 有伤害英雄记录；独立统计。此档案未提供逐场英雄下钻。" : "2018–2023 Stats Lab damage-positive hero records, counted separately. Match-level hero drilldown is unavailable.")}</p>
    <div className="draft-layout">
      <aside className="draft-index">
        <label><Search size={17} /><input value={query} onChange={(event) => handleSearch(event.target.value)} aria-label={locale === "zh" ? "搜索战队、选手或英雄" : "Search teams, players or heroes"} placeholder={mode === "teams" ? (locale === "zh" ? "搜索战队" : "Search teams") : mode === "players" ? (locale === "zh" ? "搜索选手" : "Search players") : (locale === "zh" ? "搜索英雄" : "Search heroes")} /></label>
        <div>{filteredChoices.map((item) => <button className={selected === item ? "active" : ""} key={item} onClick={() => choose(item)}>
          {mode === "heroes" ? <HeroPortrait hero={item} /> : mode === "teams" ? <TeamMark team={item} logo={logoByTeam.get(item)} /> : <span className="draft-player-dot">{playerProfileByName.get(normalize(item))?.imageUrl ? <img src={playerProfileByName.get(normalize(item))?.imageUrl || ""} alt="" /> : <UserRound size={17} />}</span>}
          <span>{mode === "heroes" ? localizeHeroName(item, locale) : mode === "teams" ? teamDisplayName(item) : item}</span>
        </button>)}</div>
      </aside>

      <div className="draft-detail">
        {mode === "teams" && <>
          <div className="draft-detail-title"><TeamMark team={team} logo={logoByTeam.get(team)} /><div><small>TEAM PROFILE</small><h3>{teamDisplayName(team)}</h3><p>{teamPlayerRows.length} {locale === "zh" ? "\u4f4d\u9009\u624b" : "players"} {"\u00b7"} {teamHeroRows.length} {locale === "zh" ? "\u4e2a\u82f1\u96c4\u8bb0\u5f55" : "hero records"}</p></div><label className="draft-tournament-filter"><span>{locale === "zh" ? "\u6570\u636e\u8303\u56f4" : "Data scope"}</span><select value={tournament} onChange={(event) => { setTournament(event.target.value); setSelectedTeamHero(""); }}>{scopeOptions}</select></label></div>
          {!teamHeroRows.length && <p className="usage-scope-note">{locale === "zh" ? "该范围尚无该战队的英雄记录。" : "No hero records for this team in the selected scope."}</p>}
          <div className="draft-kpi-grid">
            {teamHeroRows.slice(0, 4).map((row, index) => <button type="button" className={selectedTeamHero === row.hero_name ? "active" : ""} onClick={() => openTeamHeroMatches(row.hero_name)} key={row.hero_name}><span>0{index + 1}</span><HeroPortrait hero={row.hero_name} /><div><small>{index === 0 ? (locale === "zh" ? "第一选择" : "Most used") : (locale === "zh" ? "常用英雄" : "Common pick")}</small><strong>{localizeHeroName(row.hero_name, locale)}</strong><p>{usageLabel(row.usage_count, tournament, locale, sourceKind)}{n(row.pick_rate) ? ` · ${rate(row.pick_rate)}` : ""}</p></div></button>)}
          </div>
          <div className="draft-two-columns">
            <section>
              <div className="draft-section-title"><BarChart3 size={18} /><h4>{locale === "zh" ? "\u82f1\u96c4\u4f7f\u7528\u8bb0\u5f55" : "Hero usage"}</h4></div>
              <UsageRows rows={teamHeroRows.slice(0, 12)} max={n(teamHeroRows[0]?.usage_count)} onSelectHero={openTeamHeroMatches} selectedHero={selectedTeamHero} locale={locale} />
              {selectedTeamHero && <div ref={teamHeroMatchesRef} className="team-hero-match-detail">
                <div className="draft-section-title"><Swords size={19} /><h4>{locale === "zh" ? "\u4f7f\u7528" : "Used"} {localizeHeroName(selectedTeamHero, locale)} {locale === "zh" ? "\u7684\u6bd4\u8d5b" : "matches"}</h4><span>{sourceKind === "settlement" ? `${selectedTeamHeroMatches.length} ${locale === "zh" ? "场" : "matches"} · ${selectedTeamHeroEvidenceTotal}/${selectedTeamHeroTotal} ${locale === "zh" ? "图" : "maps"}` : usageLabel(selectedTeamHeroTotal, tournament, locale, sourceKind)}</span><button type="button" onClick={() => setSelectedTeamHero("")} aria-label={locale === "zh" ? "\u5173\u95ed" : "Close"}>{"\u00d7"}</button></div>
                {sourceKind === "settlement" && !selectedTeamHeroEvidenceComplete && <p className="team-hero-match-audit">{locale === "zh" ? `\u6392\u884c\u603b\u6570 ${selectedTeamHeroTotal} \u56fe\uff1b\u5f53\u524d\u6570\u636e\u6e90\u53ef\u4e0b\u94bb\u5230 ${selectedTeamHeroEvidenceTotal} \u56fe\u3002` : `Ranking total: ${selectedTeamHeroTotal} maps; ${selectedTeamHeroEvidenceTotal} maps can be traced to match records in this source.`}</p>}
                {selectedTeamHeroMatches.length ? <div className="team-hero-match-list">{selectedTeamHeroMatches.map((entry) => <article key={`${entry.tournament}-${entry.matchId}`} data-match-id={entry.matchId} data-tournament={entry.tournament} data-usage={entry.usage}>
                  <span><strong>{localizeTournamentName(entry.tournament, locale)}</strong><small>{entry.title || entry.matchId}</small></span>
                  <b>{teamDisplayName(team)} <em>VS</em> {teamDisplayName(entry.opponent) || (locale === "zh" ? "\u5bf9\u624b\u5f85\u6838" : "Opponent pending")}</b>
                  <p className="team-hero-match-evidence">{locale === "zh" ? "\u7ed3\u7b97\u4f9d\u636e" : "Result evidence"}：{entry.evidencePlayers.length ? entry.evidencePlayers.join(" / ") : (locale === "zh" ? "\u793e\u533a\u8d5b\u540e\u9635\u5bb9\u8868" : "community post-match composition sheet")}{entry.evidenceMaps.length ? ` \u00b7 ${entry.evidenceMaps.map((map) => localizeMapName(map, locale)).join(" / ")}` : ""}<small>{locale === "zh" ? "外链为对阵参考，不是英雄使用来源；同队重赛无法唯一匹配时仅提供搜索。" : "External links are matchup references, not hero-usage sources. Ambiguous rematches only receive a search link."}</small></p>
                  <div className="team-hero-match-actions"><mark>{entry.usage} {locale === "zh" ? "\u56fe\u8d5b\u540e\u7ed3\u7b97" : "post-match maps"}</mark>{entry.links.map((link) => <a key={`${link.kind}-${link.url}`} href={link.url} target="_blank" rel="noreferrer">{matchLinkLabel(link.kind, locale)} <span aria-hidden="true">{String.fromCodePoint(0x2197)}</span></a>)}</div>
                </article>)}</div> : <p className="team-hero-match-empty">{locale === "zh" ? (sourceKind === "damage" ? "Stats Lab 此档案没有逐场英雄明细。" : "该范围暂无该英雄的赛后结算比赛。") : (sourceKind === "damage" ? "This Stats Lab archive has no match-level hero details." : "No settlement match records in this scope.")}</p>}
              </div>}
            </section>
            <section><div className="draft-section-title"><UsersRound size={18} /><h4>{locale === "zh" ? "\u961f\u5185\u9009\u624b\u82f1\u96c4\u6c60" : "Player hero pools"}</h4></div><div className="draft-roster-list">{teamPlayerRows.map((item) => <button key={item.name} onClick={() => { setPlayer(item.name); onModeChange("players"); }}><span><UserRound size={18} /></span><div><strong>{item.name}</strong><small>{item.rows.slice(0, 4).map((row) => localizeHeroName(row.hero_name, locale)).join(" \u00b7 ")}</small></div><b>{number.format(item.total)}</b></button>)}</div></section>
          </div>
          <section className="team-match-history">
            <p className="usage-scope-note">{resultSource.localOwtv ? (locale === "zh" ? "赛果来源：OWTV 本地库；其他来源的赛程参考不重复计入战绩。" : "Results: local OWTV archive. Additional schedule references are not counted again.") : (locale === "zh" ? "赛程参考：尚未读取桌面 OWTV 比赛索引。" : "Schedule reference: desktop OWTV index has not been loaded.")}</p>
            <div className="draft-section-title"><Trophy size={18} /><h4>{locale === "zh" ? "比赛记录与赛事阶段" : "Matches and stages"}</h4><span>{locale === "zh" ? `${teamMatches.length} \u573a\u5df2\u6536\u5f55\u6bd4\u8d5b` : `${teamMatches.length} recorded matches`}</span></div>
            {!teamMatches.length && <p className="usage-scope-note">{locale === "zh" ? "该范围暂无可关联的比赛赛果。" : "No linked match results in this scope."}</p>}
            <div className="team-placement-strip">{teamTournamentSummaries.map((item) => <article key={item.tournament}>
              <span>{localizeTournamentName(item.tournament, locale)}</span>
              <strong>{placementLabel(item.deepest, locale)}</strong>
              <small>{locale === "zh" ? `${item.matches} \u573a \u00b7 ${item.wins} \u80dc ${item.losses} \u8d1f` : `${item.matches} matches \u00b7 ${item.wins}W ${item.losses}L`}</small>
            </article>)}</div>
            <div className="team-match-list">{teamMatches.map((entry) => {
              const won = entry.scoreFor != null && entry.scoreAgainst != null && entry.scoreFor > entry.scoreAgainst;
              const lost = entry.scoreFor != null && entry.scoreAgainst != null && entry.scoreFor < entry.scoreAgainst;
              return <article key={entry.id}>
                <time>{entry.datetime ? new Date(entry.datetime).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US") : "—"}</time>
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
          <div className="draft-detail-title"><HeroPortrait hero={hero} /><div><small>HERO SCOUTING</small><h3>{localizeHeroName(hero, locale)}</h3><p>{tournament === "all" ? usageLabel(n(heroes.find((row) => row.hero_name === hero)?.usage_count), tournament, locale, sourceKind) : `${/^20\d{2}$/.test(tournament) ? (locale === "zh" ? `${tournament} 已收录记录` : `Recorded ${tournament} appearances`) : localizeTournamentName(tournament, locale)} · ${usageLabel(heroTournamentRows.reduce((sum, row) => sum + n(row.usage_count), 0), tournament, locale, sourceKind)}${/^20\d{2}$/.test(tournament) ? (locale === "zh" ? " · \u8d5b\u540e\u7ed3\u7b97\u82f1\u96c4" : " · post-match settlement hero") : ""}`}</p></div><label className="draft-tournament-filter"><span>{locale === "zh" ? "\u6570\u636e\u8303\u56f4" : "Data scope"}</span><select value={tournament} onChange={(event) => setTournament(event.target.value)}>{scopeOptions}</select></label></div>
          {!heroTournamentRows.length && <p className="usage-scope-note">{locale === "zh" ? "该范围尚无该英雄记录。" : "No hero records in the selected scope."}</p>}
          <div className="hero-scout-grid">
            <section><div className="draft-section-title"><UsersRound size={18} /><h4>{locale === "zh" ? "出现最多的战队" : "Teams"}</h4></div>{heroTeamRows.slice(0, 10).map((row, index) => <button type="button" className="scout-rank" key={row.team_name} onClick={() => { setTeam(row.team_name); setQuery(""); onModeChange("teams"); }}><b>{String(index + 1).padStart(2, "0")}</b><TeamMark team={row.team_name} logo={logoByTeam.get(row.team_name)} /><span><strong>{teamDisplayName(row.team_name)}</strong><small>{usageLabel(row.usage_count, tournament, locale, sourceKind)}{n(row.pick_rate) ? ` · ${rate(row.pick_rate)}` : ""}</small></span><em>{tournament !== "2025" && teamWin.get(`${row.team_name}|${hero}`) ? rate(teamWin.get(`${row.team_name}|${hero}`)?.win_rate) : "—"}</em></button>)}</section>
            <section><div className="draft-section-title"><UserRound size={18} /><h4>{locale === "zh" ? "出现最多的选手" : "Players"}</h4></div>{heroPlayerRows.slice(0, 10).map((row, index) => <div className="scout-rank" key={`${row.player_name}-${row.team_name}`}><b>{String(index + 1).padStart(2, "0")}</b><span className="draft-player-dot"><UserRound size={17} /></span><span><strong>{row.player_name}</strong><small>{teamDisplayName(row.team_name)} · {usageLabel(row.usage_count, tournament, locale, sourceKind)}{playTimeLabel(row) ? ` · ${playTimeLabel(row)}` : ""}</small></span><em>{tournament !== "2025" && playerWin.get(`${row.player_name}|${hero}`) ? rate(playerWin.get(`${row.player_name}|${hero}`)?.win_rate) : "—"}</em></div>)}</section>
            <section><div className="draft-section-title"><Trophy size={18} /><h4>{locale === "zh" ? "赛事使用分布" : "Tournament distribution"}</h4></div>{heroTournamentRows.slice(0, 10).map((row) => <div className="scout-line" key={row.tournament_sheet}><span>{localizeTournamentName(row.tournament_sheet, locale)}</span><i><b style={{ width: `${n(row.usage_count) / Math.max(1, n(heroTournamentRows[0]?.usage_count)) * 100}%` }} /></i><strong>{n(row.usage_count)}</strong></div>)}</section>
            <section><div className="draft-section-title"><Crosshair size={18} /><h4>{locale === "zh" ? "地图使用分布" : "Map distribution"}</h4></div><p className="usage-scope-note">{locale === "zh" ? `已定位 ${heroMapRows.reduce((sum, row) => sum + n(row.usage_count), 0)} 条地图记录` : `${heroMapRows.reduce((sum, row) => sum + n(row.usage_count), 0)} map-linked records`}</p>{heroMapRows.slice(0, 10).map((row) => <div className="scout-line" key={row.map_name}><span>{localizeMapName(row.map_name, locale)}</span><i><b style={{ width: `${n(row.usage_count) / Math.max(1, n(heroMapRows[0]?.usage_count)) * 100}%` }} /></i><strong>{n(row.usage_count)}</strong></div>)}</section>
          </div>
          <section className="draft-match-usage"><div className="draft-section-title"><Swords size={18} /><h4>{locale === "zh" ? "包含该英雄的比赛记录" : "Matches with this hero"}</h4></div><div>{heroMatchRows.slice(0, 12).map((row) => <article key={`${row.tournament_sheet}|${row.match_id}|${row.hero_name}`}><span>{row.tournament_sheet}</span><strong>{row.team_top} <em>VS</em> {row.team_bottom}</strong><small>{row.match_title || "职业比赛"}</small><b>{row.usage_count} {locale === "zh" ? "次（双方合计队伍-地图）" : "team-map appearances, both sides"}</b></article>)}</div></section>
        </>}
      </div>
    </div>
  </section>;
}
