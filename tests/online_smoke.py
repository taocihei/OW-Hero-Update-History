from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    page=browser.new_page(viewport={"width":1440,"height":1000})
    errors=[]
    page.on("console", lambda m: errors.append(m.text) if m.type=="error" else None)
    page.goto("http://127.0.0.1:4195",wait_until="networkidle")
    page.locator(".career-query input").fill("TeKrop#2217")
    page.locator(".career-query button").click()
    page.locator(".online-intel").wait_for(timeout=30000)
    assert page.locator(".intel-identity h3").inner_text()=="TeKrop"
    print(page.locator(".intel-ranks").inner_html())
    assert not errors, errors
    browser.close()


