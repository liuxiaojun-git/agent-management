// 端到端：真前端 → 真后端 → MySQL。前面几步前端只用 localStorage 验过、后端只用裸 API
// 验过，中间这一段「前端写出去的 folders 到底有没有落成行」还没合起来跑过。
//
// 用一个一次性集合 ZZ-QA-临时 承载，最后在界面上删掉，并核对 MySQL 行数和 GET 结果
// 都回到跑测试之前的样子。
const BASE = 'http://localhost:3000/api'

const login = async () => {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin@123' }),
  })
  return (await r.json())?.data?.access_token
}
const getStore = async (t) => (await (await fetch(`${BASE}/data`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
  body: JSON.stringify({ action: 'get', name: 'api-test-saved-requests' }),
})).json())?.data

export default async function run(page, ui) {
  await page.setViewportSize({ width: 1600, height: 1000 })

  const token = await login()
  const original = await getStore(token)
  const before = JSON.stringify(original)

  await page.goto('http://localhost:8081/login', { waitUntil: 'domcontentloaded' })
  const acct = page.getByPlaceholder('请输入账号')
  await acct.waitFor({ state: 'visible', timeout: 20000 })
  await acct.fill('admin')
  await page.getByPlaceholder('请输入密码').fill('admin@123')
  await page.getByRole('button', { name: '登录' }).first().click()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 })
  await page.goto('http://localhost:8081/api-test', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('button[aria-label="Qingzhou-158操作"]', { timeout: 20000 })
  await page.waitForTimeout(800)

  const panel = page.locator('aside').nth(1)
  const dialogInput = page.locator('input[placeholder="请输入集合名称"], input[placeholder="请输入文件夹名称"]')
  const step = {}

  // 1) 新建集合
  await panel.getByRole('button', { name: '+ 新建集合' }).click()
  await page.waitForTimeout(400)
  await page.locator('input[placeholder="请输入集合名称"]').fill('ZZ-QA-临时')
  await page.getByRole('button', { name: '创建' }).click()
  await page.waitForTimeout(1500)

  // 2) 在它下面建一级文件夹
  await panel.locator('button[aria-label="ZZ-QA-临时操作"]').click()
  await page.waitForTimeout(300)
  await page.getByRole('menuitem', { name: '新建文件夹' }).click()
  await page.waitForTimeout(400)
  await page.locator('input[placeholder="请输入文件夹名称"]').fill('一级')
  await page.getByRole('button', { name: '创建' }).click()
  await page.waitForTimeout(1500)

  // 3) 在一级下面建二级 —— 这一层能建出来，就说明 parent 路径串在界面上是通的
  await panel.locator('button[aria-label="一级操作"]').click()
  await page.waitForTimeout(300)
  await page.getByRole('menuitem', { name: '新建文件夹' }).click()
  await page.waitForTimeout(400)
  await page.locator('input[placeholder="请输入文件夹名称"]').fill('二级')
  await page.getByRole('button', { name: '创建' }).click()
  await page.waitForTimeout(1800)

  step.uiRows = await panel.evaluate((el) => [...el.querySelectorAll('div[style*="padding-left"]')]
    .filter((d) => d.querySelector(':scope > span[draggable="true"]'))
    .map((d) => ({ indent: d.style.paddingLeft, text: d.innerText.replace(/\s+/g, ' ').trim() })))

  // 前端确实往后端写了
  const written = await getStore(token)
  step.written = {
    collections: written.collections.map((c) => c.name).filter((n) => n.startsWith('ZZ-')),
    folders: (written.folders || []).map((f) => `${f.collection}/${f.parent ? f.parent + '/' : ''}${f.name}`),
  }

  // 4) 界面删掉整个一次性集合
  await panel.locator('button[aria-label="ZZ-QA-临时操作"]').click()
  await page.waitForTimeout(300)
  await page.getByRole('menuitem', { name: '删除集合' }).click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: '删除' }).last().click()
  await page.waitForTimeout(2000)

  const restored = await getStore(token)
  step.restored = {
    collections: restored.collections.length,
    requests: restored.requests.length,
    folders: (restored.folders || []).length,
    identicalToOriginal: JSON.stringify(restored) === before,
  }
  step.originalCounts = {
    collections: original.collections.length,
    requests: original.requests.length,
    folders: (original.folders || []).length,
  }
  return step
}
