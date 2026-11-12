// 验收：去掉折叠之后，增删改和「移动到」是否还完整。
//
// 这些路径原先都依赖 revealPath / 折叠键清理，删掉它们最可能在这里留断链。
// 全程拦掉 /api/data，造的树只进 localStorage——绝不写用户的真实库。
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

  const req = (id, label, parent, collection = 'QA集合') => ({
    id, label, method: 'GET', url: `https://example.com/${id}`,
    headers: [], body: '', collection, savedAt: '2026/01/01 00:00:00',
    ...(parent ? { parent } : {}),
  })

  const seed = () => ({
    collections: [{ name: 'QA集合', icon: '📁' }, { name: '另一个集合', icon: '📦' }],
    folders: [
      { id: 'fA', name: 'A', collection: 'QA集合' },
      { id: 'fB', name: 'B', collection: 'QA集合', parent: 'A' },
      { id: 'fC', name: 'C', collection: 'QA集合', parent: 'A/B' },
      { id: 'fD', name: 'D', collection: 'QA集合' },
    ],
    requests: [
      req('r0', '根层请求', null),
      req('r1', 'A层请求', 'A'),
      req('r2', 'AB层请求', 'A/B'),
      req('r3', 'ABC层请求', 'A/B/C'),
      req('r9', '别家请求', null, '另一个集合'),
    ],
  })

  const storageKey = await page.evaluate(() => Object.keys(localStorage)
    .find((k) => k.startsWith('api-test-saved-requests:')) || 'api-test-saved-requests:1')

  const reset = async () => {
    await page.evaluate(([key, store]) => localStorage.setItem(key, JSON.stringify(store)), [storageKey, seed()])
    await page.goto('http://localhost:8081/api-test', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('button[aria-label="A操作"]', { timeout: 20000 })
    await page.waitForTimeout(500)
  }

  const read = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey)
  const snap = (s) => ({
    folders: s.folders.map((f) => `${f.collection}/${f.parent ? `${f.parent}/` : ''}${f.name}`),
    requests: s.requests.map((r) => `${r.collection}|${r.id}|${r.parent ?? '(根)'}|${r.label}`),
    collections: s.collections.map((c) => c.name),
  })

  // 点开某一行的 ⋯ 再点某一项。scope: 'right' = 右栏的行，'left' = 左栏的集合。
  const menu = async (label, item, scope = 'right') => {
    await page.evaluate(([name, which]) => {
      const sidebars = document.querySelectorAll('aside')
      const sidebar = sidebars[sidebars.length - 1]
      const panes = sidebar.children
      const pane = which === 'left' ? panes[0] : panes[panes.length - 1]
      const trigger = [...pane.querySelectorAll('button[aria-label]')]
        .find((b) => b.getAttribute('aria-label') === `${name}操作`)
      if (!trigger) throw new Error(`找不到 ⋯ : ${name}`)
      trigger.click()
    }, [label, scope])
    await page.waitForTimeout(250)
    await page.evaluate((text) => {
      const btn = [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.innerText.trim() === text)
      if (!btn) throw new Error(`找不到菜单项: ${text}`)
      btn.click()
    }, item)
    await page.waitForTimeout(400)
  }

  const dialogInput = async (value) => {
    await page.evaluate((v) => {
      const input = document.querySelector('dialog input[type="text"], .modal input[type="text"], input[autofocus]')
        || [...document.querySelectorAll('input[type="text"]')].pop()
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, v)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }, value)
    await page.waitForTimeout(200)
  }

  const dialogClick = async (text) => {
    await page.evaluate((t) => {
      const btn = [...document.querySelectorAll('button')].filter((b) => b.innerText.trim() === t).pop()
      if (!btn) throw new Error(`找不到按钮: ${t}`)
      btn.click()
    }, text)
    await page.waitForTimeout(500)
  }

  const intoFolder = async (name) => {
    await page.evaluate((folder) => {
      const sidebars = document.querySelectorAll('aside')
      const sidebar = sidebars[sidebars.length - 1]
      const panes = sidebar.children
      const right = panes[panes.length - 1]
      const btn = [...right.querySelectorAll('button[title]')].find((b) => b.title === `进入“${folder}”`)
      if (!btn) throw new Error(`找不到文件夹 ${folder}`)
      btn.click()
    }, name)
    await page.waitForTimeout(350)
  }

  const rows = () => page.evaluate(() => {
    const sidebars = document.querySelectorAll('aside')
    const sidebar = sidebars[sidebars.length - 1]
    const panes = sidebar.children
    const right = panes[panes.length - 1]
    const folders = []
    const requests = []
    for (const row of right.querySelectorAll('div.group')) {
      const openBtn = row.querySelector('button[title^="进入“"]')
      if (openBtn) { folders.push(openBtn.getAttribute('title').replace(/^进入“|”$/g, '')); continue }
      const trigger = row.querySelector('button[aria-label$="操作"]')
      if (trigger) requests.push(trigger.getAttribute('aria-label').replace(/操作$/, ''))
    }
    return { folders, requests, title: right.children[0].innerText.trim().split('\n')[0] }
  })

  const out = {}
  // 每个用例单独兜住：一步炸了不该把后面的结果全吞掉，否则只知道"某处出错"。
  const step = async (name, fn) => {
    try {
      out[name] = await fn()
    } catch (error) {
      out[name] = { ERROR: String(error).split('\n')[0] }
    }
  }

  // --- C1 重命名中层文件夹 B→B2：C 的 parent 必须跟着重写 ---
  await step('c1_rename_middle', async () => {
    await reset()
    await intoFolder('A')
    await menu('B', '重命名')
    await dialogInput('B2')
    await dialogClick('保存')
    return snap(await read()).folders
  })

  // --- C2a 在根层删掉 A：整棵子树（B、C 及其请求）一起走 ---
  await step('c2a_delete_subtree', async () => {
    await reset()
    const before = await rows()
    await menu('A', '删除')
    await dialogClick('删除')
    await page.waitForTimeout(300)
    return { before, after: await rows(), store: snap(await read()) }
  })

  // --- C2b 站在 A 里删它的子文件夹 B：站位不在 B 里，应当留在 A 不动 ---
  await step('c2b_delete_child_keeps_position', async () => {
    await reset()
    await intoFolder('A')
    await menu('B', '删除')
    await dialogClick('删除')
    await page.waitForTimeout(300)
    return { after: await rows(), store: snap(await read()) }
  })

  // --- C3 删集合：文件夹跟着走，右栏归零 ---
  await step('c3_delete_collection', async () => {
    await reset()
    await menu('QA集合', '删除集合', 'left')
    await dialogClick('删除')
    return { after: await rows(), store: snap(await read()) }
  })

  // --- C4 重命名集合：文件夹跟着走，右栏停在同一层 ---
  await step('c4_rename_collection', async () => {
    await reset()
    await intoFolder('A')
    await menu('QA集合', '重命名集合', 'left')
    await dialogInput('QA集合改名')
    await dialogClick('保存')
    return { after: await rows(), store: snap(await read()) }
  })

  // --- C5 移动到弹窗：把 D 移进 A/B（跨层）---
  await step('c5_move_dialog_cross_level', async () => {
    await reset()
    await menu('D', '移动到')
    // 弹窗右栏钻到 A/B。弹窗里的按钮和侧栏的重名，所以限定在 [role="dialog"] 里找。
    const clickInDialog = (text) => page.evaluate((t) => {
      const dlg = document.querySelector('[role="dialog"]') || document.querySelector('.modal-box')
      const scope = dlg || document
      const b = [...scope.querySelectorAll('button')].find((x) => x.innerText.trim() === t)
      if (!b) throw new Error(`弹窗里找不到「${t}」`)
      b.click()
    }, text)
    await clickInDialog('A')
    await page.waitForTimeout(300)
    await clickInDialog('B')
    await page.waitForTimeout(300)
    const target = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]') || document.querySelector('.modal-box')
      return (dlg || document).innerText.match(/目标：.*/)?.[0]?.slice(0, 40)
    })
    await dialogClick('移动')
    return { target, store: snap(await read()).folders }
  })

  // --- C6 移动到弹窗的拦截 ---
  // 自身后代这条在 UI 上是**不可达**的：移 A 时，A 自己那行在弹窗右栏就置灰了，
  // 而面包屑又必须经过 A 才能到 A/B，所以用户根本表达不出这个非法目标。
  // 这里断言的就是这道置灰，而不是去点一个点不动的按钮。
  await step('c6a_self_subtree_disabled', async () => {
    await reset()
    await menu('A', '移动到')
    await page.waitForTimeout(300)
    const state = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]')
      const rowFor = (name) => [...dlg.querySelectorAll('button')].find((b) => b.innerText.trim() === name)
      return {
        rowA: { disabled: rowFor('A')?.disabled, opacity: getComputedStyle(rowFor('A')).opacity },
        rowD: { disabled: rowFor('D')?.disabled },
      }
    })
    await dialogClick('取消')
    return state
  })

  await step('c6b_same_place_blocked', async () => {
    await reset()
    await menu('D', '移动到')
    await page.waitForTimeout(300)
    const state = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]') || document.querySelector('.modal-box')
      const confirm = [...dlg.querySelectorAll('button')].filter((b) => /移动|当前位置/.test(b.innerText.trim())).pop()
      return { confirmText: confirm?.innerText.trim(), confirmDisabled: confirm?.disabled }
    })
    await dialogClick('取消')
    return state
  })

  await step('c6c_sibling_name_blocked', async () => {
    await reset()
    // 站到 A 里，把请求「A层请求」重命名成 B——A 里已经有个文件夹叫 B。
    // 错误是提交时判的，所以必须真的点保存，取消是看不到报错的。
    await intoFolder('A')
    await menu('A层请求', '重命名')
    await dialogInput('B')
    await dialogClick('保存')
    const state = await page.evaluate(() => ({
      alert: [...document.querySelectorAll('[role="alert"]')].map((n) => n.innerText),
      dialogStillOpen: !!document.querySelector('[role="dialog"]'),
    }))
    await dialogClick('取消')
    return { ...state, store: snap(await read()).requests }
  })

  return out
}
