// 第 1 步验收：应用照常加载；现有请求渲染与改动前一致；
// localStorage 多出 folders / collapsedFolders；set 请求体带 folders: []。
export default async function run(page, ui) {
  await page.setViewportSize({ width: 1600, height: 1000 })

  // 先登录。原来这里只等 1000ms 就去找输入框，而页面那时还停在「加载中…」，
  // count() 得 0 → 整个脚本静默地以未登录状态跑完，后面全是废数据。
  // 改成显式等元素可见。
  await page.goto('http://localhost:8081/login', { waitUntil: 'domcontentloaded' })
  const account = page.getByPlaceholder('请输入账号')
  await account.waitFor({ state: 'visible', timeout: 20000 })
  await account.fill('admin')
  await page.getByPlaceholder('请输入密码').fill('admin@123')
  await page.getByRole('button', { name: '登录' }).first().click()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 })

  // 抓 /api/data 的 set 请求体，用来确认持久化载荷里有 folders。
  const setBodies = []
  page.on('request', (req) => {
    if (!req.url().includes('/api/data')) return
    try {
      const body = req.postDataJSON()
      if (body?.action === 'set') setBodies.push(body)
    } catch {
      /* 非 JSON 载荷忽略 */
    }
  })

  await page.goto('http://localhost:8081/api-test', { waitUntil: 'domcontentloaded' })
  // 等侧栏真的画出请求行，而不是等固定时长——慢了会被误判成「渲染不出来」。
  await page.locator('aside').first().waitFor({ state: 'visible', timeout: 20000 })
  await page.waitForTimeout(6000)

  const aside = page.locator('aside').first()
  const asideText = await aside.innerText()

  const stored = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('api-test-saved-requests:'))
    return { key, raw: key ? localStorage.getItem(key) : null }
  })
  const parsed = stored.raw ? JSON.parse(stored.raw) : null

  return {
    userScopeKey: stored.key,
    storedKeys: parsed ? Object.keys(parsed) : null,
    collectionCount: parsed?.collections?.length,
    requestCount: parsed?.requests?.length,
    folders: parsed?.folders,
    collapsedFolders: parsed?.collapsedFolders,
    hasParentOnFirst: parsed?.requests?.[0] ? 'parent' in parsed.requests[0] : null,
    // 侧栏渲染出来的东西
    asideText: asideText.slice(0, 500),
    requestRowCount: await aside.getByRole('button', { name: /操作$/ }).count(),
    // 持久化载荷里有没有 folders
    setBodyKeys: setBodies.length ? Object.keys(setBodies[setBodies.length - 1]) : null,
    setBodyFolders: setBodies.length ? setBodies[setBodies.length - 1].folders : null,
    setBodyCount: setBodies.length,
  }
}
