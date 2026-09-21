// 探针：打开「移动到」弹窗后，把弹窗里的按钮逐层 dump 出来，看清结构再改断言。
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
      { id: 'fC', name: 'C', collection: 'QA集合', parent: 'A/B' },
      { id: 'fD', name: 'D', collection: 'QA集合' },
    ],
    requests: [
      { id: 'r0', label: '根层请求', method: 'GET', url: 'https://example.com/0', headers: [], body: '', collection: 'QA集合', savedAt: '2026/01/01 00:00:00' },
      { id: 'r1', label: 'A层请求', method: 'GET', url: 'https://example.com/1', headers: [], body: '', collection: 'QA集合', parent: 'A', savedAt: '2026/01/01 00:00:00' },
    ],
  }

  const storageKey = await page.evaluate(() => Object.keys(localStorage)
    .find((k) => k.startsWith('api-test-saved-requests:')) || 'api-test-saved-requests:1')
  await page.evaluate(([key, store]) => localStorage.setItem(key, JSON.stringify(store)), [storageKey, seed])
  await page.goto('http://localhost:8081/api-test', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('button[aria-label="A操作"]', { timeout: 20000 })
  await page.waitForTimeout(600)

  // 打开 A 的「移动到」
  await page.evaluate(() => {
    const sidebars = document.querySelectorAll('aside')
    const sidebar = sidebars[sidebars.length - 1]
    const right = sidebar.children[sidebar.children.length - 1]
    right.querySelector('button[aria-label="A操作"]').click()
  })
  await page.waitForTimeout(300)
  await page.evaluate(() => {
    [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.innerText.trim() === '移动到').click()
  })
  await page.waitForTimeout(500)

  const dump = () => page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]')
    if (!dlg) return { noDialog: true }
    return {
      buttons: [...dlg.querySelectorAll('button')].map((b) => JSON.stringify(b.innerText.trim())),
      alert: [...dlg.querySelectorAll('[role="alert"]')].map((n) => n.innerText),
      targetLine: dlg.innerText.match(/目标：[^\n]*/)?.[0],
    }
  })

  const out = { initial: await dump() }

  // 点弹窗里的 A
  const clicked = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]')
    const b = [...dlg.querySelectorAll('button')].find((x) => x.innerText.trim() === 'A')
    if (!b) return { found: false }
    b.click()
    return { found: true }
  })
  await page.waitForTimeout(400)
  out.afterClickA = { clicked, ...(await dump()) }

  // 点 B
  const clickedB = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]')
    const b = [...dlg.querySelectorAll('button')].find((x) => x.innerText.trim() === 'B')
    if (!b) return { found: false }
    b.click()
    return { found: true }
  })
  await page.waitForTimeout(400)
  out.afterClickB = { clickedB, ...(await dump()) }

  out.dialogStillOpen = await page.evaluate(() => !!document.querySelector('[role="dialog"]'))
  return out
}
