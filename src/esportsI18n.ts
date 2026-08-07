import { bundledHeroRoster } from "./heroRosterData";

export type UiLocale = "zh" | "en";

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

const heroByEnglishName = new Map(bundledHeroRoster.map((hero) => [normalize(hero.englishName), hero]));

export function localizeHeroName(value: string, locale: UiLocale) {
  const hero = heroByEnglishName.get(normalize(value));
  if (!hero) return value;
  return locale === "zh" ? hero.name : hero.englishName;
}

const tournamentZh: Record<string, string> = {
  "China - Stage 1": "中国赛区 · 第一阶段",
  "EMEA - Stage 1": "EMEA · 第一阶段",
  "Japan - Stage 1": "日本赛区 · 第一阶段",
  "Korea - Stage 1": "韩国赛区 · 第一阶段",
  "North America - Stage 1": "北美赛区 · 第一阶段",
  "Pacific - Stage 1": "太平洋赛区 · 第一阶段",
  "Pre-Season Bootcamp": "季前训练营",
  "Non-Partner Team Index": "非合作战队索引",
  "Partner Team Index": "合作战队索引",
};

export function localizeTournamentName(value: string, locale: UiLocale) {
  if (locale !== "zh") return value;
  const stage2025 = value.match(/^2025 OWCS Stage (\d) · (.+)$/);
  if (stage2025) {
    const regionNames: Record<string, string> = { EMEA: "欧洲/中东/非洲", KR: "韩国", NA: "北美", International: "国际赛" };
    const bracketNames: Record<string, string> = { "Regular Season": "常规赛", "Double Elimination": "双败淘汰赛", "Stage 1 RR": "第一阶段常规赛", "Stage 1 DE": "第一阶段淘汰赛" };
    const stageNames: Record<string, string> = { "1": "第一阶段", "2": "第二阶段", "3": "第三阶段" };
    const parts = stage2025[2].split(" · ");
    return `2025 OWCS ${stageNames[stage2025[1]] ?? `第 ${stage2025[1]} 阶段`} · ${parts.map((part) => regionNames[part] ?? bracketNames[part] ?? part).join(" · ")}`;
  }
  return tournamentZh[value] ?? value;
}

const mapZh: Record<string, string> = {
  Aatlis: "埃特利斯",
  "Blizzard World": "暴雪世界",
  Busan: "釜山",
  Colosseo: "斗兽场",
  Eichenwalde: "艾兴瓦尔德",
  "Esperança": "埃斯佩兰萨",
  Havana: "哈瓦那",
  Ilios: "伊利奥斯",
  "Lijiang Tower": "漓江塔",
  Midtown: "中城",
  "New Junk City": "新渣客城",
  Numbani: "努巴尼",
  Oasis: "绿洲城",
  Rialto: "里阿尔托",
  Runasapi: "鲁纳萨匹",
  "Shambali Monastery": "香巴里寺院",
  Suravasa: "苏拉瓦萨",
  "Watchpoint: Gibraltar": "监测站：直布罗陀",
};

export function localizeMapName(value: string, locale: UiLocale) {
  return locale === "zh" ? mapZh[value] ?? value : value;
}
