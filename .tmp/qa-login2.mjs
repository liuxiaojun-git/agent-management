export default async function run(page, ui) {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('http://localhost:8081/login', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)

  const acct = page.getByPlaceholder('请输入账号')
  await acct.waitFor({ state: 'visible', timeout: 15000 })
  await acct.fill('admin')
  await page.getByPlaceholder('请输入密码').fill('admin@123')

  const resp = page.waitForResponse((r) => r.url().includes('/api/'), { timeout: 15000 }).catch(() => null)
  await page.getByRole('button', { name: '登录' }).first().click()
  const r = await resp

  await page.waitForTimeout(4000)
  return {
    url: page.url(),
    loginApi: r ? `${r.status()} ${r.url()}` : 'no /api/ call seen',
    text: (await page.locator('body').innerText()).slice(0, 200),
    storage: await page.evaluate(() => Object.keys(localStorage)),
  }
}
