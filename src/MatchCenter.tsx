import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  LayoutGrid,
  List,
  Play,
  Radio,
  RefreshCw,
  Search,
  Shield,
  Trophy,
  UserRoundSearch,
  UsersRound,
} from "lucide-react";
import { competitionCatalog, fetchOwtvMatchDetail, loadEsportsSchedule, loadOwtvMatchIndex, mergeEsportsMatches, syncEsportsSchedule } from "./esportsApi";
import { loadEsportsAnalytics, syncEsportsAnalytics } from "./esportsAnalyticsApi";
import EsportsAnalytics, { type AnalyticsMode } from "./EsportsAnalytics";
import CompetitionDetail from "./CompetitionDetail";
import OwtvMatchDetail from "./OwtvMatchDetail";
import { compareCountDesc, compareDateAsc, compareMatchSchedule, compareNaturalText } from "./sortAlgorithms";
import { fetchPlayerIntel } from "./playerApi";
import type { EsportsMatch, OwtvMatchDetailPayload, PlayerIntel } from "./matchTypes";
import type { UiLocale } from "./esportsI18n";
import "./match.css";

interface MatchCenterProps {
  onOpenBalance: () => void;
  locale: UiLocale;
}

type StatusFilter = "all" | "upcoming" | "completed" | "pending";
type MatchSection = "schedule" | AnalyticsMode | "player";

const numberFormatter = new Intl.NumberFormat("zh-CN");
const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
});
const timeFormatter = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
const dateFormatterEn = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "2-digit", weekday: "short" });

const domesticStreamPlatforms = [
  { label: "B站", url: "https://live.bilibili.com/23612045" },
  { label: "虎牙", url: "https://www.huya.com/660128" },
  { label: "斗鱼", url: "https://www.douyu.com/945572" },
  { label: "抖音", url: "https://v.douyin.com/IauyiMFHyl4/" },
  { label: "快手", url: "https://www.kuaishou.com/profile/3xep6wi8gu8sxtq" },
  { label: "网易大神", url: "https://s.163.com/eQoQP5" },
  { label: "网易DD", url: "https://dd.163.com/room/0076" },
] as const;

function formatSyncedAt(value: string | number, locale: UiLocale) {
  if (!value) return locale === "zh" ? "等待首次同步" : "Waiting for first sync";
  const date = typeof value === "number" || /^\d+$/.test(String(value)) ? new Date(Number(value)) : new Date(value);
  return Number.isNaN(date.getTime())
    ? (locale === "zh" ? "已使用缓存" : "Using cached data")
    : `${locale === "zh" ? "同步于" : "Synced"} ${date.toLocaleString(locale === "zh" ? "zh-CN" : "en-US")}`;
}

function regionName(region: string, locale: UiLocale = "zh") {
  if (locale === "en") return region || "Global";
  const key = region.trim().toLowerCase();
  const names: Record<string, string> = {
    na: "北美",
    "north america": "北美",
    emea: "欧洲 / 中东 / 非洲",
    asia: "亚洲",
    cn: "中国",
    china: "中国",
    kr: "韩国",
    korea: "韩国",
    jp: "日本",
    japan: "日本",
    pac: "太平洋",
    pacific: "太平洋",
    owwc: "世界杯",
    global: "全球",
    faceit: "FACEIT",
    col: "高校联赛",
    sel: "SEL",
  };
  return names[key] || region.toUpperCase();
}

function eventName(event: string, locale: UiLocale = "zh") {
  if (locale === "en") return event;
  const names: Record<string, string> = {
    "Regular Season": "常规赛",
    "Online Qualifiers": "线上预选赛",
    "Midseason Championship": "季中冠军赛",
    Playoffs: "季后赛",
    "Group Stage": "小组赛",
    "Champions Clash": "全球冠军赛",
    Bootcamp: "训练营",
  };
  return names[event] || event;
}

function matchBucket(match: EsportsMatch): Exclude<StatusFilter, "all"> {
  if (match.status === "completed") return "completed";
  if (new Date(match.datetime).getTime() >= Date.now() - 12 * 60 * 60 * 1000) return "upcoming";
  if (match.score1 !== null || match.score2 !== null) return "completed";
  return "pending";
}

function statusMeta(match: EsportsMatch, locale: UiLocale) {
  const zh = locale === "zh";
  if (match.status === "live") return { label: zh ? "进行中" : "Live", className: "live" };
  if (matchBucket(match) === "completed") return { label: zh ? "已结束" : "Completed", className: "completed" };
  if (matchBucket(match) === "pending") return { label: zh ? "待补赛果" : "Result pending", className: "pending" };
  return { label: zh ? "即将开始" : "Upcoming", className: "upcoming" };
}

function isFutureMatch(match: EsportsMatch) {
  return matchBucket(match) === "upcoming";
}

function TeamLogo({ src, name, locale = "zh" }: { src: string; name: string; locale?: UiLocale }) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const initials = name.split(/\s+/).map((part) => part[0]).join("").slice(0, 3).toUpperCase();
  const hue = Array.from(name).reduce((sum, character) => sum + character.charCodeAt(0), 0) % 360;
  return (
    <span className="pro-team-fallback" style={{ "--team-hue": hue } as React.CSSProperties} title={name} aria-label={locale === "zh" ? `${name} 队标` : `${name} team logo`}>
      <Shield size={36} /><b>{initials}</b>
      {src && <img className={`pro-team-logo${imageLoaded ? " loaded" : ""}`} src={src} alt="" onLoad={() => setImageLoaded(true)} onError={() => setImageLoaded(false)} />}
    </span>
  );
}

function PlayerIntelCard({ intel, locale }: { intel: PlayerIntel; locale: UiLocale }) {
  const zh = locale === "zh";
  return (
    <article className="asia-result">
      <div className="asia-identity">
        {intel.avatar ? <img src={intel.avatar} alt="" /> : <span>{intel.username.slice(0, 1).toUpperCase()}</span>}
        <div><small>{zh ? "公开生涯资料" : "Public career profile"}</small><h3>{intel.username}</h3><p>{intel.title || intel.playerId}</p></div>
      </div>
      <div className="asia-ranks">
        {intel.ranks.length ? intel.ranks.map((rank) => (
          <span key={rank.role}><b>{rank.role.toUpperCase()}</b>{rank.tier}{rank.division ? ` ${rank.division}` : ""}</span>
        )) : <span><b>{zh ? "段位" : "Rank"}</b>{zh ? "未公开或未定级" : "Private or unranked"}</span>}
      </div>
      <dl className="asia-metrics">
        <div><dt>{zh ? "胜率" : "Win rate"}</dt><dd>{intel.winrate !== undefined ? `${intel.winrate.toFixed(1)}%` : "—"}</dd></div>
        <div><dt>KDA</dt><dd>{intel.kda?.toFixed(2) ?? "—"}</dd></div>
        <div><dt>{zh ? "场均伤害" : "Avg. damage"}</dt><dd>{intel.average.damage ? numberFormatter.format(Math.round(intel.average.damage)) : "—"}</dd></div>
        <div><dt>{zh ? "竞技场次" : "Competitive games"}</dt><dd>{intel.gamesPlayed ? numberFormatter.format(intel.gamesPlayed) : "—"}</dd></div>
      </dl>
    </article>
  );
}

export default function MatchCenter({ onOpenBalance, locale }: MatchCenterProps) {
  const zh = locale === "zh";
  const activeDateFormatter = zh ? dateFormatter : dateFormatterEn;
  const initial = useMemo(loadEsportsSchedule, []);
  const [matches, setMatches] = useState(initial.matches);
  const [source, setSource] = useState(initial.source);
  const [syncedAt, setSyncedAt] = useState(initial.syncedAt);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [region, setRegion] = useState("all");
  const [eventFilter, setEventFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [competitionFilter, setCompetitionFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(24);
  const [viewMode, setViewMode] = useState<"cards" | "list">("cards");
  const [selectedMatch, setSelectedMatch] = useState<EsportsMatch | null>(null);
  const [matchDetail, setMatchDetail] = useState<OwtvMatchDetailPayload | null>(null);
  const [matchDetailLoading, setMatchDetailLoading] = useState(false);
  const [matchDetailError, setMatchDetailError] = useState("");
  const [battleTag, setBattleTag] = useState("");
  const [intel, setIntel] = useState<PlayerIntel | null>(null);
  const [intelLoading, setIntelLoading] = useState(false);
  const [intelError, setIntelError] = useState("");
  const [section, setSection] = useState<MatchSection>("schedule");
  const [analytics, setAnalytics] = useState(loadEsportsAnalytics);

  useEffect(() => {
    let active = true;
    const refresh = () => void syncEsportsAnalytics().then((payload) => { if (active) setAnalytics(payload); }).catch(() => undefined);
    refresh();
    const timer = window.setInterval(refresh, 6 * 60 * 60 * 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    let active = true;
    void loadOwtvMatchIndex().then((payload) => {
      if (!active || !payload) return;
      setMatches((current) => mergeEsportsMatches([...current, ...payload.matches]));
      setSource((current) => current.includes("本地历史") ? current : `${current} + OWTV 本地历史`);
    }).catch((error) => setSyncError(error instanceof Error ? error.message : String(error)));
    return () => { active = false; };
  }, []);

  const regions = useMemo(() => Array.from(new Set(matches.map((match) => match.region))).sort(compareNaturalText), [matches]);
  const years = useMemo(() => Array.from(new Set(matches.map((match) => match.datetime.slice(0, 4)).filter((value) => /^\d{4}$/.test(value)))).sort((a, b) => b.localeCompare(a)), [matches]);
  const eventCounts = useMemo(() => Array.from(matches.reduce((map, match) => map.set(match.event, (map.get(match.event) || 0) + 1), new Map<string, number>()))
    .sort((a, b) => compareCountDesc({ label: a[0], count: a[1] }, { label: b[0], count: b[1] })), [matches]);
  const regionCounts = useMemo(() => matches.reduce((map, match) => map.set(match.region, (map.get(match.region) || 0) + 1), new Map<string, number>()), [matches]);
  const competitionCounts = useMemo(() => matches.reduce((map, match) => {
    if (match.tournamentId) map.set(match.tournamentId, (map.get(match.tournamentId) || 0) + 1);
    return map;
  }, new Map<string, number>()), [matches]);
  const upcoming = useMemo(() => matches.filter(isFutureMatch).sort(compareDateAsc), [matches]);
  const completedCount = matches.filter((match) => matchBucket(match) === "completed").length;
  const pendingCount = matches.filter((match) => matchBucket(match) === "pending").length;
  const teamCount = new Set(matches.flatMap((match) => [match.team1Id || match.team1, match.team2Id || match.team2])).size;
  const selectedCompetition = competitionCatalog.find((item) => item.id === competitionFilter);
  const tournamentSelection = competitionFilter !== "all" ? `competition:${competitionFilter}` : eventFilter !== "all" ? `event:${eventFilter}` : "all";

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return matches
      .filter((match) => status === "all" || matchBucket(match) === status)
      .filter((match) => region === "all" || match.region === region)
      .filter((match) => eventFilter === "all" || match.event === eventFilter)
      .filter((match) => yearFilter === "all" || match.datetime.startsWith(`${yearFilter}-`))
      .filter((match) => competitionFilter === "all" || match.tournamentId === competitionFilter)
      .filter((match) => !needle || [match.team1, match.team2, match.event, match.stage, match.phase, regionName(match.region)].join(" ").toLowerCase().includes(needle))
      .sort((a, b) => compareMatchSchedule(a, b, status, isFutureMatch));
  }, [competitionFilter, eventFilter, matches, query, region, status, yearFilter]);

  async function refreshSchedule() {
    setSyncing(true);
    setSyncError("");
    try {
      const payload = await syncEsportsSchedule();
      setMatches((current) => mergeEsportsMatches([...current, ...payload.matches]));
      setSource((current) => current.includes("本地历史") ? `${payload.source} + OWTV 本地历史` : payload.source);
      setSyncedAt(payload.syncedAt);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : String(error));
    } finally {
      setSyncing(false);
    }
  }

  async function queryPlayer(event: FormEvent) {
    event.preventDefault();
    setIntelLoading(true);
    setIntelError("");
    setIntel(null);
    try {
      setIntel(await fetchPlayerIntel(battleTag));
    } catch (error) {
      setIntelError(error instanceof Error ? error.message : String(error));
    } finally {
      setIntelLoading(false);
    }
  }

  function selectTournament(value: string) {
    if (value.startsWith("competition:")) {
      setCompetitionFilter(value.slice("competition:".length));
      setEventFilter("all");
    } else if (value.startsWith("event:")) {
      setCompetitionFilter("all");
      setEventFilter(value.slice("event:".length));
    } else {
      setCompetitionFilter("all");
      setEventFilter("all");
    }
    setVisibleCount(24);
  }

  async function openMatchDetail(match: EsportsMatch) {
    setSelectedMatch(match);
    setMatchDetail(null);
    setMatchDetailError("");
    setMatchDetailLoading(true);
    window.requestAnimationFrame(() => document.getElementById("owtv-match-detail-loading")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    try {
      const detail = await fetchOwtvMatchDetail(match);
      setMatchDetail(detail);
      window.requestAnimationFrame(() => document.getElementById("owtv-match-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (error) {
      setMatchDetailError(error instanceof Error ? error.message : String(error));
    } finally {
      setMatchDetailLoading(false);
    }
  }

  function closeMatchDetail() {
    setSelectedMatch(null);
    setMatchDetail(null);
    setMatchDetailError("");
  }

  const focus = upcoming[0];

  return (
    <main className="match-page">
      <section className="match-hero">
        <div>
          <p className="eyebrow">PRO ESPORTS / OFFICIAL SCHEDULE</p>
          <h1>{zh ? "职业赛事中心" : "Professional Match Center"}</h1>
        </div>
        {section === "schedule" && <div className="official-source-card">
          <span><Radio size={22} /></span>
          <div><small>{zh ? "当前数据源" : "Current data source"}</small><strong>{source}</strong><p>{formatSyncedAt(syncedAt, locale)}</p></div>
          <button onClick={refreshSchedule} disabled={syncing} aria-label={zh ? "同步官方职业赛程" : "Sync official professional schedule"}>
            <RefreshCw className={syncing ? "spin" : ""} size={18} />{zh ? "同步" : "Sync"}
          </button>
        </div>}
      </section>

      <nav className="match-subnav" aria-label={zh ? "职业比赛二级导航" : "Professional match navigation"}>
        <button className={section === "schedule" ? "active" : ""} onClick={() => setSection("schedule")}><CalendarDays size={18} />{zh ? "职业赛程" : "Schedule"}</button>
        <button className={section === "teams" ? "active" : ""} onClick={() => setSection("teams")}><UsersRound size={18} />{zh ? "战队" : "Teams"}</button>
        <button className={section === "players" ? "active" : ""} onClick={() => setSection("players")}><UserRoundSearch size={18} />{zh ? "选手" : "Players"}</button>
        <button className={section === "heroes" ? "active" : ""} onClick={() => setSection("heroes")}><Shield size={18} />{zh ? "英雄" : "Heroes"}</button>
        <button className={section === "player" ? "active" : ""} onClick={() => setSection("player")}><UserRoundSearch size={18} />{zh ? "亚服账号" : "Asia Profile"}</button>
      </nav>

      {section === "schedule" && <>
      <section className="pro-summary" aria-label={zh ? "职业赛事总览" : "Professional match overview"}>
        <div><Trophy size={20} /><span>{zh ? "比赛总数" : "Matches"}<strong>{matches.length}</strong></span></div>
        <div><CheckCircle2 size={20} /><span>{zh ? "已收录赛果" : "Results"}<strong>{completedCount}</strong></span></div>
        <div><CalendarDays size={20} /><span>{zh ? "即将开始" : "Upcoming"}<strong>{upcoming.length}</strong></span></div>
        <div><Clock3 size={20} /><span>{zh ? "待补赛果" : "Pending"}<strong>{pendingCount}</strong></span></div>
        <div><Radio size={20} /><span>{zh ? "赛事分类" : "Events"}<strong>{eventCounts.length}</strong></span></div>
        <div><UsersRound size={20} /><span>{zh ? "可搜索战队" : "Teams"}<strong>{teamCount}</strong></span></div>
        <a href="https://esports.overwatch.com/en-us/schedule" target="_blank" rel="noreferrer">{zh ? "打开官方赛程" : "Official schedule"} <ArrowUpRight size={17} /></a>
      </section>

      {syncError && <p className="pro-sync-error"><AlertCircle size={17} />{syncError}{zh ? "，当前继续使用本地缓存。" : ". Continuing with the local cache."}</p>}

      {focus && (
        <section className="focus-match">
          <div className="focus-copy"><p className="eyebrow">NEXT PROFESSIONAL MATCH</p><span>{eventName(focus.event, locale)} · {focus.stage || focus.phase || regionName(focus.region, locale)}</span><h2>{zh ? "下一场职业比赛" : "Next Professional Match"}</h2><p><Clock3 size={17} />{activeDateFormatter.format(new Date(focus.datetime))} {timeFormatter.format(new Date(focus.datetime))}</p></div>
          <div className="focus-teams">
            <button onClick={() => setQuery(focus.team1)}><TeamLogo src={focus.team1Logo} name={focus.team1} locale={locale} /><strong>{focus.team1}</strong></button>
            <div><span>VS</span><small>{regionName(focus.region, locale)}</small></div>
            <button onClick={() => setQuery(focus.team2)}><TeamLogo src={focus.team2Logo} name={focus.team2} locale={locale} /><strong>{focus.team2}</strong></button>
          </div>
          <div className="focus-streams">
            {domesticStreamPlatforms.map((platform) => <a className="domestic" href={platform.url} target="_blank" rel="noreferrer" key={platform.label}><Play size={14} />{platform.label}</a>)}
            {focus.youtube && <a href={focus.youtube} target="_blank" rel="noreferrer"><Play size={17} />YouTube</a>}
            {focus.twitch && <a href={focus.twitch} target="_blank" rel="noreferrer"><Radio size={17} />Twitch</a>}
          </div>
        </section>
      )}

      <section className="pro-schedule">
        <header className="owtv-index-head">
          <div><p className="eyebrow">OWTV MATCHES</p><h2>{zh ? "比赛" : "Matches"}</h2><span>{matches.length} {zh ? "场比赛" : "matches"} · {eventCounts.length} {zh ? "项赛事" : "events"}</span></div>
          <div className="owtv-head-actions">
            <div className="owtv-view-switch" aria-label={zh ? "切换比赛布局" : "Change match layout"}>
              <button aria-pressed={viewMode === "cards"} className={viewMode === "cards" ? "active" : ""} onClick={() => setViewMode("cards")}><LayoutGrid size={17} />{zh ? "卡片" : "Cards"}</button>
              <button aria-pressed={viewMode === "list"} className={viewMode === "list" ? "active" : ""} onClick={() => setViewMode("list")}><List size={17} />{zh ? "列表" : "List"}</button>
            </div>
            <button className="balance-jump" onClick={onOpenBalance}><Trophy size={18} />{zh ? "英雄更新" : "Hero Updates"}</button>
          </div>
        </header>

        <nav className="owtv-status-tabs" aria-label={zh ? "比赛状态" : "Match status"}>
          {([['upcoming', `${zh ? "即将开始" : "Upcoming"} ${upcoming.length}`], ['completed', `${zh ? "比赛结果" : "Results"} ${completedCount}`], ['all', `${zh ? "全部" : "All"} ${matches.length}`], ['pending', `${zh ? "待核赛果" : "Pending"} ${pendingCount}`]] as const).map(([value, label]) => <button key={value} aria-pressed={status === value} className={status === value ? "active" : ""} onClick={() => { setStatus(value); setVisibleCount(24); }}>{label}</button>)}
        </nav>

        <nav className="owtv-region-tabs" aria-label={zh ? "赛区" : "Regions"}>
          <button aria-pressed={region === "all"} className={region === "all" ? "active" : ""} onClick={() => { setRegion("all"); setVisibleCount(24); }}>{zh ? "全部赛区" : "All regions"}</button>
          {regions.map((value) => <button key={value} aria-pressed={region === value} className={region === value ? "active" : ""} onClick={() => { setRegion(value); setVisibleCount(24); }}>{regionName(value, locale)}<b>{regionCounts.get(value) ?? 0}</b></button>)}
        </nav>

        <div className="owtv-filter-bar">
          <label className="pro-search"><Search size={18} /><input value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(24); }} placeholder={zh ? "搜索战队或赛事" : "Search team or event"} aria-label={zh ? "搜索职业比赛" : "Search professional matches"} /></label>
          <label className="owtv-year-select"><span>{zh ? "年份" : "Year"}</span><select value={yearFilter} onChange={(event) => { setYearFilter(event.target.value); setVisibleCount(24); }} aria-label={zh ? "筛选比赛年份" : "Filter match year"}>
            <option value="all">{zh ? "全部年份" : "All years"}</option>
            {years.map((year) => <option value={year} key={year}>{year}{zh ? " 年" : ""}</option>)}
          </select></label>
          <label className="owtv-tournament-select"><span>{zh ? "赛事" : "Event"}</span><select value={tournamentSelection} onChange={(event) => selectTournament(event.target.value)} aria-label={zh ? "选择赛事" : "Select event"}>
            <option value="all">{zh ? "全部赛事" : "All events"}</option>
            <optgroup label={zh ? "赛事档案" : "Tournament archives"}>
              {competitionCatalog.filter((competition) => competitionCounts.has(competition.id)).map((competition) => <option value={`competition:${competition.id}`} key={competition.id}>{competition.name}（{competitionCounts.get(competition.id)}）</option>)}
            </optgroup>
            <optgroup label={zh ? "赛事阶段" : "Event stages"}>
              {eventCounts.map(([event, count]) => <option value={`event:${event}`} key={event}>{eventName(event, locale)} ({count})</option>)}
            </optgroup>
          </select></label>
          <strong className="owtv-result-count">{filtered.length}<small>{zh ? "场匹配" : "matches"}</small></strong>
        </div>

        {selectedCompetition && <CompetitionDetail competition={selectedCompetition} matches={matches} />}

        {selectedMatch && matchDetailLoading && <div className="owtv-detail-loading" id="owtv-match-detail-loading"><LoaderCircle className="spin" size={26} /><strong>{zh ? "正在读取本地比赛数据" : "Loading local match data"}</strong><span>{zh ? "地图、英雄禁用和选手统计会直接从 OWTV 本地数据库载入。" : "Maps, hero bans, and player statistics load directly from the local OWTV database."}</span></div>}
        {selectedMatch && matchDetailError && <div className="owtv-detail-error"><AlertCircle size={22} /><div><strong>{zh ? "比赛详情读取失败" : "Could not load match details"}</strong><span>{matchDetailError}</span></div><button onClick={closeMatchDetail}>{zh ? "返回比赛列表" : "Back to matches"}</button></div>}
        {selectedMatch && matchDetail && <OwtvMatchDetail detail={matchDetail} scheduleMatch={selectedMatch} onClose={closeMatchDetail} />}

        {!selectedMatch && <div className={`owtv-match-grid ${viewMode}`}>
          {filtered.slice(0, visibleCount).map((match) => {
            const meta = statusMeta(match, locale);
            return (
              <article className="owtv-match-card" key={match.id} role="button" tabIndex={0} data-datetime={match.datetime} data-status={matchBucket(match)} aria-label={zh ? `查看 ${match.team1} 对阵 ${match.team2} 的比赛详情` : `View match details for ${match.team1} versus ${match.team2}`} onClick={() => void openMatchDetail(match)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openMatchDetail(match); } }}>
                <header>
                  <div><strong>{activeDateFormatter.format(new Date(match.datetime))}</strong><time>{timeFormatter.format(new Date(match.datetime))}</time></div>
                  <em className={meta.className}>{meta.label}</em>
                </header>
                <div className="owtv-match-context"><strong>{eventName(match.event, locale)}</strong><span>{[match.stage, match.phase].filter(Boolean).join(" · ") || regionName(match.region, locale)}</span></div>
                <div className="owtv-team-row">
                  <button tabIndex={-1}><TeamLogo src={match.team1Logo} name={match.team1} locale={locale} /><span>{match.team1}</span></button>
                  <b>{match.status === "completed" ? match.score1 ?? 0 : "—"}</b>
                </div>
                <div className="owtv-team-row">
                  <button tabIndex={-1}><TeamLogo src={match.team2Logo} name={match.team2} locale={locale} /><span>{match.team2}</span></button>
                  <b>{match.status === "completed" ? match.score2 ?? 0 : "—"}</b>
                </div>
                <footer><span>{regionName(match.region, locale)}</span><nav aria-label={zh ? "比赛链接" : "Match links"}>
                  {match.bilibili && <a onClick={(event) => event.stopPropagation()} className="bilibili" href={match.bilibili} title={zh ? "B站中文回放" : "Bilibili replay"} target="_blank" rel="noreferrer"><Play size={15} />{zh ? "B站" : "Bilibili"}</a>}
                  {match.owtv && <a onClick={(event) => event.stopPropagation()} className="owtv" href={match.owtv} title={zh ? "OWTV 逐场数据" : "OWTV match data"} target="_blank" rel="noreferrer"><Activity size={15} />{zh ? "数据" : "Data"}</a>}
                  {match.youtube && <a onClick={(event) => event.stopPropagation()} href={match.youtube} title="YouTube 直播或回放" target="_blank" rel="noreferrer"><Play size={15} />YouTube</a>}
                  {match.twitch && <a onClick={(event) => event.stopPropagation()} href={match.twitch} title="Twitch 直播或回放" target="_blank" rel="noreferrer"><Radio size={15} />Twitch</a>}
                  {!match.bilibili && !match.owtv && !match.youtube && !match.twitch && <small>{zh ? "暂无链接" : "No links"}</small>}
                </nav></footer>
              </article>
            );
          })}
          {!filtered.length && <div className="pro-empty"><Search size={27} /><h3>{zh ? "没有匹配的职业比赛" : "No matching professional matches"}</h3><p>{zh ? "请清除关键词或切换赛区与比赛状态。" : "Clear the search or change region and status filters."}</p></div>}
        </div>}
        {!selectedMatch && visibleCount < filtered.length && <button className="show-more" onClick={() => setVisibleCount((count) => count + 24)}>{zh ? "再显示 24 场" : "Show 24 more"}</button>}
      </section>
      </>}

      {(section === "teams" || section === "players" || section === "heroes") && <EsportsAnalytics data={analytics} mode={section} matches={matches} locale={locale} onModeChange={setSection} />}

      {section === "player" && <section className="asia-player-section">
        <div className="asia-copy"><p className="eyebrow">PLAYER LOOKUP</p><h2>{zh ? "亚服账号查询" : "Asia Profile Lookup"}</h2></div>
        <form className="asia-query" onSubmit={queryPlayer}>
          <label htmlFor="asia-battletag"><UserRoundSearch size={18} />BattleTag</label>
          <div><input id="asia-battletag" value={battleTag} onChange={(event) => setBattleTag(event.target.value)} placeholder={zh ? "玩家名#1234" : "Player#1234"} /><button disabled={intelLoading || !battleTag.trim()}>{intelLoading ? <LoaderCircle className="spin" size={18} /> : <Search size={18} />}{zh ? "查询公开资料" : "Search public profile"}</button></div>
          {intelError && <p className="asia-error"><AlertCircle size={16} />{intelError}</p>}
        </form>
        {intel && <PlayerIntelCard intel={intel} locale={locale} />}
        {!intel && !intelLoading && <div className="asia-result-empty"><span>{zh ? "查询结果" : "Search result"}</span><strong>—</strong></div>}
      </section>}
    </main>
  );
}
