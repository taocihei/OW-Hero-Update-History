import { useMemo, useState } from "react";
import { Check, Crosshair, RefreshCw, Search, Shield, Sparkles, X } from "lucide-react";
import type { HeroCatalogItem, HeroRosterState } from "./heroApi";

interface HeroRosterPickerProps {
  roster: HeroRosterState;
  selectedKey: string;
  syncing: boolean;
  syncError: string;
  onSelect: (hero: HeroCatalogItem) => void;
  onSync: () => void;
  onClose: () => void;
}

const roles = [
  { key: "all", label: "全部", icon: Sparkles },
  { key: "tank", label: "坦克", icon: Shield },
  { key: "damage", label: "输出", icon: Crosshair },
  { key: "support", label: "支援", icon: Sparkles },
] as const;

const roleNames: Record<HeroCatalogItem["role"], string> = {
  tank: "坦克",
  damage: "输出",
  support: "支援",
};

export default function HeroRosterPicker({ roster, selectedKey, syncing, syncError, onSelect, onSync, onClose }: HeroRosterPickerProps) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<(typeof roles)[number]["key"]>("all");
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return roster.items.filter((hero) =>
      (role === "all" || hero.role === role) &&
      (!needle || `${hero.name} ${hero.englishName}`.toLowerCase().includes(needle)),
    );
  }, [query, role, roster.items]);

  return (
    <div className="roster-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="roster-sheet" role="dialog" aria-modal="true" aria-labelledby="roster-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="roster-head">
          <div>
            <p className="eyebrow">OFFICIAL HERO ROSTER</p>
            <h2 id="roster-title">选择英雄</h2>
            <p>按官方头像浏览当前阵容，选择后切换对应平衡档案。</p>
          </div>
          <div className="roster-head-actions">
            <span className={`sync-state ${roster.source}`}><i />{roster.source === "online" ? "在线已同步" : roster.source === "cache" ? "使用本地缓存" : "内置名单"}</span>
            <button className="sync-button" onClick={onSync} disabled={syncing}><RefreshCw className={syncing ? "spin" : ""} size={16} />{syncing ? "同步中" : "立即更新"}</button>
            <button className="icon-button" onClick={onClose} aria-label="关闭英雄选择"><X size={19} /></button>
          </div>
        </header>

        <div className="roster-toolbar">
          <label className="roster-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索英雄名称…" aria-label="搜索英雄" /></label>
          <div className="role-tabs">
            {roles.map((item) => {
              const Icon = item.icon;
              return <button key={item.key} className={role === item.key ? "active" : ""} onClick={() => setRole(item.key)}><Icon size={15} />{item.label}</button>;
            })}
          </div>
          <span className="roster-count">{visible.length} / {roster.items.length}</span>
        </div>

        {syncError && <p className="roster-error">{syncError}</p>}
        <div className="hero-avatar-grid">
          {visible.map((hero) => (
            <button key={hero.key} className={`hero-avatar-card ${selectedKey === hero.key ? "selected" : ""}`} onClick={() => onSelect(hero)}>
              <span className="portrait-wrap"><img src={hero.portrait} alt={hero.name} loading="lazy" />{selectedKey === hero.key && <i><Check size={14} /></i>}</span>
              <b>{hero.name}</b>
              <span className="hero-card-meta"><span>{hero.englishName}</span><small>{roleNames[hero.role]}</small></span>
            </button>
          ))}
        </div>
        {!visible.length && <div className="roster-empty"><Search size={24} /><p>没有匹配的英雄。</p></div>}
      </section>
    </div>
  );
}
