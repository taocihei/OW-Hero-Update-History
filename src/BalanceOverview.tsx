import { useMemo, useState } from "react";
import { ArrowUpRight, BarChart3, CalendarRange, Minus, Plus, RotateCcw, ShieldMinus, Sparkles } from "lucide-react";
import type { BalanceChange, ChangeKind } from "./types";

interface BalanceOverviewProps {
  changes: BalanceChange[];
  debutDate?: string;
  locale?: "zh" | "en";
}

const labelsZh: Record<ChangeKind, string> = { buff: "增强", nerf: "削弱", rework: "重做", system: "系统 / 地形" };
const labelsEn: Record<ChangeKind, string> = { buff: "Buff", nerf: "Nerf", rework: "Rework", system: "System / Map" };

export default function BalanceOverview({ changes, debutDate, locale = "zh" }: BalanceOverviewProps) {
  const labels = locale === "zh" ? labelsZh : labelsEn;
  const [zoom, setZoom] = useState(1);
  const [selectedId, setSelectedId] = useState("");
  const sorted = useMemo(() => [...changes].sort((a, b) => a.date.localeCompare(b.date)), [changes]);
  const selected = sorted.find((change) => change.id === selectedId) ?? sorted.at(-1) ?? null;
  const patchCount = new Set(sorted.map((change) => `${change.archiveChannel ?? change.track ?? "live"}:${change.date}`)).size;
  const nerfCount = sorted.filter((change) => change.kind === "nerf").length;
  const buffCount = sorted.filter((change) => change.kind === "buff").length;
  const reworkCount = sorted.filter((change) => change.kind === "rework").length;
  const systemCount = sorted.filter((change) => change.kind === "system").length;
  const totalCount = buffCount + nerfCount + reworkCount + systemCount;
  const start = new Date(`${debutDate || sorted[0]?.date || new Date().toISOString().slice(0, 10)}T00:00:00`).getTime();
  const end = Math.max(Date.now(), new Date(`${sorted.at(-1)?.date || debutDate || new Date().toISOString().slice(0, 10)}T00:00:00`).getTime());
  const span = Math.max(1, end - start);
  const startYear = new Date(start).getFullYear();
  const endYear = new Date(end).getFullYear();
  const yearLabels = Array.from({ length: Math.max(1, endYear - startYear + 1) }, (_, index) => startYear + index)
    .filter((_, index, values) => index === 0 || index === values.length - 1 || index % 2 === 0);

  function changeZoom(next: number) {
    setZoom(Math.max(1, Math.min(3, Number(next.toFixed(1)))));
  }

  return (
    <section className="overview-section compact-history" aria-label={locale === "zh" ? "更新历史短全图" : "Compact update history map"}>
      <div className="overview-heading compact-heading">
        <div><p className="eyebrow">COMPLETE HISTORY MAP</p><h2>{locale === "zh" ? "更新历史短全图" : "Compact Update History"}</h2></div>
        <div className="overview-actions">
          <div className="overview-fact"><ShieldMinus size={21} /><span>{locale === "zh" ? <>在 <b>{patchCount}</b> 个出现该英雄调整的版本中</> : <><b>{patchCount}</b> patches containing this hero</>}</span><strong>{locale === "zh" ? `削弱 ${nerfCount} 次` : `${nerfCount} nerfs`}</strong></div>
          <div className="zoom-controls" aria-label={locale === "zh" ? "缩放短全图" : "Zoom history map"}>
            <button onClick={() => changeZoom(zoom - .25)} disabled={zoom <= 1} aria-label={locale === "zh" ? "缩小全图" : "Zoom out map"}><Minus size={17} /></button>
            <b>{Math.round(zoom * 100)}%</b>
            <button onClick={() => changeZoom(zoom + .25)} disabled={zoom >= 3} aria-label={locale === "zh" ? "放大全图" : "Zoom in map"}><Plus size={17} /></button>
            <button onClick={() => changeZoom(1)} disabled={zoom === 1} aria-label={locale === "zh" ? "复位全图" : "Reset map zoom"}><RotateCcw size={16} /></button>
          </div>
        </div>
      </div>
      <div className="overview-metrics" aria-label={`改动总数 ${totalCount}，由增强 ${buffCount}、削弱 ${nerfCount}、重做 ${reworkCount}、系统和地形影响 ${systemCount} 相加得出`}>
        <div title={locale === "zh" ? "按补丁日期去重；同一天有多条调整时只计算为一个版本" : "Unique patch dates; multiple changes on one date count as one patch"}><CalendarRange size={17} /><span>{locale === "zh" ? "出现版本" : "Patch appearances"}<strong>{patchCount}</strong></span></div>
        <div className="metric-nerf"><ShieldMinus size={17} /><span>{locale === "zh" ? "削弱记录" : "Nerfs"}<strong>{nerfCount}</strong></span></div>
        <div className="metric-buff"><Sparkles size={17} /><span>{locale === "zh" ? "增强记录" : "Buffs"}<strong>{buffCount}</strong></span></div>
        <div className="metric-rework"><BarChart3 size={17} /><span>{locale === "zh" ? "重做记录" : "Reworks"}<strong>{reworkCount}</strong></span></div>
        <div className="metric-system"><BarChart3 size={17} /><span>{locale === "zh" ? "系统 / 地形" : "System / Map"}<strong>{systemCount}</strong></span></div>
        <div className="metric-total"><BarChart3 size={17} /><span>{locale === "zh" ? "改动总数" : "Total"}<small>{locale === "zh" ? "四类相加" : "All categories"}</small><strong>{totalCount}</strong></span></div>
      </div>
      <div className="overview-chart-viewport">
        <div className={`overview-chart ${totalCount ? "" : "empty"}`} style={{ width: `${zoom * 100}%` }}>
          <div className="overview-year-grid">
            {yearLabels.map((year) => {
              const position = endYear === startYear ? 0 : ((year - startYear) / (endYear - startYear)) * 100;
              return <span key={year} style={{ left: `${position}%` }}><i />{year}</span>;
            })}
          </div>
          <div className="overview-axis" />
          {sorted.map((change, index) => {
            const time = new Date(`${change.date}T00:00:00`).getTime();
            const left = Math.max(0, Math.min(100, ((time - start) / span) * 100));
            return (
              <button key={change.id} className={`overview-marker ${change.kind} ${selected?.id === change.id ? "selected" : ""}`} style={{ left: `${left}%`, "--lane": index % 7 } as React.CSSProperties} onClick={() => setSelectedId(change.id)} title={`${change.date} · ${labels[change.kind]} · ${change.title}`} aria-label={`${change.date} ${change.title}`}>
                <i />
              </button>
            );
          })}
          {!totalCount && <p>{locale === "zh" ? "没有匹配的更新记录" : "No matching updates"}</p>}
        </div>
      </div>
      <div className="overview-legend">
        {(Object.keys(labels) as ChangeKind[]).map((kind) => <span className={kind} key={kind}><i />{labels[kind]}</span>)}
        <em>{locale === "zh" ? "点击节点查看记录" : "Click a node to inspect the update"}</em>
      </div>
      {selected && <article className="overview-selected" aria-live="polite">
        <div><span className={`kind-label ${selected.kind}`}>{labels[selected.kind]}</span><time>{selected.date}</time><small>{selected.patchLabel}</small></div>
        <h3>{selected.title}</h3>
        <p>{selected.summary}</p>
        <ul>{selected.details.slice(0, 5).map((detail) => <li key={detail}>{detail}</li>)}</ul>
        <a href={selected.sourceUrl} target="_blank" rel="noreferrer">{locale === "zh" ? "暴雪官方补丁" : "Official Blizzard patch"}<ArrowUpRight size={15} /></a>
      </article>}
    </section>
  );
}
