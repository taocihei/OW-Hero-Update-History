import { useEffect, useMemo, useState } from "react";
import { Activity, BarChart3, Crosshair, HeartPulse, LoaderCircle, Shield, Swords, Trophy, UserRound } from "lucide-react";
import type { HeroWinRate, PlayerHeroUsage, TournamentPlayerHeroUsage } from "./esportsAnalyticsApi";
import type { EsportsMatch } from "./matchTypes";
import { fetchOwtvPlayerPerformance, type OwtvPlayerPerformance } from "./playerPerformanceApi";
import { canonicalEvent, displayMatchDate, identity, performanceAverage, playerMatchResult, summarizePlayerMatches, type OwtvPlayerMatchPerformance, type PerformanceSource } from "./playerPerformanceModel";
import { localizeHeroName, type UiLocale } from "./esportsI18n";
import { playerEventSnapshots, type PlayerEventMatch } from "./playerEventSnapshot";

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
  catalogProfile?: { name?: string | null; alias?: string | null; role?: string | null; nationality?: string | null; imageUrl?: string | null; teamNames?: string[] };
}

const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });
const metric = (value: number | null | undefined) => value == null ? "—" : number.format(value);

export default function PlayerFiveEProfile(props: Props) {
  const { player, team, playerRows, allPlayerRows, eventPlayerRows, locale, logoByTeam, onSelectHero, onSelectPlayer, renderHero, renderTeam, catalogProfile } = props;
  const t = (zh: string, en: string) => locale === "zh" ? zh : en;
  const [tab, setTab] = useState<"overview" | "data" | "schedule">("overview");
  const [sourceScope, setSourceScope] = useState<PerformanceSource>("owtv");
  const [eventScope, setEventScope] = useState("all");
  const [historySort, setHistorySort] = useState<"placement" | "date">("date");
  const [performance, setPerformance] = useState<OwtvPlayerPerformance | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const eventSnapshots = useMemo(() => playerEventSnapshots(player), [player]);

  useEffect(() => {
    let active = true;
    setPerformance(null); setError(""); setLoading(true); setEventScope("all");
    fetchOwtvPlayerPerformance(player, "", [], { source: sourceScope }).then((result) => {
      if (active) setPerformance(result);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [player, sourceScope]);

  const allMatchRows = performance?.matches ?? [];
  const scopedRows = useMemo(() => allMatchRows.filter((row) => eventScope === "all" || canonicalEvent(row.event, eventSnapshots) === eventScope), [allMatchRows, eventScope, eventSnapshots]);
  const summary = useMemo(() => summarizePlayerMatches(scopedRows), [scopedRows]);
  const selectedEventSnapshot = sourceScope === "owtv" ? eventSnapshots.find((item) => item.event === eventScope) : undefined;
  const latestTeam = allMatchRows[0]?.playerTeam || allMatchRows[0]?.team1 || team;
  const eventRows = useMemo(() => {
    const groups = new Map<string, OwtvPlayerMatchPerformance[]>();
    for (const row of allMatchRows) {
      const key = canonicalEvent(row.event, eventSnapshots);
      const rows = groups.get(key) ?? []; rows.push(row); groups.set(key, rows);
    }
    return Array.from(groups, ([event, rows]) => {
      const known = sourceScope === "owtv" ? eventSnapshots.find((item) => item.event === event) : undefined;
      return { event, ...summarizePlayerMatches(rows), latest: rows[0]?.datetime ?? "", placement: known?.placement, rank: Number(known?.placement.match(/\d+/)?.[0] ?? Infinity) };
    }).sort((a, b) => historySort === "placement" ? (a.rank - b.rank || b.latest.localeCompare(a.latest) || a.event.localeCompare(b.event)) : (b.latest.localeCompare(a.latest) || a.event.localeCompare(b.event)));
  }, [allMatchRows, eventSnapshots, historySort, sourceScope]);

  const teammates = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of allPlayerRows) if (identity(row.team_name) === identity(latestTeam) && identity(row.player_name) !== identity(player)) counts.set(row.player_name, (counts.get(row.player_name) ?? 0) + Number(row.usage_count || 0));
    return Array.from(counts, ([name, uses]) => ({ name, uses })).sort((a, b) => b.uses - a.uses).slice(0, 4);
  }, [allPlayerRows, latestTeam, player]);

  const eventHeroes = useMemo(() => {
    if (selectedEventSnapshot) return selectedEventSnapshot.heroes;
    const counts = new Map<string, number>();
    for (const row of eventPlayerRows) if (identity(row.player_name) === identity(player) && canonicalEvent(row.tournament_sheet, eventSnapshots) === eventScope) counts.set(row.hero_name, (counts.get(row.hero_name) ?? 0) + Number(row.usage_count || 0));
    return Array.from(counts, ([hero, mapAppearances]) => ({ hero, mapAppearances })).sort((a, b) => b.mapAppearances - a.mapAppearances);
  }, [eventPlayerRows, player, eventScope, eventSnapshots, selectedEventSnapshot]);
  const profile = performance?.profile;
  const currentRole = profile?.playerRole || catalogProfile?.role || "";
  const role = locale === "zh" ? ({ TANK: "坦克", DAMAGE: "输出", SUPPORT: "支援" } as Record<string, string>)[currentRole] || currentRole : currentRole;
  const winLoss = `${summary.wins} ${t("胜", "W")} ${summary.losses} ${t("负", "L")}`;
  const coverage = (key: "eliminations" | "deaths" | "damage" | "mitigation") => `${summary.metricMapCounts[key]} / ${summary.mapCount} ${t("图有数据", "maps with data")}`;
  const kda = summary.totals.eliminations != null && summary.totals.assists != null && summary.totals.deaths != null && summary.metricMapCounts.eliminations === summary.metricMapCounts.assists && summary.metricMapCounts.assists === summary.metricMapCounts.deaths
    ? (summary.totals.eliminations + summary.totals.assists) / Math.max(1, summary.totals.deaths) : null;
  const supplements = sourceScope === "owtv" ? eventSnapshots.flatMap((item) => item.matches) : [];
  const sourceTitle = performance?.source || (sourceScope === "owtv" ? "OWTV" : sourceScope === "statslab" ? "Stats Lab" : "2025 社区统计");

  return <div className="five-player">
    <header className="five-player-head">
      <div className="five-player-portrait">{profile?.imageUrl || catalogProfile?.imageUrl ? <img src={profile?.imageUrl || catalogProfile?.imageUrl || ""} alt="" /> : <><UserRound size={52} /><small>{t("暂无头像", "No photo")}</small></>}</div>
      <div className="five-player-id"><small>{t("选手资料", "PLAYER PROFILE")}</small><h3>{player}</h3><p>{profile?.nationality?.toUpperCase() || catalogProfile?.nationality?.toUpperCase() || ""} {role}</p><span>{t("最近参赛战队：", "Latest recorded team: ")}<b>{latestTeam || "—"}</b></span></div>
      <div className="five-player-teammark">{renderTeam(latestTeam, logoByTeam.get(latestTeam))}</div>
      <section className="five-teammates"><h4>{t("同队选手（已收录）", "Recorded teammates")}</h4><div>{teammates.map((item) => <button key={item.name} onClick={() => onSelectPlayer(item.name)}><span><UserRound size={22} /></span><strong>{item.name}</strong><small>{item.uses} {t("条英雄记录", "hero records")}</small></button>)}</div></section>
    </header>
    <nav className="five-player-tabs">
      <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>{t("基础信息", "Overview")}</button>
      <button className={tab === "data" ? "active" : ""} onClick={() => setTab("data")}>{t("数据", "Statistics")}</button>
      <button className={tab === "schedule" ? "active" : ""} onClick={() => setTab("schedule")}>{t("比赛", "Matches")}</button>
      <label className="five-event-select"><small>{t("统计来源", "Source")}</small><select aria-label={t("选手统计来源", "Player statistics source")} value={sourceScope} onChange={(event) => setSourceScope(event.target.value as PerformanceSource)}><option value="owtv">OWTV</option><option value="statslab">Stats Lab · 2018—2023</option><option value="community2025">{t("社区统计 · 2025", "Community · 2025")}</option></select></label>
      <label className="five-event-select"><small>{t("赛事", "Event")}</small><select aria-label={t("选手赛事筛选", "Player event filter")} value={eventScope} onChange={(event) => setEventScope(event.target.value)}><option value="all">{t("全部已收录赛事", "All recorded events")}</option>{eventRows.map((item) => <option key={item.event} value={item.event}>{item.event}</option>)}</select></label>
      <span title={performance?.archivePath}>{loading ? <><LoaderCircle className="spin" size={15} />{t("读取本地数据", "Reading local data")}</> : `${sourceTitle} · ${summary.matchCount} ${t("场", "matches")} / ${summary.mapCount} ${t("图记录", "map records")}`}{performance?.syncedAt ? ` · ${t("更新于", "Updated")} ${displayMatchDate({ datetime: performance.syncedAt }, locale === "zh" ? "zh-CN" : "en-US")}` : ""}</span>
    </nav>
    {error && <p className="five-data-error">{t("读取失败：", "Read failed: ")}{error}</p>}
    {!loading && !performance && !error && <div className="five-empty-data">{t("请在桌面软件中查看本地 OWTV 数据库。", "Open the desktop app to read the local OWTV database.")}</div>}

    {tab === "overview" && <div className="five-overview">
      {eventScope !== "all" && <section className="five-event-focus"><div className="five-event-focus-title"><span><Trophy size={18} />{selectedEventSnapshot?.placement || t("名次未提供", "Placement unavailable")}</span><div><h4>{eventScope}</h4><p>{summary.matchCount} {t("场比赛", "matches")} · {winLoss} · {sourceTitle}</p></div></div><div className="five-event-heroes">{eventHeroes.slice(0, 5).map((item) => <button key={item.hero} onClick={() => onSelectHero(item.hero)}>{renderHero(item.hero)}<span><strong>{localizeHeroName(item.hero, locale)}</strong><small>{item.mapAppearances} {t("条英雄补充记录", "supplemental hero records")}</small></span></button>)}</div></section>}
      <section className="five-data-overview"><div className="five-section-head"><h4>{t("当前筛选统计", "Selected statistics")}</h4><span>{sourceTitle}</span></div><div className="five-metric-grid">
        <article><span>{t("比赛", "Matches")}</span><b>{summary.matchCount}</b><small>{summary.mapCount} {t("图记录", "map records")}</small></article>
        <article><span>{t("比赛战绩", "Match record")}</span><b>{winLoss}</b><small>{summary.unknownResults ? `${summary.unknownResults} ${t("场比分缺失", "missing results")}` : summary.draws ? `${summary.draws} ${t("场平局", "draws")}` : t("按下方比赛计算", "From the match list below")}</small></article>
        <article><span>{t("每图击杀", "Eliminations / map")}</span><b>{metric(performanceAverage(summary, "eliminations"))}</b><small>{coverage("eliminations")}</small></article>
        <article><span>{t("每图死亡", "Deaths / map")}</span><b>{metric(performanceAverage(summary, "deaths"))}</b><small>{coverage("deaths")}</small></article>
        <article><span>{t("每图伤害", "Damage / map")}</span><b>{metric(performanceAverage(summary, "damage"))}</b><small>{coverage("damage")}</small></article>
        <article><span>{t("每图减伤", "Mitigation / map")}</span><b>{metric(performanceAverage(summary, "mitigation"))}</b><small>{coverage("mitigation")}</small></article>
      </div></section>
      <section className="five-recent"><div className="five-section-head"><h4>{eventScope === "all" ? t("最近比赛", "Recent matches") : t("本届比赛", "Event matches")}</h4><button onClick={() => setTab("schedule")}>{t("查看全部", "View all")}</button></div><MatchRows rows={scopedRows.slice(0, 6)} locale={locale} supplements={supplements} renderHero={renderHero} detailed={eventScope !== "all"} /></section>
      {eventScope === "all" && <section className="five-history"><div className="five-section-head"><h4>{t("赛事经历", "Event history")}</h4><div className="five-history-sort"><button aria-pressed={historySort === "date"} onClick={() => setHistorySort("date")}>{t("按时间", "Date")}</button><button aria-pressed={historySort === "placement"} onClick={() => setHistorySort("placement")}>{t("按名次", "Placement")}</button></div></div><div>{eventRows.map((event) => <article key={event.event}><b><Trophy size={15} />{event.placement || "—"}</b><span className="five-history-name"><button onClick={() => setEventScope(event.event)}>{event.event}</button><small>{displayMatchDate({ datetime: event.latest }, locale === "zh" ? "zh-CN" : "en-US")}</small></span><span>{event.wins} {t("胜", "W")} {event.losses} {t("负", "L")} · {event.matchCount} {t("场", "matches")}</span></article>)}</div></section>}
      {eventScope === "all" && <section className="five-hero-pool"><div className="five-section-head"><h4>{t("英雄使用（补充记录）", "Hero usage (supplemental)")}</h4></div><div>{playerRows.slice(0, 10).map((row, index) => <button key={`${row.hero_name}-${index}`} onClick={() => onSelectHero(row.hero_name)}><em>#{index + 1}</em>{renderHero(row.hero_name)}<span><strong>{localizeHeroName(row.hero_name, locale)}</strong><small>{row.usage_count} {t("条记录", "records")}</small></span></button>)}</div></section>}
    </div>}

    {tab === "data" && <div className="five-data-tab"><div className="five-detail-metrics">
      <article><Crosshair /><span>{t("击杀", "Eliminations")}</span><b>{metric(summary.totals.eliminations)}</b></article>
      <article><Swords /><span>{t("助攻", "Assists")}</span><b>{metric(summary.totals.assists)}</b></article>
      <article><Activity /><span>{t("伤害", "Damage")}</span><b>{metric(summary.totals.damage)}</b></article>
      <article><HeartPulse /><span>{t("治疗", "Healing")}</span><b>{metric(summary.totals.healing)}</b></article>
      <article><Shield /><span>{t("减伤", "Mitigation")}</span><b>{metric(summary.totals.mitigation)}</b></article>
      <article><BarChart3 /><span>KDA</span><b>{kda == null ? "—" : kda.toFixed(2)}</b></article>
    </div><section className="five-stat-table"><div className="five-section-head"><h4>{t("逐场表现", "Match performance")}</h4><span>{sourceTitle} · {coverage("damage")}</span></div><MatchRows rows={scopedRows} locale={locale} supplements={supplements} renderHero={renderHero} detailed /></section></div>}
    {tab === "schedule" && <section className="five-schedule-tab"><div className="five-section-head"><h4>{eventScope === "all" ? t("已收录比赛", "Recorded matches") : eventScope}</h4><span>{summary.matchCount} {t("场", "matches")} · {winLoss}</span></div><MatchRows rows={scopedRows} locale={locale} supplements={supplements} renderHero={renderHero} detailed /></section>}
  </div>;
}

function MatchRows({ rows, locale, supplements, renderHero, detailed = false }: { rows: OwtvPlayerMatchPerformance[]; locale: UiLocale; supplements: PlayerEventMatch[]; renderHero: (hero: string) => React.ReactNode; detailed?: boolean }) {
  const t = (zh: string, en: string) => locale === "zh" ? zh : en;
  if (!rows.length) return <div className="five-empty-data">{t("当前筛选下没有已收录比赛。", "No recorded matches for this selection.")}</div>;
  return <div className={detailed ? "five-event-match-rows detailed generic" : "five-match-rows"}>{rows.map((row) => {
    const own = row.playerTeam || row.team1;
    const left = identity(own) === identity(row.team1);
    const opponent = left ? row.team2 : row.team1;
    const a = left ? row.score1 : row.score2; const b = left ? row.score2 : row.score1;
    const result = playerMatchResult(row);
    const hasScore = a != null && b != null;
    const supplement = supplements.find((item) => item.owtv.replace(/\/$/, "") === row.url.replace(/\/$/, ""));
    return <article key={`${row.id}:${own}`}>
      <span className={detailed ? "five-event-match-date" : undefined}>{displayMatchDate(row, locale === "zh" ? "zh-CN" : "en-US")}<small>{row.event}{detailed ? ` · ${row.mapCount} ${t("图记录", "map records")}` : ""}</small></span>
      <strong className={hasScore ? "" : "unscored"}><b>{own}</b><em className={result === "win" ? "win" : ""}>{hasScore ? `${a} : ${b}` : t("比分未提供", "Score unavailable")}</em><b>{opponent}</b></strong>
      {detailed && <><div className={`five-event-match-heroes${supplement ? "" : " missing"}`}>{supplement ? supplement.heroes.map((hero) => <span key={hero}>{renderHero(hero)}<b>{localizeHeroName(hero, locale)}</b></span>) : <span>{t("逐场英雄未提供", "Per-match heroes unavailable")}</span>}</div><div className="five-event-match-stats"><span>{metric(row.eliminations)} {t("击杀", "elims")}</span><span>{metric(row.assists)} {t("助攻", "assists")}</span><span>{metric(row.deaths)} {t("死亡", "deaths")}</span><span>{metric(row.damage)} {t("伤害", "damage")}</span><span>{metric(row.healing)} {t("治疗", "healing")}</span><span>{metric(row.mitigation)} {t("减伤", "mitigation")}</span><small>{row.metricMapCounts ? `${row.metricMapCounts.damage} / ${row.mapCount} ${t("图有伤害统计", "maps with damage statistics")}` : row.source}</small></div></>}
      <div className={detailed ? "five-event-match-links" : undefined}>{row.url && <a href={row.url} target="_blank" rel="noreferrer">{row.source || t("数据来源", "Source")}</a>}{supplement?.bilibili && <a href={supplement.bilibili} target="_blank" rel="noreferrer">{t("B站录像", "Bilibili VOD")}</a>}</div>
    </article>;
  })}</div>;
}
