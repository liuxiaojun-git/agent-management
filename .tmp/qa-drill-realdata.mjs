// 真实数据回归：用用户库里的真数据渲染新的两栏侧栏，逐层比对渲染结果。
//
// 读写都走 POST /api/data，靠 body 里的 action 区分。这里只 abort action==='set'，
// 读照常放行——于是页面水合的是真数据，而一个字都写不回去。
// 库里是真实数据，保存又是 replace-all，所以这条边界必须守住。
export default async function run(page, ui) {
  await page.setViewportSize({ width: 1680, height: 1000 })

  await page.goto('http://localhost:8081/login', { waitUntil: 'domcontentloaded' })
  const acct = page.getByPlaceholder('请输入账号')
  await acct.waitFor({ state: 'visible', timeout: 20000 })
  await acct.fill('admin')
  await page.getByPlaceholder('请输入密码').fill('admin@123')
  await page.getByRole('button', { name: '登录' }).first().click()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 })

  let blockedWrites = 0
  let allowedReads = 0
  await page.route('**/api/data', (route) => {
    let action = null
    try { action = JSON.parse(route.request().postData() || '{}').action } catch { /* 非 JSON 一律放行 */ }
    if (action === 'set') { blockedWrites++; return route.abort() }
    allowedReads++
    return route.continue()
  })

  await page.goto('http://localhost:8081/api-test', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)

  // 直接问后端要一份真数据，不依赖页面状态。
  const store = await page.evaluate(async () => {
    const token = localStorage.getItem('access_token')
    const res = await fetch('http://localhost:3000/api/data', {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ action: 'get', name: 'api-test-saved-requests' }),
    })
    const json = await res.json()
    return json.data
  })

  if (!store || !Array.isArray(store.requests)) {
    return { error: '拿不到真实数据', store }
  }

  const norm = (p) => p || null
  const childFolders = (collection, parent) =>
    (store.folders || []).filter((f) => f.collection === collection && norm(f.parent) === parent)
  const childRequests = (collection, parent) =>
    store.requests.filter((r) => r.collection === collection && norm(r.parent) === parent)

  // 右栏当前层的行标签（文件夹在前、请求在后），和上面两个函数同序。
  // 靠 DOM 结构分类，不靠名字——请求和文件夹可以重名，按名字过滤会串行。
  const renderedRows = () => page.evaluate(() => {
    const sidebars = document.querySelectorAll('aside')
    const sidebar = sidebars[sidebars.length - 1]
    const panes = sidebar.children
    const right = panes[panes.length - 1]
    const folders = []
    const requests = []
    for (const row of right.querySelectorAll('div.group')) {
      const openBtn = row.querySelector('button[title^="进入“"]')
      if (openBtn) { folders.push(openBtn.getAttribute('title').replace(/^进入“|”$/g, '')); continue }
      const trigger = row.querySelector('button[aria-label$="操作"]')
      if (trigger) requests.push(trigger.getAttribute('aria-label').replace(/操作$/, ''))
    }
    return { folders, requests }
  })

  const expected = (collection, parent) => ({
    folders: childFolders(collection, parent).map((f) => f.name),
    requests: childRequests(collection, parent).map((r) => r.label),
  })

  const gotoRoot = async (collection) => {
    await page.evaluate((name) => {
      const sidebars = document.querySelectorAll('aside')
      const left = sidebars[sidebars.length - 1].children[0]
      const btn = [...left.querySelectorAll('button')].find((b) => b.title === `打开“${name}”`)
      if (!btn) throw new Error(`左栏找不到集合 ${name}`)
      btn.click()
    }, collection)
    await page.waitForTimeout(350)
  }

  const enterFolder = async (name) => {
    await page.evaluate((folder) => {
      const sidebars = document.querySelectorAll('aside')
      const sidebar = sidebars[sidebars.length - 1]
      const panes = sidebar.children
      const right = panes[panes.length - 1]
      const btn = [...right.querySelectorAll('button[title]')].find((b) => b.title === `进入“${folder}”`)
      if (!btn) throw new Error(`右栏找不到文件夹 ${folder}`)
      btn.click()
    }, name)
    await page.waitForTimeout(300)
  }

  const back = async () => {
    await page.evaluate(() => {
      const sidebars = document.querySelectorAll('aside')
      const sidebar = sidebars[sidebars.length - 1]
      const panes = sidebar.children
      const right = panes[panes.length - 1]
      const btn = right.querySelector('button[title="返回上一级"]')
      if (btn) btn.click()
    })
    await page.waitForTimeout(300)
  }

  const mismatches = []
  const checked = []

  for (const c of store.collections) {
    await gotoRoot(c.name)
    const got = await renderedRows()
    const want = expected(c.name, null)
    checked.push(`${c.name} @root`)
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      mismatches.push({ collection: c.name, parent: null, got, want })
    }

    // 逐个钻进去核对每一层：真数据里最深几层就核几层。
    const walk = async (parent) => {
      for (const folder of childFolders(c.name, parent)) {
        const path = parent ? `${parent}/${folder.name}` : folder.name
        await enterFolder(folder.name)
        const childGot = await renderedRows()
        const childWant = expected(c.name, path)
        checked.push(`${c.name} @${path}`)
        if (JSON.stringify(childGot) !== JSON.stringify(childWant)) {
          mismatches.push({ collection: c.name, parent: path, got: childGot, want: childWant })
        }
        await walk(path)
        await back()
      }
    }
    await walk(null)
  }

  return {
    realData: {
      collections: store.collections.map((c) => c.name),
      folderCount: (store.folders || []).length,
      requestCount: store.requests.length,
      hasCollapsedKeys: ['collapsedCollections', 'collapsedFolders'].filter((k) => k in store),
    },
    pagesChecked: checked.length,
    checked,
    mismatches,
    blockedWrites,
    allowedReads,
  }
}
