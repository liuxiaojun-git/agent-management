// 把「接口信息」面板的渲染结果抓成可 diff 的结构：整段文本 + 每行的文本和位置。
export default async function run(page, ui) {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('http://localhost:8081/login', { waitUntil: 'domcontentloaded' })
  const acct = page.getByPlaceholder('请输入账号')
  await acct.waitFor({ state: 'visible', timeout: 20000 })
  await acct.fill('admin')
  await page.getByPlaceholder('请输入密码').fill('admin@123')
  await page.getByRole('button', { name: '登录' }).first().click()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 })

  const sets = []
  page.on('request', (req) => {
    if (!req.url().includes('/api/data')) return
    try { const b = req.postDataJSON(); if (b?.action === 'set') sets.push(Object.keys(b)) } catch {}
  })

  await page.goto('http://localhost:8081/api-test', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(8000)

  const panel = page.locator('aside').nth(1)
  await panel.waitFor({ state: 'visible', timeout: 20000 })

  const rows = await panel.evaluate((el) => {
    // 侧栏每一行都是带 paddingLeft 的容器；连文本和盒子一起抓，缩进/间距变了也能看出来。
    return [...el.querySelectorAll('div')]
      .filter((d) => d.style && d.style.paddingLeft && d.innerText.trim())
      .map((d) => {
        const r = d.getBoundingClientRect()
        return { pad: d.style.paddingLeft, x: Math.round(r.x), y: Math.round(r.y), t: d.innerText.replace(/\s+/g, ' ').trim() }
      })
  })

  const stored = await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith('api-test-saved-requests:'))
    return { key: k, raw: k ? localStorage.getItem(k) : null }
  })
  const parsed = stored.raw ? JSON.parse(stored.raw) : null

  return {
    panelText: (await panel.innerText()).replace(/\s+/g, ' ').trim(),
    rows,
    storedKeys: parsed ? Object.keys(parsed) : null,
    collectionCount: parsed?.collections?.length,
    requestCount: parsed?.requests?.length,
    folders: parsed?.folders,
    collapsedFolders: parsed?.collapsedFolders,
    hasParentOnFirst: parsed?.requests?.[0] ? 'parent' in parsed.requests[0] : null,
    setBodyKeys: sets.length ? sets[sets.length - 1] : null,
  }
}
