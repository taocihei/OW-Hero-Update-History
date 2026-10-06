import { describe, expect, it } from "vitest";
import { mergeMatchRecords } from "./matchMerge";
import type { EsportsMatch } from "./matchTypes";

function match(overrides: Partial<EsportsMatch> = {}): EsportsMatch {
  return {
    id: "schedule:one", datetime: "2026-03-01T01:30:00.000Z", region: "na", event: "North America Stage 1 - OWCS 2026",
    team1: "Amplify", team2: "Iliad Artemis", team1Id: "A", team2Id: "I", team1Logo: "", team2Logo: "",
    score1: 3, score2: 0, status: "completed", phase: "Regular Season", stage: "Stage 1", youtube: "", twitch: "",
    ...overrides,
  };
}

describe("match identity and source merging", () => {
  it("keeps simultaneous matches and their own OWTV detail identities", () => {
    const first = match({ id: "owtv:968", owtvMatchId: 968, owtv: "https://owtv.gg/matches/amp-vs-ia" });
    const second = match({ id: "owtv:967", owtvMatchId: 967, owtv: "https://owtv.gg/matches/gd-vs-consta", team1: "Gorillas Disciples", team2: "Team_consta_ow", score1: 0, score2: 3 });
    expect(mergeMatchRecords([first, second])).toEqual([first, second]);
  });

  it("never merges distinct OWTV IDs even if teams, time and tournament coincide", () => {
    const first = match({ id: "owtv:101", owtvMatchId: 101 });
    const second = match({ id: "owtv:102", owtvMatchId: 102 });
    expect(mergeMatchRecords([first, second])).toHaveLength(2);
  });

  it("does not collapse a same-day rematch, another tournament or unknown teams", () => {
    const first = match();
    expect(mergeMatchRecords([first, match({ id: "later", datetime: "2026-03-01T04:00:00Z" })])).toHaveLength(2);
    expect(mergeMatchRecords([first, match({ id: "other-event", event: "FACEIT Season 9" })])).toHaveLength(2);
    expect(mergeMatchRecords([match({ team1: "TBD" }), match({ id: "unknown", team1: "TBD" })])).toHaveLength(2);
  });

  it("merges the same OWTV URL independent of tracking parameters", () => {
    const a = match({ owtv: "https://owtv.gg/matches/amp-vs-ia?ref=schedule" });
    const b = match({ id: "owtv:968", owtvMatchId: 968, owtv: "https://owtv.gg/matches/amp-vs-ia/", score1: 2, score2: 3 });
    expect(mergeMatchRecords([a, b])).toMatchObject([{ id: "owtv:968", owtvMatchId: 968, score1: 2, score2: 3 }]);
  });

  it("keeps reversed OWTV participants with their own scores and aligns fallback logos", () => {
    const official = match({ team1Logo: "amplify.png", team2Logo: "iliad.png", bilibili: "https://bilibili.com/video/sample" });
    const owtv = match({ id: "owtv:968", owtvMatchId: 968, owtv: "https://owtv.gg/matches/ia-vs-amp", team1: "Iliad Artemis", team2: "Amplify", team1Id: "I", team2Id: "A", score1: 0, score2: 3 });
    for (const records of [[official, owtv], [owtv, official]]) {
      expect(mergeMatchRecords(records)).toMatchObject([{ id: "owtv:968", team1: "Iliad Artemis", team2: "Amplify", score1: 0, score2: 3, team1Logo: "iliad.png", team2Logo: "amplify.png", bilibili: official.bilibili }]);
    }
  });

  it("aligns score pairs if an OWTV record has no score, without mixing partial scores", () => {
    const old = match({ id: "owtv:968", owtvMatchId: 968 });
    const reversed = match({ id: "owtv:968", owtvMatchId: 968, team1: "Iliad Artemis", team2: "Amplify", score1: null, score2: null });
    expect(mergeMatchRecords([old, reversed])[0]).toMatchObject({ score1: 0, score2: 3 });
    expect(mergeMatchRecords([old, { ...reversed, score1: 1 }])[0]).toMatchObject({ score1: 1, score2: null });
  });

  it("preserves historic records whichever the local index or refreshed schedule arrives first", () => {
    const old = match({ id: "owtv:1", owtvMatchId: 1, datetime: "2025-08-01T01:30:00Z" });
    const recent = match({ id: "owtv:968", owtvMatchId: 968 });
    const fresh = match({ id: "future", datetime: "2026-10-07T00:00:00Z", score1: null, score2: null, status: "upcoming" });
    const localFirst = mergeMatchRecords([...mergeMatchRecords([recent, old]), recent, fresh]);
    const networkFirst = mergeMatchRecords([...mergeMatchRecords([recent, fresh]), old]);
    expect(localFirst.map((item) => item.id).sort()).toEqual([old.id, recent.id, fresh.id].sort());
    expect(networkFirst.map((item) => item.id).sort()).toEqual(localFirst.map((item) => item.id).sort());
  });

  it("does not overwrite database results with the older packaged supplement during refresh", () => {
    const database = match({ id: "owtv:968", owtvMatchId: 968, score1: 3, score2: 1, owtv: "https://owtv.gg/matches/amp-vs-ia" });
    const packaged = match({ id: "owtv:amp-vs-ia", owtvMatchId: 968, score1: 0, score2: 0, status: "upcoming", owtv: database.owtv, bilibili: "https://bilibili.com/video/sample" });
    expect(mergeMatchRecords([database, packaged])[0]).toMatchObject({ id: "owtv:968", score1: 3, score2: 1, status: "completed", bilibili: packaged.bilibili });
  });

  it("does not mutate source records", () => {
    const a = Object.freeze(match({ owtvMatchId: 1, sources: ["OWTV"] }));
    const b = Object.freeze(match({ owtvMatchId: 1, score1: 2 }));
    expect(mergeMatchRecords([a, b])[0].score1).toBe(2);
    expect(a.score1).toBe(3);
  });
});
