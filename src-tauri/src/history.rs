use futures::future::join_all;
use regex::Regex;
use reqwest::Client;
use scraper::{ElementRef, Html, Selector};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const INDEX_URL: &str = "https://overwatch.blizzard.com/en-us/news/patch-notes/";

#[derive(Clone, Debug, Default)]
struct LocalBlock {
    hero: String,
    patch_label: String,
    title: String,
    details: Vec<String>,
}

fn selector(value: &str) -> Selector {
    Selector::parse(value).expect("static selector must be valid")
}

fn clean_text(element: Option<ElementRef<'_>>) -> String {
    element
        .map(|node| node.text().collect::<Vec<_>>().join(" "))
        .unwrap_or_default()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn normalize_name(value: &str) -> String {
    value
        .to_lowercase()
        .replace('ú', "u")
        .replace('ö', "o")
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect()
}

fn hero_key(value: &str) -> String {
    match normalize_name(value).as_str() {
        "mccree" => "cassidy".into(),
        "wreckingball" => "wrecking-ball".into(),
        "soldier76" => "soldier-76".into(),
        "jetpackcat" => "jetpack-cat".into(),
        "junkerqueen" => "junker-queen".into(),
        "lifeweaver" => "lifeweaver".into(),
        other => other.to_string(),
    }
}

fn parse_months(html: &str) -> Result<Vec<String>, String> {
    let expression =
        Regex::new(r#"(?s)patchNotesDates\s*=\s*(\{.*?\});"#).map_err(|error| error.to_string())?;
    let payload = expression
        .captures(html)
        .and_then(|captures| captures.get(1))
        .ok_or_else(|| "Official patch month index was not found".to_string())?
        .as_str();
    let value: Value = serde_json::from_str(payload)
        .map_err(|error| format!("Official patch month index was invalid: {error}"))?;
    Ok(value
        .get("live")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect())
}

fn localized_blocks(html: &str) -> HashMap<(String, usize), LocalBlock> {
    let document = Html::parse_document(html);
    let patch_selector = selector(".PatchNotes-patch");
    let anchor_selector = selector(".anchor[id^='patch-']");
    let patch_title_selector = selector(".PatchNotes-patchTitle");
    let hero_selector = selector(".PatchNotesHeroUpdate");
    let hero_name_selector = selector(".PatchNotesHeroUpdate-name");
    let ability_selector = selector(".PatchNotesAbilityUpdate-name");
    let general_selector = selector(".PatchNotesHeroUpdate-generalUpdates p");
    let detail_selector = selector("li");
    let mut output = HashMap::new();

    for patch in document.select(&patch_selector) {
        let date = patch
            .select(&anchor_selector)
            .next()
            .and_then(|anchor| anchor.value().attr("id"))
            .unwrap_or_default()
            .trim_start_matches("patch-")
            .to_string();
        if date.len() != 10 {
            continue;
        }
        let patch_label = clean_text(patch.select(&patch_title_selector).next());
        for (index, block) in patch.select(&hero_selector).enumerate() {
            let mut abilities: Vec<String> = block
                .select(&ability_selector)
                .map(|item| clean_text(Some(item)))
                .filter(|item| !item.is_empty())
                .collect();
            if abilities.is_empty() {
                abilities = block
                    .select(&general_selector)
                    .map(|item| clean_text(Some(item)))
                    .filter(|item| !item.is_empty())
                    .collect();
            }
            abilities.dedup();
            let title = if abilities.is_empty() {
                "英雄数值调整".to_string()
            } else {
                abilities
                    .into_iter()
                    .take(2)
                    .collect::<Vec<_>>()
                    .join(" / ")
            };
            let details = block
                .select(&detail_selector)
                .map(|item| clean_text(Some(item)))
                .filter(|item| !item.is_empty())
                .collect();
            output.insert(
                (date.clone(), index),
                LocalBlock {
                    hero: clean_text(block.select(&hero_name_selector).next()),
                    patch_label: patch_label.clone(),
                    title,
                    details,
                },
            );
        }
    }
    output
}

fn classify(details_en: &[String], details_zh: &[String]) -> &'static str {
    let mut beneficial = 0_u32;
    let mut harmful = 0_u32;
    for index in 0..details_en.len().max(details_zh.len()) {
        let english = details_en
            .get(index)
            .map(String::as_str)
            .unwrap_or_default();
        let chinese = details_zh
            .get(index)
            .map(String::as_str)
            .unwrap_or_default();
        let en = english.to_lowercase();
        let cooldown_like = [
            "cooldown",
            "ultimate cost",
            "spread",
            "recoil",
            "charge cost",
        ]
        .iter()
        .any(|word| en.contains(word));
        if cooldown_like {
            beneficial += ["reduced", "decreased", "lowered"]
                .iter()
                .filter(|word| en.contains(**word))
                .count() as u32;
            harmful += ["increased", "raised"]
                .iter()
                .filter(|word| en.contains(**word))
                .count() as u32;
        } else {
            beneficial += [
                "increased",
                "improved",
                "faster",
                "now pierces",
                "can now",
                "added",
            ]
            .iter()
            .filter(|word| en.contains(**word))
            .count() as u32;
            harmful += ["reduced", "decreased", "slower", "no longer", "removed"]
                .iter()
                .filter(|word| en.contains(**word))
                .count() as u32;
        }
        let cooldown_zh = [
            "冷却",
            "冷卻",
            "终极技能消耗",
            "終極技能消耗",
            "扩散",
            "擴散",
            "后座力",
            "後座力",
        ]
        .iter()
        .any(|word| chinese.contains(word));
        if cooldown_zh {
            beneficial += ["降低", "减少", "減少", "缩短", "縮短"]
                .iter()
                .filter(|word| chinese.contains(**word))
                .count() as u32;
            harmful += ["提高", "增加", "延长", "延長"]
                .iter()
                .filter(|word| chinese.contains(**word))
                .count() as u32;
        } else {
            beneficial += [
                "提高",
                "增加",
                "强化",
                "強化",
                "加快",
                "现在可以",
                "現在可以",
            ]
            .iter()
            .filter(|word| chinese.contains(**word))
            .count() as u32;
            harmful += ["降低", "减少", "減少", "削弱", "不再"]
                .iter()
                .filter(|word| chinese.contains(**word))
                .count() as u32;
        }
    }
    match (beneficial > 0, harmful > 0) {
        (true, false) => "buff",
        (false, true) => "nerf",
        (true, true) => "rework",
        _ => "system",
    }
}

fn track_for(patch_title: &str, section_title: &str, body: &str) -> &'static str {
    let text = format!("{patch_title} {section_title} {body}").to_lowercase();
    if text.contains("stadium") {
        "stadium"
    } else if [
        "community crafted",
        "arcade",
        "april fools",
        "halloween",
        "creator experimental",
    ]
    .iter()
    .any(|word| text.contains(word))
    {
        "arcade"
    } else if text.contains("perk") {
        "perk"
    } else if text.contains("experimental") || text.contains(" ptr ") {
        "experimental"
    } else {
        "core"
    }
}

fn parse_month_pair(month: &str, english_html: &str, chinese_html: &str) -> Vec<(String, Value)> {
    let chinese = localized_blocks(chinese_html);
    let document = Html::parse_document(english_html);
    let patch_selector = selector(".PatchNotes-patch");
    let anchor_selector = selector(".anchor[id^='patch-']");
    let patch_title_selector = selector(".PatchNotes-patchTitle");
    let section_title_selector = selector(".PatchNotes-sectionTitle");
    let hero_selector = selector(".PatchNotesHeroUpdate");
    let hero_name_selector = selector(".PatchNotesHeroUpdate-name");
    let ability_selector = selector(".PatchNotesAbilityUpdate-name");
    let general_selector = selector(".PatchNotesHeroUpdate-generalUpdates p");
    let detail_selector = selector("li");
    let mut output = Vec::new();

    for patch in document.select(&patch_selector) {
        let date = patch
            .select(&anchor_selector)
            .next()
            .and_then(|anchor| anchor.value().attr("id"))
            .unwrap_or_default()
            .trim_start_matches("patch-")
            .to_string();
        if date.len() != 10 {
            continue;
        }
        let patch_title_en = clean_text(patch.select(&patch_title_selector).next());
        let mut occurrences: HashMap<(String, String), usize> = HashMap::new();
        for (block_index, block) in patch.select(&hero_selector).enumerate() {
            let hero_en = clean_text(block.select(&hero_name_selector).next());
            let key = hero_key(&hero_en);
            if key.is_empty() {
                continue;
            }
            let section = block
                .ancestors()
                .filter_map(ElementRef::wrap)
                .find(|ancestor| {
                    ancestor
                        .value()
                        .attr("class")
                        .map(|classes| {
                            classes
                                .split_whitespace()
                                .any(|class| class == "PatchNotes-section")
                        })
                        .unwrap_or(false)
                });
            let section_title = section
                .and_then(|section| section.select(&section_title_selector).next())
                .map(|node| clean_text(Some(node)))
                .unwrap_or_default();
            if section_title.to_lowercase().contains("bug fix") {
                continue;
            }
            let details_en: Vec<String> = block
                .select(&detail_selector)
                .map(|item| clean_text(Some(item)))
                .filter(|item| !item.is_empty() && !item.to_lowercase().starts_with("fixed "))
                .collect();
            if details_en.is_empty() {
                continue;
            }
            let mut abilities: Vec<String> = block
                .select(&ability_selector)
                .map(|item| clean_text(Some(item)))
                .filter(|item| !item.is_empty())
                .collect();
            if abilities.is_empty() {
                abilities = block
                    .select(&general_selector)
                    .map(|item| clean_text(Some(item)))
                    .filter(|item| !item.is_empty())
                    .collect();
            }
            abilities.dedup();
            let title_en = if abilities.is_empty() {
                "Hero balance update".to_string()
            } else {
                abilities
                    .into_iter()
                    .take(2)
                    .collect::<Vec<_>>()
                    .join(" / ")
            };
            let local = chinese
                .get(&(date.clone(), block_index))
                .cloned()
                .unwrap_or_default();
            let title_zh = if local.title.is_empty() {
                title_en.clone()
            } else {
                local.title
            };
            let details_zh = if local.details.is_empty() {
                details_en.clone()
            } else {
                local.details
            };
            let patch_title_zh = if local.patch_label.is_empty() {
                patch_title_en.clone()
            } else {
                local.patch_label
            };
            let hero_zh = if local.hero.is_empty() {
                hero_en.clone()
            } else {
                local.hero
            };
            let track =
                track_for(&patch_title_en, &section_title, &clean_text(Some(block))).to_string();
            let occurrence = occurrences.entry((key.clone(), track.clone())).or_insert(0);
            *occurrence += 1;
            let suffix = if *occurrence > 1 {
                format!("-{}", *occurrence)
            } else {
                String::new()
            };
            let source_url = format!(
                "https://overwatch.blizzard.com/en-us/news/patch-notes/live/{}/",
                month.replace('-', "/")
            );
            let summary_zh = format!("{hero_zh}在本次暴雪官方补丁中调整了{title_zh}。");
            let summary_en =
                format!("{hero_en} was updated in this official Blizzard patch: {title_en}.");
            let kind = classify(&details_en, &details_zh);
            output.push((
                key.clone(),
                json!({
                    "id": format!("official-{key}-{date}-{track}{suffix}"),
                    "date": date,
                    "patchLabel": patch_title_zh.clone(),
                    "patchLabelZh": patch_title_zh,
                    "patchLabelEn": patch_title_en,
                    "kind": kind,
                    "track": track,
                    "title": title_zh.clone(),
                    "titleZh": title_zh,
                    "titleEn": title_en,
                    "summary": summary_zh.clone(),
                    "summaryZh": summary_zh,
                    "summaryEn": summary_en,
                    "details": details_zh.clone(),
                    "detailsZh": details_zh,
                    "detailsEn": details_en,
                    "sourceUrl": source_url,
                    "sourceLabel": "暴雪官方补丁",
                    "sourceKind": "official",
                    "platformScope": "all",
                    "archiveChannel": "live"
                }),
            ));
        }
    }
    output
}

fn parse_patch_dates(html: &str) -> Vec<String> {
    let document = Html::parse_document(html);
    let anchor_selector = selector(".PatchNotes-patch .anchor[id^='patch-']");
    let mut dates: Vec<String> = document
        .select(&anchor_selector)
        .filter_map(|anchor| anchor.value().attr("id"))
        .map(|id| id.trim_start_matches("patch-").to_string())
        .filter(|date| {
            date.len() == 10
                && date.chars().enumerate().all(|(index, value)| {
                    matches!(index, 4 | 7) && value == '-'
                        || !matches!(index, 4 | 7) && value.is_ascii_digit()
                })
        })
        .collect();
    dates.sort();
    dates.dedup();
    dates
}

async fn fetch_month(
    client: Client,
    month: String,
) -> Result<(String, Vec<(String, Value)>, Vec<String>), String> {
    let path = month.replace('-', "/");
    let en_url = format!("https://overwatch.blizzard.com/en-us/news/patch-notes/live/{path}/");
    let zh_url = format!("https://overwatch.blizzard.com/zh-tw/news/patch-notes/live/{path}/");
    let (english, chinese) = futures::join!(client.get(&en_url).send(), client.get(&zh_url).send());
    let english =
        english.map_err(|error| format!("{month} English patch request failed: {error}"))?;
    let chinese =
        chinese.map_err(|error| format!("{month} Chinese patch request failed: {error}"))?;
    if !english.status().is_success() || !chinese.status().is_success() {
        return Err(format!(
            "{month} patch request returned HTTP {}/{}",
            english.status(),
            chinese.status()
        ));
    }
    let (english_html, chinese_html) = futures::join!(english.text(), chinese.text());
    let english_html = english_html.map_err(|error| error.to_string())?;
    let chinese_html = chinese_html.map_err(|error| error.to_string())?;
    let patch_dates = parse_patch_dates(&english_html);
    Ok((
        month.clone(),
        parse_month_pair(&month, &english_html, &chinese_html),
        patch_dates,
    ))
}

#[tauri::command]
pub async fn fetch_official_history(known_months: Vec<String>) -> Result<Value, String> {
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(45))
        .user_agent("OWHeroUpdateHistory/0.7.1")
        .build()
        .map_err(|error| format!("Failed to initialize patch collector: {error}"))?;
    let index_html = client
        .get(INDEX_URL)
        .send()
        .await
        .map_err(|error| format!("Official patch index request failed: {error}"))?
        .text()
        .await
        .map_err(|error| format!("Official patch index response was invalid: {error}"))?;
    let all_months = parse_months(&index_html)?;
    let known: HashSet<&str> = known_months.iter().map(String::as_str).collect();
    let mut requested: Vec<String> = all_months
        .iter()
        .filter(|month| !known.contains(month.as_str()))
        .cloned()
        .collect();
    for month in all_months.iter().take(2) {
        if !requested.contains(month) {
            requested.push(month.clone());
        }
    }
    let results = join_all(
        requested
            .iter()
            .cloned()
            .map(|month| fetch_month(client.clone(), month)),
    )
    .await;
    let mut heroes: HashMap<String, Vec<Value>> = HashMap::new();
    let mut patch_dates: HashSet<String> = HashSet::new();
    for result in results {
        let (_, records, dates) = result?;
        patch_dates.extend(dates);
        for (key, record) in records {
            heroes.entry(key).or_default().push(record);
        }
    }
    for records in heroes.values_mut() {
        records.sort_by(|left, right| {
            let left_key = format!(
                "{}:{}",
                left["date"].as_str().unwrap_or_default(),
                left["id"].as_str().unwrap_or_default()
            );
            let right_key = format!(
                "{}:{}",
                right["date"].as_str().unwrap_or_default(),
                right["id"].as_str().unwrap_or_default()
            );
            left_key.cmp(&right_key)
        });
    }
    let patch_entries: Vec<String> = patch_dates
        .iter()
        .map(|date| format!("live:{date}"))
        .collect();
    Ok(json!({
        "source": "Blizzard official Overwatch patch notes",
        "sourceIndex": INDEX_URL,
        "generatedAt": SystemTime::now().duration_since(UNIX_EPOCH).map(|duration| duration.as_millis()).unwrap_or_default(),
        "scannedMonths": all_months,
        "updatedMonths": requested,
        "patchDates": patch_dates,
        "patchEntries": patch_entries,
        "heroes": heroes
    }))
}

#[cfg(test)]
mod tests {
    use super::{classify, fetch_month, parse_months, track_for};

    #[test]
    fn reads_official_month_index() {
        let html = r#"<script>patchNotesDates = {"live":["2026-07","2026-06"]};</script>"#;
        assert_eq!(parse_months(html).unwrap(), vec!["2026-07", "2026-06"]);
    }

    #[test]
    fn classifies_english_and_chinese_values() {
        assert_eq!(
            classify(&["Cooldown reduced from 10 to 8 seconds".into()], &[]),
            "buff"
        );
        assert_eq!(classify(&[], &["伤害从 80 降低至 70".into()]), "nerf");
    }

    #[test]
    fn community_crafted_takes_priority_over_perk_words() {
        assert_eq!(
            track_for(
                "Overwatch Retail Patch Notes – June 30, 2026",
                "Community Crafted",
                "Shield Battery – Major Perk moved to base kit"
            ),
            "arcade"
        );
    }

    #[test]
    #[ignore]
    fn downloads_and_parses_bilingual_official_month() {
        let client = reqwest::Client::builder()
            .user_agent("OWHeroUpdateHistory/Test")
            .build()
            .unwrap();
        let (_, records, dates) =
            tauri::async_runtime::block_on(fetch_month(client, "2026-07".into())).unwrap();
        assert!(!records.is_empty());
        assert!(!dates.is_empty());
        assert!(records
            .iter()
            .any(|(_, record)| record["titleZh"] != record["titleEn"]));
    }
}
