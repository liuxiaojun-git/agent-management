// 知识库「我的知识库」拖动排序的验收。
//
// 和接口信息那边的脚本有个关键差异：**不能 route.abort() 掉 /api/data**。
// 接口信息的 store 会回落到 localStorage，知识库没有这层回落——abort 掉 GET 只会
// 渲染出一个空列表。所以这里在脚本里起一个假后端：GET 回当前状态，SET 把 payload
// 原样存下来并回显。把 payload 的 libraries 原样回显，忠实地模拟了后端
// 「sort_order = 数组下标」+「ORDER BY sort_order, id」这一对（data.js:254-256, 348-365）。
//
// 全程只跟假后端说话，用户的真实知识库一个字都不会被碰。
export default async function run(page, ui) {
  await page.setViewportSize({ width: 1680, height: 1000 })

  await page.goto('http://localhost:8081/login', { waitUntil: 'domcontentloaded' })
  const acct = page.getByPlaceholder('请输入账号')
  await acct.waitFor({ state: 'visible', timeout: 20000 })
  await acct.fill('admin')
  await page.getByPlaceholder('请输入密码').fill('admin@123')
  await page.getByRole('button', { name: '登录' }).first().click()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 })

  // 交错种子。createLibrary 是追加，所以「个人/共享/个人」这种排列在生产里是常态。
  // 种子不交错的话，索引映射那一块等于没验。
  const seed = () => ({
    assetWire: 0,
    groups: [
      { key: 'personal', name: '个人知识库', system: true },
      { key: 'shared', name: '共享知识库', system: true },
      { key: 'subscribed', name: '订阅知识库', system: true },
    ],
    libraries: [
      { id: 1, name: 'P1', icon: 'neural', description: '', count: 0, type: 'personal' },
      { id: 2, name: 'S1', icon: 'circuit', description: '', count: 0, type: 'shared' },
      { id: 3, name: 'P2', icon: 'neural', description: '', count: 0, type: 'personal' },
      { id: 4, name: 'B1', icon: 'matrix', description: '', count: 0, type: 'subscribed' },
      { id: 5, name: 'S2', icon: 'circuit', description: '', count: 0, type: 'shared' },
      { id: 6, name: 'P3', icon: 'neural', description: '', count: 0, type: 'personal' },
    ],
    contents: {},
    messages: {},
  })

  let server = seed()
  let setLog = []
  // 每次保存的耗时。默认立即返回；T7 用「第一次慢、之后快」把并发写摆出来。
  let setDelay = () => 0
  let setCounter = 0

  await page.route('**/api/data', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}')
    if (body.action === 'set') {
      const index = setCounter++
      const wait = setDelay(index)
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
      setLog.push(body.data)
      // 后端会按数组下标写 sort_order，读回时 ORDER BY sort_order, id —— 原样回显即等价。
      server = { ...server, ...body.data, assetWire: 0 }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: server }) })
  })

  const openPage = async () => {
    await page.goto('http://localhost:8081/knowledge', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('button[aria-label="P1操作"]', { timeout: 20000 })
    await page.waitForTimeout(600)
  }

  const reset = async () => {
    server = seed()
    setLog = []
    setDelay = () => 0
    setCounter = 0
    await openPage()
    // 水合那次 GET 不计入 setLog，但保险起见把计数清零。
    setLog = []
  }

  // 左栏全部知识库行的 DOM 顺序（分组按 个人/共享/订阅 固定渲染，所以是各组的拼接）。
  // 只认带拖柄的行——分组标题行也是 div.group，但没有拖柄。
  const rendered = () => page.evaluate(() => [...document.querySelectorAll('div.group')]
    .filter((row) => row.querySelector('span[draggable]'))
    .map((row) => {
      const trigger = row.querySelector('button[aria-label$="操作"]')
      return trigger ? trigger.getAttribute('aria-label').replace(/操作$/, '') : null
    })
    .filter(Boolean))

  // 最后一次保存里 libraries 的顺序（这才是真正落库的东西）。
  const posted = () => (setLog.length ? setLog[setLog.length - 1].libraries.map((l) => l.name) : null)

  const rowRect = (name) => page.evaluate((n) => {
    const rows = [...document.querySelectorAll('div.group')].filter((row) => row.querySelector('span[draggable]'))
    const row = rows.find((r) => r.querySelector(`button[aria-label="${n}操作"]`))
    if (!row) throw new Error(`找不到知识库行: ${n}`)
    const r = row.getBoundingClientRect()
    return { left: r.left, top: r.top, height: r.height, width: r.width }
  }, name)

  // 合成拖拽。HTML5 拖放没法用真实鼠标事件稳定复现（尤其要精确落在某一行的上下半区），
  // 所以派发合成 DragEvent。dragstart 与 dragover 分两次 evaluate，中间留一拍让 React
  // 把 dragPayload 落成 state——否则 dragover 读到的还是 null。
  const fire = (action, rect, ratio) => page.evaluate(([act, r, y]) => {
    const clientX = r.left + r.width / 2
    const clientY = r.top + r.height * y
    if (!window.__dt) window.__dt = new DataTransfer()
    if (act === 'start') {
      const el = document.elementFromPoint(clientX, r.top + r.height / 2)
      const row = el?.closest('div.group')
      const handle = row?.querySelector('span[draggable]')
      if (!handle) throw new Error('找不到拖柄')
      handle.dispatchEvent(new DragEvent('dragstart', {
        bubbles: true, cancelable: true, clientX, clientY: r.top + r.height / 2, dataTransfer: window.__dt,
      }))
      return { started: true }
    }
    const el = document.elementFromPoint(clientX, clientY)
    const row = el?.closest('div.group')
    if (!row) throw new Error(`落点找不到行 @${y}`)
    row.dispatchEvent(new DragEvent(act === 'drop' ? 'drop' : 'dragover', {
      bubbles: true, cancelable: true, clientX, clientY, dataTransfer: window.__dt,
    }))
    return { rowClass: row.className }
  }, [action, rect, ratio])

  // 正常一次拖拽：源行起手 → 悬停目标行的上/下半区 → 落下。
  const drag = async (from, to, ratio = 0.5) => {
    const source = await rowRect(from)
    const target = await rowRect(to)
    await fire('start', source, 0.5)
    await page.waitForTimeout(140)
    await fire('dragover', target, ratio)
    await page.waitForTimeout(140)
    await fire('drop', target, ratio)
    await page.waitForTimeout(700)
  }

  // 起手后就丢掉（落到列表外），只在源行派发 dragend —— 用户名副其实地放弃这次拖拽。
  const dragAndCancel = async (from) => {
    const source = await rowRect(from)
    await fire('start', source, 0.5)
    await page.waitForTimeout(140)
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('div.group')].filter((row) => row.querySelector('span[draggable]'))
      const handle = rows[0].querySelector('span[draggable]')
      handle.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: window.__dt }))
    })
    await page.waitForTimeout(400)
  }

  const out = {}
  const step = async (name, fn) => {
    try {
      out[name] = await fn()
    } catch (error) {
      out[name] = { ERROR: String(error).split('\n')[0] }
    }
  }

  const dragState = () => page.evaluate(() => ({
    dragging: [...document.querySelectorAll('div.group')].filter((row) => row.className.includes('opacity-40')).length,
    indicators: document.querySelectorAll('span.pointer-events-none.absolute').length,
    menus: document.querySelectorAll('[role="menuitem"]').length,
  }))

  // --- T1/T2 个人组重排：把 P1 拖到 P3 下半区 ---
  // 起点 [P1,S1,P2,B1,S2,P3] → 移除 P1 → [S1,P2,B1,S2,P3] → findIndex(P3)=4 → splice(5,0,P1)
  // → [S1,P2,B1,S2,P3,P1]。个人组变成 P2,P3,P1；共享组 S1,S2 和订阅组 B1 必须一字不动。
  await step('t1_personal_reorder', async () => {
    await reset()
    const before = await rendered()
    await drag('P1', 'P3', 0.8)
    return { before, after: await rendered(), posted: await posted() }
  })

  await step('t2_other_sections_untouched', async () => {
    await reset()
    await drag('P1', 'P3', 0.8)
    const list = await rendered()
    // 分组固定按 个人/共享/订阅 渲染，所以按名字前缀挑出来比对。
    return {
      shared: list.filter((n) => n.startsWith('S')),
      subscribed: list.filter((n) => n.startsWith('B')),
    }
  })

  // --- T3 跨组拖拽：上下半区各来一次，必须完全不受理 ---
  await step('t3a_cross_section_top', async () => {
    await reset()
    const baseline = setLog.length
    await drag('P2', 'S1', 0.2)
    return { posts: setLog.length - baseline, rendered: await rendered(), drag: await dragState() }
  })

  await step('t3b_cross_section_bottom', async () => {
    await reset()
    const baseline = setLog.length
    await drag('P2', 'S1', 0.8)
    return { posts: setLog.length - baseline, rendered: await rendered(), drag: await dragState() }
  })

  // --- T4 搜索中禁用拖拽 ---
  await step('t4_search_disables_drag', async () => {
    await reset()
    await page.evaluate(() => document.querySelector('button[aria-label="搜索知识库"]').click())
    await page.waitForTimeout(300)
    await page.fill('input[placeholder="搜索知识库"]', 'P')
    await page.waitForTimeout(400)
    const handles = await page.evaluate(() => [...document.querySelectorAll('span[draggable]')]
      .map((h) => ({ draggable: h.getAttribute('draggable'), title: h.getAttribute('title') })))
    const baseline = setLog.length
    // 合成事件绕过了浏览器对非 draggable 元素的拒绝，所以这是唯一能验到
    // handler 里那道守卫（moveLibrary 开头的 if (libraryQuery) return）的办法。
    await drag('P1', 'P3', 0.8)
    await drag('P3', 'P1', 0.2)
    return { handles, posts: setLog.length - baseline, rendered: await rendered() }
  })

  // --- T5 自身 / 原地：都不该产生保存 ---
  await step('t5a_self_drop', async () => {
    await reset()
    const baseline = setLog.length
    await drag('P2', 'P2', 0.5)
    return { posts: setLog.length - baseline, rendered: await rendered() }
  })

  await step('t5b_adjacent_noop', async () => {
    await reset()
    const baseline = setLog.length
    // P1 已经在 P2 前面，拖到 P2 上半区等于没动。交错数组下全局顺序其实会变
    // （P1 落到 S1 后面），但个人组的相对顺序没变——判据看的是后者，所以不该保存。
    await drag('P1', 'P2', 0.2)
    return { posts: setLog.length - baseline, rendered: await rendered() }
  })

  // --- T6 拖到列表外放弃：状态必须清干净，且下一次拖拽仍然有效 ---
  await step('t6_cancel_then_drag_again', async () => {
    await reset()
    await dragAndCancel('P1')
    const afterCancel = await dragState()
    const baseline = setLog.length
    await drag('P1', 'P3', 0.8)
    return { afterCancel, postsAfterSecondDrag: setLog.length - baseline, rendered: await rendered() }
  })

  // --- T7 连续两次拖拽：第一次保存故意慢，第二次快 ---
  // 没有串行化的话第二次会先落地、第一次后落地把它覆盖掉，最终库里是第一次的顺序。
  // 串行化之后第二次要等第一次跑完才发，最终库里必然是第二次的顺序。
  await step('t7_overlapping_saves', async () => {
    await reset()
    setDelay = (index) => (index === 0 ? 700 : 40)
    // 第一次：P1 拖到 P3 下半区 → [S1,P2,B1,S2,P3,P1]，个人组 P2,P3,P1
    await drag('P1', 'P3', 0.8)
    // 第二次（此时第一次的 POST+回读还没跑完）：P2 拖到 P1 下半区
    // 从 [S1,P2,B1,S2,P3,P1] 移除 P2 → [S1,B1,S2,P3,P1] → findIndex(P1)=4 → splice(5,0,P2)
    // → [S1,B1,S2,P3,P1,P2]，个人组 P3,P1,P2
    await drag('P2', 'P1', 0.8)
    await page.waitForTimeout(2500)
    return {
      setCount: setLog.length,
      postedLatest: await posted(),
      serverOrder: server.libraries.map((l) => l.name),
      rendered: await rendered(),
    }
  })

  // --- T8 刷新后顺序仍在（假后端持有最后一次保存的 payload）---
  await step('t8_survives_reload', async () => {
    await reset()
    await drag('P1', 'P3', 0.8)
    const before = await rendered()
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('button[aria-label="P1操作"]', { timeout: 20000 })
    await page.waitForTimeout(700)
    return { before, after: await rendered() }
  })

  // --- T9 先开着某行的 ⋯ 菜单再拖另一行 ---
  await step('t9_open_menu_then_drag', async () => {
    await reset()
    await page.evaluate(() => document.querySelector('button[aria-label="P1操作"]').click())
    await page.waitForTimeout(300)
    const menuBefore = await dragState()
    await drag('P2', 'P3', 0.8)
    return { menuBefore, menuAfter: (await dragState()).menus, rendered: await rendered(), posted: await posted() }
  })

  return out
}
