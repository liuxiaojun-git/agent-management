// 只查「移进自身子树」：对文件夹 A 打开移动到，右栏里属于 A 子树的条目应被置灰。
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

  await page.evaluate(() => {
    const seed = {
      collections: [{ name: 'QA集合', icon: '📁' }, { name: '别的集合', icon: '📁' }],
      folders: [
        { id: 'f1', name: 'A', collection: 'QA集合' },
        { id: 'f2', name: 'B', collection: 'QA集合', parent: 'A' },
        { id: 'fx', name: 'X', collection: '别的集合' },
      ],
      requests: [], collapsedCollections: {}, collapsedFolders: {},
    }
    const k = Object.keys(localStorage).find((x) => x.startsWith('api-test-saved-requests:')) || 'api-test-saved-requests:1'
    localStorage.setItem(k, JSON.stringify(seed))
  })

  await page.goto('http://localhost:8081/api-test', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(5000)

  await page.getByRole('button', { name: 'A操作' }).first().click()
  await page.waitForTimeout(700)
  await page.getByRole('menuitem', { name: '移动到', exact: true }).first().click()
  await page.waitForTimeout(900)

  // 右栏每一行是一个 button，读出它的文本、是否 disabled、以及 confirms 时的拦截。
  const dlg = page.locator('div.fixed.inset-0').last()
  const rightRows = await dlg.locator('div.overflow-y-auto button').evaluateAll((els) =>
    els.map((e) => ({ text: e.innerText.trim(), disabled: e.disabled })),
  )

  // 再验确认时的守卫：走进 B（若按钮可用）后确认按钮的状态
  const bBtn = dlg.locator('div.overflow-y-auto button', { hasText: 'B' }).first()
  let afterAttempt = null
  if (await bBtn.count()) {
    await bBtn.click({ force: true }).catch(() => {})
    await page.waitForTimeout(800)
    const confirm = dlg.locator('button', { hasText: /^(移动|当前位置)$/ })
    afterAttempt = {
      targetLine: (await dlg.locator('div.bg-base-200\/50').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim(),
      confirmLabel: (await confirm.innerText()).trim(),
      confirmDisabled: await confirm.isDisabled(),
    }
  }

  return { rightRows, afterAttempt }
}
