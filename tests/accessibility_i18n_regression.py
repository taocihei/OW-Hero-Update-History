from pathlib import Path
from playwright.sync_api import sync_playwright

BASE_URL = "http://127.0.0.1:4181"
OUT = Path("artifacts/accessibility-i18n")
OUT.mkdir(parents=True, exist_ok=True)


def visible_audit(page):
    return page.evaluate("""() => {
      const visible = e => { const r=e.getBoundingClientRect(); const s=getComputedStyle(e); return r.width>0 && r.height>0 && s.visibility!=='hidden' && s.display!=='none'; };
      return {
        unnamed: [...document.querySelectorAll('button,a,input,select,textarea,[role="button"]')]
          .filter(visible).filter(e => !((e.getAttribute('aria-label') || e.getAttribute('title') || e.innerText || e.value || '').trim()))
          .map(e => e.outerHTML.slice(0, 180)),
        tiny: [...document.querySelectorAll('body *')].filter(visible)
          .filter(e => (e.innerText || '').trim() && parseFloat(getComputedStyle(e).fontSize) < 12)
          .map(e => ({ tag:e.tagName, cls:e.className, text:(e.innerText||'').trim().slice(0,60), size:getComputedStyle(e).fontSize })),
        badFonts: [...document.querySelectorAll('body *')].filter(visible)
          .filter(e => !getComputedStyle(e).fontFamily.includes('Microsoft YaHei'))
          .map(e => ({ tag:e.tagName, cls:e.className, font:getComputedStyle(e).fontFamily })).slice(0,20),
        viewportOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      };
    }""")


def run_viewport(browser, width, height):
    page = browser.new_page(viewport={"width": width, "height": height})
    page.add_init_script("localStorage.setItem('balance-atlas:language','zh')")
    page.goto(BASE_URL, wait_until="domcontentloaded", timeout=30_000)
    page.wait_for_timeout(4_000)
    assert page.locator("html").get_attribute("lang") == "zh-CN"
    zh = visible_audit(page)
    assert not zh["unnamed"], zh["unnamed"]
    assert not zh["tiny"], zh["tiny"]
    assert not zh["badFonts"], zh["badFonts"]
    assert not zh["viewportOverflow"]
    page.screenshot(path=str(OUT / f"balance-zh-{width}x{height}.png"), full_page=False)

    page.locator(".language-toggle").click()
    page.wait_for_timeout(500)
    assert page.locator("html").get_attribute("lang") == "en"
    assert page.title() == "OW Hero Update History"
    page.get_by_role("button", name="Pro Matches").click()
    page.wait_for_timeout(4_000)
    text = page.locator("body").inner_text()
    for label in ["Professional Match Center", "Schedule", "Teams", "Players", "Heroes", "Matches", "All regions"]:
        assert label in text, label
    for stale in ["??????", "????", "????", "????", "???????"]:
        assert stale not in text, stale
    en = visible_audit(page)
    assert not en["unnamed"], en["unnamed"]
    assert not en["tiny"], en["tiny"]
    assert not en["badFonts"], en["badFonts"]
    assert not en["viewportOverflow"]

    page.keyboard.press("Tab")
    focus = page.evaluate("""() => { const e=document.activeElement; const s=getComputedStyle(e); return {tag:e?.tagName, name:e?.getAttribute('aria-label')||e?.innerText, outline:s.outlineStyle, width:s.outlineWidth}; }""")
    assert focus["tag"] in ("A", "BUTTON", "INPUT", "SELECT"), focus
    assert focus["outline"] != "none" and focus["width"] != "0px", focus
    page.screenshot(path=str(OUT / f"matches-en-{width}x{height}.png"), full_page=False)
    page.close()


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for viewport in [(1366, 768), (1920, 1080)]:
            run_viewport(browser, *viewport)
        browser.close()
    print("accessibility/i18n regression: PASS")


if __name__ == "__main__":
    main()
