// 第 5 步验收：文件夹增删改，以及集合改名/删除时文件夹跟着走。
// 全程拦掉 /api/data，只动 localStorage。
export default async function run(page, ui) {
  const log = {}
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('http://localhost:8081/login', { waitUntil: 'domcontentloaded' })
  const acct = page.getByPlaceholder('请输入账号')
  await acct.waitFor({ state: 'visible', timeout: 20000 })
  await acct.fill('admin')
  await page.getByPlaceholder('请输入密码').fill('admin@123')
  await page.getByRole('button', { name: '登录' }).first().click()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 })
  await page.route('**/api/data', (route) => route.abort())

  const seed = {
    collections: [{ name: 'QA集合', icon: '📁' }, { name: '别的集合', icon: '📁' }],
    folders: [
      { id: 'f1', name: 'A', collection: 'QA集合' },
      { id: 'f2', name: 'B', collection: 'QA集合', parent: 'A' },
      { id: 'f3', name: 'C', collection: 'QA集合', parent: 'A/B' },
    ],
    requests: [
      { id: 'r1', label: 'A层', method: 'GET', url: 'https://e.com/1', headers: [], body: '', collection: 'QA集合', parent: 'A', savedAt: 'x' },
      { id: 'r2', label: 'AB层', method: 'GET', url: 'https://e.com/2', headers: [], body: '', collection: 'QA集合', parent: 'A/B', savedAt: 'x' },
      { id: 'r0', label: '根层', method: 'GET', url: 'https://e.com/0', headers: [], body: '', collection: 'QA集合', savedAt: 'x' },
    ],
    collapsedCollections: {}, collapsedFolders: {},
  }
  const writeSeed = (store) => page.evaluate((s) => {
    const k = Object.keys(localStorage).find((x) => x.startsWith('api-test-saved-requests:')) || 'api-test-saved-requests:1'
    localStorage.setItem(k, JSON.stringify(s))
    return k
  }, store)
  const reload = async () => {
    await page.goto('http://localhost:8081/api-test', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(4500)
  }
  const readStore = () => page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith('api-test-saved-requests:')) || 'api-test-saved-requests:1'
    return JSON.parse(localStorage.getItem(k))
  })
  const readRows = () => page.locator('aside').nth(1).evaluate((el) => {
    const out = []
    for (const d of el.querySelectorAll('div[style*="padding-left"]')) {
      const t = d.innerText.replace(/\s+/g, ' ').trim()
      if (!t || out.some((o) => o.text.includes(t))) continue
      out.push({ indent: d.style.paddingLeft, text: t })
    }
    return out
  })
  const menu = async (label, item) => {
    await page.getByRole('button', { name: label }).first().click()
    await page.waitForTimeout(700)
    // 菜单项是 role=menuitem，不是 button
    await page.getByRole('menuitem', { name: item, exact: true }).first().click()
    await page.waitForTimeout(900)
  }

  const key = await writeSeed(seed)

  // --- 1) 新建文件夹（集合根层）---
  await reload()
  log.baseline = await readRows()
  await menu('QA集合操作', '新建文件夹')
  await page.getByPlaceholder('请输入文件夹名称').fill('新文件夹')
  await page.getByRole('button', { name: '创建' }).click()
  await page.waitForTimeout(1200)
  log.afterCreate = { rows: await readRows(), folders: (await readStore()).folders }

  // --- 2) 重命名中层文件夹 A → Z，后代路径应整体重写 ---
  await menu('A操作', '重命名')
  const renameInput = page.getByPlaceholder('请输入文件夹名称')
  await renameInput.fill('Z')
  await page.getByRole('button', { name: '保存' }).last().click()
  await page.waitForTimeout(1500)
  const afterRename = await readStore()
  log.afterRename = {
    rows: await readRows(),
    folders: afterRename.folders.map((f) => `${f.name}@${f.parent ?? '-'}`),
    requests: afterRename.requests.map((r) => `${r.label}@${r.parent ?? '-'}`),
    collapsedFolders: afterRename.collapsedFolders,
  }

  // --- 3) 删除 Z（连带整棵子树）---
  await menu('Z操作', '删除')
  const dialogText = await page.locator('[role="dialog"], .fixed').first().innerText().catch(() => '')
  await page.getByRole('button', { name: '删除' }).last().click()
  await page.waitForTimeout(1500)
  const afterDelete = await readStore()
  log.afterDelete = {
    dialogText: dialogText.replace(/\s+/g, ' ').slice(0, 160),
    rows: await readRows(),
    folders: afterDelete.folders.length,
    requests: afterDelete.requests.map((r) => r.label),
  }

  // --- 4) 集合改名，文件夹跟着走 ---
  await writeSeed(seed)
  await reload()
  await menu('QA集合操作', '重命名集合')
  await page.getByPlaceholder('请输入集合名称').fill('改名后的集合')
  await page.getByRole('button', { name: '保存' }).last().click()
  await page.waitForTimeout(1500)
  const afterCollRename = await readStore()
  log.afterCollectionRename = {
    folders: afterCollRename.folders.map((f) => `${f.name}@${f.collection}@${f.parent ?? '-'}`),
    collapsedFolders: afterCollRename.collapsedFolders,
  }

  return log
}
