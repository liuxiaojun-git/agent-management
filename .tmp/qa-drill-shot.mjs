// 只为看清两栏顶部：header（返回 / 层名 / +）、面包屑、行。
export default async function run(page, ui) {
  await page.setViewportSize({ width: 1680, height: 1000 })
  await page.goto('http://localhost:8081/login', { waitUntil: 'domcontentloaded' })
  const acct = page.getByPlaceholder('请输入账号')
  await acct.waitFor({ state: 'visible', timeout: 20000 })
  await acct.fill('admin')
  await page.getByPlaceholder('请输入密码').fill('admin@123')
  await page.getByRole('button', { name: '登录' }).first().click()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 })
  await page.route('**/api/data', (route) => route.abort())

  const seed = {
    collections: [{ name: 'QA集合', icon: '📁' }, { name: '另一个集合', icon: '📦' }],
    folders: [
      { id: 'fA', name: 'A', collection: 'QA集合' },
      { id: 'fB', name: 'B', collection: 'QA集合', parent: 'A' },
    ],
    requests: [
      { id: 'r0', label: '根层请求', method: 'GET', url: 'https://example.com/0', headers: [], body: '', collection: 'QA集合', savedAt: '2026/01/01 00:00:00' },
      { id: 'r1', label: 'A层请求', method: 'POST', url: 'https://example.com/1', headers: [], body: '', collection: 'QA集合', parent: 'A', savedAt: '2026/01/01 00:00:00' },
    ],
  }
  const key = await page.evaluate(() => Object.keys(localStorage)
    .find((k) => k.startsWith('api-test-saved-requests:')) || 'api-test-saved-requests:1')
  await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [key, seed])
  await page.goto('http://localhost:8081/api-test', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('button[aria-label="A操作"]', { timeout: 20000 })
  await page.waitForTimeout(700)

  // 打开右栏的「+」菜单，把菜单也拍进去。
  await page.evaluate(() => {
    const sidebars = document.querySelectorAll('aside')
    const sidebar = sidebars[sidebars.length - 1]
    sidebar.children[sidebar.children.length - 1]
      .querySelector('button[aria-label="新建"]').click()
  })
  await page.waitForTimeout(350)

  const box = await page.evaluate(() => {
    const sidebars = document.querySelectorAll('aside')
    const r = sidebars[sidebars.length - 1].getBoundingClientRect()
    return { x: Math.max(0, r.left - 4), y: Math.max(0, r.top - 4), width: r.width + 8, height: 380 }
  })
  await page.screenshot({ path: '.tmp/drill-head.png', clip: box })
  return { clip: box }
}
