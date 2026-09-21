// 验收：接口信息改成左右两栏下钻。
//
// 全程把 GET /api/data 拦掉，水合回落到 localStorage——造的树不写进用户的真实库
// （库里是 6 个集合 / 22 条真实请求，而保存是 replace-all）。
//
// 定位方式：集合行没有 ⋯ 之外的锚点，用 aria-label（`${名字}操作`）；
// 右栏的行靠文本定位，因为文件夹行和请求行不再有 padding-left 缩进可以当抓手。
export default async function run(page, ui) {
  await page.setViewportSize({ width: 1680, height: 1000 })

  await page.goto('http://localhost:8081/login', { waitUntil: 'domcontentloaded' })
  const acct = page.getByPlaceholder('请输入账号')
  await acct.waitFor({ state: 'visible', timeout: 20000 })
  await acct.fill('admin')
  await page.getByPlaceholder('请输入密码').fill('admin@123')
  await page.getByRole('button', { name: '登录' }).first().click()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 })

  // 登录之后才拦：登录本身要走后端。
  await page.route('**/api/data', (route) => route.abort())

  const req = (id, label, parent, collection = 'QA集合') => ({
    id, label, method: 'GET', url: `https://example.com/${id}`,
    headers: [], body: '', collection, savedAt: '2026/01/01 00:00:00',
    ...(parent ? { parent } : {}),
  })

  // A ── B ── C   三层，验下钻与面包屑
  // D            根层文件夹，验同层排序
  const seed = () => ({
    collections: [{ name: 'QA集合', icon: '📁' }, { name: '另一个集合', icon: '📦' }],
    folders: [
      { id: 'fA', name: 'A', collection: 'QA集合' },
      { id: 'fB', name: 'B', collection: 'QA集合', parent: 'A' },
      { id: 'fC', name: 'C', collection: 'QA集合', parent: 'A/B' },
      { id: 'fD', name: 'D', collection: 'QA集合' },
    ],
    requests: [
      req('r0', '根层请求', null),
      req('r1', 'A层请求', 'A'),
      req('r2', 'AB层请求', 'A/B'),
      req('r3', 'ABC层请求', 'A/B/C'),
      req('r9', '别家请求', null, '另一个集合'),
    ],
  })

  const storageKey = await page.evaluate(() => Object.keys(localStorage)
    .find((k) => k.startsWith('api-test-saved-requests:')) || 'api-test-saved-requests:1')

  const reset = async () => {
    await page.evaluate(([key, store]) => localStorage.setItem(key, JSON.stringify(store)), [storageKey, seed()])
    await page.goto('http://localhost:8081/api-test', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('button[aria-label="A操作"]', { timeout: 20000 })
    await page.waitForTimeout(500)
  }

  // 右栏当前这一层渲染出来的所有行的文字。
  const rows = () => page.evaluate(() => {
    const sidebar = document.querySelectorAll('aside')[document.querySelectorAll('aside').length - 1]
    // 右栏是 aside 里最后一个 flex-col 子元素。
    const panes = sidebar.children
    const right = panes[panes.length - 1]
    return [...right.querySelectorAll('button[aria-label$="操作"]')]
      .map((b) => b.getAttribute('aria-label').replace(/操作$/, ''))
  })

  const header = () => page.evaluate(() => {
    const sidebar = document.querySelectorAll('aside')[document.querySelectorAll('aside').length - 1]
    const panes = sidebar.children
    const right = panes[panes.length - 1]
    const top = right.children[0]
    return {
      title: top.innerText.trim().split('\n')[0],
      hasBack: !!top.querySelector('button[title="返回上一级"]'),
      hasCrumb: right.children.length > 2
        ? !!right.children[1].innerText.includes('全部内容') || right.children[1].innerText.includes('/')
        : false,
      crumbs: right.children.length > 2 && right.children[1].innerText.includes('/')
        ? right.children[1].innerText.trim()
        : (right.children.length > 2 ? right.children[1].innerText.trim() : ''),
    }
  })

  const openFolder = async (name) => {
    await page.evaluate((folder) => {
      const sidebar = document.querySelectorAll('aside')[document.querySelectorAll('aside').length - 1]
      const panes = sidebar.children
      const right = panes[panes.length - 1]
      const btn = [...right.querySelectorAll('button[title]')].find((b) => b.title === `进入“${folder}”`)
      if (!btn) throw new Error(`找不到文件夹行: ${folder}`)
      btn.click()
    }, name)
    await page.waitForTimeout(400)
  }

  const clickCrumb = async (label) => {
    await page.evaluate((text) => {
      const sidebar = document.querySelectorAll('aside')[document.querySelectorAll('aside').length - 1]
      const panes = sidebar.children
      const right = panes[panes.length - 1]
      const btn = [...right.querySelectorAll('button')].find((b) => b.innerText.trim() === text)
      if (!btn) throw new Error(`找不到面包屑: ${text}`)
      btn.click()
    }, label)
    await page.waitForTimeout(400)
  }

  const clickBack = async () => {
    await page.evaluate(() => {
      const sidebar = document.querySelectorAll('aside')[document.querySelectorAll('aside').length - 1]
      const panes = sidebar.children
      const right = panes[panes.length - 1]
      right.querySelector('button[title="返回上一级"]').click()
    })
    await page.waitForTimeout(400)
  }

  const out = {}
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))

  // --- T1 根层只画当前一层的直接子项 ---
  await reset()
  out.t1_root_rows = await rows()
  out.t1_root_header = await header()

  // --- T2 下钻 A：只剩 A 里的东西，B 不再原地展开（C 在 A/B 里，看不见）---
  await openFolder('A')
  out.t2_into_A = { rows: await rows(), header: await header() }

  // --- T3 再下钻 B，并验面包屑 ---
  await openFolder('B')
  out.t3_into_AB = { rows: await rows(), header: await header() }

  // --- T4 再下钻 C（三层深）---
  await openFolder('C')
  out.t4_into_ABC = { rows: await rows(), header: await header() }

  // --- T5 面包屑点「全部内容」回根层 ---
  await clickCrumb('全部内容')
  out.t5_crumb_root = { rows: await rows(), header: await header() }

  // --- T6 返回上一级逐级退 ---
  await openFolder('A')
  await openFolder('B')
  await clickBack()
  const afterOneBack = { rows: await rows(), header: await header() }
  await clickBack()
  out.t6_back_twice = { afterOneBack, afterTwoBack: { rows: await rows(), header: await header() } }

  // --- T7 点请求把右栏带到它所在的那一层 ---
  await reset()
  await page.evaluate(() => {
    const sidebar = document.querySelectorAll('aside')[document.querySelectorAll('aside').length - 1]
    const panes = sidebar.children
    const right = panes[panes.length - 1]
    ;[...right.querySelectorAll('div')].find((d) => d.innerText.startsWith('根层请求'))?.click()
  })
  await page.waitForTimeout(400)
  out.t7_after_load_root = await rows()

  await openFolder('A')
  await openFolder('B')
  await page.evaluate(() => {
    const sidebar = document.querySelectorAll('aside')[document.querySelectorAll('aside').length - 1]
    const panes = sidebar.children
    const right = panes[panes.length - 1]
    ;[...right.querySelectorAll('div')].find((d) => d.innerText.startsWith('AB层请求'))?.click()
  })
  await page.waitForTimeout(400)
  // 点完当前层的请求后，仍在 AB 层。
  out.t7_still_in_AB = { rows: await rows(), header: await header() }

  // --- T8 刷新后首条请求若在深层，右栏要停到那一层 ---
  await page.evaluate(([key, store]) => {
    const deep = { ...store }
    deep.requests = [store.requests.find((r) => r.id === 'r2'), ...store.requests.filter((r) => r.id !== 'r2')]
    localStorage.setItem(key, JSON.stringify(deep))
  }, [storageKey, seed()])
  await page.goto('http://localhost:8081/api-test', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('button[aria-label="A操作"]', { timeout: 20000 })
  await page.waitForTimeout(700)
  out.t8_hydrate_deep = { rows: await rows(), header: await header() }

  // --- T9 左栏切集合：右栏归零到该集合根层 ---
  await reset()
  await openFolder('A')
  await openFolder('B')
  await page.evaluate(() => {
    const sidebar = document.querySelectorAll('aside')[document.querySelectorAll('aside').length - 1]
    const left = sidebar.children[0]
    const btn = [...left.querySelectorAll('button')].find((b) => b.title === '打开“另一个集合”')
    btn.click()
  })
  await page.waitForTimeout(400)
  out.t9_switch_collection = { rows: await rows(), header: await header() }

  // --- T10 header 的 + 落在当前层 ---
  await reset()
  await openFolder('A')
  await page.evaluate(() => {
    const sidebar = document.querySelectorAll('aside')[document.querySelectorAll('aside').length - 1]
    const panes = sidebar.children
    const right = panes[panes.length - 1]
    right.querySelector('button[aria-label="新建"]').click()
  })
  await page.waitForTimeout(300)
  const plusItems = await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].map((b) => b.innerText.trim()))
  await page.evaluate(() => {
    const item = [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.innerText.trim() === '新建文件夹')
    item.click()
  })
  await page.waitForTimeout(300)
  await page.evaluate(() => {
    const input = [...document.querySelectorAll('input')].find((i) => i.placeholder && i.placeholder.includes('名称'))
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, 'A下的新文件夹')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.waitForTimeout(200)
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === '创建' || b.innerText.trim() === '确定')
    if (btn) btn.click()
  })
  await page.waitForTimeout(600)
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey)
  out.t10_plus_menu = {
    items: plusItems,
    newFolder: stored.folders.find((f) => f.name === 'A下的新文件夹'),
    rowsAfter: await rows(),
  }

  // --- T11 左栏计数是集合请求总数，不是根层直接子项数 ---
  await reset()
  out.t11_left_count = await page.evaluate(() => {
    const sidebar = document.querySelectorAll('aside')[document.querySelectorAll('aside').length - 1]
    const left = sidebar.children[0]
    return [...left.querySelectorAll('button')]
      .filter((b) => b.title && b.title.startsWith('打开“'))
      .map((b) => b.innerText.replace(/\s+/g, ' ').trim())
  })

  // --- T12 折叠状态不再进存储 ---
  out.t12_no_collapsed_keys = Object.keys(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey))

  // --- T13 两条拖拽手柄都在，宽度能拖 ---
  out.t13_handles = await page.evaluate(() => {
    const sidebar = document.querySelectorAll('aside')[document.querySelectorAll('aside').length - 1]
    const outer = sidebar.nextElementSibling
    const inner = sidebar.children[1]
    return {
      sidebarWidth: sidebar.getBoundingClientRect().width,
      leftPaneWidth: sidebar.children[0].getBoundingClientRect().width,
      rightPaneWidth: sidebar.children[sidebar.children.length - 1].getBoundingClientRect().width,
      innerHandleWidth: inner.getBoundingClientRect().width,
      outerHandleExists: !!outer && getComputedStyle(outer).cursor === 'col-resize',
    }
  })

  out.consoleErrors = errors
  return out
}
