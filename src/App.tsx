import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  ArrowUpRight,
  BookOpenCheck,
  ChevronDown,
  Download,
  FlaskConical,
  Menu,
  Search,
  ShieldCheck,
  Sparkles,
  Swords,
  X,
} from "lucide-react";
import { heroes } from "./data";
import type { BalanceChange, ChangeKind, ChangeTrack } from "./types";
import { historyPatchCount, historyRecordCount, loadOfficialHistory, officialPatchCount, syncOfficialHistory } from "./historyApi";
import MatchCenter from "./MatchCenter";
import BalanceOverview from "./BalanceOverview";
import HeroRosterPicker from "./HeroRosterPicker";
import { loadHeroRoster, syncHeroRoster } from "./heroApi";
import type { HeroCatalogItem } from "./heroApi";
import { openExternalUrl } from "./externalLinks";

type UiLanguage = "zh" | "en";

const kindMetaZh: Record<ChangeKind, { label: string; short: string }> = {
  buff: { label: "增强", short: "增" },
  nerf: { label: "削弱", short: "削" },
  rework: { label: "重做", short: "改" },
  system: { label: "系统 / 地形影响", short: "系" },
};

const kindMetaEn: Record<ChangeKind, { label: string; short: string }> = {
  buff: { label: "Buff", short: "+" },
  nerf: { label: "Nerf", short: "−" },
  rework: { label: "Rework", short: "R" },
  system: { label: "System / Map", short: "S" },
};

const trackMetaZh: Record<ChangeTrack, { label: string; short: string; description: string }> = {
  core: { label: "正式核心", short: "正式", description: "正式服基础技能与数值" },
  perk: { label: "威能系统", short: "威能", description: "正式服威能及并入基础技能的改动" },
  stadium: { label: "角斗领域", short: "角斗", description: "角斗领域英雄技能、专属能力与数值调整" },
  experimental: { label: "实验 / 测试", short: "实验", description: "实验卡、Beta 与测试方案" },
  arcade: { label: "限时娱乐", short: "娱乐", description: "四月娱乐等非常规版本" },
};

const trackMetaEn: Record<ChangeTrack, { label: string; short: string; description: string }> = {
  core: { label: "Core", short: "CORE", description: "Live hero abilities and values" },
  perk: { label: "Perks", short: "PERK", description: "Perks and changes merged into base abilities" },
  stadium: { label: "Stadium", short: "STDM", description: "Stadium hero abilities, powers and values" },
  experimental: { label: "Experimental", short: "TEST", description: "Experimental Card, beta and test changes" },
  arcade: { label: "Arcade", short: "FUN", description: "Limited-time and non-standard modes" },
};

function changeTrack(change: BalanceChange): ChangeTrack {
  return change.track ?? "core";
}

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function formatDate(date: string) {
  return dateFormatter.format(new Date(`${date}T00:00:00`));
}

type PatchRegion = "asia" | "china";

const patchRegionMeta = {
  asia: { label: "亚服", detail: "暴雪全球版本 · 繁中官网" },
  china: { label: "国服", detail: "网易暴雪国服 · 简中官网" },
} satisfies Record<PatchRegion, { label: string; detail: string }>;

function regionalSource(change: BalanceChange, region: PatchRegion) {
  const match = change.sourceUrl.match(/\/news\/patch-notes\/(live|experimental|beta|ptr)\/(\d{4})\/(\d{1,2})\//);
  if (!match) return { url: change.sourceUrl, label: change.sourceLabel, badge: "暴雪官方" };
  const [, channel, year, monthValue] = match;
  const month = monthValue.padStart(2, "0");
  const asiaUrl = `https://overwatch.blizzard.com/zh-tw/news/patch-notes/${channel}/${year}/${month}/`;

  if (region === "asia") return { url: asiaUrl, label: "亚服官方补丁", badge: "亚服 · 官方" };
  if (change.date >= "2025-02-01") {
    return {
      url: `https://ow.blizzard.cn/news/patch-notes/${channel}/${year}/${month}/`,
      label: "国服官方补丁",
      badge: "国服 · 官方",
    };
  }
  if (change.date >= "2023-01-24") {
    return { url: asiaUrl, label: "亚服官方补丁（国服停服期）", badge: "停服期 · 亚服官方" };
  }
  return { url: change.sourceUrl, label: "暴雪官方历史补丁", badge: "国服历史期 · 官方" };
}

function App() {
  const [activeKinds, setActiveKinds] = useState<Set<ChangeKind>>(
    new Set(["buff", "nerf", "rework", "system"]),
  );
  const [activeTracks, setActiveTracks] = useState<Set<ChangeTrack>>(
    new Set(["core", "perk", "stadium", "experimental", "arcade"]),
  );
  const [query, setQuery] = useState("");
  const [ascending, setAscending] = useState(true);
  const [historyView, setHistoryView] = useState<"compact" | "tree">("compact");
  const [mobileNav, setMobileNav] = useState(false);
  const [view, setView] = useState<"matches" | "balance">("balance");
  const [patchRegion, setPatchRegion] = useState<PatchRegion>("china");
  const [includeConsole, setIncludeConsole] = useState(false);
  const [roster, setRoster] = useState(loadHeroRoster);
  const [selectedHeroKey, setSelectedHeroKey] = useState("symmetra");
  const [showHeroPicker, setShowHeroPicker] = useState(false);
  const [rosterSyncing, setRosterSyncing] = useState(false);
  const [rosterError, setRosterError] = useState("");
  const [historyState, setHistoryState] = useState(loadOfficialHistory);
  const [historySyncing, setHistorySyncing] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>(() => (localStorage.getItem("balance-atlas:language") === "en" ? "en" : "zh"));

  const kindMeta = uiLanguage === "zh" ? kindMetaZh : kindMetaEn;
  const trackMeta = uiLanguage === "zh" ? trackMetaZh : trackMetaEn;

  const selectedCatalog = roster.items.find((item) => item.key === selectedHeroKey) ?? roster.items[0];
  const archivedHero = heroes.find((item) => item.id === selectedHeroKey);
  const generatedChanges = historyState.heroes[selectedHeroKey] ?? [];
  const generatedHero = selectedCatalog && generatedChanges.length ? {
    id: selectedCatalog.key,
    name: uiLanguage === "zh" ? selectedCatalog.name : selectedCatalog.englishName,
    englishName: selectedCatalog.englishName.toUpperCase(),
    role: ({ tank: "坦克", damage: "输出", support: "支援" } as Record<string, string>)[selectedCatalog.role] ?? selectedCatalog.role,
    archetype: "",
    debutDate: generatedChanges[0].date,
    accent: "#0d9cac",
    quote: "",
    changes: generatedChanges,
  } : undefined;
  const curatedTrackDates = new Set(archivedHero?.changes.map((change) => `${change.date}|${changeTrack(change)}`) ?? []);
  const curatedWithOfficialTestTracks = archivedHero && generatedHero ? {
    ...archivedHero,
    changes: [
      ...archivedHero.changes,
      ...generatedChanges.filter((change) => {
        const track = changeTrack(change);
        const isSupplementalTrack = track === "perk" || track === "stadium" || (change.archiveChannel && change.archiveChannel !== "live");
        return isSupplementalTrack && !curatedTrackDates.has(`${change.date}|${track}`);
      }),
    ],
  } : archivedHero;
  const hero = (uiLanguage === "en" ? generatedHero ?? curatedWithOfficialTestTracks : curatedWithOfficialTestTracks ?? generatedHero) ?? {
    id: selectedCatalog?.key ?? selectedHeroKey,
    name: selectedCatalog?.name ?? selectedHeroKey,
    englishName: (selectedCatalog?.englishName ?? selectedHeroKey).toUpperCase(),
    role: selectedCatalog?.role ?? "damage",
    archetype: "官方阵容 / 档案待同步",
    debutDate: new Date().toISOString().slice(0, 10),
    accent: "#0d9cac",
    quote: "英雄名单已经同步，完整平衡记录将在后续数据更新中补齐。",
    changes: [],
  };
  const hasArchive = hero.changes.length > 0;
  const isCuratedArchive = Boolean(archivedHero);
  const selectedPortrait = selectedCatalog?.portrait;

  async function refreshRoster() {
    setRosterSyncing(true);
    setRosterError("");
    try {
      setRoster(await syncHeroRoster());
    } catch (error) {
      setRosterError(error instanceof Error ? error.message : String(error));
    } finally {
      setRosterSyncing(false);
    }
  }

  async function refreshHistory() {
    setHistorySyncing(true);
    setHistoryError("");
    try {
      setHistoryState(await syncOfficialHistory(loadOfficialHistory()));
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : String(error));
    } finally {
      setHistorySyncing(false);
    }
  }

  async function refreshAllData() {
    await Promise.all([refreshRoster(), refreshHistory()]);
  }

  useEffect(() => {
    void refreshAllData();
    const timer = window.setInterval(() => void refreshAllData(), 6 * 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  const allChanges = useMemo(() => hero.changes.map((change) => uiLanguage === "en" ? {
    ...change,
    patchLabel: change.patchLabelEn ?? change.patchLabel,
    title: change.titleEn ?? change.title,
    summary: change.summaryEn ?? change.summary,
    details: change.detailsEn ?? change.details,
  } : {
    ...change,
    patchLabel: change.patchLabelZh ?? change.patchLabel,
    title: change.titleZh ?? change.title,
    summary: change.summaryZh ?? change.summary,
    details: change.detailsZh ?? change.details,
  }), [hero.changes, uiLanguage]);
  const platformChanges = useMemo(
    () => allChanges.filter((change) => includeConsole || change.platformScope !== "console"),
    [allChanges, includeConsole],
  );
  const coreChanges = useMemo(
    () => platformChanges.filter((change) => changeTrack(change) === "core"),
    [platformChanges],
  );
  const perkChanges = useMemo(
    () => platformChanges
      .filter((change) => changeTrack(change) === "perk")
      .sort((a, b) => b.date.localeCompare(a.date)),
    [platformChanges],
  );
  const stadiumChanges = useMemo(
    () => platformChanges
      .filter((change) => changeTrack(change) === "stadium")
      .sort((a, b) => b.date.localeCompare(a.date)),
    [platformChanges],
  );

  const stats = useMemo(() => {
    const count = (kind: ChangeKind) => coreChanges.filter((change) => change.kind === kind).length;
    const trackCount = (track: ChangeTrack) => platformChanges.filter((change) => changeTrack(change) === track).length;
    return {
      total: platformChanges.length,
      buff: count("buff"),
      nerf: count("nerf"),
      official: platformChanges.filter((change) => change.sourceKind === "official").length,
      patches: new Set(coreChanges.map((change) => change.date)).size,
      years: new Date().getFullYear() - Number(hero.debutDate.slice(0, 4)),
      tracks: {
        core: trackCount("core"),
        perk: trackCount("perk"),
        stadium: trackCount("stadium"),
        experimental: trackCount("experimental"),
        arcade: trackCount("arcade"),
      },
    };
  }, [coreChanges, hero.debutDate, platformChanges]);

  const visibleChanges = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return platformChanges
      .filter((change) => activeKinds.has(change.kind))
      .filter((change) => activeTracks.has(changeTrack(change)))
      .filter((change) => {
        if (!normalized) return true;
        return [change.title, change.summary, change.patchLabel, trackMeta[changeTrack(change)].label, ...change.details]
          .join(" ")
          .toLowerCase()
          .includes(normalized);
      })
      .sort((a, b) => ascending ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date));
  }, [activeKinds, activeTracks, ascending, platformChanges, query]);

  function toggleKind(kind: ChangeKind) {
    setActiveKinds((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  function exportData() {
    const payload = JSON.stringify({
      schemaVersion: "1.0",
      format: "OW Hero Update History JSON",
      exportedAt: new Date().toISOString(),
      patchRegion,
      platformMode: includeConsole ? "pc-and-console" : "pc-only",
      hero: {
        id: hero.id,
        name: hero.name,
        englishName: hero.englishName,
        role: hero.role,
        debutDate: hero.debutDate,
      },
      records: platformChanges,
    }, null, 2);
    const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ow-hero-update-history-${hero.id}-${includeConsole ? "all-platforms" : "pc"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function selectHero(item: HeroCatalogItem) {
    setSelectedHeroKey(item.key);
    setQuery("");
    setActiveKinds(new Set(["buff", "nerf", "rework", "system"]));
    setActiveTracks(new Set(["core", "perk", "stadium", "experimental", "arcade"]));
    setShowHeroPicker(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleTrack(track: ChangeTrack) {
    setActiveTracks((current) => {
      const next = new Set(current);
      if (next.has(track)) next.delete(track);
      else next.add(track);
      return next;
    });
  }

  function focusTrack(track: ChangeTrack) {
    setActiveTracks((current) => current.size === 1 && current.has(track)
      ? new Set(["core", "perk", "stadium", "experimental", "arcade"])
      : new Set([track]));
    setQuery("");
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="返回顶部">
          <span className="brand-mark"><FlaskConical size={21} /></span>
          <span><b>OW 英雄</b><em>更新历史</em></span>
        </a>

        <nav className={mobileNav ? "nav open" : "nav"} aria-label="主导航">
          <button className={`view-tab ${view === "matches" ? "active" : ""}`} onClick={() => { setView("matches"); setMobileNav(false); window.scrollTo({ top: 0 }); }}>
            <Swords size={15} />职业比赛
          </button>
          <button className={`view-tab ${view === "balance" ? "active" : ""}`} onClick={() => { setView("balance"); setMobileNav(false); window.scrollTo({ top: 0 }); }}>
            <BookOpenCheck size={15} />英雄更新
          </button>
        </nav>

        <div className="top-actions">
          <button className="language-toggle" onClick={() => setUiLanguage((language) => {
            const next = language === "zh" ? "en" : "zh";
            localStorage.setItem("balance-atlas:language", next);
            return next;
          })} aria-label="切换中英文">{uiLanguage === "zh" ? "中文" : "EN"}</button>
          <span className="live-pill" title={historyError || rosterError}><i /> {view === "matches"
            ? "OWCS 官方赛程"
            : historySyncing
              ? (uiLanguage === "zh" ? "正在采集官网更新" : "Syncing official patches")
              : rosterSyncing
                ? (uiLanguage === "zh" ? "正在同步英雄名单" : "Syncing hero roster")
                : uiLanguage === "zh"
                  ? `${officialPatchCount(historyState)} 个官网版本 · ${historyPatchCount(historyState)} 个含英雄调整 · ${historyRecordCount(historyState)} 条记录`
                  : `${officialPatchCount(historyState)} official patches · ${historyPatchCount(historyState)} with hero changes · ${historyRecordCount(historyState)} records`}</span>
          <button className="icon-button menu-button" onClick={() => setMobileNav((value) => !value)} aria-label={"\u6253\u5f00\u83dc\u5355"}>
            <Menu size={20} />
          </button>
        </div>
      </header>

      {view === "matches" ? (
        <MatchCenter locale={uiLanguage} onOpenBalance={() => { setView("balance"); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
      ) : (
      <main id="top">
        <section className="hero-control-strip" aria-label="英雄与服务器版本选择">
          <button className="hero-switch-trigger" onClick={() => setShowHeroPicker(true)} aria-label={`切换英雄，当前为${hero.name}`}>
            {selectedPortrait && <img src={selectedPortrait} alt="" />}
            <span><small>当前查看英雄</small><strong>{hero.name}</strong><em>{hero.englishName}</em></span>
            <b>切换英雄</b><ChevronDown size={19} />
          </button>
          <div className="region-audit"><ShieldCheck size={18} /><span><strong>当前收录记录数值一致</strong><small>已核对国服与亚服官方补丁；活动、奖励及运营说明可能不同</small></span></div>
          <div className="patch-region-selector" aria-label="选择补丁服务器">
            <span>补丁来源</span>
            {(Object.keys(patchRegionMeta) as PatchRegion[]).map((region) => (
              <button key={region} className={patchRegion === region ? "active" : ""} onClick={() => setPatchRegion(region)}>
                <strong>{patchRegionMeta[region].label}</strong><small>{patchRegionMeta[region].detail}</small>
              </button>
            ))}
          </div>
        </section>
        <section className="hero-intro" aria-labelledby="hero-title">
          <div className="hero-index" aria-hidden="true">{String(Math.max(1, roster.items.findIndex((item) => item.key === hero.id) + 1)).padStart(2, "0")}</div>
          {selectedPortrait && <img className="selected-hero-portrait" src={selectedPortrait} alt="" />}
          <div className="intro-copy">
            <p className="eyebrow">HERO UPDATE HISTORY</p>
            <div className="hero-name-line">
              <div>
                <h1 id="hero-title">{hero.name}</h1>
                <p className="english-name">{hero.englishName}</p>
              </div>
            </div>
            {hero.quote && <p className="hero-thesis">{hero.quote}</p>}
            {hasArchive && <div className="life-range">
              <div className="range-point start"><span>{isCuratedArchive ? "登场" : "首条记录"}</span><strong>{formatDate(hero.debutDate)}</strong></div>
              <div className="range-track"><i /><i /><i /><i /><i /><i /><i /><i /><i /><b /></div>
              <div className="range-point end"><span>当前</span><strong>持续维护</strong></div>
            </div>}
          </div>

          {hasArchive && <aside className="hero-summary" aria-label="档案概况">
            <div className="summary-seal"><ShieldCheck size={19} /><span>{stats.official} 条官方来源 · {includeConsole ? "PC + 主机" : "仅 PC"}</span></div>
            <dl>
              <div title="正式服中出现该英雄调整的补丁日期数"><dt>正式服出现</dt><dd>{String(stats.patches).padStart(2, "0")}</dd></div>
              <div><dt>增强</dt><dd className="buff-text">+{stats.buff}</dd></div>
              <div><dt>削弱</dt><dd className="nerf-text">−{stats.nerf}</dd></div>
              <div><dt>记录总数</dt><dd>{stats.total}</dd></div>
            </dl>
            <p><BookOpenCheck size={16} />每条记录均附暴雪官方网站链接</p>
          </aside>}
        </section>

        {hasArchive ? <>
        <section className="track-summary" aria-label="版本分类总览">
          {(Object.keys(trackMeta) as ChangeTrack[]).map((track) => (
            <button key={track} className={`track-summary-card ${track} ${activeTracks.size === 1 && activeTracks.has(track) ? "isolated" : activeTracks.has(track) ? "active" : ""}`} onClick={() => focusTrack(track)} title={trackMeta[track].description}>
              <span>{trackMeta[track].short}</span>
              <strong>{trackMeta[track].label}</strong>
              <b>{stats.tracks[track]}</b>
              <small>{trackMeta[track].description}</small>
            </button>
          ))}
        </section>

        {perkChanges.length > 0 && <section className="perk-spotlight" aria-labelledby="perk-history-title">
          <header className="perk-spotlight-head">
            <div>
              <p className="eyebrow">PERK UPDATE HISTORY</p>
              <h2 id="perk-history-title">{uiLanguage === "zh" ? "威能调整" : "Perk Updates"}</h2>
              <p>{uiLanguage === "zh" ? `共 ${perkChanges.length} 条，显示最新 ${Math.min(3, perkChanges.length)} 条；完整记录可进入威能时间轴。` : `${perkChanges.length} records; showing the latest ${Math.min(3, perkChanges.length)}. Open the timeline for the complete history.`}</p>
            </div>
            <button className="perk-focus-button" onClick={() => {
              focusTrack("perk");
              setHistoryView("tree");
              window.setTimeout(() => document.getElementById("timeline")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
            }}>{activeTracks.size === 1 && activeTracks.has("perk")
              ? (uiLanguage === "zh" ? "恢复全部版本" : "Show all tracks")
              : (uiLanguage === "zh" ? "只看威能时间轴" : "Perk timeline only")}</button>
          </header>
          <div className="perk-record-grid">
            {perkChanges.slice(0, 3).map((change) => {
              const source = regionalSource(change, patchRegion);
              return <article
                className={`perk-record ${change.kind}`}
                key={`perk-${change.id}`}
                role="link"
                tabIndex={0}
                aria-label={`${change.title} · ${source.label}`}
                title={uiLanguage === "zh" ? "点击打开官方补丁" : "Open official patch notes"}
                onClick={(event) => {
                  if ((event.target as Element).closest("a, button")) return;
                  void openExternalUrl(source.url);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  void openExternalUrl(source.url);
                }}
              >
                <div className="perk-record-topline">
                  <time>{formatDate(change.date)}</time>
                  <span className={`kind-label ${change.kind}`}>{kindMeta[change.kind].label}</span>
                  <span className="patch-label">{change.patchLabel}</span>
                </div>
                <h3>{change.title}</h3>
                <p>{change.summary}</p>
                <ul>{change.details.slice(0, 4).map((detail) => <li key={detail}>{detail}</li>)}</ul>
                <a href={source.url} target="_blank" rel="noreferrer"><ShieldCheck size={15} />{source.label}<ArrowUpRight size={15} /></a>
              </article>;
            })}
          </div>
        </section>}

        {stadiumChanges.length > 0 && <section className="stadium-spotlight" aria-labelledby="stadium-history-title">
          <header className="stadium-spotlight-head">
            <div>
              <p className="eyebrow">STADIUM UPDATE HISTORY</p>
              <h2 id="stadium-history-title">{uiLanguage === "zh" ? "角斗领域调整" : "Stadium Updates"}</h2>
              <p>{uiLanguage === "zh" ? `已收录 ${stadiumChanges.length} 条英雄专属调整，与正式核心和威能系统分别统计。` : `${stadiumChanges.length} hero-specific records, counted separately from Core and Perks.`}</p>
            </div>
            <button className="stadium-focus-button" onClick={() => {
              focusTrack("stadium");
              setHistoryView("tree");
              window.setTimeout(() => document.getElementById("timeline")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
            }}>{activeTracks.size === 1 && activeTracks.has("stadium")
              ? (uiLanguage === "zh" ? "恢复全部版本" : "Show all tracks")
              : (uiLanguage === "zh" ? "查看全部角斗领域记录" : "Open full Stadium history")}</button>
          </header>
          <div className="stadium-record-grid">
            {stadiumChanges.slice(0, 4).map((change) => {
              const source = regionalSource(change, patchRegion);
              return <article className={`stadium-record ${change.kind}`} key={`stadium-${change.id}`}>
                <div><time>{formatDate(change.date)}</time><span className={`kind-label ${change.kind}`}>{kindMeta[change.kind].label}</span></div>
                <h3>{change.title}</h3>
                <p>{change.summary}</p>
                <ul>{change.details.slice(0, 3).map((detail) => <li key={detail}>{detail}</li>)}</ul>
                <a href={source.url} target="_blank" rel="noreferrer">{source.label}<ArrowUpRight size={14} /></a>
              </article>;
            })}
          </div>
        </section>}

        <section className="control-deck" id="timeline" aria-label="时间轴控制">
          <div className="search-box">
            <Search size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索技能、数值或版本…" aria-label="搜索平衡记录" />
            {query && <button onClick={() => setQuery("")} aria-label="清除搜索"><X size={15} /></button>}
          </div>
          <div className="filter-group" aria-label="按类型筛选">
            {(Object.keys(kindMeta) as ChangeKind[]).map((kind) => (
              <button key={kind} className={`filter-chip ${kind} ${activeKinds.has(kind) ? "active" : ""}`} onClick={() => toggleKind(kind)}>
                <i />{kindMeta[kind].label}
              </button>
            ))}
          </div>
          <div className="control-tail">
            <div className="history-view-selector" aria-label="选择历史显示方式">
              <button className={historyView === "compact" ? "active" : ""} onClick={() => setHistoryView("compact")}>短全图</button>
              <button className={historyView === "tree" ? "active" : ""} onClick={() => setHistoryView("tree")}>长树图</button>
            </div>
            <div className="platform-selector" aria-label="选择统计平台">
              <span>平台</span>
              <button className={!includeConsole ? "active" : ""} onClick={() => setIncludeConsole(false)}>仅 PC</button>
              <button className={includeConsole ? "active" : ""} onClick={() => setIncludeConsole(true)}>PC + 主机</button>
            </div>
            {historyView === "tree" && <button className="sort-button" onClick={() => setAscending((value) => !value)}>
              {ascending ? <ArrowDownAZ size={17} /> : <ArrowUpAZ size={17} />}
              {ascending ? "从登场开始" : "从最新开始"}
            </button>}
            <button className="export-json-button" onClick={exportData} title="导出当前平台范围的完整英雄记录，格式为 JSON">
              <Download size={16} />导出 JSON
            </button>
          </div>
          <div className="track-filter-group" aria-label="按版本轨道筛选">
            <span>版本轨道</span>
            {(Object.keys(trackMeta) as ChangeTrack[]).map((track) => (
              <button key={track} className={`track-filter ${track} ${activeTracks.has(track) ? "active" : ""}`} onClick={() => toggleTrack(track)} title={trackMeta[track].description}>
                <i />{trackMeta[track].label}<b>{stats.tracks[track]}</b>
              </button>
            ))}
          </div>
        </section>

        {historyView === "compact" ? <BalanceOverview changes={visibleChanges} debutDate={hero.debutDate} locale={uiLanguage} /> : <section className="timeline-section" aria-label="英雄平衡时间轴">
          <div className="axis-labels" aria-hidden="true">
            <span><Swords size={14} />削弱侧</span>
            <b>时间 / PATCH</b>
            <span>增强侧<Sparkles size={14} /></span>
          </div>

          <div className="timeline">
            <div className="timeline-origin">
              <span className="origin-dot" />
              <div><small>{isCuratedArchive ? "ORIGIN" : "FIRST RECORD"}</small><strong>{formatDate(hero.debutDate)}</strong><p>{isCuratedArchive ? `${hero.name}随《守望先锋》正式登场` : "首条已收录的暴雪官方平衡记录"}</p></div>
            </div>

            {visibleChanges.map((change, index) => {
              const source = regionalSource(change, patchRegion);
              return (
              <article id={`change-${change.id}`} className={`change-row ${change.kind}`} key={change.id} style={{ "--order": index } as React.CSSProperties}>
                <div className="change-date">
                  <strong>{change.date.slice(0, 4)}</strong>
                  <span>{change.date.slice(5).replace("-", ".")}</span>
                </div>
                <span className="change-node" aria-label={kindMeta[change.kind].label}>{kindMeta[change.kind].short}</span>
                <div className="change-card">
                  <div className="card-topline">
                    <span className={`kind-label ${change.kind}`}>{kindMeta[change.kind].label}</span>
                    <span className={`track-label ${changeTrack(change)}`}>{trackMeta[changeTrack(change)].label}</span>
                    <span className="patch-label">{change.patchLabel}</span>
                    {change.platform && <span className="platform-label">{change.platform}</span>}
                  </div>
                  <h2>{change.title}</h2>
                  <p>{change.summary}</p>
                  <ul>
                    {change.details.map((detail) => <li key={detail}>{detail}</li>)}
                  </ul>
                  <div className="card-footer">
                    <span className="source-badge official">
                      <ShieldCheck size={14} />{source.badge}
                    </span>
                    <a href={source.url} target="_blank" rel="noreferrer">
                      {source.label}<ArrowUpRight size={15} />
                    </a>
                  </div>
                </div>
              </article>
              );
            })}

            {visibleChanges.length === 0 && (
              <div className="empty-state">
                <Search size={28} />
                <h2>没有匹配的记录</h2>
                <p>调整关键词或重新启用一种改动类型。</p>
                <button className="button ghost" onClick={() => { setQuery(""); setActiveKinds(new Set(["buff", "nerf", "rework", "system"])); setActiveTracks(new Set(["core", "perk", "stadium", "experimental", "arcade"])); }}>清除筛选</button>
              </div>
            )}

            <div className="timeline-now">
              <span className="now-pulse" />
              <div><small>NOW</small><strong>档案仍在生长</strong><p>下一次改动会继续出现在这里。</p></div>
            </div>
          </div>
        </section>}
        </> : <section className="hero-no-records" aria-label="暂无更新记录">
          <strong>暂无更新记录</strong>
          <button className="button ghost" onClick={() => setShowHeroPicker(true)}>切换英雄</button>
        </section>}

      </main>
      )}

      {showHeroPicker && <HeroRosterPicker roster={roster} selectedKey={selectedHeroKey} syncing={rosterSyncing || historySyncing} syncError={rosterError || historyError} onSelect={selectHero} onSync={() => void refreshAllData()} onClose={() => setShowHeroPicker(false)} />}
    </div>
  );
}

export default App;
