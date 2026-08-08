export type MatchSortMode = "all" | "completed" | "upcoming" | "pending";
export type EventHistorySort = "placement" | "date";

const textCollator = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base",
});

function timestamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function compareNaturalText(left: string, right: string) {
  return textCollator.compare(left, right);
}

export function compareDateAsc(
  left: { datetime: string; id?: string },
  right: { datetime: string; id?: string },
) {
  const leftTime = timestamp(left.datetime);
  const rightTime = timestamp(right.datetime);
  if (leftTime == null || rightTime == null) {
    if (leftTime == null && rightTime != null) return 1;
    if (leftTime != null && rightTime == null) return -1;
  } else if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return compareNaturalText(left.id ?? "", right.id ?? "");
}

export function compareDateDesc(
  left: { datetime: string; id?: string },
  right: { datetime: string; id?: string },
) {
  const leftTime = timestamp(left.datetime);
  const rightTime = timestamp(right.datetime);
  if (leftTime == null || rightTime == null) {
    if (leftTime == null && rightTime != null) return 1;
    if (leftTime != null && rightTime == null) return -1;
  } else if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }
  return compareNaturalText(left.id ?? "", right.id ?? "");
}

export function compareMatchSchedule<T extends { datetime: string; id?: string }>(
  left: T,
  right: T,
  mode: MatchSortMode,
  isUpcoming: (match: T) => boolean,
) {
  if (mode === "completed") return compareDateDesc(left, right);
  if (mode === "upcoming") return compareDateAsc(left, right);

  const leftUpcoming = isUpcoming(left);
  const rightUpcoming = isUpcoming(right);
  if (leftUpcoming !== rightUpcoming) return leftUpcoming ? -1 : 1;
  return leftUpcoming ? compareDateAsc(left, right) : compareDateDesc(left, right);
}

export function compareCountDesc(
  left: { count: number; label: string },
  right: { count: number; label: string },
) {
  return right.count - left.count || compareNaturalText(left.label, right.label);
}

export function compareUsageDesc<T>(
  left: T,
  right: T,
  usage: (value: T) => number,
  label: (value: T) => string,
) {
  return usage(right) - usage(left) || compareNaturalText(label(left), label(right));
}

export function compareEventHistory(
  left: { name: string; latest: string; placement: { rank: number | null } },
  right: { name: string; latest: string; placement: { rank: number | null } },
  mode: EventHistorySort,
) {
  const byRank = (left.placement.rank ?? Number.POSITIVE_INFINITY)
    - (right.placement.rank ?? Number.POSITIVE_INFINITY);
  const byDate = compareDateDesc(
    { datetime: left.latest },
    { datetime: right.latest },
  );
  return mode === "date"
    ? byDate || byRank || compareNaturalText(left.name, right.name)
    : byRank || byDate || compareNaturalText(left.name, right.name);
}
