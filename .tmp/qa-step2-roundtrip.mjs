// 第 2 步验收：GET 仍返回原有数据 + folders: []；POST 一个「1 个文件夹 + 1 条嵌套请求」
// 的 store 再读回来。store 是 replace-all，所以测试前后都要把原始数据原样放回去。
const BASE = 'http://localhost:3000/api'

const call = async (token, body) => {
  const res = await fetch(`${BASE}/data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let parsed
  try { parsed = JSON.parse(text) } catch { parsed = text }
  return { status: res.status, parsed }
}

const login = async () => {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin@123' }),
  })
  const body = await res.json()
  return body?.data?.access_token
}

const NAME = 'api-test-saved-requests'
const out = {}

const token = await login()
out.tokenAcquired = Boolean(token)
if (!token) {
  console.log(JSON.stringify(out, null, 2))
  process.exit(1)
}

// 1) 原样读回
const g1 = await call(token, { action: 'get', name: NAME })
const original = g1.parsed?.data
out.get1 = {
  status: g1.status,
  keys: original ? Object.keys(original) : null,
  collections: original?.collections?.length,
  folders: original?.folders,
  collapsedFolders: original?.collapsedFolders,
  requests: original?.requests?.length,
  firstRequestHasParent: original?.requests?.[0] ? 'parent' in original.requests[0] : null,
}

// 2) 写一个带文件夹和嵌套请求的 store（原数据整体保留，只做增量）
const firstCollection = original.collections[0].name
const testStore = {
  ...original,
  folders: [{ id: 'folder_qa1', name: 'QA-登录模块', collection: firstCollection }],
  collapsedFolders: { folder_qa1: true },
  requests: [
    ...original.requests,
    {
      id: 'req_qa_nested', label: 'QA 嵌套请求', method: 'GET',
      url: 'https://example.com/qa', headers: [], body: '',
      collection: firstCollection, parent: 'QA-登录模块',
      savedAt: new Date().toISOString(),
    },
  ],
}
const s1 = await call(token, { action: 'set', name: NAME, data: testStore })
out.set = { status: s1.status }

// 3) 读回来
const g2 = await call(token, { action: 'get', name: NAME })
const after = g2.parsed?.data
out.get2 = {
  status: g2.status,
  collections: after?.collections?.length,
  folders: after?.folders,
  collapsedFolders: after?.collapsedFolders,
  requests: after?.requests?.length,
  nested: after?.requests?.find((r) => r.id === 'req_qa_nested') ?? null,
  // 原有请求一条都不能少，且没人被误加上 parent
  originalsIntact: original.requests.every((r) => {
    const now = after?.requests?.find((x) => x.id === r.id)
    return now && now.label === r.label && JSON.stringify(now.parent) === JSON.stringify(r.parent)
  }),
}

// 4) 还原
const s2 = await call(token, { action: 'set', name: NAME, data: original })
const g3 = await call(token, { action: 'get', name: NAME })
out.restored = {
  status: s2.status,
  collections: g3.parsed?.data?.collections?.length,
  folders: g3.parsed?.data?.folders,
  requests: g3.parsed?.data?.requests?.length,
  matchesOriginal: JSON.stringify(g3.parsed?.data) === JSON.stringify(original),
}

console.log(JSON.stringify(out, null, 2))
