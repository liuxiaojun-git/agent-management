// 验收：两栏之间那根手柄、以及整体那根手柄，都真的能拖且钳制正确；
// 顺带确认侧栏加宽后主编辑区没被挤没。
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

  const seed = {
    collections: [{ name: 'QA集合', icon: '📁' }, { name: '另一个集合', icon: '📦' }],
    folders: [
      { id: 'fA', name: 'A', collection: 'QA集合' },
      { id: 'fB', name: 'B', collection: 'QA集合', parent: 'A' },
    ],
    requests: [{ id: 'r0', label: '根层请求', method: 'GET', url: 'https://example.com/0', headers: [], body: '', collection: 'QA集合', savedAt: '2026/01/01 00:00:00' }],
  }
  const key = await page.evaluate(() => Object.keys(localStorage)
    .find((k) => k.startsWith('api-test-saved-requests:')) || 'api-test-saved-requests:1')
  await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [key, seed])
  await page.goto('http://localhost:8081/api-test', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('button[aria-label="A操作"]', { timeout: 20000 })
  await page.waitForTimeout(700)

  const geo = () => page.evaluate(() => {
    const sidebars = document.querySelectorAll('aside')
    const sidebar = sidebars[sidebars.length - 1]
    const panes = sidebar.children
    const editor = sidebar.nextElementSibling.nextElementSibling
    return {
      sidebar: Math.round(sidebar.getBoundingClientRect().width),
      left: Math.round(panes[0].getBoundingClientRect().width),
      right: Math.round(panes[panes.length - 1].getBoundingClientRect().width),
      editor: Math.round(editor.getBoundingClientRect().width),
      editorScrollOverflow: editor.scrollWidth - editor.clientWidth,
    }
  })

  const dragHandle = async (which, dx) => {
    const box = await page.evaluate((w) => {
      const sidebars = document.querySelectorAll('aside')
      const sidebar = sidebars[sidebars.length - 1]
      const target = w === 'inner' ? sidebar.children[1] : sidebar.nextElementSibling
      const r = target.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + 200 }
    }, which)
    await page.mouse.move(box.x, box.y)
    await page.mouse.down()
    await page.mouse.move(box.x + dx, box.y, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(300)
  }

  const out = { initial: await geo() }

  // 内层手柄向右 60：左栏变宽，右栏相应变窄，侧栏总宽不动。
  await dragHandle('inner', 60)
  out.afterInnerPlus60 = await geo()

  // 内层手柄向左 400：应当被 COLLECTION_PANE_MIN=150 钳住。
  await dragHandle('inner', -400)
  out.afterInnerMinus400 = await geo()

  // 内层手柄向右 600：应当被 COLLECTION_PANE_MAX=320 钳住。
  await dragHandle('inner', 600)
  out.afterInnerPlus600 = await geo()

  // 外层手柄向右 200：整个侧栏变宽，编辑区相应变窄。
  await dragHandle('outer', 200)
  out.afterOuterPlus200 = await geo()

  // 外层手柄向右 900：应当被 900 上限钳住。
  await dragHandle('outer', 900)
  out.afterOuterPlus900 = await geo()

  // 外层手柄向左 2000：应当被「左栏 + 180 右栏下限 + 8 手柄」钳住。
  await dragHandle('outer', -2000)
  out.afterOuterMinus2000 = await geo()

  // 截一张钻进去之后的图，看排版本身。
  await page.evaluate(() => {
    const sidebars = document.querySelectorAll('aside')
    const sidebar = sidebars[sidebars.length - 1]
    const right = sidebar.children[sidebar.children.length - 1]
    const b = [...right.querySelectorAll('button[title]')].find((x) => x.title === '进入“A”')
    b.click()
  })
  await page.waitForTimeout(400)
  await page.screenshot({ path: '.tmp/drill-sidebar.png', clip: { x: 0, y: 130, width: 1340, height: 700 } })

  return out
}
