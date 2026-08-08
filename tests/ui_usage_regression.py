from __future__ import annotations

from pathlib import Path

from playwright.sync_api import Page, TimeoutError as PlaywrightTimeoutError, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
BASE_URL = "http://127.0.0.1:4181"


def step(name: str) -> None:
    print(f"PASS  {name}")


def load(page: Page) -> None:
    page.set_default_timeout(30_000)
    page.goto(BASE_URL, wait_until="domcontentloaded", timeout=120_000)
    try:
        page.wait_for_load_state("networkidle", timeout=15_000)
    except PlaywrightTimeoutError:
        # Official portraits can keep a request open; app readiness is the stable UI shell.
        page.get_by_role("heading", name="秩序之光", exact=True).wait_for(state="visible")


def assert_active(page: Page, selector: str, text: str) -> None:
    locator = page.locator(selector).filter(has_text=text).first
    assert "active" in (locator.get_attribute("class") or ""), f"{text} 未进入选中状态"


def test_balance(page: Page) -> None:
    assert page.get_by_role("heading", name="秩序之光", exact=True).is_visible()
    assert page.get_by_role("button", name="英雄更新", exact=True).is_visible()
    step("主导航与默认英雄页")

    markers = page.locator(".overview-marker")
    initial_markers = markers.count()
    assert initial_markers > 20
    width_before = page.locator(".overview-chart").evaluate("node => node.getBoundingClientRect().width")
    page.get_by_role("button", name="放大全图", exact=True).click()
    page.wait_for_timeout(250)
    width_after = page.locator(".overview-chart").evaluate("node => node.getBoundingClientRect().width")
    assert width_after > width_before
    markers.first.click()
    assert page.locator(".overview-selected").is_visible()
    page.get_by_role("button", name="复位全图", exact=True).click()
    step("短全图缩放、标记下钻与复位")

    page.get_by_role("button", name="削弱", exact=True).click()
    assert page.locator(".overview-marker.nerf").count() == 0
    page.get_by_role("button", name="削弱", exact=True).click()
    assert page.locator(".overview-marker.nerf").count() > 0
    page.locator(".track-filter.perk").click()
    assert page.locator(".track-filter.perk").get_attribute("class").find("active") < 0
    page.locator(".track-filter.perk").click()
    step("改动类型和版本轨道筛选")

    page.get_by_role("button", name="长树图", exact=True).click()
    assert_active(page, ".history-view-selector button", "长树图")
    tree_count = page.locator("article.change-row").count()
    assert tree_count == initial_markers, f"长树图 {tree_count} 与短全图 {initial_markers} 数量不一致"
    first_date = page.locator("article.change-row .change-date").first.inner_text()
    page.locator(".sort-button").click()
    assert page.locator("article.change-row .change-date").first.inner_text() != first_date
    page.get_by_role("button", name="短全图", exact=True).click()
    step("短全图/长树图切换与时间排序")

    page.get_by_role("button", name="切换英雄，当前为秩序之光", exact=True).click()
    assert page.get_by_role("dialog").is_visible()
    search = page.get_by_role("textbox", name="搜索英雄")
    search.fill("安娜")
    assert page.locator(".hero-avatar-card").count() == 1
    page.locator(".hero-avatar-card").click()
    assert page.get_by_role("heading", name="安娜", exact=True).is_visible()
    page.get_by_role("button", name="切换英雄，当前为安娜", exact=True).click()
    page.get_by_role("button", name="输出", exact=True).click()
    assert page.locator(".hero-avatar-card").count() > 10
    assert page.locator(".hero-card-meta").filter(has_text="输出").count() == page.locator(".hero-avatar-card").count()
    page.get_by_role("button", name="关闭英雄选择", exact=True).click()
    step("英雄选择器搜索、角色筛选、选择与关闭")


def test_schedule(page: Page) -> None:
    page.get_by_role("button", name="职业比赛", exact=True).click()
    assert page.get_by_role("heading", name="职业赛事中心", exact=True).is_visible()
    assert page.locator(".owtv-match-card").count() == 24
    step("比赛中心导航与首屏卡片")

    page.locator(".owtv-view-switch button").filter(has_text="列表").click()
    assert "list" in (page.locator(".owtv-match-grid").get_attribute("class") or "")
    page.locator(".owtv-view-switch button").filter(has_text="卡片").click()
    assert "cards" in (page.locator(".owtv-match-grid").get_attribute("class") or "")

    page.locator(".owtv-status-tabs button").filter(has_text="比赛结果").click()
    assert page.locator(".owtv-match-card").count() > 0
    assert page.locator(".owtv-match-card .completed").count() > 0
    page.locator(".owtv-region-tabs button").filter(has_text="中国").click()
    region_result_count = int(page.locator(".owtv-result-count").inner_text().splitlines()[0])
    assert region_result_count > 0
    page.get_by_role("textbox", name="搜索职业比赛").fill("Weibo")
    filtered_count = int(page.locator(".owtv-result-count").inner_text().splitlines()[0])
    assert 0 < filtered_count <= region_result_count
    page.get_by_role("textbox", name="搜索职业比赛").fill("绝对不存在的战队XYZ")
    assert page.locator(".pro-empty").is_visible()
    page.get_by_role("textbox", name="搜索职业比赛").fill("")
    step("比赛视图、状态、赛区与关键词筛选")

    card = page.locator(".owtv-match-card").first
    matchup = card.get_attribute("aria-label")
    card.click()
    page.locator("#owtv-match-detail").wait_for(state="visible")
    assert page.locator(".owtv-detail-scoreboard").is_visible()
    assert page.locator(".owtv-result-record, .owtv-map-summary").count() >= 1
    page.locator(".owtv-detail-back").click()
    assert page.locator("#owtv-match-detail").count() == 0
    assert page.locator(".owtv-match-card").count() > 0
    step(f"比赛详情进入/返回（{matchup}）")


def choose_sidebar_item(page: Page, query: str, expected: str) -> None:
    search = page.locator(".draft-index input")
    search.fill(query)
    item = page.locator(".draft-index button").filter(has_text=expected).first
    assert item.is_visible(), f"侧栏找不到 {expected}"
    item.click()


def test_analytics(page: Page) -> None:
    page.locator(".match-subnav button").filter(has_text="战队").click()
    assert page.get_by_role("heading", name="战队战术档案", exact=True).is_visible()
    choose_sidebar_item(page, "Weibo", "Weibo Gaming")
    assert page.locator(".draft-detail-title h3").inner_text() == "Weibo Gaming"
    usage_button = page.locator(".draft-usage-row").first
    if usage_button.count():
        usage_button.click()
    else:
        page.locator(".draft-kpi-grid button").first.click()
    assert page.locator(".team-hero-match-detail").is_visible()
    page.locator(".team-hero-match-detail button[aria-label='关闭']").click()
    assert page.locator(".team-hero-match-detail").count() == 0
    step("战队搜索、选择、英雄比赛下钻与关闭")

    roster_player = page.locator(".draft-roster-list button").first
    assert roster_player.is_visible()
    roster_player.click()
    assert page.get_by_role("heading", name="选手英雄池", exact=True).is_visible()
    assert page.locator(".five-player").is_visible()
    page.locator(".five-player-tabs button").filter(has_text="数据").click()
    assert page.locator(".five-data-tab").is_visible()
    page.locator(".five-player-tabs button").filter(has_text="赛程").click()
    assert page.locator(".five-schedule-tab").is_visible()
    page.locator(".five-player-tabs button").filter(has_text="基础信息").click()
    step("战队到选手下钻及选手页签")

    page.locator(".match-subnav button").filter(has_text="选手").click()
    choose_sidebar_item(page, "Guxue", "Guxue")
    assert page.locator(".five-player-id h3").inner_text().lower() == "guxue"
    hero_buttons = page.locator(".five-event-heroes button") if page.locator(".five-event-heroes button").count() else page.locator(".five-hero-pool button")
    assert hero_buttons.count() > 0
    hero_buttons.first.click()
    assert page.get_by_role("heading", name="英雄职业赛场使用", exact=True).is_visible()
    assert page.locator(".hero-scout-grid").is_visible()
    page.locator(".hero-scout-grid .scout-rank").first.click()
    assert page.get_by_role("heading", name="战队战术档案", exact=True).is_visible()
    step("选手搜索、英雄池下钻、英雄到战队下钻")

    page.locator(".match-subnav button").filter(has_text="英雄").click()
    choose_sidebar_item(page, "秩序之光", "秩序之光")
    assert page.locator(".draft-match-usage").is_visible()
    assert page.locator(".draft-match-usage article").count() > 0
    step("英雄搜索与比赛记录")


def test_mobile(browser) -> None:
    page = browser.new_page(viewport={"width": 390, "height": 844})
    load(page)
    page.get_by_role("button", name="打开菜单", exact=True).click()
    assert page.locator("nav.open").is_visible()
    page.get_by_role("button", name="职业比赛", exact=True).click()
    assert page.get_by_role("heading", name="职业赛事中心", exact=True).is_visible()
    assert page.locator(".owtv-match-card").first.is_visible()
    page.close()
    step("移动端菜单与比赛导航")


def main() -> None:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1500, "height": 980})
        console_errors: list[str] = []
        page_errors: list[str] = []
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        load(page)
        try:
            test_balance(page)
            test_schedule(page)
            test_analytics(page)
            test_mobile(browser)
        except (AssertionError, PlaywrightTimeoutError):
            page.screenshot(path=str(ROOT / "tests" / "ui-usage-failure.png"), full_page=True)
            raise
        assert not console_errors, f"Console errors: {console_errors}"
        assert not page_errors, f"Page errors: {page_errors}"
        browser.close()
        step("console/page error 检查")


if __name__ == "__main__":
    main()
