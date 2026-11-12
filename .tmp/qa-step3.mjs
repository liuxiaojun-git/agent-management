// 第 3 步验收：手写一棵 3 层深的树，看它渲染成嵌套结构；折叠状态刷新后保持；
// 自动选中的首条请求若在折叠的祖先里会被自动展开。
//
// 把 GET /api/data 拦掉，让水合回落到 localStorage——这样造数据不必写进用户的真实库。
export default async function run(page, ui) {
  await page.setViewportSize({ width: 1600, height: 1000 })

  await page.goto('http://localhost:8081/login', { waitUntil: 'domcontentloaded' })
  const acct = page.getByPlaceholder('请输入账号')
  await acct.waitFor({ state: 'visible', timeout: 20000 })
  await acct.fill('admin')
  await page.getByPlaceholder('请输入密码').fill('admin@123')
  await page.getByRole('button', { name: '登录' }).first().click()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 })

  // 登录之后才拦：登录本身要走后端。
  await page.route('**/api/data', (route) => route.abort())

  const req = (id, label, parent) => ({
    id, label, method: 'GET', url: `https://example.com/${id}`,
    headers: [], body: '', collection: 'QA集合', savedAt: '2026/01/01 00:00:00',
    ...(parent ? { parent } : {}),
  })
  const seed = {
    collections: [{ name: 'QA集合', icon: '📁' }],
    folders: [
      { id: 'f1', name: 'A', collection: 'QA集合' },
      { id: 'f2', name: 'B', collection: 'QA集合', parent: 'A' },
      { id: 'f3', name: 'C', collection: 'QA集合', parent: 'A/B' },
    ],
    requests: [
      req('r0', '根层请求', null),
      req('r1', 'A层请求', 'A'),
      req('r2', 'AB层请求', 'A/B'),
      req('r3', 'ABC层请求', 'A/B/C'),
    ],
    collapsedCollections: {},
    collapsedFolders: {},
  }

  const readRows = async () => {
    const panel = page.locator('aside').nth(1)
    return panel.evaluate((el) => {
      const out = []
      for (const d of el.querySelectorAll('div[style*="padding-left"]')) {
        const t = d.innerText.replace(/\s+/g, ' ').trim()
        if (!t) continue
        // 只取最内层那一行，父容器会把子行文本也带上
        if (out.some((o) => o.text.includes(t))) continue
        out.push({ indent: d.style.paddingLeft, text: t })
      }
      return out
    })
  }

  // --- 1) 渲染成嵌套结构 ---
  const writeSeed = (collapsedFolders = {}) => page.evaluate(
    ([store, collapsed]) => {
      const key = Object.keys(localStorage).find((k) => k.startsWith('api-test-saved-requests:'))
        || 'api-test-saved-requests:1'
      localStorage.setItem(key, JSON.stringify({ ...store, collapsedFolders: collapsed }))
      return key
    },
    [seed, collapsedFolders],
  )

  const storageKey = await writeSeed()
  await page.goto('http://localhost:8081/api-test', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(5000)
  const expanded = await readRows()

  // --- 2) 折叠 B，看子层是否收起 ---
  const panel = page.locator('aside').nth(1)
  await panel.getByText('B', { exact: true }).first().click()
  await page.waitForTimeout(1200)
  const collapsedB = await readRows()

  // 折叠状态写回了 localStorage 吗
  const persistedCollapse = await page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw).collapsedFolders : null
  }, storageKey)

  // --- 3) 折叠 A 和 B 后刷新，首条请求应触发自动展开 ---
  await writeSeed({ f1: true, f2: true, f3: true })
  await page.goto('http://localhost:8081/api-test', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(5000)
  const afterReload = await readRows()
  const collapsedAfter = await page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw).collapsedFolders : null
  }, storageKey)

  return {
    expanded: { rows: expanded },
    collapsedB: { rows: collapsedB },
    persistedCollapse,
    afterReload: { rows: afterReload, collapsedFolders: collapsedAfter },
  }
}
