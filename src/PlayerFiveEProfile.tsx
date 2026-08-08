import { useEffect, useMemo, useState } from "react";
import { Activity, BarChart3, Crosshair, HeartPulse, LoaderCircle, Shield, Swords, Trophy, UserRound, UsersRound } from "lucide-react";
import type { HeroWinRate, PlayerHeroUsage, TournamentPlayerHeroUsage } from "./esportsAnalyticsApi";
import type { EsportsMatch } from "./matchTypes";
import { fetchOwtvPlayerPerformance, type OwtvPlayerPerformance } from "./playerPerformanceApi";
import { localizeHeroName, type UiLocale } from "./esportsI18n";
import { playerEventSnapshots, type PlayerEventMatch } from "./playerEventSnapshot";
import { compareDateAsc, compareDateDesc, compareEventHistory, compareUsageDesc } from "./sortAlgorithms";

type Tab = "overview" | "data" | "schedule";
type HistorySort = "placement" | "date";

interface Props {
  player: string;
  team: string;
  playerRows: PlayerHeroUsage[];
  allPlayerRows: PlayerHeroUsage[];
  eventPlayerRows: TournamentPlayerHeroUsage[];
  winRates: Map<string, HeroWinRate>;
  matches: EsportsMatch[];
  locale: UiLocale;
  logoByTeam: Map<string, string>;
  onSelectHero: (hero: string) => void;
  onSelectPlayer: (player: string) => void;
  renderHero: (hero: string) => React.ReactNode;
  renderTeam: (team: string, logo?: string) => React.ReactNode;
  catalogProfile?: {
    name?: string | null;
    alias?: string | null;
    role?: string | null;
    nationality?: string | null;
    imageUrl?: string | null;
    teamNames?: string[];
  };
}

const number = new Intl.NumberFormat("zh-CN");
const date = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });

function n(value: string | number | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isPerformanceMatch(match: EsportsMatch | OwtvPlayerPerformance["matches"][number]): match is OwtvPlayerPerformance["matches"][number] {
  return "eliminations" in match;
}

function roleName(role?: string) {
  return ({ TANK: "坦克", DAMAGE: "输出", SUPPORT: "支援" } as Record<string, string>)[role ?? ""] ?? role ?? "职业选手";
}

function matchResult(match: Pick<EsportsMatch, "team1" | "team2" | "score1" | "score2">, team: string) {
  const left = normalize(match.team1) === normalize(team);
  const own = left ? match.score1 : match.score2;
  const opponent = left ? match.score2 : match.score1;
  if (own == null || opponent == null || Number(own) === Number(opponent)) return 0;
  return Number(own) > Number(opponent) ? 1 : -1;
}

function tournamentPlacement(teamRows: EsportsMatch[], allRows: EsportsMatch[], team: string, locale: UiLocale) {
  const completed = teamRows.filter((match) => match.score1 != null && match.score2 != null).sort(compareDateAsc);
  const final = completed.filter((match) => match.bracketSide === "grand_final").pop();
  if (final) {
    const rank = matchResult(final, team) > 0 ? 1 : 2;
    return { rank, label: locale === "zh" ? `第 ${rank} 名` : `#${rank}` };
  }
  const thirdPlace = completed.filter((match) => match.bracketSide === "third_place").pop();
  if (thirdPlace) {
    const rank = matchResult(thirdPlace, team) > 0 ? 3 : 4;
    return { rank, label: locale === "zh" ? `第 ${rank} 名` : `#${rank}` };
  }
  const lastLoss = [...completed].reverse().find((match) => matchResult(match, team) < 0);
  if (lastLoss?.bracketSide === "losers") {
    const grandFinal = allRows.find((match) => match.bracketSide === "grand_final");
    if (grandFinal?.bracketMatchNumber != null && lastLoss.bracketMatchNumber === grandFinal.bracketMatchNumber - 1) {
      return { rank: 3, label: locale === "zh" ? "第 3 名" : "#3" };
    }
  }
  const roundText = `${lastLoss?.stage ?? ""} ${lastLoss?.phase ?? ""}`.toLowerCase();
  if (/semi.?final|半决赛/.test(roundText)) return { rank: 3, label: locale === "zh" ? "第 3—4 名" : "#3—4" };
  if (/quarter.?final|四分之一/.test(roundText)) return { rank: 5, label: locale === "zh" ? "第 5—8 名" : "#5—8" };
  return { rank: null, label: locale === "zh" ? "名次待核" : "Unranked" };
}

export default function PlayerFiveEProfile(props: Props) {
  const { player, team, playerRows, allPlayerRows, eventPlayerRows, winRates, matches, locale, logoByTeam, onSelectHero, onSelectPlayer, renderHero, renderTeam, catalogProfile } = props;
  const [tab, setTab] = useState<Tab>("overview");
  const [performance, setPerformance] = useState<OwtvPlayerPerformance | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncingNew, setSyncingNew] = useState(false);
  const [error, setError] = useState("");
  const [historySort, setHistorySort] = useState<HistorySort>("placement");
  const eventSnapshots = useMemo(() => playerEventSnapshots(player), [player]);
  const [eventScope, setEventScope] = useState("all");

  useEffect(() => {
    setEventScope(eventSnapshots[0]?.event ?? "all");
  }, [eventSnapshots, player]);

  const selectedEventSnapshot = useMemo(() => eventSnapshots.find((item) => item.event === eventScope) ?? null, [eventScope, eventSnapshots]);

  const teammates = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of allPlayerRows.filter((item) => item.team_name === team && item.player_name !== player)) {
      totals.set(row.player_name, (totals.get(row.player_name) ?? 0) + n(row.usage_count));
    }
    const rows = Array.from(totals, ([name, total]) => ({ name, total }))
      .sort((a, b) => compareUsageDesc(a, b, (item) => item.total, (item) => item.name));
    const eventRoster = eventSnapshots[0]?.roster.filter((name) => normalize(name) !== normalize(player)).map((name) => ({ name, total: totals.get(name) ?? 0 })) ?? [];
    return (eventRoster.length ? eventRoster : rows).slice(0, 4);
  }, [allPlayerRows, eventSnapshots, player, team]);

  const teamMatches = useMemo(() => {
    const key = normalize(team);
    return matches.filter((match) => normalize(match.team1) === key || normalize(match.team2) === key)
      .sort(compareDateDesc);
  }, [matches, team]);

  const eventRows = useMemo(() => {
    const grouped = new Map<string, { matches: number; resultMatches: number; wins: number; latest: string }>();
    const merged = new Map<string, EsportsMatch | OwtvPlayerPerformance["matches"][number]>();
    teamMatches.forEach((match) => merged.set(match.id, match));
    performance?.matches.forEach((match) => {
      if (!merged.has(match.id)) merged.set(match.id, match);
    });
    for (const match of merged.values()) {
      const current = grouped.get(match.event) ?? { matches: 0, resultMatches: 0, wins: 0, latest: "" };
      current.matches += 1;
      const result = matchResult(match, team);
      if (result !== 0) current.resultMatches += 1;
      if (result > 0) current.wins += 1;
      current.latest = current.latest > match.datetime ? current.latest : match.datetime;
      grouped.set(match.event, current);
    }
    const rows = Array.from(grouped, ([name, value]) => {
      const eventMatches = matches.filter((match) => match.event === name);
      const teamEventMatches = teamMatches.filter((match) => match.event === name);
      return { name, ...value, placement: tournamentPlacement(teamEventMatches, eventMatches, team, locale) };
    });
    return rows.sort((a, b) => compareEventHistory(a, b, historySort));
  }, [historySort, locale, matches, performance, team, teamMatches]);

  const eventOptions = useMemo(() => {
    const entries = new Map<string, string>();
    eventSnapshots.forEach((item) => entries.set(normalize(item.event), item.event));
    eventRows.forEach((item) => entries.set(normalize(item.name), item.name));
    return Array.from(entries.values());
  }, [eventRows, eventSnapshots]);

  const genericEventMatches = useMemo(() => {
    if (eventScope === "all" || selectedEventSnapshot) return [];
    const scopeKey = normalize(eventScope);
    const matchesScope = (match: EsportsMatch | OwtvPlayerPerformance["matches"][number]) => {
      const eventKey = normalize(match.event);
      return eventKey === scopeKey || eventKey.includes(scopeKey) || scopeKey.includes(eventKey);
    };
    const merged = new Map<string, EsportsMatch | OwtvPlayerPerformance["matches"][number]>();
    teamMatches.filter(matchesScope).forEach((match) => merged.set(match.id, match));
    (performance?.matches ?? []).filter(matchesScope).forEach((match) => merged.set(match.id, match));
    return Array.from(merged.values()).sort(compareDateDesc);
  }, [eventScope, performance, selectedEventSnapshot, teamMatches]);

  const eventTotals = useMemo(() => {
    const rows = selectedEventSnapshot?.matches ?? genericEventMatches.filter(isPerformanceMatch);
    if (!rows.length || eventScope === "all") return null;
    return rows.reduce((sum, match) => ({
      eliminations: sum.eliminations + match.eliminations,
      assists: sum.assists + match.assists,
      deaths: sum.deaths + match.deaths,
      damage: sum.damage + match.damage,
      healing: sum.healing + match.healing,
      mitigation: sum.mitigation + match.mitigation,
      mapCount: sum.mapCount + ("mapAppearances" in match ? match.mapAppearances : match.mapCount),
    }), { eliminations: 0, assists: 0, deaths: 0, damage: 0, healing: 0, mitigation: 0, mapCount: 0 });
  }, [eventScope, genericEventMatches, selectedEventSnapshot]);

  const selectedEventHeroRows = useMemo(() => {
    if (eventScope === "all") return [];
    if (selectedEventSnapshot) return selectedEventSnapshot.heroes;
    const scopeKey = normalize(eventScope);
    const grouped = new Map<string, number>();
    for (const row of eventPlayerRows) {
      if (normalize(row.player_name) !== normalize(player)) continue;
      const eventKey = normalize(row.tournament_sheet);
      if (eventKey !== scopeKey && !eventKey.includes(scopeKey) && !scopeKey.includes(eventKey)) continue;
      grouped.set(row.hero_name, (grouped.get(row.hero_name) ?? 0) + n(row.usage_count));
    }
    return Array.from(grouped, ([hero, mapAppearances]) => ({ hero, mapAppearances }))
      .sort((a, b) => compareUsageDesc(a, b, (item) => item.mapAppearances, (item) => item.hero));
  }, [eventPlayerRows, eventScope, player, selectedEventSnapshot]);

  const selectedEventRow = useMemo(() => eventRows.find((row) => normalize(row.name) === normalize(eventScope)) ?? null, [eventRows, eventScope]);
  const selectedEventMatchCount = selectedEventSnapshot?.matches.length ?? genericEventMatches.length;
  const selectedEventPlacement = selectedEventSnapshot?.placement ?? selectedEventRow?.placement.label ?? "名次待核";

  const heroSamples = useMemo(() => playerRows.map((row) => {
    const win = winRates.get(`${player}|${row.hero_name}`);
    return { row, played: n(win?.matches_played), wins: n(win?.wins) };
  }), [player, playerRows, winRates]);
  const heroSources = useMemo(() => {
    const sources = new Map<string, Set<string>>();
    const add = (hero: string, source: string) => {
      const key = normalize(hero);
      const current = sources.get(key) ?? new Set<string>();
      current.add(source);
      sources.set(key, current);
    };
    for (const row of allPlayerRows.filter((item) => normalize(item.player_name) === normalize(player))) {
      if (row.metric === "damage_positive_fallback" || row.damage_verified) add(row.hero_name, "\u9020\u6210\u4f24\u5bb3");
    }
    for (const row of eventPlayerRows.filter((item) => normalize(item.player_name) === normalize(player))) {
      if (row.metric === "post_match_settlement_hero" || row.tournament_sheet.startsWith("2025 ")) add(row.hero_name, "\u8d5b\u540e\u7ed3\u7b97");
      else if (row.metric === "post_match_settlement_hero" || row.tournament_sheet.startsWith("2026 ") || row.metric === "scoresheet_map_appearance") add(row.hero_name, "\u8d5b\u540e\u7ed3\u7b97");
    }
    return sources;
  }, [allPlayerRows, eventPlayerRows, player]);
  const totalHeroUses = playerRows.reduce((sum, row) => sum + n(row.usage_count), 0);
  const totalSamples = heroSamples.reduce((sum, item) => sum + item.played, 0);
  const totalWins = heroSamples.reduce((sum, item) => sum + item.wins, 0);
  const winRate = totalSamples ? totalWins / totalSamples * 100 : 0;
  const activeTotals = eventScope === "all" ? performance?.totals ?? null : eventTotals;
  const activeMapCount = eventScope === "all" ? performance?.mapCount ?? 0 : eventTotals?.mapCount ?? 0;
  const maps = Math.max(1, activeMapCount);
  const average = (key: "eliminations" | "assists" | "deaths" | "damage" | "healing" | "mitigation") => (activeTotals?.[key] ?? 0) / maps;

  useEffect(() => {
    let active = true;
    setPerformance(null);
    setError("");
    setLoading(true);
    setSyncingNew(false);
    fetchOwtvPlayerPerformance(player, team, matches).then((payload) => {
      if (!active) return;
      setPerformance(payload);
      setLoading(false);
      const syncKey = `ow-hero-history:player-performance-sync:${normalize(player)}:${normalize(team)}`;
      const lastSync = Number(localStorage.getItem(syncKey) ?? 0);
      if (Date.now() - lastSync < 6 * 60 * 60 * 1000) return;
      localStorage.setItem(syncKey, String(Date.now()));
      setSyncingNew(true);
      void fetchOwtvPlayerPerformance(player, team, matches, { syncNew: true, maxCandidates: 18 }).then((updated) => {
        if (active) setPerformance(updated);
      }).catch(() => {
        localStorage.removeItem(syncKey);
      }).finally(() => {
        if (active) setSyncingNew(false);
      });
    }).catch((reason) => {
      if (active) {
        setError(reason instanceof Error ? reason.message : String(reason));
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [matches, player, team]);

  const allMatchRows = useMemo(() => {
    const merged = new Map<string, EsportsMatch | OwtvPlayerPerformance["matches"][number]>();
    teamMatches.forEach((match) => merged.set(match.id, match));
    performance?.matches.forEach((match) => {
      merged.set(match.id, match);
    });
    return Array.from(merged.values()).sort(compareDateDesc);
  }, [performance, teamMatches]);
  const scopedMatchRows = eventScope === "all" ? allMatchRows : selectedEventSnapshot?.matches ?? genericEventMatches;
  const recentRows = scopedMatchRows.slice(0, 6);

  return <div className="five-player">
    <header className="five-player-head">
      <div className="five-player-portrait">
        {performance?.profile?.imageUrl || catalogProfile?.imageUrl ? <img src={performance?.profile?.imageUrl || catalogProfile?.imageUrl || ""} alt="" /> : <><UserRound size={52} /><small>OWTV 暂无头像</small></>}
      </div>
      <div className="five-player-id">
        <small>PLAYER PROFILE</small>
        <h3>{player}</h3>
        <p>{performance?.profile?.nationality?.toUpperCase() || catalogProfile?.nationality?.toUpperCase() || "PRO"} · {roleName(performance?.profile?.playerRole || catalogProfile?.role || undefined)}</p>
        <span>当前战队：<b>{team || "待确认"}</b></span>
      </div>
      <div className="five-player-teammark">{renderTeam(team, logoByTeam.get(team))}</div>
      <section className="five-teammates">
        <h4>当前队友</h4>
        <div>{teammates.map((item) => <button key={item.name} onClick={() => onSelectPlayer(item.name)}>
          <span><UserRound size={22} /></span><strong>{item.name}</strong><small>{item.total ? `${number.format(item.total)} 次英雄记录` : selectedEventSnapshot ? "本届赛事队友" : "队友"}</small>
        </button>)}</div>
      </section>
    </header>

    <nav className="five-player-tabs">
      <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>基础信息</button>
      <button className={tab === "data" ? "active" : ""} onClick={() => setTab("data")}>数据</button>
      <button className={tab === "schedule" ? "active" : ""} onClick={() => setTab("schedule")}>赛程</button>
      <label className="five-event-select"><small>查看赛事</small><select value={eventScope} onChange={(event) => setEventScope(event.target.value)}>
        <option value="all">全部生涯</option>
        {eventOptions.map((item) => <option key={item} value={item}>{item}</option>)}
      </select></label>
      <span title={performance?.archivePath || "OWTV 本地数据库"}>{loading ? <><LoaderCircle className="spin" size={15} /> 正在读取 OWTV 本地库</> : syncingNew ? <><LoaderCircle className="spin" size={15} /> OWTV 本地数据已显示 · 后台检查新增比赛</> : performance ? `OWTV · ${performance.matchCount} 场 / ${performance.mapCount} 图${performance.fetchedMatchCount ? ` · 新增 ${performance.fetchedMatchCount} 场` : " · 已是最新"}` : "OWTV 主库 · 英雄使用由其他来源补充"}</span>
    </nav>

    {tab === "overview" && <div className="five-overview">
      {eventScope !== "all" && <section className="five-event-focus">
        <div className="five-event-focus-title">
          <span><Trophy size={18} />{selectedEventPlacement}</span>
          <div><small>EVENT DRILLDOWN</small><h4>{eventScope}</h4><p>{selectedEventMatchCount} 场比赛 · {eventTotals?.mapCount ?? 0} 图由 {player} 出场 · {selectedEventSnapshot ? "OWTV 数据 + B站录像英雄核验" : "本地档案 + OWTV 赛后数据"}</p></div>
        </div>
        <div className="five-event-heroes">
          {selectedEventHeroRows.slice(0, 5).map((item, index) => <button key={item.hero} onClick={() => onSelectHero(item.hero)}>
            <em>#{index + 1}</em>{renderHero(item.hero)}<span><strong>{localizeHeroName(item.hero, locale)}</strong><small>{item.mapAppearances} 图出场{index === 0 ? " · 使用最多" : ""}</small></span>
          </button>)}
          {!selectedEventHeroRows.length && <div className="five-event-heroes-empty">本届逐场英雄尚未进入权威数据源</div>}
        </div>
        <p className="five-event-team-note"><UsersRound size={16} /><b>{selectedEventSnapshot ? "同队坦克英雄分工" : "赛事英雄使用"}</b>{selectedEventSnapshot?.teamTankNote ?? (selectedEventHeroRows[0] ? `${player} 使用最多的是 ${localizeHeroName(selectedEventHeroRows[0].hero, locale)}，共 ${selectedEventHeroRows[0].mapAppearances} 次记录。` : "逐场英雄将在录像核验后直接补入对应比赛。")}</p>
      </section>}
      <section className="five-data-overview">
        <div className="five-section-head"><h4>{eventScope !== "all" ? `${eventScope} 数据总览` : "OWTV 生涯数据总览"}</h4><span>{eventScope !== "all" ? "赛后结算英雄优先 · 造成伤害英雄补充" : "赛后结算英雄 → 造成伤害英雄"}</span></div>
        <div className="five-metric-grid">
          <article><span>{eventScope !== "all" ? "出场英雄" : "英雄使用"}</span><b>{eventScope !== "all" ? selectedEventHeroRows.length || "—" : number.format(totalHeroUses)}</b><small>{eventScope !== "all" ? (selectedEventHeroRows[0] ? `${selectedEventHeroRows[0].mapAppearances} 图${localizeHeroName(selectedEventHeroRows[0].hero, locale)}最多` : "等待逐场英雄核验") : `${playerRows.length} 个英雄`}</small></article>
          <article><span>{eventScope !== "all" ? "比赛战绩" : "样本胜率"}</span><b>{eventScope !== "all" ? `${selectedEventRow?.wins ?? selectedEventSnapshot?.matches.filter((match) => match.scoreFor > match.scoreAgainst).length ?? 0} 胜 ${Math.max(0, (selectedEventRow?.resultMatches ?? selectedEventSnapshot?.matches.length ?? 0) - (selectedEventRow?.wins ?? selectedEventSnapshot?.matches.filter((match) => match.scoreFor > match.scoreAgainst).length ?? 0))} 负` : winRate ? `${winRate.toFixed(1)}%` : "—"}</b><small>{eventScope !== "all" ? selectedEventPlacement : totalSamples ? `${number.format(totalSamples)} 次胜负样本` : "Stats Lab 未提供胜负字段"}</small></article>
          <article><span>每图击杀</span><b>{activeTotals ? average("eliminations").toFixed(1) : "—"}</b><small>{activeMapCount} 图出场</small></article>
          <article><span>每图死亡</span><b>{activeTotals ? average("deaths").toFixed(1) : "—"}</b><small>按实际出场地图计算</small></article>
          <article><span>每图伤害</span><b>{activeTotals ? number.format(Math.round(average("damage"))) : "—"}</b><small>OWTV 赛后统计</small></article>
          <article><span>每图减伤</span><b>{activeTotals ? number.format(Math.round(average("mitigation"))) : "—"}</b><small>OWTV 赛后统计</small></article>
        </div>
        {error && <p className="five-data-error">数据读取失败：{error}</p>}
      </section>

      <section className="five-recent">
        <div className="five-section-head"><h4>{eventScope !== "all" ? "本届逐场对阵、英雄与数据" : "最近比赛统计"}</h4><span>{selectedEventSnapshot ? "英雄来自 B站比赛录像核验" : eventScope !== "all" ? "每场统一显示击杀、助攻、死亡、伤害、治疗和减伤" : (recentRows as Array<EsportsMatch | OwtvPlayerPerformance["matches"][number]>).some((match) => match.score1 == null || match.score2 == null) ? "部分历史比赛无比分字段" : "已收录赛果"}</span><button onClick={() => setTab("schedule")}>查看全部</button></div>
        {selectedEventSnapshot ? <EventMatchRows rows={selectedEventSnapshot.matches} locale={locale} renderHero={renderHero} detailed player={player} team={team} /> : <MatchRows rows={recentRows.slice(0, 5) as Array<EsportsMatch | OwtvPlayerPerformance["matches"][number]>} team={team} detailed={eventScope !== "all"} />}
      </section>

      {eventScope === "all" && <section className="five-history">
        <div className="five-section-head"><h4>赛事经历</h4><div className="five-history-sort"><span>{eventRows.length} 项赛事</span><button aria-pressed={historySort === "placement"} className={historySort === "placement" ? "active" : ""} onClick={() => setHistorySort("placement")}>按名次</button><button aria-pressed={historySort === "date"} className={historySort === "date" ? "active" : ""} onClick={() => setHistorySort("date")}>按时间</button></div></div>
        <div>{eventRows.map((event) => <article key={event.name} data-rank={event.placement.rank ?? "unranked"} data-latest={event.latest}>
          <b><Trophy size={15} />{event.placement.label}</b><span className="five-history-name"><strong>{event.name}</strong><small>{event.latest ? date.format(new Date(event.latest)) : "—"}</small></span><span>{event.resultMatches ? `${event.matches} 场 · ${event.wins} 胜` : `${event.matches} 场统计`}</span>
        </article>)}</div>
      </section>}

      {eventScope === "all" && <section className="five-hero-pool">
        <div className="five-section-head"><h4>英雄有效出场</h4><span>赛后结算为准 · 缺失时按造成伤害补充</span></div>
        <div>{playerRows.slice(0, 10).map((row, index) => <button key={`${row.hero_name}-${index}`} onClick={() => onSelectHero(row.hero_name)}>
          <em>#{index + 1}</em>{renderHero(row.hero_name)}<span><strong>{localizeHeroName(row.hero_name, locale)}</strong><small>{number.format(n(row.usage_count))} 次 · {Array.from(heroSources.get(normalize(row.hero_name)) ?? ["补充数据"]).join(" + ")}</small></span><b>{winRates.get(`${player}|${row.hero_name}`) ? `${(n(winRates.get(`${player}|${row.hero_name}`)?.win_rate) * 100).toFixed(1)}%` : "—"}</b>
        </button>)}</div>
      </section>}
    </div>}

    {tab === "data" && <div className="five-data-tab">
      <div className="five-detail-metrics">
        <article><Crosshair /><span>击杀</span><b>{number.format(Math.round(activeTotals?.eliminations ?? 0))}</b></article>
        <article><Swords /><span>助攻</span><b>{number.format(Math.round(activeTotals?.assists ?? 0))}</b></article>
        <article><Activity /><span>伤害</span><b>{number.format(Math.round(activeTotals?.damage ?? 0))}</b></article>
        <article><HeartPulse /><span>治疗</span><b>{number.format(Math.round(activeTotals?.healing ?? 0))}</b></article>
        <article><Shield /><span>减伤</span><b>{number.format(Math.round(activeTotals?.mitigation ?? 0))}</b></article>
        <article><BarChart3 /><span>KDA</span><b>{activeTotals ? ((activeTotals.eliminations + activeTotals.assists) / Math.max(1, activeTotals.deaths)).toFixed(2) : "—"}</b></article>
      </div>
      <section className="five-stat-table"><div className="five-section-head"><h4>逐场表现</h4><span>2018—2023：暴雪 Stats Lab；当前赛事：OWTV 增量采集</span></div>
        {selectedEventSnapshot ? <EventMatchRows rows={selectedEventSnapshot.matches} locale={locale} renderHero={renderHero} detailed player={player} team={team} /> : performance?.matches.length ? <MatchRows rows={eventScope === "all" ? performance.matches : genericEventMatches} team={team} detailed /> : <div className="five-empty-data">当前选手最近比赛未匹配到 OWTV 逐地图统计。</div>}
      </section>
    </div>}

    {tab === "schedule" && <section className="five-schedule-tab">
      <div className="five-section-head"><h4>{eventScope !== "all" ? `${eventScope} · 逐场英雄与数据` : "全部比赛统计与赛果"}</h4><span>{eventScope !== "all" ? `${selectedEventMatchCount} 场 · 点击数据或录像` : `${allMatchRows.length} 场已收录；有赛后数据的比赛全部展开六项统计`}</span></div>
      {selectedEventSnapshot ? <EventMatchRows rows={selectedEventSnapshot.matches} locale={locale} renderHero={renderHero} detailed player={player} team={team} /> : <MatchRows rows={eventScope === "all" ? allMatchRows : genericEventMatches} team={team} detailed />}
    </section>}
  </div>;
}

function EventMatchRows({ rows, locale, renderHero, player, team, detailed = false }: { rows: PlayerEventMatch[]; locale: UiLocale; renderHero: (hero: string) => React.ReactNode; player: string; team: string; detailed?: boolean }) {
  return <div className={`five-event-match-rows${detailed ? " detailed" : ""}`}>{rows.map((match) => <article key={match.id}>
    <span className="five-event-match-date">{date.format(new Date(match.datetime))}<small>{match.scoreFor > match.scoreAgainst ? "胜" : "负"} · {player} {match.mapAppearances} 图出场</small></span>
    <strong><b>{team}</b><em className={match.scoreFor > match.scoreAgainst ? "win" : ""}>{match.scoreFor} : {match.scoreAgainst}</em><b>{match.opponent}</b></strong>
    <div className="five-event-match-heroes">{match.heroes.map((hero) => <span key={hero}>{renderHero(hero)}<b>{localizeHeroName(hero, locale)}</b></span>)}</div>
    {detailed && <div className="five-event-match-stats"><span>{match.eliminations} 击杀</span><span>{match.assists} 助攻</span><span>{match.deaths} 死亡</span><span>{number.format(match.damage)} 伤害</span><span>{number.format(match.healing)} 治疗</span><span>{number.format(match.mitigation)} 减伤</span></div>}
    <div className="five-event-match-links"><a href={match.owtv} target="_blank" rel="noreferrer">OWTV 数据</a><a href={match.bilibili} target="_blank" rel="noreferrer">B站录像</a></div>
  </article>)}</div>;
}

function MatchRows({ rows, team, detailed = false }: { rows: Array<EsportsMatch | OwtvPlayerPerformance["matches"][number]>; team: string; detailed?: boolean }) {
  return <div className={detailed ? "five-event-match-rows detailed generic" : "five-match-rows"}>{rows.map((match) => {
    const left = normalize(match.team1) === normalize(team);
    const own = left ? match.team1 : match.team2;
    const opponent = left ? match.team2 : match.team1;
    const ownScore = left ? match.score1 : match.score2;
    const opponentScore = left ? match.score2 : match.score1;
    const hasScore = ownScore != null && opponentScore != null;
    const won = hasScore && n(ownScore) > n(opponentScore);
    const url = "url" in match ? match.url : match.owtv || match.bilibili;
    const hasPerformance = "eliminations" in match;
    if (detailed) return <article key={`${match.id}-${match.datetime}`}>
      <span className="five-event-match-date">{date.format(new Date(match.datetime))}<small>{hasScore ? `${won ? "胜" : "负"} · ` : ""}{hasPerformance ? `${match.mapCount} 图出场` : match.event}</small></span>
      <strong className={hasScore ? "" : "unscored"}><b>{own}</b><em className={won ? "win" : ""}>{hasScore ? `${ownScore} : ${opponentScore}` : "比分未收录"}</em><b>{opponent}</b></strong>
      <div className="five-event-match-heroes missing"><Shield size={20} /><span><b>逐场英雄</b><small>等待录像核验</small></span></div>
      {hasPerformance ? <div className="five-event-match-stats"><span>{number.format(Math.round(match.eliminations))} 击杀</span><span>{number.format(Math.round(match.assists))} 助攻</span><span>{number.format(Math.round(match.deaths))} 死亡</span><span>{number.format(Math.round(match.damage))} 伤害</span><span>{number.format(Math.round(match.healing))} 治疗</span><span>{number.format(Math.round(match.mitigation))} 减伤</span></div> : <div className="five-event-match-stats unavailable"><span>{match.event}</span><span>{"phase" in match ? [match.phase, match.stage].filter(Boolean).join(" · ") : "赛后数据待同步"}</span></div>}
      <div className="five-event-match-links">{url ? <a href={url} target="_blank" rel="noreferrer">比赛数据</a> : <span>数据待同步</span>}{"bilibili" in match && match.bilibili ? <a href={match.bilibili} target="_blank" rel="noreferrer">B站录像</a> : null}</div>
    </article>;
    return <article key={`${match.id}-${match.datetime}`}>
      <span>{date.format(new Date(match.datetime))}<small>{match.event}</small></span>
      <strong className={hasScore ? "" : "unscored"}>{own}<em className={won ? "win" : ""}>{hasScore ? `${ownScore} : ${opponentScore}` : "比分未收录"}</em>{opponent}</strong>
      {url ? <a href={url} target="_blank" rel="noreferrer"><Activity size={15} /> 数据</a> : <i>暂无数据</i>}
    </article>;
  })}</div>;
}
