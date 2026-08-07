from pathlib import Path
import json

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]


def px(page, selector: str) -> float:
    return float(page.locator(selector).first.evaluate("node => parseFloat(getComputedStyle(node).fontSize)"))


def main() -> None:
    official_history = json.loads((ROOT / "src" / "officialHistorySnapshot.json").read_text(encoding="utf-8"))
    lucio_2020 = next(record for record in official_history["heroes"]["lucio"] if record["date"] == "2020-11-17")
    assert "壁面疾走" in lucio_2020["titleZh"]
    assert "Wall Ride" in lucio_2020["titleEn"]
    assert lucio_2020["detailsZh"] and lucio_2020["detailsEn"]

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
        errors: list[str] = []
        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)

        page.goto("http://127.0.0.1:4181", wait_until="networkidle")
        assert page.title() == "OW英雄更新历史", f"Unexpected title: {page.title()} at {page.url}"
        assert page.get_by_role("heading", name="秩序之光", exact=True).is_visible()
        assert "1514" in page.locator(".live-pill").inner_text()
        page.get_by_role("button", name="切换中英文", exact=True).click()
        assert page.get_by_role("heading", name="Symmetra", exact=True).is_visible()
        assert page.get_by_text("Buff", exact=True).count() >= 1
        assert page.locator(".overview-selected").inner_text().find("Official Blizzard patch") >= 0
        page.get_by_role("button", name="切换中英文", exact=True).click()
        assert page.get_by_role("heading", name="秩序之光", exact=True).is_visible()
        assert page.get_by_role("heading", name="更新历史短全图", exact=True).is_visible()
        assert px(page, "body") >= 16
        assert px(page, ".hero-name-line h1") <= 82
        assert page.locator(".overview-marker").count() == 34
        assert "33" in page.locator(".overview-fact").inner_text()
        assert "削弱 8 次" in page.locator(".overview-fact").inner_text()
        assert page.locator(".overview-metrics").get_attribute("aria-label") == "改动总数 34，由增强 15、削弱 8、重做 8、系统和地形影响 3 相加得出"
        assert page.locator(".metric-rework strong").inner_text() == "8"
        assert page.locator(".metric-system strong").inner_text() == "3"
        assert page.locator(".metric-total strong").inner_text() == "34"
        chart_width = page.locator(".overview-chart").evaluate("node => node.getBoundingClientRect().width")
        page.get_by_role("button", name="放大全图", exact=True).click()
        page.wait_for_timeout(300)
        assert page.locator(".overview-chart").evaluate("node => node.getBoundingClientRect().width") > chart_width
        page.locator(".overview-marker").first.click()
        assert page.locator(".overview-selected").is_visible()
        page.get_by_role("button", name="复位全图", exact=True).click()
        page.screenshot(path=str(ROOT / "tests" / "compact-history.png"), full_page=False)
        page.get_by_role("button", name="长树图", exact=True).click()
        assert page.locator("article.change-row").count() == 10
        page.get_by_role("button", name="再显示 10 条", exact=True).click()
        assert page.locator("article.change-row").count() == 20
        page.get_by_role("button", name="收起至 10 条", exact=True).click()
        assert page.locator("article.change-row").count() == 10
        assert px(page, ".change-card > p") >= 15
        assert px(page, ".change-card li") >= 14
        assert page.locator(".track-summary-card.perk").is_visible()
        assert page.get_by_text("职业比赛线索核查", exact=True).count() == 0
        assert page.locator(".track-summary-card.esports").count() == 0
        assert page.get_by_text("添加记录", exact=True).count() == 0
        assert page.get_by_text("导出档案", exact=True).count() == 0
        assert page.get_by_text("一条记录，一份官方依据。", exact=False).count() == 0
        assert page.locator("footer").count() == 0
        assert page.get_by_text("当前收录记录数值一致", exact=True).is_visible()
        assert page.get_by_role("button", name="仅 PC", exact=True).get_attribute("class") == "active"
        assert page.get_by_text("主机版炮台伤害再次降低", exact=True).count() == 0
        page.get_by_role("textbox", name="搜索平衡记录").fill("主机版炮台伤害再次降低")
        page.get_by_role("button", name="PC + 主机", exact=True).click()
        assert page.get_by_text("主机版炮台伤害再次降低", exact=True).is_visible()
        page.get_by_role("button", name="仅 PC", exact=True).click()
        assert page.get_by_text("主机版炮台伤害再次降低", exact=True).count() == 0
        page.get_by_role("textbox", name="搜索平衡记录").fill("")
        with page.expect_download() as download_info:
            page.get_by_role("button", name="导出 JSON", exact=True).click()
        export_path = download_info.value.path()
        exported = json.loads(Path(export_path).read_text(encoding="utf-8"))
        assert exported["schemaVersion"] == "1.0"
        assert exported["platformMode"] == "pc-only"
        assert all(record.get("platformScope") != "console" for record in exported["records"])
        page.get_by_role("button", name="亚服 暴雪全球版本 · 繁中官网", exact=True).click()
        assert "亚服" in page.locator(".source-badge").first.inner_text()
        page.get_by_role("button", name="国服 网易暴雪国服 · 简中官网", exact=True).click()
        assert "国服" in page.locator(".source-badge").first.inner_text()

        page.get_by_role("button", name="切换英雄，当前为秩序之光", exact=True).click()
        assert page.locator(".hero-avatar-card").count() >= 50
        assert page.locator(".hero-avatar-card img[src*='/heroes/']").count() >= 50
        assert page.locator(".hero-card-meta").count() >= 50
        assert page.get_by_text("完整档案", exact=True).count() == 0
        page.screenshot(path=str(ROOT / "tests" / "hero-picker-spacing.png"), full_page=False)
        page.locator(".hero-avatar-card").filter(has_text="安娜").first.click()
        assert page.get_by_role("heading", name="安娜", exact=True).is_visible()
        assert page.locator("article.change-row").count() == 10
        assert page.locator(".source-badge.official").count() == 10
        assert page.get_by_text("该英雄尚无完整本地档案", exact=True).count() == 0
        assert page.get_by_text("等待数据同步", exact=True).count() == 0
        assert page.get_by_text("暂无更新记录", exact=True).count() == 0
        page.screenshot(path=str(ROOT / "tests" / "ana-history.png"), full_page=False)
        page.get_by_role("button", name="切换英雄，当前为安娜", exact=True).click()
        page.locator(".hero-avatar-card").filter(has_text="卢西奥").first.click()
        assert page.get_by_role("heading", name="卢西奥", exact=True).is_visible()
        assert page.get_by_text("壁面疾走", exact=False).count() >= 1
        assert page.get_by_text("Wall Ride /", exact=False).count() == 0
        page.get_by_role("button", name="切换英雄，当前为卢西奥", exact=True).click()
        page.locator(".hero-avatar-card").filter(has_text="秩序之光").first.click()
        assert page.locator("article.change-row").count() == 10
        page.screenshot(path=str(ROOT / "tests" / "balance-readable.png"), full_page=False)

        page.get_by_role("button", name="职业比赛", exact=True).click()
        assert page.get_by_role("heading", name="职业赛事中心", exact=True).is_visible()
        assert page.locator(".pro-match-card").count() == 24
        assert "209" in page.locator(".pro-summary").inner_text()
        assert "183" in page.locator(".pro-summary").inner_text()
        assert "18" in page.locator(".pro-summary").inner_text()
        assert "8" in page.locator(".pro-summary").inner_text()
        assert page.locator(".event-breakdown button").count() == 9
        page.locator(".status-tabs button").filter(has_text="已结束").click()
        assert "显示 183 / 共 209 场" in page.locator(".filter-count").inner_text()
        page.locator(".status-tabs button").filter(has_text="全部").click()
        page.locator("select[aria-label='筛选赛事分类']").select_option("Regular Season")
        assert "显示 60 / 共 209 场" in page.locator(".filter-count").inner_text()
        page.locator("select[aria-label='筛选赛事分类']").select_option("all")
        for platform in ["B站", "虎牙", "斗鱼", "抖音", "快手", "网易大神", "网易DD"]:
            assert page.locator(".focus-streams").get_by_role("link", name=platform, exact=True).is_visible()
        assert page.get_by_text("导入一场比赛", exact=True).count() == 0
        assert px(page, ".pro-match-card .match-context strong") >= 15
        pro_search = page.get_by_role("textbox", name="搜索职业比赛")
        pro_search.fill("Geekay")
        page.locator(".status-tabs button").filter(has_text="已结束").click()
        assert page.locator(".pro-match-card").count() >= 1
        assert page.locator(".pro-team-fallback svg").count() >= 1
        page.locator(".status-tabs button").filter(has_text="全部").click()
        pro_search.fill("Mexico")
        assert page.locator(".pro-match-card").count() >= 1
        assert page.get_by_text("Mexico", exact=True).count() >= 1
        page.get_by_role("button", name="亚服账号查询", exact=True).click()
        assert page.get_by_role("heading", name="亚服账号查询", exact=True).is_visible()
        assert page.locator(".pro-match-card").count() == 0
        assert page.get_by_text("个人资料放在职业比赛之后", exact=False).count() == 0
        page.screenshot(path=str(ROOT / "tests" / "player-subnav.png"), full_page=False)
        page.get_by_role("button", name="职业赛程", exact=True).click()
        page.get_by_role("textbox", name="搜索职业比赛").fill("")
        assert page.locator(".pro-match-card").count() == 24
        page.locator(".pro-schedule").scroll_into_view_if_needed()
        page.screenshot(path=str(ROOT / "tests" / "esports-filters.png"), full_page=False)
        page.screenshot(path=str(ROOT / "tests" / "esports-desktop.png"), full_page=True)

        mobile = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=1)
        mobile.goto("http://127.0.0.1:4181", wait_until="networkidle")
        assert mobile.get_by_role("heading", name="秩序之光", exact=True).is_visible()
        mobile.get_by_role("button", name="打开菜单").click()
        assert mobile.locator("nav.open").is_visible()
        mobile.screenshot(path=str(ROOT / "tests" / "balance-mobile-readable.png"), full_page=False)

        assert not errors, f"Console errors: {errors}"
        browser.close()


if __name__ == "__main__":
    main()
