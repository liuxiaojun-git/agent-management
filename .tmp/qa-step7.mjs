// 第 7 步验收：拖拽矩阵。
//
// HTML5 拖放没法用真实鼠标事件稳定复现（尤其要精确落在某一行的上/中/下三段），
// 所以直接派发合成 DragEvent。React 的监听挂在根容器上，冒泡上来的合成事件照样收得到。
// dragstart 和 dragover 分成两次 evaluate：中间要留一拍让 React 把 dragPayload 落成 state，
// 否则 dragover 读到的还是 null。
//
// 全程把 GET /api/data 拦掉，水合回落到 localStorage——造的树不写进用户的真实库。
export default async function run(page, ui) {
  await page.setViewportSize({ width: 1600, height: 1000 })

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

  // A ── B ── C    （三层，专门用来验证「拖进自身后代」被拦）
  // D             （根层文件夹，用来验证跨层移动）
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
      req('r3', 'D层请求', 'D'),
      req('r4', 'B', null),          // 和文件夹 B 同名，但一个在根层一个在 A 里，不冲突
      req('r9', '别家请求', null, '另一个集合'),
    ],
    collapsedCollections: {},
    collapsedFolders: {},
  })

  const KEY = () => page.evaluate(() => Object.keys(localStorage)
    .find((k) => k.startsWith('api-test-saved-requests:')) || 'api-test-saved-requests:1')

  const storageKey = await KEY()

  const reset = async (patch = {}) => {
    await page.evaluate(([key, store]) => localStorage.setItem(key, JSON.stringify(store)), [storageKey, { ...seed(), ...patch }])
    // 登录后落点在家页，必须显式导航过去；reload 只会重载当前那一页。
    await page.goto('http://localhost:8081/api-test', { waitUntil: 'domcontentloaded' })
    // 等侧栏真的画出来，不是等一个死的时长。
    await page.waitForSelector('button[aria-label="A操作"]', { timeout: 20000 })
    await page.waitForTimeout(600)
  }

  const read = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey)

  // 行的定位靠 ⋯ 按钮的 aria-label（`${名字}操作`），再往上找到带缩进的那一行。
  // 不用 innerText 匹配：行里同时有箭头、图标、计数和 URL，前缀匹配很容易串行。
  const locate = (label, ratio, type, nth = 0) => page.evaluate(([name, r, kind, index]) => {
    const panel = document.querySelectorAll('aside')[1]
    // 重名时同名行会有多个：文件夹 B 和请求 B 的 ⋯ 都叫「B操作」。按 DOM 顺序取第 index 个。
    const trigger = panel.querySelectorAll(`button[aria-label="${name}"]`)[index]
    if (!trigger) throw new Error(`找不到行: ${name}`)
    const row = trigger.closest('div[style*="padding-left"]')
    if (!row) throw new Error(`找不到行容器: ${name}`)
    const handle = row.querySelector(':scope > span[draggable="true"]')
    if (!handle) throw new Error(`找不到拖柄: ${name}`)
    const rect = row.getBoundingClientRect()
    if (!window.__dt) window.__dt = new DataTransfer()
    const fire = (eventType, target, clientY) => target.dispatchEvent(new DragEvent(eventType, {
      bubbles: true, cancelable: true,
      clientX: rect.left + rect.width / 2, clientY,
      dataTransfer: window.__dt,
    }))
    if (kind === 'start') {
      fire('dragstart', handle, rect.top + rect.height / 2)
      return { started: name }
    }
    if (kind === 'hover') {
      fire('dragover', row, rect.top + rect.height * r)
      // 把这一刻的高亮类读回来：被拒绝的投放不该有任何高亮。
      return { rowClass: row.className }
    }
    if (kind === 'drop') {
      fire('drop', row, rect.top + rect.height * r)
      fire('dragend', handle, rect.top + rect.height * r)
      return { dropped: name }
    }
    throw new Error(`未知动作 ${kind}`)
  }, [label, ratio, type, nth])

  // 集合头没有 padding-left（它不是缩进行），所以定位方式和行不同：从 ⋯ 按钮上溯到表头再取拖柄。
  const startCollection = (name) => page.evaluate((collection) => {
    const panel = document.querySelectorAll('aside')[1]
    const trigger = panel.querySelector(`button[aria-label="${collection}操作"]`)
    if (!trigger) throw new Error(`找不到集合: ${collection}`)
    const handle = trigger.parentElement.parentElement.querySelector('span[draggable="true"]')
      || trigger.closest('div').parentElement.querySelector('span[draggable="true"]')
    if (!handle) throw new Error(`找不到集合拖柄: ${collection}`)
    const rect = handle.getBoundingClientRect()
    if (!window.__dt) window.__dt = new DataTransfer()
    handle.dispatchEvent(new DragEvent('dragstart', {
      bubbles: true, cancelable: true,
      clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
      dataTransfer: window.__dt,
    }))
    return { started: collection }
  }, name)

  const hoverCollection = (name, kind) => page.evaluate(([collection, action]) => {
    const panel = document.querySelectorAll('aside')[1]
    const trigger = panel.querySelector(`button[aria-label="${collection}操作"]`)
    const header = trigger.closest('div')
    const container = header.parentElement
    const rect = container.getBoundingClientRect()
    const y = rect.top + rect.height / 2
    if (!window.__dt) window.__dt = new DataTransfer()
    const fire = (eventType, target, clientY) => target.dispatchEvent(new DragEvent(eventType, {
      bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY, dataTransfer: window.__dt,
    }))
    if (action === 'hover') { fire('dragover', container, y); return { rowClass: container.className } }
    fire('drop', container, y)
    return { dropped: collection }
  }, [name, kind])

  const drag = async (fromLabel, toLabel, ratio, kind = 'row', nth = [0, 0]) => {
    const fromIsCollection = kind === 'collection' && seed().collections.some((c) => c.name === fromLabel)
    if (fromIsCollection) await startCollection(fromLabel)
    else await locate(fromLabel, 0.5, 'start', nth[0])
    await page.waitForTimeout(120)
    const hover = kind === 'collection' ? await hoverCollection(toLabel, 'hover') : await locate(toLabel, ratio, 'hover', nth[1])
    await page.waitForTimeout(120)
    if (kind === 'collection') await hoverCollection(toLabel, 'drop')
    else await locate(toLabel, ratio, 'drop', nth[1])
    await page.waitForTimeout(700)
    return hover
  }

  const snapshot = (store) => ({
    folders: store.folders.map((f) => `${f.collection}/${f.parent ? `${f.parent}/` : ''}${f.name}`),
    requests: store.requests.map((r) => `${r.collection}|${r.id}|${r.parent ?? '(根)'}|${r.label}`),
    collections: store.collections.map((c) => c.name),
    collapsedFolders: Object.keys(store.collapsedFolders || {}).filter((k) => store.collapsedFolders[k]),
  })

  const out = {}
  const toast = () => page.evaluate(() => {
    const hits = [...document.querySelectorAll('div')]
      .filter((d) => d.children.length === 0 && /⚠️|同名|不能移进|路径过长/.test(d.innerText))
    return hits.map((d) => d.innerText.trim()).filter(Boolean)
  })

  // --- T1 请求拖进文件夹行中段 = 放进去 ---
  await reset()
  await drag('根层请求操作', 'B操作', 0.5)
  out.t1_request_into_folder = snapshot(await read())

  // --- T2 拖进折叠的文件夹会自动展开（折 B 而不是折 A，否则 B 自己也看不见了）---
  await reset({ collapsedFolders: { fB: true } })
  await drag('根层请求操作', 'B操作', 0.5)
  out.t2_into_collapsed = snapshot(await read())

  // --- T3 文件夹拖进文件夹行中段 = 整棵子树跟着走 ---
  await reset()
  await drag('D操作', 'B操作', 0.5)
  out.t3_folder_into_folder = snapshot(await read())

  // --- T4 文件夹拖到自己后代上：拦住，且不该有任何高亮 ---
  await reset()
  const t4hover = await drag('A操作', 'C操作', 0.5)
  out.t4_self_descendant = { ...snapshot(await read()), hoverClass: t4hover.rowClass, toast: await toast() }

  // --- T5 请求拖到另一条请求上沿 = 同级排到它前面 ---
  await reset()
  await drag('根层请求操作', 'AB层请求操作', 0.25)
  out.t5_request_before_request = snapshot(await read())

  // --- T6 请求拖到另一个集合的容器上 = 落到该集合根层 ---
  await reset()
  await drag('根层请求操作', '另一个集合', 0, 'collection')
  out.t6_request_into_collection = snapshot(await read())

  // --- T7 文件夹跨集合：子树里的请求要跟着换集合 ---
  await reset()
  await drag('D操作', '另一个集合', 0, 'collection')
  out.t7_folder_cross_collection = snapshot(await read())

  // --- T8 同级重名守卫：把根层的请求「B」拖进 A，A 里已经有个文件夹叫 B ---
  // 'B操作' 命中两行：文件夹 B 在前、请求 B 在后，取后者。
  await reset()
  const t8hover = await drag('B操作', 'A操作', 0.5, 'row', [1, 0])
  out.t8_duplicate = { ...snapshot(await read()), hoverClass: t8hover.rowClass, toast: await toast() }

  // --- T9 集合排序没被改坏 ---
  await reset()
  await drag('另一个集合', 'QA集合', 0.2, 'collection')
  out.t9_collection_reorder = snapshot(await read()).collections

  // --- T10 刷新后排序保持（真写盘、真水合）---
  await reset()
  await drag('根层请求操作', 'AB层请求操作', 0.25)
  const before = snapshot(await read())
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('button[aria-label="A操作"]', { timeout: 20000 })
  await page.waitForTimeout(600)
  out.t10_persist_after_reload = { before: before.requests, after: snapshot(await read()).requests }

  // --- T11 文件夹同级重排：把 D 拖到 A 的上沿 ---
  await reset()
  await drag('D操作', 'A操作', 0.12)
  out.t11_folder_reorder = snapshot(await read()).folders

  // --- T12 文件夹拖到请求行：落到该请求所在的层，追加 ---
  await reset()
  await drag('D操作', 'A层请求操作', 0.5)
  out.t12_folder_onto_request = snapshot(await read())

  out.storageKey = storageKey
  return out
}
