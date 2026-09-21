import { chromium } from 'playwright'

const BASE = 'http://localhost:8081'
const API = 'http://localhost:3000'

// 用真实后端登录拿新鲜 token，再注入 localStorage（绕过 CORS 直接走 Vite 代理）
async function login() {
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin@123' }),
  })
  const json = await res.json()
  if (!json.data?.access_token) throw new Error(`登录失败: ${JSON.stringify(json)}`)
  return { token: json.data.access_token, user: json.data.user }
}

const { token, user } = await login()

const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage()

const consoleErrors = []
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
page.on('pageerror', (err) => consoleErrors.push('PAGEERROR: ' + err.message))

const convTraffic = []
page.on('request', (req) => {
  if (req.url().includes('/api/knowledge/conversations')) convTraffic.push({ method: req.method() })
})
page.on('response', (res) => {
  if (res.url().includes('/api/knowledge/conversations')) {
    const last = convTraffic[convTraffic.length - 1]
    if (last && !last.status) last.status = res.status()
  }
})

await page.addInitScript(({ token, user }) => {
  localStorage.setItem('access_token', token)
  localStorage.setItem('user', JSON.stringify(user))
}, { token, user })

await page.goto(`${BASE}/knowledge`, { waitUntil: 'domcontentloaded' })

// 1) 等待知识库加载出来
const lib = page.locator('button', { hasText: 'Qingzhou' }).first()
await lib.waitFor({ state: 'visible', timeout: 20000 })
await lib.click()

// 2) 等待聊天输入框就绪
const textarea = page.locator('textarea[placeholder="基于知识库提问"]')
await textarea.waitFor({ state: 'visible', timeout: 10000 })

// 3) 提问（POST /api/knowledge/conversations 应在提问瞬间发出，并因后端未实现而 404）
await textarea.fill('你好，请介绍一下你自己')
await textarea.press('Enter')

// 4) 等助手回复渲染（真实后端 /ask 已实现会返回回答；若失败则出现「问答失败」）
await page.waitForTimeout(8000)

const bodyText = await page.locator('body').innerText()
const userMsgRendered = bodyText.includes('你好，请介绍一下你自己')
const assistantRendered = bodyText.includes('问答失败') || /管理员|抱歉|你好|当前知识库|没有足够信息/.test(bodyText)

// 5) 刷新页面：后端未实现契约 → 会话不落库 → 提问记录消失（优雅降级，页面不崩）
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)
const afterReload = await page.locator('body').innerText()
const convLostAfterReload = !afterReload.includes('你好，请介绍一下你自己')

console.log(JSON.stringify({
  convTraffic,                 // 应包含 GET(加载) + POST(提问)
  userMsgRendered,             // 提问后用户消息在内存中渲染
  assistantRendered,           // 助手回复渲染（真实 /ask 回答或失败文案）
  convLostAfterReload,         // 后端未实现 → 刷新后记录消失（预期，过渡期降级）
  consoleErrors,               // 应无未捕获异常
}, null, 2))

await browser.close()
