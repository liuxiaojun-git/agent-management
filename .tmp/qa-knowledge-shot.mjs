// 只为看清拖拽进行中的样子：被拖的行变淡、目标行亮出落点条。
export default async function run(page, ui) {
  await page.setViewportSize({ width: 1680, height: 1000 })
  await page.goto('http://localhost:8081/login', { waitUntil: 'domcontentloaded' })
  const acct = page.getByPlaceholder('请输入账号')
  await acct.waitFor({ state: 'visible', timeout: 20000 })
  await acct.fill('admin')
  await page.getByPlaceholder('请输入密码').fill('admin@123')
  await page.getByRole('button', { name: '登录' }).first().click()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 })

  const seed = {
    assetWire: 0,
    groups: [
      { key: 'personal', name: '个人知识库', system: true },
      { key: 'shared', name: '共享知识库', system: true },
      { key: 'subscribed', name: '订阅知识库', system: true },
    ],
    libraries: [
      { id: 1, name: '产品文档', icon: 'neural', description: '', count: 0, type: 'personal' },
      { id: 2, name: '团队共享', icon: 'circuit', description: '', count: 0, type: 'shared' },
      { id: 3, name: '接口手册', icon: 'matrix', description: '', count: 0, type: 'personal' },
      { id: 4, name: '运维笔记', icon: 'neural', description: '', count: 0, type: 'personal' },
      { id: 5, name: '订阅源', icon: 'circuit', description: '', count: 0, type: 'subscribed' },
    ],
    contents: {}, messages: {},
  }
  await page.route('**/api/data', (route) => {
    const body = JSON.parse(route.request().postData() || '{}')
    if (body.action === 'set') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: seed }) })
  })

  await page.goto('http://localhost:8081/knowledge', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('button[aria-label="产品文档操作"]', { timeout: 20000 })
  await page.waitForTimeout(700)

  const rectOf = (name) => page.evaluate((n) => {
    const row = [...document.querySelectorAll('div.group')].filter((r) => r.querySelector('span[draggable]'))
      .find((r) => r.querySelector(`button[aria-label="${n}操作"]`))
    const r = row.getBoundingClientRect()
    return { left: r.left, top: r.top, height: r.height, width: r.width }
  }, name)
  const fire = (act, rect, ratio) => page.evaluate(([a, r, y]) => {
    const clientX = r.left + r.width / 2
    const clientY = r.top + r.height * y
    if (!window.__dt) window.__dt = new DataTransfer()
    if (a === 'start') {
      const h = document.elementFromPoint(clientX, r.top + r.height / 2)?.closest('div.group')?.querySelector('span[draggable]')
      h.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, clientX, clientY, dataTransfer: window.__dt }))
      return
    }
    const row = document.elementFromPoint(clientX, clientY)?.closest('div.group')
    row.dispatchEvent(new DragEvent(a, { bubbles: true, cancelable: true, clientX, clientY, dataTransfer: window.__dt }))
  }, [act, rect, ratio])

  await fire('start', await rectOf('产品文档'), 0.5)
  await page.waitForTimeout(200)
  await fire('dragover', await rectOf('接口手册'), 0.8)   // 下半区 → 插到接口手册后面
  await page.waitForTimeout(300)

  const box = await page.evaluate(() => {
    const r = [...document.querySelectorAll('div.group')].filter((x) => x.querySelector('span[draggable]'))[0].closest('aside').getBoundingClientRect()
    return { x: r.left - 2, y: Math.max(0, r.top - 2), width: r.width + 4, height: 260 }
  })
  await page.screenshot({ path: '.tmp/knowledge-drag.png', clip: box })
  return { state: await page.evaluate(() => document.body.getAttribute('data-x')) }
}
