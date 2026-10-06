import type { OwtvPlayerMapStat } from "./matchTypes";

export const statMetrics = ["eliminations", "assists", "deaths", "damage", "healing", "mitigation", "fantasy", "objectiveTime", "finalBlows"] as const;
export type StatMetric = (typeof statMetrics)[number];
export type ComparedMetric = StatMetric | "mapCount";
export type TotalRow = OwtvPlayerMapStat & { mapCount: number; reportedMaps: Record<StatMetric, number> };

export function aggregateStats(rows: OwtvPlayerMapStat[]): TotalRow[] {
  const totals = new Map<string, TotalRow>();
  for (const row of rows) {
    const key = `${row.teamId}:${row.playerId}`;
    let current = totals.get(key);
    if (!current) {
      current = { ...row, mapCount: 0, reportedMaps: Object.fromEntries(statMetrics.map((metric) => [metric, 0])) as Record<StatMetric, number> };
      for (const metric of statMetrics) current[metric] = null;
      totals.set(key, current);
    }
    current.mapCount += 1;
    for (const metric of statMetrics) {
      const value = row[metric];
      if (value !== null && Number.isFinite(value)) {
        current[metric] = (current[metric] ?? 0) + value;
        current.reportedMaps[metric] += 1;
      }
    }
  }
  return [...totals.values()];
}

export function metricValue(player: TotalRow | undefined, metric: ComparedMetric) {
  const totalMaps = player?.mapCount ?? 0;
  const reportedMaps = metric === "mapCount" ? totalMaps : player?.reportedMaps[metric] ?? 0;
  const value = player ? metric === "mapCount" ? player.mapCount : player[metric] : null;
  return { value, reportedMaps, totalMaps, complete: value !== null && reportedMaps === totalMaps && totalMaps > 0 };
}

export function formatMetric(player: TotalRow | undefined, metric: ComparedMetric, format: Intl.NumberFormat) {
  const state = metricValue(player, metric);
  return state.value === null ? "—" : `${format.format(state.value)}${state.complete ? "" : "*"}`;
}

export function compareMetricValues(left: TotalRow | undefined, right: TotalRow | undefined, metric: ComparedMetric, lowerIsBetter = false) {
  const leftState = metricValue(left, metric);
  const rightState = metricValue(right, metric);
  const comparable = leftState.complete && rightState.complete && leftState.value !== null && rightState.value !== null;
  const difference = comparable ? (leftState.value! - rightState.value!) * (lowerIsBetter ? -1 : 1) : 0;
  return { left: leftState, right: rightState, comparable, leftWins: difference > 0, rightWins: difference < 0 };
}

export function compareReportedMetricDesc(left: TotalRow, right: TotalRow, metric: StatMetric) {
  const a = metricValue(left, metric);
  const b = metricValue(right, metric);
  if (a.complete !== b.complete) return a.complete ? -1 : 1;
  if (a.value === null || b.value === null) return a.value === b.value ? 0 : a.value === null ? 1 : -1;
  return b.value - a.value;
}
