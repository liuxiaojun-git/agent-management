// 第 4 步验收：把一条请求存进深层文件夹 → 刷新后还在那个文件夹里。
// 拦掉 /api/data，只走 localStorage，不碰用户的真实库（后端往返已在第 2 步验过）。
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

  const key = await page.evaluate(() => {
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
    return k
  })

  await page.goto('http://localhost:8081/api-test', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(5000)

  // 空库进的是欢迎页，得先点「新建 API 请求」才会出现编辑器
  if (await page.getByText('新建 API 请求').count()) {
    await page.getByText('新建 API 请求').first().click()
    await page.waitForTimeout(1500)
  }

  // 打开保存弹窗
  await page.getByPlaceholder('https://api.example.com/v1/...').fill('https://example.com/deep')
  await page.locator('button', { hasText: /^保存$/ }).first().click()
  await page.waitForTimeout(1500)

  const selects = page.locator('select')
  const options = []
  for (let i = 0; i < await selects.count(); i++) {
    const values = await selects.nth(i).locator('option').evaluateAll((os) => os.map((o) => [o.value, o.textContent.trim()]))
    options.push({ index: i, values })
  }
  // 页面上有三个 select：0=HTTP 方法（在弹窗背板后面）、1=保存合集、2=保存到文件夹
  const folderSelect = selects.nth(2)
  const selected = await folderSelect.inputValue()

  // 按 value（路径本身）选，比按 label 稳
  await folderSelect.selectOption('A/B')
  await page.waitForTimeout(600)
  const labelInput = page.getByPlaceholder('输入请求名称...')
  await labelInput.fill('深层请求')
  await page.waitForTimeout(400)

  await page.locator('button', { hasText: /^保存$/ }).last().click()
  await page.waitForTimeout(2000)

  const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key)

  // 刷新后还在不在那个文件夹里
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

  return {
    folderOptions: options,
    preselectedFolder: selected,
    savedRequest: stored.requests[0] ? {
      label: stored.requests[0].label,
      collection: stored.requests[0].collection,
      parent: stored.requests[0].parent,
    } : null,
    rowsAfterReload: rows,
  }
}
