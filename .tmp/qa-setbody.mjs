// 触发一次写盘（折叠一个集合），确认持久化载荷里带 folders / collapsedFolders。
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
    try {
      const b = req.postDataJSON()
      if (b?.action === 'set') sets.push(b)
    } catch {}
  })

  await page.goto('http://localhost:8081/api-test', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000)

  const panel = page.locator('aside').nth(1)
  const localBefore = await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith('api-test-saved-requests:'))
    return k ? { key: k, keys: Object.keys(JSON.parse(localStorage.getItem(k))) } : null
  })

  // 点集合名折叠，触发 updateStore
  await panel.getByText('Qingzhou-158', { exact: false }).first().click()
  await page.waitForTimeout(2500)

  const last = sets.length ? sets[sets.length - 1] : null
  return {
    localBefore,
    setCount: sets.length,
    setBodyKeys: last ? Object.keys(last) : null, dataKeys: last ? Object.keys(last.data) : null,
    setBodyFolders: last ? last.data.folders : undefined,
    setBodyCollapsedFolders: last ? last.data.collapsedFolders : undefined,
    setBodyCollections: last ? last.data.collections?.length : undefined,
    setBodyRequests: last ? last.data.requests?.length : undefined,
    setBodyFirstRequestKeys: last?.requests?.[0] ? Object.keys(last.requests[0]) : null,
  }
}
