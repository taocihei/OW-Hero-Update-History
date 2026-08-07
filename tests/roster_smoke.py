from pathlib import Path
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(headless=True)
    page=b.new_page(viewport={"width":1440,"height":1000})
    page.goto('http://127.0.0.1:4199',wait_until='networkidle')
    page.locator('.view-tab').nth(1).click()
    page.get_by_role('button',name='选择英雄',exact=True).click()
    page.screenshot(path=str(Path(__file__).parent/'hero-roster.png'))
    b.close()

