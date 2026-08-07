from __future__ import annotations

import concurrent.futures
import json
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests
from bs4 import BeautifulSoup, Tag
from opencc import OpenCC


ROOT = Path(__file__).resolve().parents[1]
ROSTER_PATH = ROOT / "src" / "heroRosterData.ts"
OUTPUT_PATH = ROOT / "src" / "officialHistorySnapshot.json"
PATCH_INDEX_URL = "https://overwatch.blizzard.com/en-us/news/patch-notes/"
BASE_URL = "https://overwatch.blizzard.com/en-us/news/patch-notes/{channel}/{year}/{month}/"
ZH_BASE_URL = "https://overwatch.blizzard.com/zh-tw/news/patch-notes/{channel}/{year}/{month}/"
TO_SIMPLIFIED = OpenCC("t2s")
TO_TRADITIONAL = OpenCC("s2t")


@dataclass
class LocalBlock:
    hero: str
    patch_label: str
    title: str
    details: list[str]

LEGACY_TW_NAMES = {
    "ana": ["安娜"], "bastion": ["壁壘機兵"], "dva": ["D.Va"], "genji": ["源氏"],
    "hanzo": ["半藏"], "junkrat": ["炸彈鼠"], "lucio": ["路西歐"], "cassidy": ["麥卡利", "卡西迪"],
    "mercy": ["慈悲"], "mei": ["小美"], "pharah": ["法拉"], "reaper": ["死神"],
    "reinhardt": ["萊因哈特"], "roadhog": ["攔路豬"], "soldier-76": ["士兵：76", "士兵76"],
    "symmetra": ["辛梅塔"], "torbjorn": ["托比昂"], "tracer": ["閃光"], "widowmaker": ["奪命女"],
    "winston": ["溫斯頓"], "zarya": ["札莉雅"], "zenyatta": ["禪亞塔"], "orisa": ["歐瑞莎"],
    "sombra": ["駭影"], "doomfist": ["毀滅拳王"], "moira": ["莫伊拉"], "brigitte": ["碧姬"],
    "wrecking-ball": ["火爆鋼球"], "ashe": ["艾西"], "baptiste": ["巴帝斯特"], "sigma": ["席格馬"],
    "echo": ["迴音"],
}


def load_roster() -> list[dict[str, Any]]:
    source = ROSTER_PATH.read_text(encoding="utf-8")
    assignment = source.index("=")
    payload = source[source.index("[", assignment) : source.rindex("]") + 1]
    return json.loads(payload)


def normalize_name(value: str) -> str:
    value = value.casefold().replace("ú", "u").replace("ö", "o")
    return re.sub(r"[^a-z0-9]", "", value)


def hero_aliases(roster: list[dict[str, Any]]) -> dict[str, str]:
    aliases: dict[str, str] = {}
    for hero in roster:
        aliases[normalize_name(hero["englishName"])] = hero["key"]
        aliases[normalize_name(hero["key"])] = hero["key"]
    aliases.update({
        "mccree": "cassidy",
        "wreckingball": "wrecking-ball",
        "soldier76": "soldier-76",
        "torbjorn": "torbjorn",
        "lucio": "lucio",
        "jetpackcat": "jetpack-cat",
        "junkerqueen": "junker-queen",
    })
    return aliases


def month_index() -> dict[str, list[str]]:
    response = requests.get(PATCH_INDEX_URL, timeout=30)
    response.raise_for_status()
    html = response.content.decode("utf-8", errors="replace")
    match = re.search(r"patchNotesDates\s*=\s*(\{.*?\});", html, re.S)
    if not match:
        raise RuntimeError("未在暴雪补丁页面找到月份索引")
    payload = json.loads(match.group(1))
    return {channel: payload.get(channel, []) for channel in ("live", "ptr", "experimental", "beta")}


def clean_text(node: Tag | None) -> str:
    if node is None:
        return ""
    return " ".join(node.get_text(" ", strip=True).split())


def legacy_name_maps(roster: list[dict[str, Any]], aliases: dict[str, str]) -> tuple[dict[str, str], dict[str, str]]:
    english = dict(aliases)
    chinese: dict[str, str] = {}
    for hero in roster:
        for name in (hero["name"], TO_TRADITIONAL.convert(hero["name"]), hero["englishName"]):
            chinese[clean_text(BeautifulSoup(f"<p>{name}</p>", "html.parser").p)] = hero["key"]
    for key, names in LEGACY_TW_NAMES.items():
        for name in names:
            chinese[name] = key
    return english, chinese


def legacy_patch_blocks(patch: Tag, name_map: dict[str, str], english: bool) -> dict[str, LocalBlock]:
    body = next((node for node in patch.find_all("div", recursive=False) if not node.get("class")), None)
    if body is None:
        return {}
    active = False
    current_key = ""
    abilities: list[str] = []
    details: list[str] = []
    records: dict[str, LocalBlock] = {}

    def flush() -> None:
        nonlocal current_key, abilities, details
        if current_key and details:
            unique_abilities = list(dict.fromkeys(item for item in abilities if item))
            title = " / ".join(unique_abilities[:2]) or ("Hero balance update" if english else "英雄数值调整")
            records[current_key] = LocalBlock(hero=current_key, patch_label="", title=title, details=list(dict.fromkeys(details)))
        current_key, abilities, details = "", [], []

    for node in body.find_all(recursive=False):
        if node.name in {"h1", "h2", "h3", "h4"}:
            heading = clean_text(node)
            normalized = heading.upper()
            if ("HERO" in normalized and ("UPDATE" in normalized or "BALANCE" in normalized)) or ("英雄" in heading and ("更新" in heading or "平衡" in heading or "更動" in heading)):
                flush()
                active = True
                continue
            if active and normalized not in {"TANK", "DAMAGE", "SUPPORT", "GENERAL", "坦克", "輸出", "輔助", "一般"}:
                candidate = normalize_name(heading) if english else heading
                if candidate in name_map:
                    flush()
                    current_key = name_map[candidate]
                    continue
                flush()
                active = False
            continue
        if not active:
            continue
        text = clean_text(node)
        candidate = normalize_name(text) if english else text
        if node.name in {"p", "strong"} and candidate in name_map:
            flush()
            current_key = name_map[candidate]
            continue
        if not current_key:
            continue
        if node.name == "ul":
            leaf_details = [clean_text(item) for item in node.find_all("li") if not item.find("li")]
            details.extend(item for item in leaf_details if item)
        elif node.name == "p" and "developer" not in text.casefold() and "开发者" not in text and "開發者" not in text and len(text) <= 120:
            # Legacy pages place an ability name directly before its change list.
            # Do not turn surrounding developer commentary into a record title.
            next_sibling = node.find_next_sibling()
            if next_sibling is not None and next_sibling.name == "ul":
                abilities.append(text)
    flush()
    return records


def classify(details: list[str], details_zh: list[str] | None = None) -> str:
    beneficial = 0
    harmful = 0
    for detail in details:
        text = detail.casefold()
        if "cooldown" in text or "ultimate cost" in text or "spread" in text or "recoil" in text:
            beneficial += int(any(word in text for word in ("reduced", "decreased", "lowered")))
            harmful += int(any(word in text for word in ("increased", "raised")))
        else:
            beneficial += int(any(word in text for word in ("increased", "improved", "faster", "now pierces", "can now", "added")))
            harmful += int(any(word in text for word in ("reduced", "decreased", "slower", "no longer", "removed")))
    for detail in details_zh or []:
        cooldown_like = any(word in detail for word in ("冷却", "冷卻", "终极技能消耗", "終極技能消耗", "扩散", "擴散", "后座力", "後座力"))
        if cooldown_like:
            beneficial += int(any(word in detail for word in ("降低", "减少", "減少", "缩短", "縮短")))
            harmful += int(any(word in detail for word in ("提高", "增加", "延长", "延長")))
        else:
            beneficial += int(any(word in detail for word in ("提高", "增加", "强化", "強化", "加快", "现在可以", "現在可以")))
            harmful += int(any(word in detail for word in ("降低", "减少", "減少", "削弱", "不再")))
    if beneficial and not harmful:
        return "buff"
    if harmful and not beneficial:
        return "nerf"
    if beneficial and harmful:
        return "rework"
    return "system"


def track_for(patch_title: str, section_title: str, body: str) -> str:
    haystack = f"{patch_title} {section_title} {body}".casefold()
    if "stadium" in haystack:
        return "stadium"
    if any(word in haystack for word in ("community crafted", "arcade", "april fools", "halloween", "creator experimental")):
        return "arcade"
    if "perk" in haystack:
        return "perk"
    if "experimental" in haystack or "ptr" in haystack:
        return "experimental"
    return "core"


def localized_blocks(soup: BeautifulSoup) -> dict[tuple[str, int], dict[str, Any]]:
    result: dict[tuple[str, int], dict[str, Any]] = {}
    for patch in soup.select(".PatchNotes-patch"):
        anchor = patch.select_one(".anchor[id^='patch-']")
        if anchor is None:
            continue
        patch_date = str(anchor.get("id", "")).removeprefix("patch-")
        patch_title = clean_text(patch.select_one(".PatchNotes-patchTitle"))
        for block_index, block in enumerate(patch.select(".PatchNotesHeroUpdate")):
            details = [clean_text(item) for item in block.select("li")]
            abilities = [clean_text(item) for item in block.select(".PatchNotesAbilityUpdate-name")]
            if not abilities:
                general = block.select_one(".PatchNotesHeroUpdate-generalUpdates")
                abilities = [clean_text(item) for item in general.select("p")] if general else []
            abilities = [item for item in abilities if item]
            result[(patch_date, block_index)] = {
                "hero": clean_text(block.select_one(".PatchNotesHeroUpdate-name")),
                "patchLabel": patch_title,
                "title": " / ".join(dict.fromkeys(abilities[:2])) or "英雄数值调整",
                "details": [detail for detail in details if detail],
            }
    return result


def parse_month(channel: str, month_key: str, aliases: dict[str, str], local_names: dict[str, str], legacy_en_names: dict[str, str], legacy_zh_names: dict[str, str]) -> tuple[list[tuple[str, dict[str, Any]]], list[str]]:
    year, month = month_key.split("-")
    url = BASE_URL.format(channel=channel, year=year, month=month)
    zh_url = ZH_BASE_URL.format(channel=channel, year=year, month=month)
    for attempt in range(4):
        try:
            response = requests.get(url, timeout=40)
            zh_response = requests.get(zh_url, timeout=40)
            response.raise_for_status()
            zh_response.raise_for_status()
            break
        except requests.RequestException:
            if attempt == 3:
                raise
            time.sleep(1.5 * (attempt + 1))
    soup = BeautifulSoup(response.content.decode("utf-8", errors="replace"), "html.parser")
    zh_soup = BeautifulSoup(zh_response.content.decode("utf-8", errors="replace"), "html.parser")
    zh_blocks = localized_blocks(zh_soup)
    records: list[tuple[str, dict[str, Any]]] = []
    patch_entries = sorted({
        f"{channel}:{str(anchor.get('id', '')).removeprefix('patch-')}"
        for anchor in soup.select(".PatchNotes-patch .anchor[id^='patch-']")
        if re.fullmatch(r"patch-\d{4}-\d{2}-\d{2}", str(anchor.get("id", "")))
    })

    for patch in soup.select(".PatchNotes-patch"):
        anchor = patch.select_one(".anchor[id^='patch-']")
        if anchor is None:
            continue
        patch_date = str(anchor.get("id", "")).removeprefix("patch-")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", patch_date):
            continue
        patch_title = clean_text(patch.select_one(".PatchNotes-patchTitle")) or f"{patch_date} 官方补丁"

        occurrence: dict[tuple[str, str], int] = {}
        for block_index, block in enumerate(patch.select(".PatchNotesHeroUpdate")):
            hero_name = clean_text(block.select_one(".PatchNotesHeroUpdate-name"))
            hero_key = aliases.get(normalize_name(hero_name))
            if not hero_key:
                continue
            section = block.find_parent(class_="PatchNotes-section")
            section_title = clean_text(section.select_one(".PatchNotes-sectionTitle")) if isinstance(section, Tag) else ""
            if "bug fix" in section_title.casefold():
                continue

            details = [clean_text(item) for item in block.select("li")]
            details = [detail for detail in details if detail and not detail.casefold().startswith("fixed ")]
            if not details:
                continue
            abilities = [clean_text(item) for item in block.select(".PatchNotesAbilityUpdate-name")]
            if not abilities:
                general = block.select_one(".PatchNotesHeroUpdate-generalUpdates")
                abilities = [clean_text(item) for item in general.select("p")] if general else []
            abilities = [item for item in abilities if item]
            title_en = " / ".join(dict.fromkeys(abilities[:2])) or "Hero balance update"
            localized = zh_blocks.get((patch_date, block_index), {})
            title_zh = TO_SIMPLIFIED.convert(str(localized.get("title") or title_en))
            details_zh = [TO_SIMPLIFIED.convert(str(item)) for item in localized.get("details", details)]
            patch_title_zh = TO_SIMPLIFIED.convert(str(localized.get("patchLabel") or patch_title))
            summary_zh = f"{local_names.get(hero_key, hero_name)}在本次暴雪官方补丁中调整了{title_zh}。"
            summary_en = f"{hero_name} was updated in this official Blizzard patch: {title_en}."
            track = track_for(patch_title, section_title, clean_text(block)) if channel == "live" else "experimental"
            identity = (hero_key, track)
            occurrence[identity] = occurrence.get(identity, 0) + 1
            suffix = f"-{occurrence[identity]}" if occurrence[identity] > 1 else ""
            id_prefix = "official" if channel == "live" else f"official-{channel}"
            records.append((hero_key, {
                "id": f"{id_prefix}-{hero_key}-{patch_date}-{track}{suffix}",
                "date": patch_date,
                "patchLabel": patch_title_zh,
                "patchLabelZh": patch_title_zh,
                "patchLabelEn": patch_title,
                "kind": classify(details, details_zh),
                "track": track,
                "title": title_zh,
                "titleZh": title_zh,
                "titleEn": title_en,
                "summary": summary_zh,
                "summaryZh": summary_zh,
                "summaryEn": summary_en,
                "details": details_zh,
                "detailsZh": details_zh,
                "detailsEn": details,
                "sourceUrl": url,
                "sourceLabel": "暴雪官方补丁",
                "sourceKind": "official",
                "platformScope": "all",
                "archiveChannel": channel,
            }))

    zh_legacy_by_date = {
        str(patch.select_one(".anchor[id^='patch-']").get("id", "")).removeprefix("patch-"): patch
        for patch in zh_soup.select(".PatchNotes-patch--legacy")
        if patch.select_one(".anchor[id^='patch-']")
    }
    for patch in soup.select(".PatchNotes-patch--legacy"):
        anchor = patch.select_one(".anchor[id^='patch-']")
        if anchor is None:
            continue
        patch_date = str(anchor.get("id", "")).removeprefix("patch-")
        english_blocks = legacy_patch_blocks(patch, legacy_en_names, True)
        if not english_blocks:
            continue
        zh_patch = zh_legacy_by_date.get(patch_date)
        chinese_blocks = legacy_patch_blocks(zh_patch, legacy_zh_names, False) if zh_patch else {}
        patch_title_en = clean_text(patch.find(["h1", "h2"])) or f"Overwatch Patch Notes - {patch_date}"
        patch_title_zh = (
            TO_SIMPLIFIED.convert(clean_text(zh_patch.find(["h1", "h2"])))
            if zh_patch
            else f"《守望先锋》补丁说明 - {patch_date}"
        )
        for hero_key, block in english_blocks.items():
            local = chinese_blocks.get(hero_key)
            title_zh = TO_SIMPLIFIED.convert(local.title) if local else "英雄数值调整"
            details_zh = [TO_SIMPLIFIED.convert(item) for item in (local.details if local else block.details)]
            summary_zh = f"{local_names.get(hero_key, hero_key)}在本次暴雪官方补丁中调整了{title_zh}。"
            summary_en = f"{hero_key} was updated in this official Blizzard patch: {block.title}."
            track = "core" if channel == "live" else "experimental"
            id_prefix = "official" if channel == "live" else f"official-{channel}"
            records.append((hero_key, {
                "id": f"{id_prefix}-{hero_key}-{patch_date}-{track}-legacy",
                "date": patch_date,
                "patchLabel": patch_title_zh,
                "patchLabelZh": patch_title_zh,
                "patchLabelEn": patch_title_en,
                "kind": classify(block.details, details_zh),
                "track": track,
                "title": title_zh,
                "titleZh": title_zh,
                "titleEn": block.title,
                "summary": summary_zh,
                "summaryZh": summary_zh,
                "summaryEn": summary_en,
                "details": details_zh,
                "detailsZh": details_zh,
                "detailsEn": block.details,
                "sourceUrl": url,
                "sourceLabel": "暴雪官方补丁",
                "sourceKind": "official",
                "platformScope": "all",
                "archiveChannel": channel,
            }))
    return records, patch_entries


def main() -> None:
    roster = load_roster()
    aliases = hero_aliases(roster)
    local_names = {hero["key"]: hero["name"] for hero in roster}
    legacy_en_names, legacy_zh_names = legacy_name_maps(roster, aliases)
    month_groups = month_index()
    archive_months = [(channel, month) for channel, months in month_groups.items() for month in months]
    grouped: dict[str, list[dict[str, Any]]] = {hero["key"]: [] for hero in roster}
    patch_entries: set[str] = set()

    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as executor:
        futures = {
            executor.submit(parse_month, channel, month, aliases, local_names, legacy_en_names, legacy_zh_names): (channel, month)
            for channel, month in archive_months
        }
        for future in concurrent.futures.as_completed(futures):
            channel, month = futures[future]
            try:
                month_records, month_patch_entries = future.result()
                patch_entries.update(month_patch_entries)
                for hero_key, record in month_records:
                    grouped.setdefault(hero_key, []).append(record)
            except Exception as exc:
                raise RuntimeError(f"抓取 {channel}/{month} 失败: {exc}") from exc

    grouped = {
        key: sorted({record["id"]: record for record in records}.values(), key=lambda item: (item["date"], item["id"]))
        for key, records in grouped.items()
        if records
    }
    payload = {
        "source": "Blizzard official Overwatch patch notes",
        "sourceIndex": "https://overwatch.blizzard.com/en-us/news/patch-notes/",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "monthsScanned": len(archive_months),
        "scannedMonths": month_groups["live"],
        "scannedArchives": [f"{channel}:{month}" for channel, month in archive_months],
        "patchDates": sorted({entry.split(":", 1)[1] for entry in patch_entries}),
        "patchEntries": sorted(patch_entries),
        "heroes": grouped,
    }
    OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {OUTPUT_PATH}")
    print(f"months={len(archive_months)} patches={len(patch_entries)} heroes={len(grouped)} records={sum(map(len, grouped.values()))}")
    for channel, months in month_groups.items():
        count = sum(1 for entry in patch_entries if entry.startswith(f"{channel}:"))
        print(f"{channel}: months={len(months)} patches={count}")
    for key, records in sorted(grouped.items(), key=lambda item: (-len(item[1]), item[0])):
        print(f"{key}: {len(records)}")


if __name__ == "__main__":
    main()
