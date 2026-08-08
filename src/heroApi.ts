import { bundledHeroRoster } from "./heroRosterData";

export interface HeroCatalogItem {
  key: string;
  name: string;
  englishName: string;
  portrait: string;
  role: "tank" | "damage" | "support";
  gamemodes: string[];
}

export interface HeroRosterState {
  items: HeroCatalogItem[];
  syncedAt?: string;
  source: "online" | "cache" | "bundled";
}

type RawHero = {
  key?: unknown;
  name?: unknown;
  portrait?: unknown;
  role?: unknown;
  gamemodes?: unknown;
};

type RawRosterPayload = {
  english?: unknown;
  chinese?: unknown;
};

const CACHE_KEY = "balance-atlas:hero-roster:v1";
const LOCAL_NAMES = new Map(bundledHeroRoster.map((hero) => [hero.key, hero.name]));
const BUNDLED_PORTRAITS = new Map(bundledHeroRoster.map((hero) => [hero.key, hero.portrait]));

export function normalizeHeroRosterPayload(payload: unknown): HeroCatalogItem[] {
  const localized = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as RawRosterPayload
    : null;
  const english = Array.isArray(localized?.english) ? localized.english : payload;
  const chinese = Array.isArray(localized?.chinese) ? localized.chinese : [];
  if (!Array.isArray(english)) throw new Error("英雄名单格式无效");
  const chineseNames = new Map(chinese
    .filter((raw): raw is RawHero => Boolean(raw) && typeof raw === "object")
    .map((raw) => [String(raw.key ?? ""), String(raw.name ?? "")]));
  return english
    .filter((raw): raw is RawHero => Boolean(raw) && typeof raw === "object")
    .map((raw) => {
      const key = String(raw.key ?? "");
      const role = String(raw.role ?? "damage");
      const gamemodes = Array.isArray(raw.gamemodes) ? raw.gamemodes.map(String) : [];
      return {
        key,
        name: LOCAL_NAMES.get(key) ?? chineseNames.get(key) ?? String(raw.name ?? key),
        englishName: String(raw.name ?? key),
        portrait: BUNDLED_PORTRAITS.get(key) ?? String(raw.portrait ?? ""),
        role: role === "tank" || role === "support" ? role : "damage",
        gamemodes,
      } satisfies HeroCatalogItem;
    })
    .filter((hero) => hero.key && hero.portrait && (!hero.gamemodes.length || hero.gamemodes.includes("quickplay")));
}

export function loadHeroRoster(): HeroRosterState {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as HeroRosterState | null;
    if (cached?.items?.length) {
      return {
        ...cached,
        source: "cache",
        items: cached.items.map((hero) => ({
          ...hero,
          name: LOCAL_NAMES.get(hero.key) ?? hero.name,
          portrait: BUNDLED_PORTRAITS.get(hero.key) ?? hero.portrait,
        })),
      };
    }
  } catch {
    // A bad cache should never prevent the bundled roster from loading.
  }
  return { items: bundledHeroRoster, source: "bundled" };
}

export async function syncHeroRoster(): Promise<HeroRosterState> {
  let payload: unknown;
  if ("__TAURI_INTERNALS__" in window) {
    const { invoke } = await import("@tauri-apps/api/core");
    payload = await invoke("fetch_hero_roster");
  } else {
    const [englishResponse, chineseResponse] = await Promise.all([
      fetch("https://overfast-api.tekrop.fr/heroes?locale=en-us"),
      fetch("https://overfast-api.tekrop.fr/heroes?locale=zh-tw"),
    ]);
    if (!englishResponse.ok) throw new Error(`英雄名单同步失败（HTTP ${englishResponse.status}）`);
    payload = {
      english: await englishResponse.json(),
      chinese: chineseResponse.ok ? await chineseResponse.json() : [],
    };
  }

  const items = normalizeHeroRosterPayload(payload);
  if (items.length < 30) throw new Error("在线英雄名单不完整，已保留本地快照");
  const state: HeroRosterState = { items, syncedAt: new Date().toISOString(), source: "online" };
  localStorage.setItem(CACHE_KEY, JSON.stringify(state));
  return state;
}
