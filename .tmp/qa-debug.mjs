export default async function run(page, ui) {
  const api = []
  page.on('response', (r) => {
    if (r.url().includes('/api/')) api.push(`${r.status()} ${r.url().replace('http://localhost:3000','')}`)
  })

  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('http://localhost:8081/login', { waitUntil: 'domcontentloaded' })
  const acct = page.getByPlaceholder('请输入账号')
  await acct.waitFor({ state: 'visible', timeout: 20000 })
  await acct.fill('admin')
  await page.getByPlaceholder('请输入密码').fill('admin@123')
  await page.getByRole('button', { name: '登录' }).first().click()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 })
  await page.waitForTimeout(1500)

  const beforeNav = await page.evaluate(() => ({
    url: location.pathname,
    hasToken: !!localStorage.getItem('access_token'),
    user: localStorage.getItem('user'),
  }))

  // 换用客户端路由而不是整页 reload，看看是不是「刷新后掉登录」
  await page.goto('http://localhost:8081/api-test', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(8000)

  const afterNav = await page.evaluate(() => ({
    url: location.pathname,
    hasToken: !!localStorage.getItem('access_token'),
    user: localStorage.getItem('user'),
    bodyText: document.body.innerText.slice(0, 200),
    asides: [...document.querySelectorAll('aside')].map((a) => a.innerText.slice(0, 60)),
  }))

  return { beforeNav, afterNav, api: [...new Set(api)] }
}
