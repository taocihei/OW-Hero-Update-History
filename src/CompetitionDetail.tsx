import { useEffect, useMemo, useState } from "react";
import { Activity, CalendarDays, ExternalLink, MapPinned, Play, Trophy, UsersRound } from "lucide-react";
import type { CompetitionSummary, EsportsMatch } from "./matchTypes";

interface Props {
  competition: CompetitionSummary;
  matches: EsportsMatch[];
}

interface BracketRound {
  title: string;
  matches: EsportsMatch[];
}

const teamAliases: Record<string, string> = {
  "9z": "9z Team",
  ag: "All Gamers",
  cr: "Crazy Raccoon",
  dal: "Dallas Fuel",
  flc: "Team Falcons",
  gk: "Geekay Esports",
  jd: "JD Gaming",
  ssg: "Spacestation Gaming",
  t1: "T1",
  tl: "Team Liquid",
  tm: "Twisted Minds",
  ts: "Team Secret",
  vl: "VARREL",
  vp: "Virtus.Pro",
  wei: "Weibo Gaming",
  zeta: "Zeta Division",
};

function stageOf(match: EsportsMatch) {
  if (match.bracketGroup) return "Groups";
  const explicit = match.stage.trim();
  if (explicit) return explicit;
  const value = `${match.id} ${match.phase}`.toLowerCase();
  if (value.includes("playoff")) return "Playoffs";
  if (value.includes("group")) return "Groups";
  if (value.includes("regular-season")) return "Regular Season";
  if (value.includes("swiss")) return "Swiss Stage";
  if (value.includes("qualifier")) return "Qualifier";
  return "其他阶段";
}

function stageLabel(value: string) {
  const names: Record<string, string> = {
    Playoffs: "淘汰赛",
    "Regular Season": "常规赛",
    "Regular season": "常规赛",
    Groups: "小组赛",
    "Swiss Stage": "瑞士轮",
    "Swiss Stage ": "瑞士轮",
    Qualifier: "资格赛",
    "Regional Playoffs": "赛区季后赛",
    "Last Chance Qualifier": "最终资格赛",
    "Playoffs Seeding Decider Matches": "季后赛排位赛",
  };
  return names[value] ?? value;
}

function date(value: string) {
  if (!value) return "待定";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function recoveredTeams(match: EsportsMatch) {
  const raw = match.id.match(/-day-\d-([a-z0-9]+)-vs-([a-z0-9]+)$/i);
  const fallback = raw ? [teamAliases[raw[1].toLowerCase()], teamAliases[raw[2].toLowerCase()]] : [];
  const clean = (value: string, index: number) => {
    const normalized = value.trim();
    if (!normalized || normalized === "TBD" || /^(winner|loser) of/i.test(normalized)) return fallback[index] || "待晋级";
    return normalized;
  };
  return [clean(match.team1, 0), clean(match.team2, 1)] as const;
}

function BracketCard({ match }: { match: EsportsMatch }) {
  const completed = match.status === "completed" || match.score1 !== null || match.score2 !== null;
  const [team1, team2] = recoveredTeams(match);
  return <article className="bracket-match-card">
    <header>
      <span>{match.bracketSide === "losers" ? "败者组" : match.bracketSide === "third_place" ? "季军赛" : match.bracketSide === "grand_final" ? "总决赛" : match.bracketSide === "winners" ? "胜者组" : stageLabel(stageOf(match))}</span>
      <small>{date(match.datetime)}</small>
      <nav>
        {match.owtv && <a href={match.owtv} title="比赛数据" target="_blank" rel="noreferrer"><Activity size={14} /></a>}
        {match.bilibili && <a href={match.bilibili} title="B站回放" target="_blank" rel="noreferrer"><Play size={14} /></a>}
      </nav>
    </header>
    <p className={(match.score1 ?? -1) > (match.score2 ?? -1) ? "winner" : ""}>{match.team1Logo && <img src={match.team1Logo} alt="" />}<strong>{team1}</strong><b>{completed ? match.score1 ?? "–" : "–"}</b></p>
    <p className={(match.score2 ?? -1) > (match.score1 ?? -1) ? "winner" : ""}>{match.team2Logo && <img src={match.team2Logo} alt="" />}<strong>{team2}</strong><b>{completed ? match.score2 ?? "–" : "–"}</b></p>
  </article>;
}

function RecentMatchCard({ match }: { match: EsportsMatch }) {
  const [team1, team2] = recoveredTeams(match);
  const completed = match.status === "completed" || match.score1 !== null || match.score2 !== null;
  const href = match.owtv || match.bilibili;
  const body = <>
    <header><span>{date(match.datetime)}</span><small>{stageLabel(stageOf(match))}</small></header>
    <p>{match.team1Logo ? <img src={match.team1Logo} alt="" /> : <i />}<strong>{team1}</strong><b>{completed ? match.score1 ?? "–" : "–"}</b></p>
    <p>{match.team2Logo ? <img src={match.team2Logo} alt="" /> : <i />}<strong>{team2}</strong><b>{completed ? match.score2 ?? "–" : "–"}</b></p>
  </>;
  return href
    ? <a className="competition-recent-card" href={href} target="_blank" rel="noreferrer">{body}</a>
    : <article className="competition-recent-card">{body}</article>;
}

function BracketLane({ title, rounds, tone = "winner" }: { title: string; rounds: BracketRound[]; tone?: "winner" | "loser" | "final" }) {
  const largest = Math.max(1, ...rounds.map((round) => round.matches.length));
  return <section className={`bracket-lane ${tone}`} style={{ "--lane-rows": largest } as React.CSSProperties}>
    <h4><span>{title}</span><i /></h4>
    <div className="bracket-round-grid" style={{ "--round-count": rounds.length } as React.CSSProperties}>
      {rounds.map((round, roundIndex) => <section className="bracket-round" key={round.title}>
        <h5>{round.title}</h5>
        <div className="bracket-round-cards">
          {round.matches.map((match) => <BracketCard match={match} key={match.id} />)}
        </div>
        {roundIndex < rounds.length - 1 && <span className="round-connector" aria-hidden="true" />}
      </section>)}
    </div>
  </section>;
}

function uniqueMatches(rows: EsportsMatch[]) {
  const merged = new Map<string, EsportsMatch>();
  rows.forEach((match) => {
    const key = match.owtvMatchId ? `owtv:${match.owtvMatchId}` : match.id;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, match);
      return;
    }

    // The live schedule and the archived bracket describe the same OWTV match.
    // Keep the schedule links/scores, while restoring the bracket route fields
    // that are only present in the archive snapshot.
    merged.set(key, {
      ...existing,
      ...match,
      id: existing.id || match.id,
      stage: match.stage || existing.stage,
      phase: match.phase || existing.phase,
      bracketGroup: match.bracketGroup || existing.bracketGroup,
      bracketSide: match.bracketSide || existing.bracketSide,
      bracketMatchNumber: match.bracketMatchNumber ?? existing.bracketMatchNumber,
      nextMatchWinnerId: match.nextMatchWinnerId || existing.nextMatchWinnerId,
      nextMatchLoserId: match.nextMatchLoserId || existing.nextMatchLoserId,
      team1Logo: match.team1Logo || existing.team1Logo,
      team2Logo: match.team2Logo || existing.team2Logo,
      bilibili: match.bilibili || existing.bilibili,
      owtv: match.owtv || existing.owtv,
    });
  });
  return Array.from(merged.values());
}

function byBracketNumber(a: EsportsMatch, b: EsportsMatch) {
  return (a.bracketMatchNumber ?? 999) - (b.bracketMatchNumber ?? 999) || a.datetime.localeCompare(b.datetime);
}

export default function CompetitionDetail({ competition, matches }: Props) {
  const competitionMatches = useMemo(() => uniqueMatches(matches.filter((match) => match.tournamentId === competition.id)), [competition.id, matches]);
  const stages = useMemo(() => Array.from(new Set(competitionMatches.map(stageOf))).sort((a, b) => {
    const priority = (value: string) => /^(playoffs|regional playoffs)$/i.test(value.trim()) ? 0 : /group|swiss/i.test(value) ? 1 : /regular/i.test(value) ? 2 : 3;
    return priority(a) - priority(b) || a.localeCompare(b);
  }), [competitionMatches]);
  const [stage, setStage] = useState(stages[0] ?? "");
  const [group, setGroup] = useState("all");
  useEffect(() => { setStage(stages[0] ?? ""); setGroup("all"); }, [competition.id, stages]);

  const stageMatches = useMemo(() => competitionMatches.filter((match) => stageOf(match) === stage).sort(byBracketNumber), [competitionMatches, stage]);
  const groups = useMemo(() => Array.from(new Set(stageMatches.map((match) => match.bracketGroup?.trim()).filter(Boolean) as string[])).sort(), [stageMatches]);
  useEffect(() => {
    if (groups.length) setGroup((current) => groups.includes(current) ? current : groups[0]);
    else setGroup("all");
  }, [groups]);

  const visibleMatches = useMemo(() => group === "all" ? stageMatches : stageMatches.filter((match) => match.bracketGroup?.trim() === group), [group, stageMatches]);
  const recentMatches = useMemo(() => [...visibleMatches].sort((a, b) => {
    const now = Date.now();
    return Math.abs(new Date(a.datetime).getTime() - now) - Math.abs(new Date(b.datetime).getTime() - now);
  }).slice(0, 6), [visibleMatches]);
  const lanes = useMemo(() => {
    if (/group/i.test(stage)) {
      const winners = visibleMatches.filter((match) => match.bracketSide === "winners").sort(byBracketNumber);
      const losers = visibleMatches.filter((match) => match.bracketSide === "losers").sort(byBracketNumber);
      return [
        { title: "胜者组晋级", tone: "winner" as const, rounds: [
          { title: "胜者组首轮", matches: winners.filter((match) => (match.bracketMatchNumber ?? 0) <= 4) },
          { title: "胜者组晋级赛", matches: winners.filter((match) => (match.bracketMatchNumber ?? 0) > 4) },
        ].filter((round) => round.matches.length) },
        { title: "败者组晋级", tone: "loser" as const, rounds: [
          { title: "败者组首轮", matches: losers.filter((match) => (match.bracketMatchNumber ?? 0) <= 9) },
          { title: "败者组晋级赛", matches: losers.filter((match) => (match.bracketMatchNumber ?? 0) > 9) },
        ].filter((round) => round.matches.length) },
      ].filter((lane) => lane.rounds.length);
    }
    if (/^(playoffs|regional playoffs)$/i.test(stage.trim())) {
      const finals = visibleMatches.filter((match) => match.bracketSide === "grand_final" || match.bracketSide === "third_place");
      const quarterfinals = visibleMatches.filter((match) => !finals.includes(match) && (match.bracketMatchNumber ?? 0) <= 4);
      const semifinals = visibleMatches.filter((match) => !finals.includes(match) && !quarterfinals.includes(match));
      return [{ title: "淘汰赛晋级路线", tone: "final" as const, rounds: [
        { title: "四分之一决赛", matches: quarterfinals },
        { title: "半决赛", matches: semifinals },
        { title: "决赛阶段", matches: finals.sort((a, b) => a.bracketSide === "grand_final" ? 1 : b.bracketSide === "grand_final" ? -1 : 0) },
      ].filter((round) => round.matches.length) }];
    }
    const days = Array.from(new Set(visibleMatches.map((match) => match.datetime.slice(0, 10))));
    return [{ title: stageLabel(stage), tone: "winner" as const, rounds: days.map((day, index) => ({ title: `第 ${index + 1} 比赛日`, matches: visibleMatches.filter((match) => match.datetime.startsWith(day)) })) }];
  }, [stage, visibleMatches]);

  return <section className="competition-detail">
    <header className="competition-detail-head">
      <div className="competition-emblem">{competition.logo ? <img src={competition.logo} alt="" /> : <Trophy size={30} />}</div>
      <div className="competition-identity"><small>TOURNAMENT PROFILE</small><h3>{competition.name}</h3><p>{competition.participants.length} 支队伍 · {competition.matchCount} 场比赛</p></div>
      <div className="competition-metrics">
        <span><CalendarDays size={15} /><small>比赛日期</small><b>{date(competition.startDate)}—{date(competition.endDate)}</b></span>
        <span><MapPinned size={15} /><small>赛区</small><b>{competition.location || competition.region.toUpperCase()}</b></span>
        <span><UsersRound size={15} /><small>规模</small><b>{competition.participants.length} 队 / {competition.matchCount} 场</b></span>
        <span><Trophy size={15} /><small>{competition.prizePool ? "奖金" : "回放"}</small><b>{competition.prizePool || `${competition.videoCount} 条`}</b></span>
      </div>
      <a className="competition-source-link" href={competition.url} target="_blank" rel="noreferrer">赛事资料 <ExternalLink size={14} /></a>
    </header>

    <div className="competition-stage-tabs">
      <strong>阶段</strong>
      {stages.map((item) => <button className={stage === item ? "active" : ""} onClick={() => setStage(item)} key={item}>{stageLabel(item)}<b>{competitionMatches.filter((match) => stageOf(match) === item).length}</b></button>)}
      {groups.length > 0 && <div className="competition-group-tabs"><span>分组</span>{groups.map((item) => <button className={group === item ? "active" : ""} onClick={() => setGroup(item)} key={item}>{item} 组</button>)}</div>}
    </div>

    <div className="competition-stage-body">
      <div className="competition-bracket-board">
        {lanes.map((lane) => <BracketLane key={lane.title} title={lane.title} rounds={lane.rounds} tone={lane.tone} />)}
        {!visibleMatches.length && <div className="competition-bracket-empty">该阶段暂无可排列的比赛</div>}
      </div>
      {!!recentMatches.length && <aside className="competition-recent">
        <h4>最近赛程</h4>
        <div>{recentMatches.map((match) => <RecentMatchCard match={match} key={match.id} />)}</div>
      </aside>}
    </div>
  </section>;
}
