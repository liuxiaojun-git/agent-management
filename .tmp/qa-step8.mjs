// 第 8 步验收：全新会话刷新后，当前请求可见（沿途祖先自动展开）且高亮。
// 把首条请求故意埋在两层折叠的祖先下面——这正是「看着像数据丢了」的场景。
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
  const key = 'api-test-saved-requests:1'
  const seed = {
    collections: [{ name: 'QA集合', icon: '📁' }],
    folders: [
      { id: 'fA', name: 'A', collection: 'QA集合' },
      { id: 'fB', name: 'B', collection: 'QA集合', parent: 'A' },
    ],
    // 首条就是最深的那条：水合会把它装进编辑器，侧栏必须跟上。
    requests: [req('r2', 'AB层请求', 'A/B'), req('r0', '根层请求', null)],
    collapsedCollections: { 'QA集合': true },
    collapsedFolders: { fA: true, fB: true },
  }
  await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [key, seed])
  await page.goto('http://localhost:8081/api-test', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('button[aria-label="AB层请求操作"]', { timeout: 20000 })
  await page.waitForTimeout(1200)

  return await page.evaluate(() => {
    const panel = document.querySelectorAll('aside')[1]
    const trigger = panel.querySelector('button[aria-label="AB层请求操作"]')
    const row = trigger.closest('div[style*="padding-left"]')
    const stored = JSON.parse(localStorage.getItem('api-test-saved-requests:1'))
    const rows = [...panel.querySelectorAll('div[style*="padding-left"]')]
      .filter((d) => d.querySelector(':scope > span[draggable="true"]'))
      .map((d) => d.innerText.replace(/\s+/g, ' ').trim().slice(0, 30))
    return {
      highlighted: /ring-primary/.test(row.className),
      rowClass: row.className,
      indent: row.style.paddingLeft,
      rows,
      collapsedFolders: Object.keys(stored.collapsedFolders || {}),
      collectionsCollapsed: stored.collapsedCollections,
      editorUrl: document.querySelector('input[type="text"]')?.value ?? null,
      bodyHasRequestLabel: document.body.innerText.includes('AB层请求'),
    }
  })
}
