from __future__ import annotations

import json
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
BASE_URL = "http://127.0.0.1:4181"
TEAM = "Weibo Gaming"
HERO = "Symmetra"


def expected_source() -> tuple[int, dict[str, int]]:
    payload = json.loads((ROOT / "src" / "esports2025Snapshot.json").read_text(encoding="utf-8"))
    totals = [
        row for row in payload["teamHeroUsage"]
        if row["team_name"] == TEAM and row["hero_name"] == HERO
    ]
    matches = {
        row["match_id"]: int(row["usage_count"])
        for row in payload["matchHeroUsage"]
        if row.get("team_name") == TEAM and row["hero_name"] == HERO
    }
    return sum(int(row["usage_count"]) for row in totals), matches


def main() -> None:
    expected_total, expected_matches = expected_source()
    assert expected_total == 51
    assert sum(expected_matches.values()) == expected_total

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1500, "height": 930})
        page.set_default_timeout(30_000)
        page.goto(BASE_URL, wait_until="domcontentloaded", timeout=120_000)
        page.get_by_role("button", name="职业比赛", exact=True).click()
        page.locator(".match-subnav button").filter(has_text="战队").click()
        page.locator(".draft-index input").fill("Weibo")
        page.locator(".draft-index button").filter(has_text=TEAM).first.click()
        page.locator(".draft-tournament-filter select").select_option("2025")

        hero_row = page.locator(f'.draft-usage-row[data-hero="{HERO}"]')
        assert hero_row.count() == 1
        assert int(hero_row.get_attribute("data-usage") or 0) == expected_total
        assert hero_row.locator("b").inner_text().replace(",", "") == str(expected_total)
        hero_row.click()

        rendered = page.locator(".team-hero-match-list article")
        assert rendered.count() == len(expected_matches)
        actual_matches = {
            str(row["matchId"]): int(row["usage"])
            for row in rendered.evaluate_all(
                "rows => rows.map(row => ({matchId: row.dataset.matchId, usage: row.dataset.usage}))"
            )
        }
        assert actual_matches == expected_matches
        assert sum(actual_matches.values()) == expected_total
        assert page.locator(".team-hero-match-audit").count() == 0
        assert f"{expected_total}/{expected_total} 图" in page.locator(".team-hero-match-detail .draft-section-title > span").inner_text()
        browser.close()

    print(f"team hero source consistency: PASS ({TEAM} / {HERO} / {expected_total} maps / {len(expected_matches)} matches)")


if __name__ == "__main__":
    main()
