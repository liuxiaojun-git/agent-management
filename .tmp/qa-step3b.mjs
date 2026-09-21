// 专测 revealPath：首条请求埋在 3 层折叠的祖先里，水合后应当沿途全部展开。
export default async function run(page, ui) {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('http://localhost:8081/login', { waitUntil: 'domcontentloaded' })
  const acct = page.getByPlaceholder('请输入账号')
  await acct.waitFor({ state: 'visible', timeout: 20000 })
  await acct.fill('admin')
  await page.getByPlaceholder('请输入密码').fill('admin@123')
  await page.getByRole('button', { name: '登录' }).first().click()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 })
  await page.route('**/api/data', (route) => route.abort())

  const req = (id, label, parent) => ({
    id, label, method: 'GET', url: `https://example.com/${id}`,
    headers: [], body: '', collection: 'QA集合', savedAt: '2026/01/01 00:00:00',
    ...(parent ? { parent } : {}),
  })
  // 关键：首条请求是埋得最深的那条，且三个祖先全处于折叠态。
  const seed = {
    collections: [{ name: 'QA集合', icon: '📁' }],
    folders: [
      { id: 'f1', name: 'A', collection: 'QA集合' },
      { id: 'f2', name: 'B', collection: 'QA集合', parent: 'A' },
      { id: 'f3', name: 'C', collection: 'QA集合', parent: 'A/B' },
    ],
    requests: [req('r3', 'ABC层请求', 'A/B/C'), req('r0', '根层请求', null)],
    collapsedCollections: {},
    collapsedFolders: { f1: true, f2: true, f3: true },
  }

  const key = await page.evaluate((store) => {
    const k = Object.keys(localStorage).find((x) => x.startsWith('api-test-saved-requests:'))
      || 'api-test-saved-requests:1'
    localStorage.setItem(k, JSON.stringify(store))
    return k
  }, seed)

  await page.goto('http://localhost:8081/api-test', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000)

  const panel = page.locator('aside').nth(1)
  const rows = await panel.evaluate((el) => {
    const out = []
    for (const d of el.querySelectorAll('div[style*="padding-left"]')) {
      const t = d.innerText.replace(/\s+/g, ' ').trim()
      if (!t || out.some((o) => o.text.includes(t))) continue
      out.push({ indent: d.style.paddingLeft, text: t })
    }
    return out
  })
  const collapsed = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).collapsedFolders, key)
  // 被自动选中的那条高亮了吗
  const highlighted = await panel.evaluate((el) => {
    const on = [...el.querySelectorAll('div')].filter((d) => d.className.includes('ring-primary/20'))
    return on.map((d) => d.innerText.replace(/\s+/g, ' ').trim())
  })

  return { rows, collapsedFoldersAfterHydration: collapsed, highlighted }
}
