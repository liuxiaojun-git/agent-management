export default async function run(page, ui) {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('http://localhost:8081/login', { waitUntil: 'domcontentloaded' })
  const acct = page.getByPlaceholder('请输入账号')
  await acct.waitFor({ state: 'visible', timeout: 20000 })
  await acct.fill('admin')
  await page.getByPlaceholder('请输入密码').fill('admin@123')
  await page.getByRole('button', { name: '登录' }).first().click()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 })
  const afterLogin = { url: page.url(), ls: await page.evaluate(() => Object.keys(localStorage)) }
  await page.route('**/api/data', (route) => route.abort())
  await page.goto('http://localhost:8081/api-test', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  const afterNav = {
    url: page.url(),
    body: (await page.evaluate(() => document.body.innerText)).slice(0, 300),
    ls: await page.evaluate(() => Object.keys(localStorage)),
  }
  return { afterLogin, afterNav }
}
