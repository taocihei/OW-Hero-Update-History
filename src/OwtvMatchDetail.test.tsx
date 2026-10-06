import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import OwtvMatchDetail from "./OwtvMatchDetail";
import type { EsportsMatch, OwtvMatchDetailPayload, OwtvPlayerMapStat } from "./matchTypes";

const schedule: EsportsMatch = {
  id: "owtv:1", datetime: "2026-08-01T12:00:00Z", team1: "Team A", team2: "Team B", team1Id: "1", team2Id: "2",
  team1Logo: "", team2Logo: "", score1: 3, score2: 1, event: "OWCS", region: "global", phase: "", stage: "",
  status: "completed", youtube: "", twitch: "",
};

function stat(overrides: Partial<OwtvPlayerMapStat> = {}): OwtvPlayerMapStat {
  return { matchMapId: 10, teamId: 1, playerId: 1, name: "Player A", role: "DAMAGE", image: "", eliminations: null,
    assists: null, deaths: null, damage: null, healing: null, mitigation: null, fantasy: null, objectiveTime: null, finalBlows: null, ...overrides };
}

function render(stats: OwtvPlayerMapStat[]) {
  const detail: OwtvMatchDetailPayload = {
    match: { id: 1, slug: "a-vs-b", startDate: schedule.datetime, complete: true, live: false, tournament: "OWCS", region: "global",
      team1: { id: 1, name: "Team A", logo: "a.png" }, team2: { id: 2, name: "Team B", logo: "b.png" }, score1: 3, score2: 1, sourceUrl: "https://owtv.gg/matches/a-vs-b" },
    maps: [], stats, source: "OWTV",
  };
  return renderToStaticMarkup(<OwtvMatchDetail detail={detail} scheduleMatch={schedule} onClose={() => undefined} />);
}

describe("match detail missing values", () => {
  it("renders unreported stats as dashes and does not award a comparison to zero-filled values", () => {
    const html = render([stat(), stat({ teamId: 2, playerId: 2, name: "Player B", damage: 100, deaths: 2 })]);
    expect(html).toContain('title="未提供">—</span>');
    expect(html).toContain("暂无完整评分");
    expect(html).not.toContain('class="winner"');
  });

  it("displays partial coverage at the value instead of presenting it as a complete total", () => {
    const html = render([stat({ damage: 100 }), stat({ matchMapId: 20 })]);
    expect(html).toContain('title="1/2 张出场地图有此项数据">100*</span>');
    expect(html).toContain("仅含部分出场地图的数据");
  });
});
