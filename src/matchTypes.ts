export interface PlayerIntel {
  playerId: string;
  username: string;
  avatar?: string;
  title?: string;
  endorsement?: number;
  lastUpdatedAt?: number;
  ranks: Array<{ role: string; tier: string; division?: number }>;
  average: {
    eliminations?: number;
    assists?: number;
    deaths?: number;
    damage?: number;
    healing?: number;
  };
  gamesPlayed?: number;
  gamesWon?: number;
  winrate?: number;
  kda?: number;
}

export type EsportsMatchStatus = "completed" | "upcoming" | "live" | string;

export interface EsportsMatch {
  id: string;
  datetime: string;
  status: EsportsMatchStatus;
  team1: string;
  team2: string;
  team1Id: string;
  team2Id: string;
  team1Logo: string;
  team2Logo: string;
  score1: number | null;
  score2: number | null;
  event: string;
  region: string;
  phase: string;
  stage: string;
  youtube: string;
  twitch: string;
  owtv?: string;
  bilibili?: string;
  sources?: string[];
  tournamentId?: string;
  owtvMatchId?: number;
  bracketSide?: string;
  bracketGroup?: string;
  bracketMatchNumber?: number | null;
  round?: number | null;
  nextMatchWinnerId?: number | null;
  nextMatchLoserId?: number | null;
}

export interface CompetitionSummary {
  id: string;
  name: string;
  region: string;
  url: string;
  matchCount: number;
  videoCount: number;
  logo: string;
  startDate: string;
  endDate: string;
  location: string;
  prizePool: string;
  participants: string[];
}

export interface CompetitionVideo {
  bvid: string;
  title: string;
  url: string;
  publishedAt: number;
  duration: number;
  tournamentId: string;
}

export interface EsportsSchedulePayload {
  source: string;
  syncedAt: string | number;
  matches: EsportsMatch[];
}

export interface OwtvDetailTeam {
  id: number;
  name: string;
  logo: string;
}

export interface OwtvMapDetail {
  id: number;
  index: number;
  name: string;
  mode: string;
  score1: number | null;
  score2: number | null;
  complete: boolean;
  team1Ban: { id: number; name: string } | null;
  team2Ban: { id: number; name: string } | null;
  pickerTeamId: number | null;
  pickerType: string | null;
  replayCode: string;
}

export interface OwtvPlayerMapStat {
  matchMapId: number;
  teamId: number | null;
  playerId: number;
  name: string;
  role: string;
  image: string;
  eliminations: number | null;
  assists: number | null;
  deaths: number | null;
  damage: number | null;
  healing: number | null;
  mitigation: number | null;
  fantasy: number | null;
  objectiveTime: number | null;
  finalBlows: number | null;
}

export interface OwtvMatchDetailPayload {
  match: {
    id: number;
    slug: string;
    startDate: string | null;
    complete: boolean;
    live: boolean;
    tournament: string;
    region: string;
    team1: OwtvDetailTeam;
    team2: OwtvDetailTeam;
    score1: number | null;
    score2: number | null;
    sourceUrl: string;
  };
  maps: OwtvMapDetail[];
  stats: OwtvPlayerMapStat[];
  source: string;
}
