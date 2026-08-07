import snapshot from "./officialHistorySnapshot.json";
import type { BalanceChange } from "./types";

export interface OfficialHistoryState {
  source: string;
  sourceIndex: string;
  generatedAt: string | number;
  scannedMonths: string[];
  updatedMonths: string[];
  patchDates: string[];
  patchEntries: string[];
  heroes: Record<string, BalanceChange[]>;
}

interface HistoryOverlay {
  generatedAt: string | number;
  scannedMonths: string[];
  patchDates?: string[];
  patchEntries?: string[];
  heroes: Record<string, BalanceChange[]>;
}

const CACHE_KEY = "balance-atlas:official-history-overlay:v1";
const bundled = snapshot as unknown as {
  source: string;
  sourceIndex: string;
  generatedAt: string;
  scannedMonths: string[];
  patchDates?: string[];
  patchEntries?: string[];
  heroes: Record<string, BalanceChange[]>;
};

function mergeHeroes(base: Record<string, BalanceChange[]>, overlay: Record<string, BalanceChange[]>) {
  const result: Record<string, BalanceChange[]> = {};
  for (const key of new Set([...Object.keys(base), ...Object.keys(overlay)])) {
    const records = new Map<string, BalanceChange>();
    const semanticKey = (record: BalanceChange) => [
      record.date,
      record.sourceUrl,
      record.titleEn ?? record.title,
      ...(record.detailsEn ?? record.details),
    ].join("|");
    // Load the local overlay first, then let the bundled archive win for an
    // identical official record. This migrates older cached Stadium rows that
    // were previously stored under the Perk track without duplicating them.
    for (const record of overlay[key] ?? []) records.set(semanticKey(record), record);
    for (const record of base[key] ?? []) records.set(semanticKey(record), record);
    result[key] = Array.from(records.values()).sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
  }
  return result;
}

function readOverlay(): HistoryOverlay | null {
  try {
    const value = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as HistoryOverlay | null;
    return value?.heroes && Array.isArray(value.scannedMonths) ? value : null;
  } catch {
    return null;
  }
}

export function loadOfficialHistory(): OfficialHistoryState {
  const overlay = readOverlay();
  return {
    source: bundled.source,
    sourceIndex: bundled.sourceIndex,
    generatedAt: overlay?.generatedAt ?? bundled.generatedAt,
    scannedMonths: Array.from(new Set([...(bundled.scannedMonths ?? []), ...(overlay?.scannedMonths ?? [])])),
    updatedMonths: [],
    patchDates: Array.from(new Set([...(bundled.patchDates ?? []), ...(overlay?.patchDates ?? [])])).sort(),
    patchEntries: Array.from(new Set([...(bundled.patchEntries ?? []), ...(overlay?.patchEntries ?? [])])).sort(),
    heroes: mergeHeroes(bundled.heroes, overlay?.heroes ?? {}),
  };
}

export async function syncOfficialHistory(current: OfficialHistoryState): Promise<OfficialHistoryState> {
  if (!("__TAURI_INTERNALS__" in window)) return current;
  const { invoke } = await import("@tauri-apps/api/core");
  const payload = await invoke<OfficialHistoryState>("fetch_official_history", { knownMonths: current.scannedMonths });
  const previous = readOverlay();
  const incomingRecordDates = Object.values(payload.heroes ?? {}).flatMap((records) => records.map((record) => record.date));
  const incomingPatchEntries = (payload.patchEntries ?? []).length
    ? payload.patchEntries
    : (payload.patchDates ?? incomingRecordDates).map((date) => `live:${date}`);
  const overlay: HistoryOverlay = {
    generatedAt: payload.generatedAt,
    scannedMonths: payload.scannedMonths,
    patchDates: Array.from(new Set([...(previous?.patchDates ?? []), ...(payload.patchDates ?? []), ...incomingRecordDates])).sort(),
    patchEntries: Array.from(new Set([...(previous?.patchEntries ?? []), ...incomingPatchEntries])).sort(),
    heroes: mergeHeroes(previous?.heroes ?? {}, payload.heroes),
  };
  localStorage.setItem(CACHE_KEY, JSON.stringify(overlay));
  return {
    ...payload,
    patchDates: Array.from(new Set([...(bundled.patchDates ?? []), ...(overlay.patchDates ?? [])])).sort(),
    patchEntries: Array.from(new Set([...(bundled.patchEntries ?? []), ...(overlay.patchEntries ?? [])])).sort(),
    heroes: mergeHeroes(bundled.heroes, overlay.heroes),
  };
}

export function historyRecordCount(state: OfficialHistoryState) {
  return Object.values(state.heroes).reduce((total, records) => total + records.length, 0);
}

export function historyPatchCount(state: OfficialHistoryState) {
  return new Set(Object.values(state.heroes).flatMap((records) => records.map((record) => `${record.archiveChannel ?? record.track ?? "live"}:${record.date}`))).size;
}

export function officialPatchCount(state: OfficialHistoryState) {
  return state.patchEntries.length || state.patchDates.length;
}
