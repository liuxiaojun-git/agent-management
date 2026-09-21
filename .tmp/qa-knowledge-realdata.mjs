// 真实数据回归：用用户库里真实的知识库跑一遍。
//
// 读照常放行，**写一律拦掉**（action === 'set' 直接 abort）。知识库的保存是整份工作区覆盖，
// 后端还会把 payload 里没有的库删掉——所以这条边界必须死守。拦住之后页面停在乐观顺序，
// 刷新一次就能证明库里一个字都没变。
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
    if (action === 'set') { blockedWrites += 1; return route.abort() }
    allowedReads += 1
    return route.continue()
  })

  const fetchWorkspace = () => page.evaluate(async () => {
    const token = localStorage.getItem('access_token')
    const res = await fetch('/api/data', {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ action: 'get', name: 'knowledge-workspace', data: { assetWire: 2 } }),
    })
    const json = await res.json()
    return json.data
  })

  const first = await fetchWorkspace()
  if (!first || !Array.isArray(first.libraries)) return { error: '拿不到真实工作区', first }

  // 连续两次 GET 顺序必须一致 —— 这条验的是后端 ORDER BY sort_order, id 的确定性。
  await page.waitForTimeout(400)
  const second = await fetchWorkspace()
  const names = (w) => w.libraries.map((l) => l.name)
  const orderStable = JSON.stringify(names(first)) === JSON.stringify(names(second))

  await page.goto('http://localhost:8081/knowledge', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('span[draggable]', { timeout: 20000 })
  await page.waitForTimeout(900)

  const rendered = () => page.evaluate(() => [...document.querySelectorAll('div.group')]
    .filter((row) => row.querySelector('span[draggable]'))
    .map((row) => {
      const trigger = row.querySelector('button[aria-label$="操作"]')
      const handle = row.querySelector('span[draggable]')
      return {
        name: trigger ? trigger.getAttribute('aria-label').replace(/操作$/, '') : null,
        draggable: handle.getAttribute('draggable'),
      }
    })
    .filter((row) => row.name))

  const before = await rendered()
  const writesBeforeDrag = blockedWrites

  // 在真实库名上真拖一次：拿第一行拖到第二行的下半区。
  const out = { renderedBefore: before, orderStable, apiOrder: names(first) }
  if (before.length >= 2) {
    const rectOf = (name) => page.evaluate((n) => {
      const rows = [...document.querySelectorAll('div.group')].filter((row) => row.querySelector('span[draggable]'))
      const row = rows.find((r) => r.querySelector(`button[aria-label="${n}操作"]`))
      if (!row) throw new Error(`找不到行 ${n}`)
      const r = row.getBoundingClientRect()
      return { left: r.left, top: r.top, height: r.height, width: r.width }
    }, name)

    const fire = (act, rect, ratio) => page.evaluate(([a, r, y]) => {
      const clientX = r.left + r.width / 2
      const clientY = r.top + r.height * y
      if (!window.__dt) window.__dt = new DataTransfer()
      if (a === 'start') {
        const el = document.elementFromPoint(clientX, r.top + r.height / 2)
        const handle = el?.closest('div.group')?.querySelector('span[draggable]')
        if (!handle) throw new Error('找不到拖柄')
        handle.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, clientX, clientY: r.top + r.height / 2, dataTransfer: window.__dt }))
        return
      }
      const row = document.elementFromPoint(clientX, clientY)?.closest('div.group')
      if (!row) throw new Error('落点找不到行')
      row.dispatchEvent(new DragEvent(a, { bubbles: true, cancelable: true, clientX, clientY, dataTransfer: window.__dt }))
    }, [act, rect, ratio])

    const [a, b] = before.map((row) => row.name)
    // 只有同组的才拖得动，先确认这两行是不是一个分组。
    const groupOf = await page.evaluate((n) => {
      const row = [...document.querySelectorAll('div.group')]
        .filter((r) => r.querySelector('span[draggable]'))
        .find((r) => r.querySelector(`button[aria-label="${n}操作"]`))
      const section = row.closest('div.border-b')
      return section?.querySelector('button span')?.textContent || null
    }, a)

    const scrollIntoView = (name) => page.evaluate((n) => {
      const row = [...document.querySelectorAll('div.group')]
        .filter((r) => r.querySelector('span[draggable]'))
        .find((r) => r.querySelector(`button[aria-label="${n}操作"]`))
      row?.scrollIntoView({ block: 'center' })
    }, name)
    await scrollIntoView(a)
    await scrollIntoView(b)
    await page.waitForTimeout(300)

    await fire('start', await rectOf(a), 0.5)
    await page.waitForTimeout(150)
    await fire('dragover', await rectOf(b), 0.8)
    await page.waitForTimeout(150)
    await fire('drop', await rectOf(b), 0.8)
    await page.waitForTimeout(900)

    out.dragged = { from: a, onto: b, section: groupOf }
    out.renderedAfterDrag = await rendered()
    out.writesBlockedByDrag = blockedWrites - writesBeforeDrag

    // 刷新一次：写全被拦掉了，顺序必须原样回来 —— 这是「没碰你的库」的正面证据。
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('span[draggable]', { timeout: 20000 })
    await page.waitForTimeout(900)
    out.renderedAfterReload = await rendered()

    await page.waitForTimeout(300)
    out.finalApiOrder = names(await fetchWorkspace())
  }

  return { ...out, blockedWrites, allowedReads }
}
