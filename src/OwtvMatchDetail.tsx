import { useMemo, useState } from "react";
import { Activity, ArrowLeft, ExternalLink, GitCompareArrows, MapPinned, Play, Radio, Trophy, UsersRound } from "lucide-react";
import { bundledHeroRoster } from "./heroRosterData";
import type { EsportsMatch, OwtvMatchDetailPayload, OwtvPlayerMapStat } from "./matchTypes";

interface Props {
  detail: OwtvMatchDetailPayload;
  scheduleMatch: EsportsMatch;
  onClose: () => void;
}

type TotalRow = OwtvPlayerMapStat & { mapCount: number };
type SelectedMap = number | "all";

const integer = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });

function sum(value: number | null | undefined) {
  return Number.isFinite(value) ? Number(value) : 0;
}

function aggregateStats(rows: OwtvPlayerMapStat[]) {
  const totals = new Map<number, TotalRow>();
  rows.forEach((row) => {
    const current = totals.get(row.playerId);
    if (!current) {
      totals.set(row.playerId, { ...row, mapCount: 1 });
      return;
    }
    current.mapCount += 1;
    current.eliminations = sum(current.eliminations) + sum(row.eliminations);
    current.assists = sum(current.assists) + sum(row.assists);
    current.deaths = sum(current.deaths) + sum(row.deaths);
    current.damage = sum(current.damage) + sum(row.damage);
    current.healing = sum(current.healing) + sum(row.healing);
    current.mitigation = sum(current.mitigation) + sum(row.mitigation);
    current.fantasy = sum(current.fantasy) + sum(row.fantasy);
    current.finalBlows = sum(current.finalBlows) + sum(row.finalBlows);
  });
  return Array.from(totals.values());
}

function heroKey(value: string) {
  return value.normalize("NFKD").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

const heroCatalog = new Map(bundledHeroRoster.map((hero) => [heroKey(hero.englishName), hero]));

function HeroBan({ hero, team }: { hero: { id: number; name: string } | null; team: string }) {
  if (!hero) return <span className="owtv-ban empty">未记录禁用</span>;
  const catalog = heroCatalog.get(heroKey(hero.name));
  return <span className="owtv-ban" title={`${team} 禁用 ${catalog?.name ?? hero.name}`}>
    {catalog?.portrait ? <img src={catalog.portrait} alt="" /> : <i>{hero.id}</i>}
    <small>{catalog?.name ?? hero.name}</small>
  </span>;
}

function roleName(role: string) {
  const names: Record<string, string> = {
    TANK: "坦克",
    DPS: "输出",
    DAMAGE: "输出",
    SUPPORT: "支援",
  };
  return names[role.toUpperCase()] ?? (role || "—");
}

function roleOrder(role: string) {
  const value = role.toUpperCase();
  if (value === "TANK") return 0;
  if (value === "DPS" || value === "DAMAGE") return 1;
  if (value === "SUPPORT") return 2;
  return 3;
}

function modeName(mode: string) {
  const names: Record<string, string> = {
    control: "控制",
    escort: "护送",
    hybrid: "混合",
    push: "机动推进",
    flashpoint: "闪点",
    clash: "攻防作战",
  };
  return names[mode.toLowerCase()] ?? (mode || "地图");
}

function sortLineup(players: TotalRow[]) {
  return [...players].sort((a, b) => roleOrder(a.role) - roleOrder(b.role) || a.name.localeCompare(b.name));
}

function PlayerTile({ player, badge }: { player: TotalRow; badge?: string }) {
  return <span className="owtv-lineup-player">
    {player.image ? <img src={player.image} alt="" /> : <i />}
    <b>{player.name}</b>
    <small>{roleName(player.role)}</small>
    {badge && <em>{badge}</em>}
  </span>;
}

const compareMetrics: Array<{
  key: "mapCount" | "eliminations" | "assists" | "deaths" | "damage" | "healing" | "mitigation" | "fantasy";
  label: string;
  lowerIsBetter?: boolean;
  decimal?: boolean;
}> = [
  { key: "mapCount", label: "出场地图" },
  { key: "eliminations", label: "击杀" },
  { key: "assists", label: "助攻" },
  { key: "deaths", label: "死亡", lowerIsBetter: true },
  { key: "damage", label: "伤害" },
  { key: "healing", label: "治疗" },
  { key: "mitigation", label: "减伤" },
  { key: "fantasy", label: "Fantasy", decimal: true },
];

function compareValue(player: TotalRow | undefined, key: (typeof compareMetrics)[number]["key"]) {
  if (!player) return 0;
  return key === "mapCount" ? player.mapCount : sum(player[key]);
}

function PlayerComparison({
  players,
  leftId,
  rightId,
  onLeftChange,
  onRightChange,
  team1Id,
  team1Name,
  team2Name,
  scope,
}: {
  players: TotalRow[];
  leftId: number | null;
  rightId: number | null;
  onLeftChange: (id: number) => void;
  onRightChange: (id: number) => void;
  team1Id: number;
  team1Name: string;
  team2Name: string;
  scope: string;
}) {
  const left = players.find((player) => player.playerId === leftId)
    ?? players.find((player) => player.teamId === team1Id)
    ?? players[0];
  const right = players.find((player) => player.playerId === rightId && player.playerId !== left?.playerId)
    ?? players.find((player) => player.teamId !== team1Id && player.playerId !== left?.playerId)
    ?? players.find((player) => player.playerId !== left?.playerId);

  return <section className="owtv-player-compare">
    <header>
      <div><GitCompareArrows size={20} /><h3>选手数据对比</h3><span>{scope}</span></div>
      <p>数据范围与上方“全场 / 地图”选择保持一致</p>
    </header>
    <div className="owtv-compare-pickers">
      <label>
        <small>选手 A</small>
        <select value={left?.playerId ?? ""} onChange={(event) => onLeftChange(Number(event.target.value))}>
          {players.map((player) => <option key={player.playerId} value={player.playerId}>{player.teamId === team1Id ? team1Name : team2Name} · {player.name}</option>)}
        </select>
        {left && <strong>{left.name}<em>{roleName(left.role)}</em></strong>}
      </label>
      <b>VS</b>
      <label>
        <small>选手 B</small>
        <select value={right?.playerId ?? ""} onChange={(event) => onRightChange(Number(event.target.value))}>
          {players.filter((player) => player.playerId !== left?.playerId).map((player) => <option key={player.playerId} value={player.playerId}>{player.teamId === team1Id ? team1Name : team2Name} · {player.name}</option>)}
        </select>
        {right && <strong>{right.name}<em>{roleName(right.role)}</em></strong>}
      </label>
    </div>
    {left && right ? <div className="owtv-compare-metrics">
      {compareMetrics.map((metric) => {
        const leftValue = compareValue(left, metric.key);
        const rightValue = compareValue(right, metric.key);
        const maximum = Math.max(leftValue, rightValue, 1);
        const leftWins = metric.lowerIsBetter ? leftValue < rightValue : leftValue > rightValue;
        const rightWins = metric.lowerIsBetter ? rightValue < leftValue : rightValue > leftValue;
        const format = metric.decimal ? decimal : integer;
        return <div className="owtv-compare-row" key={metric.key}>
          <b className={leftWins ? "winner" : ""}>{format.format(leftValue)}</b>
          <span className="left"><i style={{ width: `${Math.max(3, leftValue / maximum * 100)}%` }} /></span>
          <strong>{metric.label}</strong>
          <span className="right"><i style={{ width: `${Math.max(3, rightValue / maximum * 100)}%` }} /></span>
          <b className={rightWins ? "winner" : ""}>{format.format(rightValue)}</b>
        </div>;
      })}
    </div> : <p className="owtv-detail-empty">当前数据范围内不足两名选手，无法进行对比。</p>}
  </section>;
}

function TeamLineup({
  teamName,
  active,
  substitutes,
  selectedMap,
  mapName,
  hasMapData,
}: {
  teamName: string;
  active: TotalRow[];
  substitutes: TotalRow[];
  selectedMap: SelectedMap;
  mapName: string;
  hasMapData: boolean;
}) {
  return <div className="owtv-lineup-team">
    <header>
      <h3>{teamName}</h3>
      <span>{selectedMap === "all" ? "首发阵容" : `${mapName} 出场`}</span>
    </header>
    {selectedMap !== "all" && !hasMapData ? <p className="owtv-lineup-missing">OWTV 未提供这张地图的选手数据</p> : <div className="owtv-lineup-five">
      {active.map((player) => <PlayerTile key={player.playerId} player={player} />)}
      {Array.from({ length: Math.max(0, 5 - active.length) }).map((_, index) => <span className="owtv-lineup-player missing" key={`missing-${index}`}><i /><b>数据缺失</b><small>未记录</small></span>)}
    </div>}
    {!!substitutes.length && <div className="owtv-bench">
      <strong>替补</strong>
      {substitutes.map((player) => <PlayerTile key={player.playerId} player={player} badge={`${player.mapCount} 图`} />)}
    </div>}
  </div>;
}

export default function OwtvMatchDetail({ detail, scheduleMatch, onClose }: Props) {
  const [selectedMap, setSelectedMap] = useState<SelectedMap>("all");
  const [leftCompareId, setLeftCompareId] = useState<number | null>(null);
  const [rightCompareId, setRightCompareId] = useState<number | null>(null);
  const allTotals = useMemo(() => aggregateStats(detail.stats), [detail.stats]);
  const mapRows = useMemo(() => selectedMap === "all" ? [] : detail.stats.filter((row) => row.matchMapId === selectedMap), [detail.stats, selectedMap]);
  const visibleStats = useMemo(() => selectedMap === "all" ? allTotals : aggregateStats(mapRows), [allTotals, mapRows, selectedMap]);
  const orderedStats = useMemo(() => [...visibleStats].sort((a, b) => {
    const teamOrder = Number(a.teamId !== detail.match.team1.id) - Number(b.teamId !== detail.match.team1.id);
    return teamOrder || roleOrder(a.role) - roleOrder(b.role) || sum(b.fantasy) - sum(a.fantasy);
  }), [detail.match.team1.id, visibleStats]);

  const firstRecordedMapId = useMemo(() => {
    for (const map of [...detail.maps].sort((a, b) => a.index - b.index)) {
      const rows = detail.stats.filter((row) => row.matchMapId === map.id);
      const team1Count = rows.filter((row) => row.teamId === detail.match.team1.id).length;
      const team2Count = rows.filter((row) => row.teamId === detail.match.team2.id).length;
      if (team1Count === 5 && team2Count === 5) return map.id;
    }
    return detail.maps[0]?.id ?? null;
  }, [detail.maps, detail.match.team1.id, detail.match.team2.id, detail.stats]);

  const lineupRows = useMemo(() => {
    if (selectedMap !== "all") return mapRows;
    return firstRecordedMapId === null ? [] : detail.stats.filter((row) => row.matchMapId === firstRecordedMapId);
  }, [detail.stats, firstRecordedMapId, mapRows, selectedMap]);

  const team1Active = sortLineup(aggregateStats(lineupRows.filter((row) => row.teamId === detail.match.team1.id)));
  const team2Active = sortLineup(aggregateStats(lineupRows.filter((row) => row.teamId === detail.match.team2.id)));
  const team1ActiveIds = new Set(team1Active.map((player) => player.playerId));
  const team2ActiveIds = new Set(team2Active.map((player) => player.playerId));
  const team1Subs = sortLineup(allTotals.filter((row) => row.teamId === detail.match.team1.id && !team1ActiveIds.has(row.playerId)));
  const team2Subs = sortLineup(allTotals.filter((row) => row.teamId === detail.match.team2.id && !team2ActiveIds.has(row.playerId)));
  const selectedMapRecord = selectedMap === "all" ? null : detail.maps.find((map) => map.id === selectedMap) ?? null;
  const hasMapData = selectedMap === "all" || mapRows.length > 0;
  const mvp = [...allTotals].sort((a, b) => sum(b.fantasy) - sum(a.fantasy) || sum(b.eliminations) - sum(a.eliminations))[0];
  const start = detail.match.startDate ? new Date(detail.match.startDate) : null;
  const links = [
    scheduleMatch.bilibili && { label: "B站", url: scheduleMatch.bilibili, icon: <Play size={15} /> },
    detail.match.sourceUrl && { label: "OWTV", url: detail.match.sourceUrl, icon: <Activity size={15} /> },
    scheduleMatch.youtube && { label: "YouTube", url: scheduleMatch.youtube, icon: <Play size={15} /> },
    scheduleMatch.twitch && { label: "Twitch", url: scheduleMatch.twitch, icon: <Radio size={15} /> },
  ].filter(Boolean) as Array<{ label: string; url: string; icon: React.ReactNode }>;
  const score1 = detail.match.score1;
  const score2 = detail.match.score2;
  const hasFinalScore = score1 !== null && score2 !== null;
  const winner = hasFinalScore && score1 !== score2 ? (score1 > score2 ? detail.match.team1 : detail.match.team2) : null;
  const loser = hasFinalScore && score1 !== score2 ? (score1 < score2 ? detail.match.team1 : detail.match.team2) : null;

  return <section className="owtv-detail" id="owtv-match-detail">
    <header className="owtv-detail-scoreboard">
      <button className="owtv-detail-back" onClick={onClose}><ArrowLeft size={18} />返回比赛列表</button>
      <div className="owtv-detail-event"><strong>{detail.match.tournament || scheduleMatch.event}</strong><span>{scheduleMatch.stage || scheduleMatch.phase || "职业比赛"}</span>{start && <time>{start.toLocaleString("zh-CN", { hour12: false })}</time>}</div>
      <div className="owtv-detail-team first"><img src={detail.match.team1.logo || scheduleMatch.team1Logo} alt="" /><strong>{detail.match.team1.name}</strong></div>
      <div className="owtv-detail-score"><b>{detail.match.score1 ?? "—"}</b><span>:</span><b>{detail.match.score2 ?? "—"}</b><small>{detail.match.live ? "进行中" : detail.match.complete ? "已结束" : "即将开始"}</small></div>
      <div className="owtv-detail-team"><img src={detail.match.team2.logo || scheduleMatch.team2Logo} alt="" /><strong>{detail.match.team2.name}</strong></div>
    </header>

    <div className="owtv-detail-streams">
      <strong><Radio size={18} />直播与数据</strong>
      {links.map((link) => <a key={link.label} href={link.url} target="_blank" rel="noreferrer">{link.icon}{link.label}<ExternalLink size={13} /></a>)}
      <span>{detail.source}</span>
    </div>

    {!detail.stats.length && detail.match.complete && <section className="owtv-result-record">
      <header><Trophy size={19} /><div><h3>赛果记录</h3><p>没有选手统计时仍保留对阵双方、最终比分和胜负关系。</p></div></header>
      <div>
        <span><small>胜者</small><strong>{winner?.name ?? (hasFinalScore ? "平局" : "待核实")}</strong></span>
        <b>{hasFinalScore ? `${score1} : ${score2}` : "— : —"}</b>
        <span><small>负者</small><strong>{loser?.name ?? (hasFinalScore ? "平局" : "待核实")}</strong></span>
      </div>
    </section>}

    <section className="owtv-map-summary">
      <h3><MapPinned size={19} />地图与英雄禁用</h3>
      <div>
        {detail.maps.map((map) => <button key={map.id} className={selectedMap === map.id ? "active" : ""} onClick={() => setSelectedMap(map.id)}>
          <span><small>地图 {map.index}</small><strong>{map.name}</strong><em>{modeName(map.mode)}</em></span>
          <div><HeroBan hero={map.team1Ban} team={detail.match.team1.name} /><b>{map.score1 ?? "—"}</b></div>
          <div><HeroBan hero={map.team2Ban} team={detail.match.team2.name} /><b>{map.score2 ?? "—"}</b></div>
        </button>)}
        {!detail.maps.length && <p className="owtv-detail-empty">这场比赛尚无逐地图记录。</p>}
      </div>
    </section>

    {!!detail.stats.length && <>
    <section className="owtv-rosters">
      <TeamLineup teamName={detail.match.team1.name} active={team1Active} substitutes={team1Subs} selectedMap={selectedMap} mapName={selectedMapRecord?.name ?? ""} hasMapData={hasMapData} />
      <article>
        <Trophy size={22} />
        <small>数据最高（非投票 MVP）</small>
        <strong>{mvp?.name ?? "暂无"}</strong>
        {mvp && <p>{decimal.format(sum(mvp.fantasy))} Fantasy · {integer.format(sum(mvp.eliminations))} 击杀</p>}
      </article>
      <TeamLineup teamName={detail.match.team2.name} active={team2Active} substitutes={team2Subs} selectedMap={selectedMap} mapName={selectedMapRecord?.name ?? ""} hasMapData={hasMapData} />
    </section>

    <section className="owtv-stat-board">
      <header><h3><UsersRound size={19} />选手数据</h3><nav><button className={selectedMap === "all" ? "active" : ""} onClick={() => setSelectedMap("all")}>全场</button>{detail.maps.map((map) => <button key={map.id} className={selectedMap === map.id ? "active" : ""} onClick={() => setSelectedMap(map.id)}>{map.name}</button>)}</nav></header>
      <div className="owtv-stat-table">
        <div className="head"><span>选手</span><span>位置</span><span>地图</span><span>击杀</span><span>助攻</span><span>死亡</span><span>最终击杀</span><span>伤害</span><span>治疗</span><span>减伤</span><span>Fantasy</span></div>
        {orderedStats.map((player) => <div className={player.teamId === detail.match.team1.id ? "team-one" : "team-two"} key={player.playerId}>
          <span className="player">{player.image ? <img src={player.image} alt="" /> : <i /> }<b>{player.name}</b><small>{player.teamId === detail.match.team1.id ? detail.match.team1.name : detail.match.team2.name}</small></span>
          <span>{roleName(player.role)}</span><span>{player.mapCount}</span><span>{integer.format(sum(player.eliminations))}</span><span>{integer.format(sum(player.assists))}</span><span>{integer.format(sum(player.deaths))}</span><span>{integer.format(sum(player.finalBlows))}</span><span>{integer.format(sum(player.damage))}</span><span>{integer.format(sum(player.healing))}</span><span>{integer.format(sum(player.mitigation))}</span><span className="fantasy">{decimal.format(sum(player.fantasy))}</span>
        </div>)}
        {!orderedStats.length && <p className="owtv-detail-empty">OWTV 尚未提供这张地图的选手数据。</p>}
      </div>
    </section>
    <PlayerComparison
      players={orderedStats}
      leftId={leftCompareId}
      rightId={rightCompareId}
      onLeftChange={setLeftCompareId}
      onRightChange={setRightCompareId}
      team1Id={detail.match.team1.id}
      team1Name={detail.match.team1.name}
      team2Name={detail.match.team2.name}
      scope={selectedMap === "all" ? "全场数据" : selectedMapRecord?.name ?? "单张地图"}
    />
    </>}
  </section>;
}
