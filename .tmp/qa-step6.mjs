// 第 6 步验收：移动到弹窗。原地、移进自身子树、重名三条规则，以及跨集合同步搬整棵子树。
export default async function run(page, ui) {
  const log = {}
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('http://localhost:8081/login', { waitUntil: 'domcontentloaded' })
  const acct = page.getByPlaceholder('请输入账号')
  await acct.waitFor({ state: 'visible', timeout: 20000 })
  await acct.fill('admin')
  await page.getByPlaceholder('请输入密码').fill('admin@123')
  await page.getByRole('button', { name: '登录' }).first().click()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 })
  await page.route('**/api/data', (route) => route.abort())

  const seed = {
    collections: [{ name: 'QA集合', icon: '📁' }, { name: '别的集合', icon: '📁' }],
    folders: [
      { id: 'f1', name: 'A', collection: 'QA集合' },
      { id: 'f2', name: 'B', collection: 'QA集合', parent: 'A' },
      { id: 'f3', name: 'C', collection: 'QA集合', parent: 'A/B' },
      { id: 'fx', name: 'X', collection: '别的集合' },
    ],
    requests: [
      { id: 'r1', label: 'A层', method: 'GET', url: 'https://e.com/1', headers: [], body: '', collection: 'QA集合', parent: 'A', savedAt: 'x' },
      { id: 'r2', label: 'AB层', method: 'GET', url: 'https://e.com/2', headers: [], body: '', collection: 'QA集合', parent: 'A/B', savedAt: 'x' },
      { id: 'r3', label: 'X', method: 'GET', url: 'https://e.com/3', headers: [], body: '', collection: 'QA集合', savedAt: 'x' },
    ],
    collapsedCollections: {}, collapsedFolders: {},
  }
  await page.evaluate((s) => {
    const k = Object.keys(localStorage).find((x) => x.startsWith('api-test-saved-requests:')) || 'api-test-saved-requests:1'
    localStorage.setItem(k, JSON.stringify(s))
  }, seed)
  const reload = async () => {
    await page.goto('http://localhost:8081/api-test', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(4500)
  }
  const readStore = () => page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith('api-test-saved-requests:')) || 'api-test-saved-requests:1'
    return JSON.parse(localStorage.getItem(k))
  })
  const dlg = () => page.locator('div.fixed.inset-0').last()
  const openMove = async (menuLabel) => {
    await page.getByRole('button', { name: menuLabel }).first().click()
    await page.waitForTimeout(700)
    await page.getByRole('menuitem', { name: '移动到', exact: true }).first().click()
    await page.waitForTimeout(900)
  }
  const confirmBtn = () => dlg().locator('button', { hasText: /^(移动|当前位置)$/ })
  const snapshotDialog = async () => ({
    target: (await dlg().locator('div.bg-base-200\/50').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim(),
    confirmLabel: (await confirmBtn().innerText()).trim(),
    confirmDisabled: await confirmBtn().isDisabled(),
    breadcrumb: (await dlg().locator('button').allInnerTexts()).slice(0, 6),
  })

  await reload()

  // --- 1) 原地：按钮应显示「当前位置」且禁用 ---
  await openMove('A层操作')
  log.samePlace = await snapshotDialog()
  await dlg().locator('button', { hasText: '取消' }).click()
  await page.waitForTimeout(600)

  // --- 2) 重名：QA 根层的请求 X 移到「别的集合」根层，那里已有文件夹 X ---
  await openMove('X操作')
  await dlg().locator('button', { hasText: /别的集合/ }).first().click()
  await page.waitForTimeout(700)
  log.duplicate = await snapshotDialog()
  await dlg().locator('button', { hasText: '取消' }).click()
  await page.waitForTimeout(600)

  // --- 3) 移进自身子树：对文件夹 A 打开，右栏里 B 应被置灰 ---
  await openMove('A操作')
  log.intoSelf = {
    childB: await dlg().locator('button', { hasText: /^B$/ }).first().isDisabled().catch(() => null),
    childX: await dlg().locator('button', { hasText: /^X$/ }).first().isDisabled().catch(() => null),
  }
  await dlg().locator('button', { hasText: '取消' }).click()
  await page.waitForTimeout(600)

  // --- 4) 跨集合移动文件夹 A：整棵子树跟着走 ---
  await openMove('A操作')
  await dlg().locator('button', { hasText: /别的集合/ }).first().click()
  await page.waitForTimeout(700)
  log.beforeFolderMove = await snapshotDialog()
  await confirmBtn().click()
  await page.waitForTimeout(1800)
  const afterFolder = await readStore()
  log.afterFolderMove = {
    folders: afterFolder.folders.map((f) => `${f.name}@${f.collection}@${f.parent ?? '-'}`),
    requests: afterFolder.requests.map((r) => `${r.label}@${r.collection}@${r.parent ?? '-'}`),
  }

  // --- 5) 移走之后回读渲染，源集合不该留下孤儿 ---
  await reload()
  log.rowsAfterMove = await page.locator('aside').nth(1).evaluate((el) => {
    const out = []
    for (const d of el.querySelectorAll('div[style*="padding-left"]')) {
      const t = d.innerText.replace(/\s+/g, ' ').trim()
      if (!t || out.some((o) => o.text.includes(t))) continue
      out.push({ indent: d.style.paddingLeft, text: t })
    }
    return out
  })

  return log
}
