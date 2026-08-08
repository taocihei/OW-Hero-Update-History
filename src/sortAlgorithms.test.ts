import { describe, expect, it } from "vitest";
import {
  compareCountDesc,
  compareDateAsc,
  compareDateDesc,
  compareEventHistory,
  compareMatchSchedule,
  compareUsageDesc,
} from "./sortAlgorithms";

describe("date sorting", () => {
  const rows = [
    { id: "offset", datetime: "2026-08-08T01:00:00+09:00" },
    { id: "utc", datetime: "2026-08-07T17:30:00Z" },
    { id: "invalid", datetime: "unknown" },
  ];

  it("compares actual timestamps instead of ISO text", () => {
    expect([...rows].sort(compareDateAsc).map((row) => row.id)).toEqual(["offset", "utc", "invalid"]);
    expect([...rows].sort(compareDateDesc).map((row) => row.id)).toEqual(["utc", "offset", "invalid"]);
  });
});

describe("match center sorting", () => {
  const rows = [
    { id: "past-old", datetime: "2026-01-01T00:00:00Z", upcoming: false },
    { id: "future-late", datetime: "2027-02-01T00:00:00Z", upcoming: true },
    { id: "past-new", datetime: "2026-07-01T00:00:00Z", upcoming: false },
    { id: "future-near", datetime: "2027-01-01T00:00:00Z", upcoming: true },
  ];
  const upcoming = (row: (typeof rows)[number]) => row.upcoming;

  it("puts upcoming first and orders each bucket in the useful direction", () => {
    expect([...rows].sort((a, b) => compareMatchSchedule(a, b, "all", upcoming)).map((row) => row.id))
      .toEqual(["future-near", "future-late", "past-new", "past-old"]);
  });

  it("orders completed newest-first and upcoming nearest-first", () => {
    expect([...rows].sort((a, b) => compareMatchSchedule(a, b, "completed", upcoming)).map((row) => row.id))
      .toEqual(["future-late", "future-near", "past-new", "past-old"]);
    expect([...rows].sort((a, b) => compareMatchSchedule(a, b, "upcoming", upcoming)).map((row) => row.id))
      .toEqual(["past-old", "past-new", "future-near", "future-late"]);
  });
});

describe("ranking and usage sorting", () => {
  const events = [
    { name: "Unranked", latest: "2026-08-01T00:00:00Z", placement: { rank: null } },
    { name: "Runner-up old", latest: "2025-02-01T00:00:00Z", placement: { rank: 2 } },
    { name: "Champion", latest: "2024-01-01T00:00:00Z", placement: { rank: 1 } },
    { name: "Runner-up new", latest: "2026-02-01T00:00:00Z", placement: { rank: 2 } },
  ];

  it("sorts event history by placement with date as a deterministic tie-breaker", () => {
    expect([...events].sort((a, b) => compareEventHistory(a, b, "placement")).map((row) => row.name))
      .toEqual(["Champion", "Runner-up new", "Runner-up old", "Unranked"]);
  });

  it("sorts event history by date and keeps unranked events in chronological position", () => {
    expect([...events].sort((a, b) => compareEventHistory(a, b, "date")).map((row) => row.name))
      .toEqual(["Unranked", "Runner-up new", "Runner-up old", "Champion"]);
  });

  it("uses placement and then name when two events have the same date", () => {
    const tied = [
      { name: "Beta", latest: "2026-08-01T00:00:00Z", placement: { rank: 2 } },
      { name: "Alpha", latest: "2026-08-01T00:00:00Z", placement: { rank: 1 } },
      { name: "Alpha 2", latest: "2026-08-01T00:00:00Z", placement: { rank: 2 } },
    ];
    expect(tied.sort((a, b) => compareEventHistory(a, b, "date")).map((row) => row.name))
      .toEqual(["Alpha", "Alpha 2", "Beta"]);
  });

  it("breaks equal-count ties naturally instead of depending on source order", () => {
    const usage = [
      { name: "Team 10", total: 5 },
      { name: "Team 2", total: 5 },
      { name: "Team 1", total: 8 },
    ];
    expect(usage.sort((a, b) => compareUsageDesc(a, b, (row) => row.total, (row) => row.name)).map((row) => row.name))
      .toEqual(["Team 1", "Team 2", "Team 10"]);

    const counts = [
      { label: "赛事 10", count: 2 },
      { label: "赛事 2", count: 2 },
    ];
    expect(counts.sort(compareCountDesc).map((row) => row.label)).toEqual(["赛事 2", "赛事 10"]);
  });
});
