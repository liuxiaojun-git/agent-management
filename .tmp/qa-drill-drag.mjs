// 验收：两栏布局下的拖拽矩阵。
//
// HTML5 拖放没法用真实鼠标事件稳定复现（尤其要精确落在某一行的上下半区），
// 所以派发合成 DragEvent。dragstart 与 dragover 分两次 evaluate，中间留一拍让
// React 把 dragPayload 落成 state，否则 dragover 读到的还是 null。
//
// 全程拦掉 GET /api/data，水合回落 localStorage——造的树不写进用户的真实库。
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

  const req = (id, label, parent, collection = 'QA集合') => ({
    id, label, method: 'GET', url: `https://example.com/${id}`,
    headers: [], body: '', collection, savedAt: '2026/01/01 00:00:00',
    ...(parent ? { parent } : {}),
  })

  // A ── B ── C 三层；D 在根层。A 里放两条请求验同层排序。
  const seed = () => ({
    collections: [{ name: 'QA集合', icon: '📁' }, { name: '另一个集合', icon: '📦' }],
    folders: [
      { id: 'fA', name: 'A', collection: 'QA集合' },
      { id: 'fB', name: 'B', collection: 'QA集合', parent: 'A' },
      { id: 'fC', name: 'C', collection: 'QA集合', parent: 'A/B' },
      { id: 'fD', name: 'D', collection: 'QA集合' },
    ],
    requests: [
      req('r0', '根层请求一', null),
      req('r1', '根层请求二', null),
      req('r5', 'A层请求一', 'A'),
      req('r6', 'A层请求二', 'A'),
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

  const read = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey)

  const snapshot = (store) => ({
    folders: store.folders.map((f) => `${f.collection}/${f.parent ? `${f.parent}/` : ''}${f.name}`),
    requests: store.requests.map((r) => `${r.collection}|${r.id}|${r.parent ?? '(根)'}|${r.label}`),
    collections: store.collections.map((c) => c.name),
  })

  // 右栏的行：从 ⋯ 触发器上溯到那一行（带 group 类的圆角 div）。
  // 请求行的 ⋯ 用请求 id 当 openMenuId，aria-label 是 `${label}操作`。
  const locateRow = (label, kind) => page.evaluate(([name, which]) => {
    const sidebars = document.querySelectorAll('aside')
    const sidebar = sidebars[sidebars.length - 1]
    const panes = sidebar.children
    const right = panes[panes.length - 1]
    let row = null
    if (which === 'folder') {
      const btn = [...right.querySelectorAll('button[title]')].find((b) => b.title === `进入“${name}”`)
      if (!btn) throw new Error(`找不到文件夹行: ${name}`)
      row = btn.closest('div.group')
    } else {
      const trigger = [...right.querySelectorAll('button[aria-label]')]
        .find((b) => b.getAttribute('aria-label') === `${name}操作`)
      if (!trigger) throw new Error(`找不到请求行: ${name}`)
      row = trigger.closest('div.group')
    }
    if (!row) throw new Error(`找不到行容器: ${name}`)
    const handle = row.querySelector(':scope > span[draggable="true"]')
    if (!handle) throw new Error(`找不到拖柄: ${name}`)
    return { left: row.getBoundingClientRect().left, top: row.getBoundingClientRect().top, height: row.getBoundingClientRect().height, width: row.getBoundingClientRect().width }
  }, [label, kind])

  // 集合行：从 ⋯ 触发器上溯。
  const locateCollection = (name) => page.evaluate((collection) => {
    const sidebars = document.querySelectorAll('aside')
    const sidebar = sidebars[sidebars.length - 1]
    const left = sidebar.children[0]
    const trigger = left.querySelector(`button[aria-label="${collection}操作"]`)
    if (!trigger) throw new Error(`找不到集合: ${collection}`)
    const row = trigger.closest('div.group')
    if (!row) throw new Error(`找不到集合行容器: ${collection}`)
    const rect = row.getBoundingClientRect()
    return { left: rect.left, top: rect.top, height: rect.height, width: rect.width }
  }, name)

  // 派发一次拖拽。from/to 都是 {left, top, height, width} 加一个 selector 说明取哪个元素。
  const fire = (action, rect, ratio, selector) => page.evaluate(([act, r, y, sel]) => {
    const sidebars = document.querySelectorAll('aside')
    const sidebar = sidebars[sidebars.length - 1]
    const scope = sel === 'left' ? sidebar.children[0] : sidebar.children[sidebar.children.length - 1]
    const clientX = r.left + r.width / 2
    const clientY = r.top + r.height * y
    if (!window.__dt) window.__dt = new DataTransfer()
    if (act === 'start') {
      // 拖柄就在行里，按 x/y 找回那一行再取 span[draggable]。
      const el = document.elementFromPoint(clientX, r.top + r.height / 2)
      const row = el?.closest('div.group')
      const handle = row?.querySelector(':scope > span[draggable="true"]')
      if (!handle) throw new Error('找不到拖柄')
      handle.dispatchEvent(new DragEvent('dragstart', {
        bubbles: true, cancelable: true, clientX, clientY: r.top + r.height / 2, dataTransfer: window.__dt,
      }))
      return { started: true }
    }
    const el = document.elementFromPoint(clientX, clientY)
    const row = el?.closest('div.group')
    if (!row) throw new Error(`落点找不到行 @${y}`)
    const type = act === 'drop' ? 'drop' : 'dragover'
    row.dispatchEvent(new DragEvent(type, {
      bubbles: true, cancelable: true, clientX, clientY, dataTransfer: window.__dt,
    }))
    if (act === 'drop') {
      const handle = row.querySelector(':scope > span[draggable="true"]')
      handle?.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, clientX, clientY, dataTransfer: window.__dt }))
    }
    return { rowClass: row.className, text: row.innerText.replace(/\s+/g, ' ').trim().slice(0, 24) }
  }, [action, rect, ratio, selector])

  const drag = async (from, fromKind, toRect, toRatio, toScope = 'right') => {
    const fromRect = fromKind === 'collection' ? await locateCollection(from) : await locateRow(from, fromKind)
    await fire('start', fromRect, fromRect.height, fromKind === 'collection' ? 'left' : 'right')
    await page.waitForTimeout(140)
    const hover = await fire('hover', toRect, toRatio, toScope)
    await page.waitForTimeout(140)
    await fire('drop', toRect, toRatio, toScope)
    await page.waitForTimeout(650)
    return hover
  }

  const out = {}
  const toast = () => page.evaluate(() => [...document.querySelectorAll('div')]
    .filter((d) => d.children.length === 0 && /⚠️|同名|不能移进|位置/.test(d.innerText))
    .map((d) => d.innerText.trim()).filter(Boolean))

  const A = () => locateRow('A', 'folder')
  const D = () => locateRow('D', 'folder')

  // --- 1 文件夹同层重排：把 D 拖到 A 的上半区 ---
  await reset()
  await drag('D', 'folder', await A(), 0.2)
  out.d1_folder_reorder = snapshot(await read()).folders

  // --- 2 请求同层重排：A 里把「A层请求二」拖到「A层请求一」上半区 ---
  await reset()
  await page.evaluate(() => {
    const sidebars = document.querySelectorAll('aside')
    const panes = sidebars[sidebars.length - 1].children
    const right = panes[panes.length - 1]
    ;[...right.querySelectorAll('button[title]')].find((b) => b.title === '进入“A”').click()
  })
  await page.waitForTimeout(400)
  await drag('A层请求二', 'request', await locateRow('A层请求一', 'request'), 0.2)
  out.d2_request_reorder = snapshot(await read()).requests.filter((r) => r.includes('A层请求'))

  // --- 3 请求拖到文件夹行 → 放进该文件夹 ---
  await reset()
  await drag('根层请求一', 'request', await A(), 0.5)
  out.d3_request_into_folder = snapshot(await read()).requests

  // --- 4 文件夹拖到集合行 → 落到该集合根层，子树里的请求跟着换集合 ---
  await reset()
  await drag('A', 'folder', await locateCollection('另一个集合'), 0.5, 'left')
  out.d4_folder_cross_collection = snapshot(await read())

  // --- 5 请求拖到集合行 → 落到该集合根层 ---
  await reset()
  await drag('根层请求一', 'request', await locateCollection('另一个集合'), 0.5, 'left')
  out.d5_request_into_collection = snapshot(await read()).requests

  // --- 6 集合排序：把「另一个集合」拖到「QA集合」的上半区 ---
  await reset()
  await drag('另一个集合', 'collection', await locateCollection('QA集合'), 0.2, 'left')
  out.d6_collection_reorder = snapshot(await read()).collections

  // --- 7 文件夹拖到请求行 → 不接（没有高亮、存储不动）---
  await reset()
  const hover7 = await drag('D', 'folder', await locateRow('根层请求一', 'request'), 0.5)
  out.d7_folder_onto_request_rejected = { ...snapshot(await read()), hoverClass: hover7.rowClass }

  // --- 8 集合拖到文件夹行 → 不接 ---
  await reset()
  const hover8 = await drag('另一个集合', 'collection', await A(), 0.5, 'right')
  out.d8_collection_onto_folder_rejected = { ...snapshot(await read()).folders, hoverClass: hover8.rowClass }

  // --- 9 刷新后排序保持 ---
  await reset()
  await drag('D', 'folder', await A(), 0.2)
  const before = snapshot(await read()).folders
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('button[aria-label="A操作"]', { timeout: 20000 })
  await page.waitForTimeout(600)
  out.d9_persist_after_reload = { before, after: snapshot(await read()).folders }

  return out
}
