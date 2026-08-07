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

const CACHE_KEY = "balance-atlas:hero-roster:v1";
const LOCAL_NAMES = new Map(bundledHeroRoster.map((hero) => [hero.key, hero.name]));
const BUNDLED_PORTRAITS = new Map(bundledHeroRoster.map((hero) => [hero.key, hero.portrait]));

function normalizeRoster(payload: unknown): HeroCatalogItem[] {
  if (!Array.isArray(payload)) throw new Error("英雄名单格式无效");
  return payload
    .filter((raw): raw is RawHero => Boolean(raw) && typeof raw === "object")
    .map((raw) => {
      const key = String(raw.key ?? "");
      const role = String(raw.role ?? "damage");
      const gamemodes = Array.isArray(raw.gamemodes) ? raw.gamemodes.map(String) : [];
      return {
        key,
        name: LOCAL_NAMES.get(key) ?? String(raw.name ?? key),
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
    const response = await fetch("https://overfast-api.tekrop.fr/heroes?locale=en-us");
    if (!response.ok) throw new Error(`英雄名单同步失败（HTTP ${response.status}）`);
    payload = await response.json();
  }

  const items = normalizeRoster(payload);
  if (items.length < 30) throw new Error("在线英雄名单不完整，已保留本地快照");
  const state: HeroRosterState = { items, syncedAt: new Date().toISOString(), source: "online" };
  localStorage.setItem(CACHE_KEY, JSON.stringify(state));
  return state;
}
