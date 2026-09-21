export default async function run(page, ui) {
  await ui.fill('@e1', 'admin')
  await ui.fill('@e2', 'admin@123')
  await ui.click('@e4')
  await page.waitForTimeout(4000)
  return {
    url: page.url(),
    text: (await page.locator('body').innerText()).slice(0, 300),
    storage: await page.evaluate(() => Object.keys(localStorage)),
  }
}
