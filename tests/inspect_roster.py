from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch(headless=True)
 page=b.new_page(viewport={"width":1440,"height":1000})
 page.goto('http://127.0.0.1:4198',wait_until='networkidle')
 page.locator('.view-tab').nth(1).click(); page.get_by_role('button',name='选择英雄',exact=True).click()
 page.wait_for_timeout(5000)
 first=page.locator('.hero-avatar-card').first
 print('text',repr(first.inner_text()))
 print('html',first.inner_html()[:500])
 print('style',first.locator('b').evaluate('(e)=>({display:getComputedStyle(e).display,color:getComputedStyle(e).color,fontSize:getComputedStyle(e).fontSize,height:e.getBoundingClientRect().height,y:e.getBoundingClientRect().y})'))
 print('img',first.locator('img').evaluate('(e)=>({complete:e.complete,naturalWidth:e.naturalWidth,src:e.src})'))
 page.screenshot(path='tests/hero-roster-loaded.png')
 b.close()
