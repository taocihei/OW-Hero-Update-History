export interface PlayerEventHero {
  hero: string;
  mapAppearances: number;
}

export interface PlayerEventMatch {
  id: string;
  datetime: string;
  opponent: string;
  scoreFor: number;
  scoreAgainst: number;
  mapAppearances: number;
  heroes: string[];
  eliminations: number;
  assists: number;
  deaths: number;
  damage: number;
  healing: number;
  mitigation: number;
  owtv: string;
  bilibili: string;
}

export interface PlayerEventSnapshot {
  player: string;
  team: string;
  event: string;
  eventAliases: string[];
  placement: string;
  roster: string[];
  heroes: PlayerEventHero[];
  teamTankNote: string;
  matches: PlayerEventMatch[];
  generatedAt: string;
}

const guxueMidseason2026: PlayerEventSnapshot = {
  player: "Guxue",
  team: "Weibo Gaming",
  event: "2026 季中冠军赛",
  eventAliases: ["2026 季中冠军赛", "Midseason Championship", "Midseason Championship - OWCS 2026"],
  placement: "第 4 名",
  roster: ["Leave", "shy", "SUNZO", "LeeSooMin", "MAKA"],
  heroes: [
    { hero: "Winston", mapAppearances: 5 },
    { hero: "Doomfist", mapAppearances: 3 },
    { hero: "Ramattra", mapAppearances: 2 },
  ],
  teamTankNote: "本届 WBG 坦克轮换：Guxue 以温斯顿为主，另用末日铁拳、拉玛刹；SUNZO 负责其余副坦阵容。",
  generatedAt: "2026-08-05T00:00:00+08:00",
  matches: [
    {
      id: "guxue-midseason-2026-tl", datetime: "2026-07-29T17:15:00.000Z", opponent: "Team Liquid",
      scoreFor: 2, scoreAgainst: 1, mapAppearances: 2, heroes: ["Ramattra", "Doomfist"],
      eliminations: 38, assists: 8, deaths: 13, damage: 24127, healing: 3161, mitigation: 25130,
      owtv: "https://owtv.gg/matches/midseason-championship-owcs-2026-groups-day-1-wei-vs-tl",
      bilibili: "https://www.bilibili.com/video/BV1sR3H6NESi",
    },
    {
      id: "guxue-midseason-2026-flc", datetime: "2026-07-30T11:00:00.000Z", opponent: "Team Falcons",
      scoreFor: 2, scoreAgainst: 1, mapAppearances: 1, heroes: ["Ramattra"],
      eliminations: 32, assists: 13, deaths: 13, damage: 17992, healing: 998, mitigation: 16163,
      owtv: "https://owtv.gg/matches/midseason-championship-owcs-2026-groups-day-2-wei-vs-flc",
      bilibili: "https://www.bilibili.com/video/BV1oN3866EcJ",
    },
    {
      id: "guxue-midseason-2026-ssg", datetime: "2026-08-01T13:00:00.000Z", opponent: "Spacestation Gaming",
      scoreFor: 3, scoreAgainst: 1, mapAppearances: 2, heroes: ["Winston", "Doomfist"],
      eliminations: 41, assists: 22, deaths: 11, damage: 21375, healing: 4774, mitigation: 10786,
      owtv: "https://owtv.gg/matches/midseason-championship-owcs-2026-playoffs-day-4-wei-vs-ssg",
      bilibili: "https://www.bilibili.com/video/BV1qf3m6tEn7",
    },
    {
      id: "guxue-midseason-2026-tm", datetime: "2026-08-02T11:30:00.000Z", opponent: "Twisted Minds",
      scoreFor: 2, scoreAgainst: 3, mapAppearances: 3, heroes: ["Winston", "Doomfist"],
      eliminations: 80, assists: 26, deaths: 18, damage: 32637, healing: 6856, mitigation: 20898,
      owtv: "https://owtv.gg/matches/midseason-championship-owcs-2026-playoffs-day-5-tm-vs-wei",
      bilibili: "https://www.bilibili.com/video/BV17G3o6DEse",
    },
    {
      id: "guxue-midseason-2026-t1", datetime: "2026-08-02T13:45:00.000Z", opponent: "T1",
      scoreFor: 0, scoreAgainst: 3, mapAppearances: 2, heroes: ["Winston"],
      eliminations: 39, assists: 18, deaths: 14, damage: 21369, healing: 6013, mitigation: 13717,
      owtv: "https://owtv.gg/matches/midseason-championship-owcs-2026-playoffs-day-5-wei-vs-t1",
      bilibili: "https://www.bilibili.com/video/BV1Qw3d6BEqq",
    },
  ],
};

const snapshots = [guxueMidseason2026];

function key(value: string) {
  return value.normalize("NFKC").replace(/[^a-z0-9\u4e00-\u9fff]/gi, "").toLowerCase();
}

export function playerEventSnapshots(player: string) {
  const playerKey = key(player);
  return snapshots.filter((snapshot) => key(snapshot.player) === playerKey);
}
