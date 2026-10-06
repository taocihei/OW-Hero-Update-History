import { describe, expect, it } from "vitest";
import type { OwtvPlayerMapStat } from "./matchTypes";
import { aggregateStats, compareMetricValues, formatMetric, metricValue } from "./matchStatMath";

const format = new Intl.NumberFormat("en-US");
function stat(overrides: Partial<OwtvPlayerMapStat> = {}): OwtvPlayerMapStat {
  return {
    matchMapId: 1, teamId: 1, playerId: 1, name: "Player", role: "DAMAGE", image: "",
    eliminations: null, assists: null, deaths: null, damage: null, healing: null,
    mitigation: null, fantasy: null, objectiveTime: null, finalBlows: null, ...overrides,
  };
}

describe("missing and partial match statistics", () => {
  it("keeps an entirely missing metric null across multiple maps", () => {
    const [row] = aggregateStats([stat(), stat({ matchMapId: 2 })]);
    expect(row.damage).toBeNull();
    expect(formatMetric(row, "damage", format)).toBe("—");
    expect(metricValue(row, "damage")).toMatchObject({ reportedMaps: 0, totalMaps: 2, complete: false });
  });

  it("retains a real zero and distinguishes it from no reported value", () => {
    const [row] = aggregateStats([stat({ healing: 0 }), stat({ matchMapId: 2, healing: 0 })]);
    expect(formatMetric(row, "healing", format)).toBe("0");
    expect(metricValue(row, "healing").complete).toBe(true);
  });

  it("marks partial totals and never declares a winner against a complete total", () => {
    const [partial] = aggregateStats([stat({ damage: 1000 }), stat({ matchMapId: 2 })]);
    const [complete] = aggregateStats([stat({ playerId: 2, damage: 100 })]);
    expect(formatMetric(partial, "damage", format)).toBe("1,000*");
    expect(metricValue(partial, "damage")).toMatchObject({ reportedMaps: 1, totalMaps: 2, complete: false });
    expect(compareMetricValues(partial, complete, "damage")).toMatchObject({ comparable: false, leftWins: false, rightWins: false });
  });

  it("does not treat missing deaths as zero in the lower-is-better comparison", () => {
    const [missing, actual] = aggregateStats([stat(), stat({ playerId: 2, deaths: 5 })]);
    expect(compareMetricValues(missing, actual, "deaths", true)).toMatchObject({ comparable: false, leftWins: false, rightWins: false });
  });

  it("sums and compares complete numeric values", () => {
    const [first, second] = aggregateStats([stat({ damage: 100, deaths: 2 }), stat({ matchMapId: 2, damage: 150, deaths: 3 }), stat({ playerId: 2, damage: 200, deaths: 6 })]);
    expect(first.damage).toBe(250);
    expect(compareMetricValues(first, second, "damage")).toMatchObject({ comparable: true, leftWins: true, rightWins: false });
    expect(compareMetricValues(first, second, "deaths", true)).toMatchObject({ comparable: true, leftWins: true, rightWins: false });
    expect(formatMetric(first, "mapCount", format)).toBe("2");
  });

  it("does not combine players from different sides or mutate input rows", () => {
    const first = Object.freeze(stat({ damage: 10 }));
    const second = Object.freeze(stat({ teamId: 2, damage: 20 }));
    expect(aggregateStats([first, second])).toHaveLength(2);
    expect(first.damage).toBe(10);
  });
});
