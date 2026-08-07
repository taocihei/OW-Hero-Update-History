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

const domesticStreamPlatforms = [
  { label: "B站", url: "https://live.bilibili.com/23612045" },
  { label: "虎牙", url: "https://www.huya.com/660128" },
  { label: "斗鱼", url: "https://www.douyu.com/945572" },
  { label: "抖音", url: "https://v.douyin.com/IauyiMFHyl4/" },
  { label: "快手", url: "https://www.kuaishou.com/profile/3xep6wi8gu8sxtq" },
  { label: "网易大神", url: "https://s.163.com/eQoQP5" },
  { label: "网易DD", url: "https://dd.163.com/room/0076" },
] as const;

function formatSyncedAt(value: string | number) {
  if (!value) return "等待首次同步";
  const date = typeof value === "number" || /^\d+$/.test(String(value)) ? new Date(Number(value)) : new Date(value);
  return Number.isNaN(date.getTime()) ? "已使用缓存" : `同步于 ${date.toLocaleString("zh-CN")}`;
}

function regionName(region: string) {
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

function eventName(event: string) {
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

function statusMeta(match: EsportsMatch) {
  if (match.status === "live") return { label: "进行中", className: "live" };
  if (matchBucket(match) === "completed") return { label: "已结束", className: "completed" };
  if (matchBucket(match) === "pending") return { label: "待补赛果", className: "pending" };
  return { label: "即将开始", className: "upcoming" };
}

function isFutureMatch(match: EsportsMatch) {
  return matchBucket(match) === "upcoming";
}

function TeamLogo({ src, name }: { src: string; name: string }) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const initials = name.split(/\s+/).map((part) => part[0]).join("").slice(0, 3).toUpperCase();
  const hue = Array.from(name).reduce((sum, character) => sum + character.charCodeAt(0), 0) % 360;
  return (
    <span className="pro-team-fallback" style={{ "--team-hue": hue } as React.CSSProperties} title={name} aria-label={`${name} 队标`}>
      <Shield size={36} /><b>{initials}</b>
      {src && <img className={`pro-team-logo${imageLoaded ? " loaded" : ""}`} src={src} alt="" onLoad={() => setImageLoaded(true)} onError={() => setImageLoaded(false)} />}
    </span>
  );
}

function PlayerIntelCard({ intel }: { intel: PlayerIntel }) {
  return (
    <article className="asia-result">
      <div className="asia-identity">
        {intel.avatar ? <img src={intel.avatar} alt="" /> : <span>{intel.username.slice(0, 1).toUpperCase()}</span>}
        <div><small>公开生涯资料</small><h3>{intel.username}</h3><p>{intel.title || intel.playerId}</p></div>
      </div>
      <div className="asia-ranks">
        {intel.ranks.length ? intel.ranks.map((rank) => (
          <span key={rank.role}><b>{rank.role.toUpperCase()}</b>{rank.tier}{rank.division ? ` ${rank.division}` : ""}</span>
        )) : <span><b>段位</b>未公开或未定级</span>}
      </div>
      <dl className="asia-metrics">
        <div><dt>胜率</dt><dd>{intel.winrate !== undefined ? `${intel.winrate.toFixed(1)}%` : "—"}</dd></div>
        <div><dt>KDA</dt><dd>{intel.kda?.toFixed(2) ?? "—"}</dd></div>
        <div><dt>场均伤害</dt><dd>{intel.average.damage ? numberFormatter.format(Math.round(intel.average.damage)) : "—"}</dd></div>
        <div><dt>竞技场次</dt><dd>{intel.gamesPlayed ? numberFormatter.format(intel.gamesPlayed) : "—"}</dd></div>
      </dl>
    </article>
  );
}

export default function MatchCenter({ onOpenBalance, locale }: MatchCenterProps) {
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

  const regions = useMemo(() => Array.from(new Set(matches.map((match) => match.region))).sort(), [matches]);
  const years = useMemo(() => Array.from(new Set(matches.map((match) => match.datetime.slice(0, 4)).filter((value) => /^\d{4}$/.test(value)))).sort((a, b) => b.localeCompare(a)), [matches]);
  const eventCounts = useMemo(() => Array.from(matches.reduce((map, match) => map.set(match.event, (map.get(match.event) || 0) + 1), new Map<string, number>())).sort((a, b) => b[1] - a[1]), [matches]);
  const regionCounts = useMemo(() => matches.reduce((map, match) => map.set(match.region, (map.get(match.region) || 0) + 1), new Map<string, number>()), [matches]);
  const competitionCounts = useMemo(() => matches.reduce((map, match) => {
    if (match.tournamentId) map.set(match.tournamentId, (map.get(match.tournamentId) || 0) + 1);
    return map;
  }, new Map<string, number>()), [matches]);
  const upcoming = useMemo(() => matches.filter(isFutureMatch).sort((a, b) => a.datetime.localeCompare(b.datetime)), [matches]);
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
      .sort((a, b) => {
        if (status === "completed") return b.datetime.localeCompare(a.datetime);
        if (status === "upcoming") return a.datetime.localeCompare(b.datetime);
        const aFuture = isFutureMatch(a) ? 0 : 1;
        const bFuture = isFutureMatch(b) ? 0 : 1;
        return aFuture - bFuture || (aFuture ? b.datetime.localeCompare(a.datetime) : a.datetime.localeCompare(b.datetime));
      });
  }, [competitionFilter, eventFilter, matches, query, region, status, yearFilter]);

  async function refreshSchedule() {
    setSyncing(true);
    setSyncError("");
    try {
      const payload = await syncEsportsSchedule();
      setMatches(payload.matches);
      setSource(payload.source);
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
          <h1>职业赛事中心</h1>
        </div>
        {section === "schedule" && <div className="official-source-card">
          <span><Radio size={22} /></span>
          <div><small>当前数据源</small><strong>{source}</strong><p>{formatSyncedAt(syncedAt)}</p></div>
          <button onClick={refreshSchedule} disabled={syncing} aria-label="同步官方职业赛程">
            <RefreshCw className={syncing ? "spin" : ""} size={18} />同步
          </button>
        </div>}
      </section>

      <nav className="match-subnav" aria-label="职业比赛二级导航">
        <button className={section === "schedule" ? "active" : ""} onClick={() => setSection("schedule")}><CalendarDays size={18} />职业赛程</button>
        <button className={section === "teams" ? "active" : ""} onClick={() => setSection("teams")}><UsersRound size={18} />战队</button>
        <button className={section === "players" ? "active" : ""} onClick={() => setSection("players")}><UserRoundSearch size={18} />选手</button>
        <button className={section === "heroes" ? "active" : ""} onClick={() => setSection("heroes")}><Shield size={18} />英雄</button>
        <button className={section === "player" ? "active" : ""} onClick={() => setSection("player")}><UserRoundSearch size={18} />亚服账号</button>
      </nav>

      {section === "schedule" && <>
      <section className="pro-summary" aria-label="职业赛事总览">
        <div><Trophy size={20} /><span>比赛总数<strong>{matches.length}</strong></span></div>
        <div><CheckCircle2 size={20} /><span>已收录赛果<strong>{completedCount}</strong></span></div>
        <div><CalendarDays size={20} /><span>即将开始<strong>{upcoming.length}</strong></span></div>
        <div><Clock3 size={20} /><span>待补赛果<strong>{pendingCount}</strong></span></div>
        <div><Radio size={20} /><span>赛事分类<strong>{eventCounts.length}</strong></span></div>
        <div><UsersRound size={20} /><span>可搜索战队<strong>{teamCount}</strong></span></div>
        <a href="https://esports.overwatch.com/en-us/schedule" target="_blank" rel="noreferrer">打开官方赛程 <ArrowUpRight size={17} /></a>
      </section>

      {syncError && <p className="pro-sync-error"><AlertCircle size={17} />{syncError}，当前继续使用本地缓存。</p>}

      {focus && (
        <section className="focus-match">
          <div className="focus-copy"><p className="eyebrow">NEXT PROFESSIONAL MATCH</p><span>{focus.event} · {focus.stage || focus.phase || regionName(focus.region)}</span><h2>下一场职业比赛</h2><p><Clock3 size={17} />{dateFormatter.format(new Date(focus.datetime))} {timeFormatter.format(new Date(focus.datetime))}</p></div>
          <div className="focus-teams">
            <button onClick={() => setQuery(focus.team1)}><TeamLogo src={focus.team1Logo} name={focus.team1} /><strong>{focus.team1}</strong></button>
            <div><span>VS</span><small>{regionName(focus.region)}</small></div>
            <button onClick={() => setQuery(focus.team2)}><TeamLogo src={focus.team2Logo} name={focus.team2} /><strong>{focus.team2}</strong></button>
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
          <div><p className="eyebrow">OWTV MATCHES</p><h2>比赛</h2><span>{matches.length} 场比赛 · {eventCounts.length} 项赛事</span></div>
          <div className="owtv-head-actions">
            <div className="owtv-view-switch" aria-label="切换比赛布局">
              <button className={viewMode === "cards" ? "active" : ""} onClick={() => setViewMode("cards")}><LayoutGrid size={17} />卡片</button>
              <button className={viewMode === "list" ? "active" : ""} onClick={() => setViewMode("list")}><List size={17} />列表</button>
            </div>
            <button className="balance-jump" onClick={onOpenBalance}><Trophy size={18} />英雄更新</button>
          </div>
        </header>

        <nav className="owtv-status-tabs" aria-label="比赛状态">
          {([['upcoming', `即将开始 ${upcoming.length}`], ['completed', `比赛结果 ${completedCount}`], ['all', `全部 ${matches.length}`], ['pending', `待核赛果 ${pendingCount}`]] as const).map(([value, label]) => <button key={value} className={status === value ? "active" : ""} onClick={() => { setStatus(value); setVisibleCount(24); }}>{label}</button>)}
        </nav>

        <nav className="owtv-region-tabs" aria-label="赛区">
          <button className={region === "all" ? "active" : ""} onClick={() => { setRegion("all"); setVisibleCount(24); }}>全部赛区</button>
          {regions.map((value) => <button key={value} className={region === value ? "active" : ""} onClick={() => { setRegion(value); setVisibleCount(24); }}>{regionName(value)}<b>{regionCounts.get(value) ?? 0}</b></button>)}
        </nav>

        <div className="owtv-filter-bar">
          <label className="pro-search"><Search size={18} /><input value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(24); }} placeholder="搜索战队或赛事" aria-label="搜索职业比赛" /></label>
          <label className="owtv-year-select"><span>年份</span><select value={yearFilter} onChange={(event) => { setYearFilter(event.target.value); setVisibleCount(24); }} aria-label="筛选比赛年份">
            <option value="all">全部年份</option>
            {years.map((year) => <option value={year} key={year}>{year} 年</option>)}
          </select></label>
          <label className="owtv-tournament-select"><span>赛事</span><select value={tournamentSelection} onChange={(event) => selectTournament(event.target.value)} aria-label="选择赛事">
            <option value="all">全部赛事</option>
            <optgroup label="赛事档案">
              {competitionCatalog.filter((competition) => competitionCounts.has(competition.id)).map((competition) => <option value={`competition:${competition.id}`} key={competition.id}>{competition.name}（{competitionCounts.get(competition.id)}）</option>)}
            </optgroup>
            <optgroup label="赛事阶段">
              {eventCounts.map(([event, count]) => <option value={`event:${event}`} key={event}>{eventName(event)}（{count}）</option>)}
            </optgroup>
          </select></label>
          <strong className="owtv-result-count">{filtered.length}<small>场匹配</small></strong>
        </div>

        {selectedCompetition && <CompetitionDetail competition={selectedCompetition} matches={matches} />}

        {selectedMatch && matchDetailLoading && <div className="owtv-detail-loading" id="owtv-match-detail-loading"><LoaderCircle className="spin" size={26} /><strong>正在读取本地比赛数据</strong><span>地图、英雄禁用和选手统计会直接从 OWTV 本地数据库载入。</span></div>}
        {selectedMatch && matchDetailError && <div className="owtv-detail-error"><AlertCircle size={22} /><div><strong>比赛详情读取失败</strong><span>{matchDetailError}</span></div><button onClick={closeMatchDetail}>返回比赛列表</button></div>}
        {selectedMatch && matchDetail && <OwtvMatchDetail detail={matchDetail} scheduleMatch={selectedMatch} onClose={closeMatchDetail} />}

        {!selectedMatch && <div className={`owtv-match-grid ${viewMode}`}>
          {filtered.slice(0, visibleCount).map((match) => {
            const meta = statusMeta(match);
            return (
              <article className="owtv-match-card" key={match.id} role="button" tabIndex={0} aria-label={`查看 ${match.team1} 对阵 ${match.team2} 的比赛详情`} onClick={() => void openMatchDetail(match)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") void openMatchDetail(match); }}>
                <header>
                  <div><strong>{dateFormatter.format(new Date(match.datetime))}</strong><time>{timeFormatter.format(new Date(match.datetime))}</time></div>
                  <em className={meta.className}>{meta.label}</em>
                </header>
                <div className="owtv-match-context"><strong>{eventName(match.event)}</strong><span>{[match.stage, match.phase].filter(Boolean).join(" · ") || regionName(match.region)}</span></div>
                <div className="owtv-team-row">
                  <button tabIndex={-1}><TeamLogo src={match.team1Logo} name={match.team1} /><span>{match.team1}</span></button>
                  <b>{match.status === "completed" ? match.score1 ?? 0 : "—"}</b>
                </div>
                <div className="owtv-team-row">
                  <button tabIndex={-1}><TeamLogo src={match.team2Logo} name={match.team2} /><span>{match.team2}</span></button>
                  <b>{match.status === "completed" ? match.score2 ?? 0 : "—"}</b>
                </div>
                <footer><span>{regionName(match.region)}</span><nav>
                  {match.bilibili && <a onClick={(event) => event.stopPropagation()} className="bilibili" href={match.bilibili} title="B站中文回放" target="_blank" rel="noreferrer"><Play size={15} />B站</a>}
                  {match.owtv && <a onClick={(event) => event.stopPropagation()} className="owtv" href={match.owtv} title="OWTV 逐场数据" target="_blank" rel="noreferrer"><Activity size={15} />数据</a>}
                  {match.youtube && <a onClick={(event) => event.stopPropagation()} href={match.youtube} title="YouTube 直播或回放" target="_blank" rel="noreferrer"><Play size={15} />YouTube</a>}
                  {match.twitch && <a onClick={(event) => event.stopPropagation()} href={match.twitch} title="Twitch 直播或回放" target="_blank" rel="noreferrer"><Radio size={15} />Twitch</a>}
                  {!match.bilibili && !match.owtv && !match.youtube && !match.twitch && <small>暂无链接</small>}
                </nav></footer>
              </article>
            );
          })}
          {!filtered.length && <div className="pro-empty"><Search size={27} /><h3>没有匹配的职业比赛</h3><p>请清除关键词或切换赛区与比赛状态。</p></div>}
        </div>}
        {!selectedMatch && visibleCount < filtered.length && <button className="show-more" onClick={() => setVisibleCount((count) => count + 24)}>再显示 24 场</button>}
      </section>
      </>}

      {(section === "teams" || section === "players" || section === "heroes") && <EsportsAnalytics data={analytics} mode={section} matches={matches} locale={locale} onModeChange={setSection} />}

      {section === "player" && <section className="asia-player-section">
        <div className="asia-copy"><p className="eyebrow">PLAYER LOOKUP</p><h2>亚服账号查询</h2></div>
        <form className="asia-query" onSubmit={queryPlayer}>
          <label htmlFor="asia-battletag"><UserRoundSearch size={18} />BattleTag</label>
          <div><input id="asia-battletag" value={battleTag} onChange={(event) => setBattleTag(event.target.value)} placeholder="玩家名#1234" /><button disabled={intelLoading || !battleTag.trim()}>{intelLoading ? <LoaderCircle className="spin" size={18} /> : <Search size={18} />}查询公开资料</button></div>
          {intelError && <p className="asia-error"><AlertCircle size={16} />{intelError}</p>}
        </form>
        {intel && <PlayerIntelCard intel={intel} />}
        {!intel && !intelLoading && <div className="asia-result-empty"><span>查询结果</span><strong>—</strong></div>}
      </section>}
    </main>
  );
}
