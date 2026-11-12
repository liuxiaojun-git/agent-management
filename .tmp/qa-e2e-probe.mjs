export default async function run(page, ui) {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('http://localhost:8081/login', { waitUntil: 'domcontentloaded' })
  const acct = page.getByPlaceholder('请输入账号')
  await acct.waitFor({ state: 'visible', timeout: 20000 })
  await acct.fill('admin')
  await page.getByPlaceholder('请输入密码').fill('admin@123')
  await page.getByRole('button', { name: '登录' }).first().click()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 })
  await page.goto('http://localhost:8081/api-test', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('button[aria-label="+ 新建集合"]', { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(2500)
  const buttons = await page.evaluate(() => [...document.querySelectorAll('aside')][1]
    ? [...document.querySelectorAll('aside')[1].querySelectorAll('button')].map(b => (b.getAttribute('aria-label') || b.innerText).replace(/\s+/g,' ').trim()).filter(Boolean)
    : ['NO ASIDE'])
  return { buttons, body: (await page.evaluate(() => document.body.innerText)).slice(0, 400) }
}
