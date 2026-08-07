export type ChangeKind = "buff" | "nerf" | "rework" | "system";
export type ChangeTrack = "core" | "perk" | "stadium" | "experimental" | "arcade";
export type PlatformScope = "all" | "pc" | "console";
export type SourceKind = "official" | "community";
export type ArchiveChannel = "live" | "ptr" | "experimental" | "beta";

export interface BalanceChange {
  id: string;
  date: string;
  patchLabel: string;
  kind: ChangeKind;
  track?: ChangeTrack;
  title: string;
  titleZh?: string;
  titleEn?: string;
  summary: string;
  summaryZh?: string;
  summaryEn?: string;
  details: string[];
  detailsZh?: string[];
  detailsEn?: string[];
  patchLabelZh?: string;
  patchLabelEn?: string;
  sourceUrl: string;
  sourceLabel: string;
  sourceKind: SourceKind;
  archiveChannel?: ArchiveChannel;
  platform?: string;
  platformScope?: PlatformScope;
  isCustom?: boolean;
}

export interface HeroRecord {
  id: string;
  name: string;
  englishName: string;
  role: string;
  archetype: string;
  debutDate: string;
  accent: string;
  quote: string;
  changes: BalanceChange[];
}
