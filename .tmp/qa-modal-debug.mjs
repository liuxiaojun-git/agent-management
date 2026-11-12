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
      collections: [{ name: 'QA集合', icon: '📁' }],
      folders: [
        { id: 'f1', name: 'A', collection: 'QA集合' },
        { id: 'f2', name: 'B', collection: 'QA集合', parent: 'A' },
      ],
      requests: [], collapsedCollections: {}, collapsedFolders: {},
    }
    const k = Object.keys(localStorage).find((x) => x.startsWith('api-test-saved-requests:'))
      || 'api-test-saved-requests:1'
    localStorage.setItem(k, JSON.stringify(seed))
  })

  await page.goto('http://localhost:8081/api-test', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(5000)

  await page.getByText('新建 API 请求').first().click()
  await page.waitForTimeout(1500)
  await page.getByPlaceholder('https://api.example.com/v1/...').fill('https://example.com/deep')
  await page.locator('button', { hasText: /^保存$/ }).first().click()
  await page.waitForTimeout(2000)

  return await page.evaluate(() => {
    const selects = [...document.querySelectorAll('select')]
    return {
      selectCount: selects.length,
      selects: selects.map((s) => {
        const r = s.getBoundingClientRect()
        const cx = r.left + r.width / 2
        const cy = r.top + r.height / 2
        const top = document.elementFromPoint(cx, cy)
        return {
          options: [...s.options].map((o) => [o.value, o.textContent.trim()]),
          rect: { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) },
          disabled: s.disabled,
          elementAtCenter: top ? `${top.tagName}.${top.className}`.slice(0, 80) : null,
          isSelectItself: top === s,
        }
      }),
    }
  })
}
