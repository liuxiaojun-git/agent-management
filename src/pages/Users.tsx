import { useEffect, useState } from 'react'
import Pagination from '../components/Pagination'
import SearchInput from '../components/SearchInput'
// base URL 已收敛到 utils/apiBase.ts（原本此处有一份与另外 3 个文件逐字重复的定义）
import { V1_BASE } from '../utils/apiBase'

interface UserRecord {
  id: string
  username: string
  nickname: string | null
  status: number
  createdAt: string
}

// v1 用户列表是分页的 pagedResult（items + total）。
interface UserListResponse {
  items: UserRecord[]
  total: number
}

type ConfigurablePermission = 'home' | 'knowledge' | 'api_test' | 'logs' | 'models'
const menuOptions: Array<{ code: ConfigurablePermission; label: string; description: string }> = [
  { code: 'home', label: '首页', description: '查看平台概览与统计信息' },
  { code: 'knowledge', label: '知识库', description: '管理知识内容并使用知识问答' },
  { code: 'api_test', label: 'API 测试', description: '使用接口测试与请求管理功能' },
  { code: 'logs', label: '日志', description: '查看运行日志和操作日志' },
  { code: 'models', label: '模型', description: '查看和管理模型服务配置' },
]

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

function UserTable({ users, onEdit, onDelete, onConfig }: { users: UserRecord[]; onEdit: (user: UserRecord) => void; onDelete: (user: UserRecord) => void; onConfig: (user: UserRecord) => void }) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  useEffect(() => {
    const closeMenu = () => setOpenMenuId(null)
    document.addEventListener('click', closeMenu)
    return () => document.removeEventListener('click', closeMenu)
  }, [])
  const filtered = users.filter((user) => {
    const keyword = search.trim().toLowerCase()
    return !keyword || user.username.toLowerCase().includes(keyword) || (user.nickname || '').toLowerCase().includes(keyword)
  })
  const totalPages = Math.ceil(filtered.length / pageSize)
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-4 flex shrink-0 flex-wrap items-center gap-3">
        <SearchInput placeholder="搜索账号或名称" value={search} onChange={(value) => { setSearch(value); setPage(1) }} />
      </div>
      <div className="overflow-auto rounded-lg bg-base-100" style={{ height: 'calc(100vh - 140px)' }}>
        <div className="flex min-h-full flex-col">
          <div className="flex-1">
            <table className="table table-fixed w-full text-base">
          <thead>
            <tr className="text-base text-base-content/60">
              <th className="sticky top-0 z-10 w-52 bg-base-100 text-sm">创建时间</th>
              <th className="sticky top-0 z-10 w-48 bg-base-100 text-sm">账号</th>
              <th className="sticky top-0 z-10 w-48 bg-base-100 text-sm">名称</th>
              <th className="sticky top-0 z-10 w-28 bg-base-100 text-sm">状态</th>
              <th className="sticky top-0 z-10 w-24 bg-base-100 text-center text-sm">操作</th>
            </tr>
          </thead>
          <tbody>
            {!filtered.length ? (
              <tr>
                <td colSpan={5} className="py-16 text-center text-base-content/20">
                  <div className="flex flex-col items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /></svg>
                    <span className="text-sm">暂无用户</span>
                  </div>
                </td>
              </tr>
            ) : paged.map((user) => (
              <tr key={user.id} className="transition-colors hover:bg-base-200">
                <td className="w-52 truncate whitespace-nowrap text-sm text-base-content" title={formatDate(user.createdAt)}>{formatDate(user.createdAt)}</td>
                <td className="w-48 truncate text-sm font-medium text-base-content" title={user.username}>{user.username}</td>
                <td className="w-48 truncate text-sm text-base-content" title={user.nickname || '-'}>{user.nickname || '-'}</td>
                <td>
                  <span className={`inline-flex h-6 items-center rounded-sm px-2 text-sm font-medium text-white ${Number(user.status) === 1 ? 'bg-success' : 'bg-base-content/30'}`}>
                    {Number(user.status) === 1 ? '启用' : '停用'}
                  </span>
                </td>
                <td className="w-24 text-center text-sm">
                  <div className="relative inline-flex" onClick={(event) => event.stopPropagation()}>
                    <button
                      type="button"
                      className={`btn btn-ghost btn-sm btn-square ${openMenuId === user.id ? 'bg-base-200' : ''}`}
                      aria-label="用户操作"
                      aria-haspopup="menu"
                      aria-expanded={openMenuId === user.id}
                      onClick={() => setOpenMenuId((current) => current === user.id ? null : user.id)}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" />
                      </svg>
                    </button>
                    {openMenuId === user.id && (
                      <ul role="menu" className="absolute right-0 top-full z-30 mt-1 w-28 rounded-lg border border-base-200 bg-base-100 p-1 text-left shadow-lg">
                        <li><button type="button" role="menuitem" className="w-full rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-base-200" onClick={() => { setOpenMenuId(null); onEdit(user) }}>编辑</button></li>
                        <li><button type="button" role="menuitem" className="w-full rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-base-200" onClick={() => { setOpenMenuId(null); onConfig(user) }}>配置</button></li>
                        <li><button type="button" role="menuitem" className="w-full rounded-md px-3 py-2 text-left text-sm text-error transition-colors hover:bg-error/10" onClick={() => { setOpenMenuId(null); onDelete(user) }}>删除</button></li>
                      </ul>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
            </table>
          </div>
          <div className="sticky bottom-0 flex justify-end border-t border-base-200 bg-base-100 px-4 py-3">
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              totalItems={filtered.length}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Users() {
  const [users, setUsers] = useState<UserRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState('')
  const [form, setForm] = useState({ username: '', nickname: '', password: '', confirmPassword: '', status: 1 })
  const [editing, setEditing] = useState<UserRecord | null>(null)
  const [editForm, setEditForm] = useState({ username: '', nickname: '', password: '', confirmPassword: '', status: 1 })
  const [editError, setEditError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<UserRecord | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [configTarget, setConfigTarget] = useState<UserRecord | null>(null)
  const [permissions, setPermissions] = useState<ConfigurablePermission[]>([])
  const [configLoading, setConfigLoading] = useState(false)
  const [configError, setConfigError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    const loadUsers = async () => {
      try {
        const token = localStorage.getItem('access_token')
        // v1 用户列表是分页的，逐页拼全量（用户量小，通常 1 页，但 pageSize 上限 100 会静默截断）。
        const all: UserRecord[] = []
        const pageSize = 100
        for (let page = 1; ; page += 1) {
          const response = await fetch(`${V1_BASE}/users?page=${page}&pageSize=${pageSize}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            signal: controller.signal,
          })
          const result = await response.json()
          if (!response.ok || result.code !== 0) throw new Error(result.message || '用户数据加载失败')
          const pageData = result.data as UserListResponse
          all.push(...(pageData.items || []))
          if (all.length >= pageData.total || !pageData.items?.length) break
        }
        setUsers(all)
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        setError(reason instanceof Error ? reason.message : '用户数据加载失败')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void loadUsers()
    return () => controller.abort()
  }, [])

  const closeCreate = () => {
    if (creating) return
    setShowCreate(false)
    setFormError('')
    setForm({ username: '', nickname: '', password: '', confirmPassword: '', status: 1 })
  }

  const createUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!form.username.trim()) return setFormError('请输入账号')
    if (form.password.length < 8) return setFormError('初始密码至少8个字符')
    if (form.password !== form.confirmPassword) return setFormError('两次输入的密码不一致')
    setCreating(true)
    setFormError('')
    try {
      const token = localStorage.getItem('access_token')
      const response = await fetch(`${V1_BASE}/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          username: form.username.trim(),
          nickname: form.nickname.trim(),
          password: form.password,
          status: form.status,
        }),
      })
      const result = await response.json()
      if (!response.ok || result.code !== 0) throw new Error(result.message || '用户创建失败')
      setUsers((current) => [result.data.user as UserRecord, ...current])
      setShowCreate(false)
      setForm({ username: '', nickname: '', password: '', confirmPassword: '', status: 1 })
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : '用户创建失败')
    } finally {
      setCreating(false)
    }
  }

  const openEdit = (user: UserRecord) => {
    setEditing(user)
    setEditError('')
    setEditForm({ username: user.username, nickname: user.nickname || '', password: '', confirmPassword: '', status: Number(user.status) })
  }

  const saveUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editing) return
    if (!editForm.username.trim()) return setEditError('请输入账号')
    if (editForm.password && editForm.password.length < 8) return setEditError('新密码至少8个字符')
    if (editForm.password !== editForm.confirmPassword) return setEditError('两次输入的密码不一致')
    setSaving(true)
    setEditError('')
    try {
      const token = localStorage.getItem('access_token')
      const response = await fetch(`${V1_BASE}/users/${editing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ username: editForm.username.trim(), nickname: editForm.nickname.trim(), password: editForm.password, status: editForm.status }),
      })
      const result = await response.json()
      if (!response.ok || result.code !== 0) throw new Error(result.message || '用户更新失败')
      setUsers((current) => current.map((user) => user.id === editing.id ? result.data.user as UserRecord : user))
      setEditing(null)
    } catch (reason) {
      setEditError(reason instanceof Error ? reason.message : '用户更新失败')
    } finally {
      setSaving(false)
    }
  }

  const deleteUser = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const token = localStorage.getItem('access_token')
      const response = await fetch(`${V1_BASE}/users/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const result = await response.json()
      if (!response.ok || result.code !== 0) throw new Error(result.message || '用户删除失败')
      setUsers((current) => current.filter((user) => user.id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '用户删除失败')
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  const openConfig = async (user: UserRecord) => {
    setConfigTarget(user)
    setPermissions([])
    setConfigLoading(true)
    setConfigError('')
    try {
      const token = localStorage.getItem('access_token')
      const response = await fetch(`${V1_BASE}/users/${user.id}/permissions`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const result = await response.json()
      if (!response.ok || result.code !== 0) throw new Error(result.message || '菜单权限加载失败')
      setPermissions(result.data.permissions as ConfigurablePermission[])
    } catch (reason) {
      setConfigError(reason instanceof Error ? reason.message : '菜单权限加载失败')
    } finally {
      setConfigLoading(false)
    }
  }

  const savePermissions = async () => {
    if (!configTarget) return
    if (!permissions.length) return setConfigError('请至少选择一个一级菜单')
    setConfigLoading(true)
    setConfigError('')
    try {
      const token = localStorage.getItem('access_token')
      const response = await fetch(`${V1_BASE}/users/${configTarget.id}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ permissions }),
      })
      const result = await response.json()
      if (!response.ok || result.code !== 0) throw new Error(result.message || '菜单权限保存失败')
      setConfigTarget(null)
    } catch (reason) {
      setConfigError(reason instanceof Error ? reason.message : '菜单权限保存失败')
    } finally {
      setConfigLoading(false)
    }
  }

  if (loading) return <div className="flex h-full items-center justify-center"><span className="loading loading-spinner loading-lg text-primary" /></div>

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex shrink-0 items-center justify-between">
        <h1 className="text-2xl font-bold">用户管理</h1>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          新增用户
        </button>
      </div>
      {error ? (
        <div role="alert" className="alert alert-error"><span>{error}</span></div>
      ) : (
        <UserTable users={users} onEdit={openEdit} onDelete={setDeleteTarget} onConfig={openConfig} />
      )}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={closeCreate}>
          <form className="w-full max-w-lg rounded-box bg-base-100 p-6 shadow-xl" onSubmit={createUser} onClick={(event) => event.stopPropagation()}>
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-lg font-bold">新增用户</h2>
              <button type="button" className="btn btn-ghost btn-square btn-sm" onClick={closeCreate} aria-label="关闭">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            {formError && <div role="alert" className="alert alert-error mb-4 py-2 text-sm"><span>{formError}</span></div>}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="form-control sm:col-span-2">
                <span className="mb-1 block text-sm text-base-content/70">账号 <span className="text-error">*</span></span>
                <input className="input input-bordered w-full" value={form.username} maxLength={64} autoFocus placeholder="3-64位字母、数字或下划线" onChange={(event) => setForm({ ...form, username: event.target.value })} />
              </label>
              <label className="form-control sm:col-span-2">
                <span className="mb-1 block text-sm text-base-content/70">名称</span>
                <input className="input input-bordered w-full" value={form.nickname} maxLength={64} placeholder="请输入名称" onChange={(event) => setForm({ ...form, nickname: event.target.value })} />
              </label>
              <label className="form-control">
                <span className="mb-1 block text-sm text-base-content/70">初始密码 <span className="text-error">*</span></span>
                <input type="password" className="input input-bordered w-full" value={form.password} maxLength={72} autoComplete="new-password" placeholder="至少8个字符" onChange={(event) => setForm({ ...form, password: event.target.value })} />
              </label>
              <label className="form-control">
                <span className="mb-1 block text-sm text-base-content/70">确认密码 <span className="text-error">*</span></span>
                <input type="password" className="input input-bordered w-full" value={form.confirmPassword} maxLength={72} autoComplete="new-password" placeholder="再次输入密码" onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} />
              </label>
              <label className="form-control sm:col-span-2">
                <span className="mb-1 block text-sm text-base-content/70">账号状态</span>
                <select className="select select-bordered w-full" value={form.status} onChange={(event) => setForm({ ...form, status: Number(event.target.value) })}>
                  <option value={1}>启用</option>
                  <option value={0}>停用</option>
                </select>
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" className="btn btn-ghost" onClick={closeCreate} disabled={creating}>取消</button>
              <button type="submit" className="btn btn-primary" disabled={creating}>
                {creating && <span className="loading loading-spinner loading-sm" />}
                创建用户
              </button>
            </div>
          </form>
        </div>
      )}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !saving && setEditing(null)}>
          <form className="w-full max-w-lg rounded-box bg-base-100 p-6 shadow-xl" onSubmit={saveUser} onClick={(event) => event.stopPropagation()}>
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-lg font-bold">编辑用户</h2>
              <button type="button" className="btn btn-ghost btn-square btn-sm" onClick={() => setEditing(null)} disabled={saving} aria-label="关闭">✕</button>
            </div>
            {editError && <div role="alert" className="alert alert-error mb-4 py-2 text-sm"><span>{editError}</span></div>}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="form-control sm:col-span-2"><span className="mb-1 block text-sm text-base-content/70">账号 <span className="text-error">*</span></span><input className="input input-bordered w-full" value={editForm.username} maxLength={64} onChange={(event) => setEditForm({ ...editForm, username: event.target.value })} /></label>
              <label className="form-control sm:col-span-2"><span className="mb-1 block text-sm text-base-content/70">名称</span><input className="input input-bordered w-full" value={editForm.nickname} maxLength={64} onChange={(event) => setEditForm({ ...editForm, nickname: event.target.value })} /></label>
              <label className="form-control"><span className="mb-1 block text-sm text-base-content/70">新密码</span><input type="password" className="input input-bordered w-full" value={editForm.password} maxLength={72} autoComplete="new-password" placeholder="留空则不修改" onChange={(event) => setEditForm({ ...editForm, password: event.target.value })} /></label>
              <label className="form-control"><span className="mb-1 block text-sm text-base-content/70">确认新密码</span><input type="password" className="input input-bordered w-full" value={editForm.confirmPassword} maxLength={72} autoComplete="new-password" placeholder="再次输入新密码" onChange={(event) => setEditForm({ ...editForm, confirmPassword: event.target.value })} /></label>
              <label className="form-control sm:col-span-2"><span className="mb-1 block text-sm text-base-content/70">账号状态</span><select className="select select-bordered w-full" value={editForm.status} onChange={(event) => setEditForm({ ...editForm, status: Number(event.target.value) })}><option value={1}>启用</option><option value={0}>停用</option></select></label>
            </div>
            <div className="mt-6 flex justify-end gap-3"><button type="button" className="btn btn-ghost" onClick={() => setEditing(null)} disabled={saving}>取消</button><button type="submit" className="btn btn-primary" disabled={saving}>{saving && <span className="loading loading-spinner loading-sm" />}保存</button></div>
          </form>
        </div>
      )}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !deleting && setDeleteTarget(null)}>
          <div className="w-full max-w-sm rounded-box bg-base-100 p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <h2 className="text-lg font-bold">删除用户</h2>
            <p className="mt-3 text-sm text-base-content/70">确定删除用户“{deleteTarget.nickname || deleteTarget.username}”吗？该用户的关联数据也会一并删除。</p>
            <div className="mt-6 flex justify-end gap-3"><button className="btn btn-ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>取消</button><button className="btn btn-error" onClick={deleteUser} disabled={deleting}>{deleting && <span className="loading loading-spinner loading-sm" />}确认删除</button></div>
          </div>
        </div>
      )}
      {configTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !configLoading && setConfigTarget(null)}>
          <div className="w-full max-w-lg rounded-box bg-base-100 p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <div><h2 className="text-lg font-bold">配置一级菜单</h2><p className="mt-1 text-sm text-base-content/50">用户：{configTarget.nickname || configTarget.username}</p></div>
              <button className="btn btn-ghost btn-square btn-sm" onClick={() => setConfigTarget(null)} disabled={configLoading} aria-label="关闭">✕</button>
            </div>
            {configError && <div role="alert" className="alert alert-error my-4 py-2 text-sm"><span>{configError}</span></div>}
            {configLoading && !permissions.length ? (
              <div className="flex justify-center py-12"><span className="loading loading-spinner text-primary" /></div>
            ) : (
              <div className="mt-5 divide-y divide-base-200 rounded-lg border border-base-200">
                {menuOptions.map((option) => (
                  <label key={option.code} className="flex cursor-pointer items-center gap-4 px-4 py-3 hover:bg-base-200/60">
                    <input type="checkbox" className="checkbox checkbox-primary" checked={permissions.includes(option.code)} onChange={(event) => setPermissions((current) => event.target.checked ? [...current, option.code] : current.filter((code) => code !== option.code))} />
                    <span className="flex flex-col"><span className="text-sm font-medium">{option.label}</span><span className="text-xs text-base-content/50">{option.description}</span></span>
                  </label>
                ))}
              </div>
            )}
            <div className="mt-6 flex justify-end gap-3"><button className="btn btn-ghost" onClick={() => setConfigTarget(null)} disabled={configLoading}>取消</button><button className="btn btn-primary" onClick={savePermissions} disabled={configLoading}>{configLoading && <span className="loading loading-spinner loading-sm" />}保存配置</button></div>
          </div>
        </div>
      )}
    </div>
  )
}
