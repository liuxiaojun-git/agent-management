import { useCallback, useEffect, useMemo, useState } from 'react'
import Pagination from '../components/Pagination'
import SearchInput from '../components/SearchInput'
// base URL 已收敛到 utils/apiBase.ts（原本此处有一份与另外 3 个文件逐字重复的定义）
import { V1_BASE } from '../utils/apiBase'
import { RowMenuTrigger, RowMenuPopover, MenuAction } from '../components/OperationUI'
import { useRowMenu, menuIcons } from '../components/operationMenu'

interface UserRecord {
  id: string
  username: string
  nickname: string | null
  status: number
  orgNodeId?: number | null
  createdAt: string
}

// v1 用户列表是分页的 pagedResult（items + total）。
interface UserListResponse {
  items: UserRecord[]
  total: number
}

type ConfigurablePermission = 'home' | 'knowledge' | 'api_test' | 'logs' | 'models' | 'ai'
const menuOptions: Array<{ code: ConfigurablePermission; label: string; description: string }> = [
  { code: 'home', label: '首页', description: '查看平台概览与统计信息' },
  { code: 'knowledge', label: '知识库', description: '管理知识内容并使用知识问答' },
  { code: 'ai', label: 'AI 工作台', description: '使用 AI 对话、个人提示词模板和任务中心' },
  { code: 'api_test', label: 'API 测试', description: '使用接口测试与请求管理功能' },
  { code: 'logs', label: '日志', description: '查看运行日志和操作日志' },
  { code: 'models', label: '模型', description: '查看和管理模型服务配置' },
]

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

function displayName(user: { nickname: string | null; username: string }) {
  return user.nickname || user.username
}

function UserTable({ users, orgNameById, onEdit, onDelete, onConfig, onResetPassword, onCreate }: { users: UserRecord[]; orgNameById: Map<number, string>; onEdit: (user: UserRecord) => void; onDelete: (user: UserRecord) => void; onConfig: (user: UserRecord) => void; onResetPassword: (user: UserRecord) => void; onCreate: () => void }) {
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
  const orgLabel = (user: UserRecord) => (user.orgNodeId == null ? '未分配' : (orgNameById.get(user.orgNodeId) ?? '未分配'))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 「新增用户」放在这一行，与搜索框左右对齐同一水平线，不再顶到大标题那一排。 */}
      <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3">
        <SearchInput placeholder="搜索账号或名称" value={search} onChange={(value) => { setSearch(value); setPage(1) }} />
        <button type="button" className="btn btn-primary" onClick={onCreate}>
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          新增用户
        </button>
      </div>
      {/* 高度取"父容器剩下的全部"（flex-1 + min-h-0），不写 calc(100vh - Npx) ——
          那个 N 是页头高度的近似值，页头一变（如页签挪到标题下方）就会溢出，
          于是 <main> 出现滚动条，大标题跟着滚走，切换页签时位置还会跳。 */}
      <div className="min-h-0 flex-1 overflow-auto rounded-lg bg-base-100">
        <div className="flex min-h-full flex-col">
          <div className="flex-1">
            <table className="table table-fixed w-full text-base">
          <thead>
            <tr className="text-base text-base-content/60">
              <th className="sticky top-0 z-10 w-52 bg-base-100 text-sm">创建时间</th>
              <th className="sticky top-0 z-10 w-48 bg-base-100 text-sm">账号</th>
              <th className="sticky top-0 z-10 w-48 bg-base-100 text-sm">名称</th>
              <th className="sticky top-0 z-10 w-72 bg-base-100 text-sm">所属单位部门</th>
              <th className="sticky top-0 z-10 w-28 bg-base-100 text-sm">状态</th>
              <th className="sticky top-0 z-10 w-24 bg-base-100 text-center text-sm">操作</th>
            </tr>
          </thead>
          <tbody>
            {!filtered.length ? (
              <tr>
                <td colSpan={6} className="py-16 text-center text-base-content/20">
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
                <td className="w-72 truncate text-sm text-base-content" title={orgLabel(user)}>{orgLabel(user)}</td>
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
                        <li><button type="button" role="menuitem" className="w-full rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-base-200" onClick={() => { setOpenMenuId(null); onResetPassword(user) }}>重置密码</button></li>
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

interface OrgNode {
  id: number
  name: string
  parentId: number
  sortOrder: number
  createdAt: string
  updatedAt: string
  children: OrgNode[]
}

interface OrgMember {
  id: string
  username: string
  nickname: string | null
  status: number
}

// 组织架构：左右结构 —— 左侧层级树（可选中，支持新增子层级 / 重命名 / 删除子树），
// 右侧当前选中层级下的用户（可加入 / 移出）。单根（parentId === 0），根节点不可删除。
// 树浅、节点少，每次变更后整树重载 —— 读-改-读比本地 diff 更省心也更稳。
function OrgTree() {
  const [tree, setTree] = useState<OrgNode | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [addParent, setAddParent] = useState<OrgNode | null>(null)
  const [addName, setAddName] = useState('')
  const [addError, setAddError] = useState('')
  const [adding, setAdding] = useState(false)
  const [renameTarget, setRenameTarget] = useState<OrgNode | null>(null)
  const [renameName, setRenameName] = useState('')
  const [renameError, setRenameError] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<OrgNode | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [members, setMembers] = useState<OrgMember[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [membersError, setMembersError] = useState('')
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [showAddUser, setShowAddUser] = useState(false)
  const [allUsers, setAllUsers] = useState<UserRecord[]>([])
  const [addUserLoading, setAddUserLoading] = useState(false)
  const [addUserError, setAddUserError] = useState('')
  const [assigningId, setAssigningId] = useState<string | null>(null)

  // 层级节点「⋯」操作菜单（与知识库同一套 useRowMenu 状态机与浮层外观）。
  const { openMenuId, menuAnchor, panelRef, toggle: toggleRowMenu, close: closeRowMenu } = useRowMenu()

  const nodeMap = useMemo(() => {
    const map = new Map<number, OrgNode>()
    const walk = (node: OrgNode) => { map.set(node.id, node); node.children.forEach(walk) }
    if (tree) walk(tree)
    return map
  }, [tree])

  const loadMembers = useCallback(async (nodeId: number) => {
    setMembersLoading(true)
    setMembersError('')
    try {
      const token = localStorage.getItem('access_token')
      const response = await fetch(`${V1_BASE}/org/${nodeId}/users`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const result = await response.json()
      if (!response.ok || result.code !== 0) throw new Error(result.message || '层级用户加载失败')
      setMembers(result.data.users as OrgMember[])
    } catch (reason) {
      setMembersError(reason instanceof Error ? reason.message : '层级用户加载失败')
    } finally {
      setMembersLoading(false)
    }
  }, [])

  const loadTree = useCallback(async () => {
    try {
      const token = localStorage.getItem('access_token')
      const response = await fetch(`${V1_BASE}/org`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const result = await response.json()
      if (!response.ok || result.code !== 0) throw new Error(result.message || '组织架构加载失败')
      setTree(result.data.tree as OrgNode | null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '组织架构加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  // 挂载时拉组织树。
  // react-hooks/set-state-in-effect 要求别在 effect 里取数，但本项目没有数据层，effect 取数是
  // 既有架构里的唯一写法；且 `loadTree` 全程只在 await 之后 setState，不存在规则担心的同步级联
  // 渲染 —— 规则追不过 await 边界，只要从 effect 能追到 setState 就报，属误报。
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 取数函数只在 await 之后 setState，规则追不过 await 边界
    void loadTree()
  }, [loadTree])

  // 首次加载、或选中节点已被删除时，回落到根节点并加载其成员；其余重载保持当前选中不变。
  // `setSelectedId` 是**同步** setState，本可按 React 文档改成"渲染期调整"，但实测走不通：派生掉
  // 这行之后规则立刻会报同一 effect 里的 loadMembers（同样是从 effect 可达的 setState），而
  // loadMembers 必须等 tree 到位才有 id 可加载，派生不出来。同一"effect 取数"前提下豁免。
  useEffect(() => {
    if (!tree) return
    if (selectedId == null || !nodeMap.has(selectedId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 回落选中；同 effect 的加载调用无法派生，见上
      setSelectedId(tree.id)
      void loadMembers(tree.id)
    }
  }, [tree, nodeMap, selectedId, loadMembers])

  const openAdd = (node: OrgNode) => { setAddParent(node); setAddName(''); setAddError('') }
  const openRename = (node: OrgNode) => { setRenameTarget(node); setRenameName(node.name); setRenameError('') }

  const selectedNode = selectedId != null ? nodeMap.get(selectedId) : undefined

  const selectNode = (node: OrgNode) => { setSelectedId(node.id); void loadMembers(node.id) }

  const loadAllUsers = async (): Promise<UserRecord[]> => {
    const token = localStorage.getItem('access_token')
    const all: UserRecord[] = []
    const pageSize = 100
    for (let page = 1; ; page += 1) {
      const response = await fetch(`${V1_BASE}/users?page=${page}&pageSize=${pageSize}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const result = await response.json()
      if (!response.ok || result.code !== 0) throw new Error(result.message || '用户数据加载失败')
      const pageData = result.data as UserListResponse
      all.push(...(pageData.items || []))
      if (all.length >= pageData.total || !pageData.items?.length) break
    }
    return all
  }

  const openAddUser = async () => {
    setShowAddUser(true)
    setAddUserLoading(true)
    setAddUserError('')
    setAllUsers([])
    try {
      setAllUsers(await loadAllUsers())
    } catch (reason) {
      setAddUserError(reason instanceof Error ? reason.message : '用户数据加载失败')
    } finally {
      setAddUserLoading(false)
    }
  }

  const assignUser = async (userId: string) => {
    if (selectedId == null) return
    setAssigningId(userId)
    setAddUserError('')
    try {
      const token = localStorage.getItem('access_token')
      const response = await fetch(`${V1_BASE}/org/${selectedId}/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      })
      const result = await response.json()
      if (!response.ok || result.code !== 0) throw new Error(result.message || '加入失败')
      setAllUsers((current) => current.map((user) => user.id === userId ? { ...user, orgNodeId: selectedId } : user))
      void loadMembers(selectedId)
    } catch (reason) {
      setAddUserError(reason instanceof Error ? reason.message : '加入失败')
    } finally {
      setAssigningId(null)
    }
  }

  const removeUser = async (userId: string) => {
    if (selectedId == null) return
    setRemovingId(userId)
    setMembersError('')
    try {
      const token = localStorage.getItem('access_token')
      const response = await fetch(`${V1_BASE}/org/${selectedId}/users/${userId}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const result = await response.json()
      if (!response.ok || result.code !== 0) throw new Error(result.message || '移出失败')
      void loadMembers(selectedId)
    } catch (reason) {
      setMembersError(reason instanceof Error ? reason.message : '移出失败')
    } finally {
      setRemovingId(null)
    }
  }

  const createChild = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!addParent) return
    const name = addName.trim()
    if (!name) return setAddError('请输入节点名称')
    setAdding(true)
    setAddError('')
    try {
      const token = localStorage.getItem('access_token')
      const response = await fetch(`${V1_BASE}/org`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ name, parentId: addParent.id }),
      })
      const result = await response.json()
      if (!response.ok || result.code !== 0) throw new Error(result.message || '节点创建失败')
      setAddParent(null)
      await loadTree()
    } catch (reason) {
      setAddError(reason instanceof Error ? reason.message : '节点创建失败')
    } finally {
      setAdding(false)
    }
  }

  const renameNode = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!renameTarget) return
    const name = renameName.trim()
    if (!name) return setRenameError('请输入节点名称')
    setRenaming(true)
    setRenameError('')
    try {
      const token = localStorage.getItem('access_token')
      const response = await fetch(`${V1_BASE}/org/${renameTarget.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ name }),
      })
      const result = await response.json()
      if (!response.ok || result.code !== 0) throw new Error(result.message || '节点重命名失败')
      setRenameTarget(null)
      await loadTree()
    } catch (reason) {
      setRenameError(reason instanceof Error ? reason.message : '节点重命名失败')
    } finally {
      setRenaming(false)
    }
  }

  const deleteNode = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError('')
    try {
      const token = localStorage.getItem('access_token')
      const response = await fetch(`${V1_BASE}/org/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const result = await response.json()
      if (!response.ok || result.code !== 0) throw new Error(result.message || '节点删除失败')
      setDeleteTarget(null)
      await loadTree()
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : '节点删除失败')
    } finally {
      setDeleting(false)
    }
  }

  const renderNode = (node: OrgNode, depth: number) => {
    const isRoot = node.parentId === 0
    const active = node.id === selectedId
    const menuOpen = openMenuId === String(node.id)
    return (
      <div key={node.id}>
        <div
          className={`group flex items-center gap-1 rounded-lg py-1.5 pr-1 ${active ? 'bg-primary/10' : 'hover:bg-base-200'}`}
          style={{ paddingLeft: 8 + depth * 20 }}
        >
          <button type="button" className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-left" onClick={() => selectNode(node)}>
            <span className="flex h-6 w-6 shrink-0 items-center justify-center text-base-content/40">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
            </span>
            <span className="truncate text-sm font-medium" title={node.name}>{node.name}</span>
          </button>
          <div className="mr-0.5 shrink-0">
            <RowMenuTrigger open={menuOpen} onClick={(event) => toggleRowMenu(String(node.id), event.currentTarget)} label={`${node.name}操作`} />
          </div>
        </div>
        {menuOpen && menuAnchor ? (
          <RowMenuPopover anchor={menuAnchor} panelRef={panelRef}>
            <MenuAction icon={menuIcons.folderPlus} label="新增子层级" onClick={() => { closeRowMenu(); openAdd(node) }} />
            <MenuAction icon={menuIcons.edit} label="重命名" onClick={() => { closeRowMenu(); openRename(node) }} />
            {!isRoot && <MenuAction icon={menuIcons.trash} label="删除" tone="danger" onClick={() => { closeRowMenu(); setDeleteTarget(node) }} />}
          </RowMenuPopover>
        ) : null}
        {node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    )
  }

  if (loading) return <div className="flex h-64 items-center justify-center"><span className="loading loading-spinner loading-lg text-primary" /></div>
  if (error) return <div role="alert" className="alert alert-error"><span>{error}</span></div>

  return (
    <div className="flex min-h-0 flex-1 gap-3">
      <div className="min-h-0 w-80 shrink-0 overflow-auto rounded-lg bg-base-100 p-2">
        {tree ? renderNode(tree, 0) : <div className="py-16 text-center text-sm text-base-content/40">暂无组织架构数据</div>}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-base-100">
        <div className="flex shrink-0 items-center justify-between border-b border-base-200 px-4 py-3">
          <h2 className="text-base font-semibold">{selectedNode ? `${selectedNode.name} · 层级用户` : '层级用户'}</h2>
          {selectedNode && <button type="button" className="btn btn-primary btn-sm" onClick={() => void openAddUser()}>添加用户</button>}
        </div>
        {membersError && <div role="alert" className="alert alert-error m-3 py-2 text-sm"><span>{membersError}</span></div>}
        {membersLoading ? (
          <div className="flex flex-1 items-center justify-center"><span className="loading loading-spinner text-primary" /></div>
        ) : !selectedNode ? (
          <div className="flex flex-1 items-center justify-center text-sm text-base-content/40">请选择左侧层级</div>
        ) : !members.length ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-base-content/20">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /></svg>
            <span className="text-sm">暂无用户</span>
          </div>
        ) : (
          <div className="flex-1 overflow-auto p-2">
            {members.map((member) => (
              <div key={member.id} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-base-200">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-base-200 text-sm font-medium text-base-content">{displayName(member).charAt(0)}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{displayName(member)}</div>
                  <div className="truncate text-xs text-base-content/50">{member.username}</div>
                </div>
                <span className={`badge badge-sm ${Number(member.status) === 1 ? 'badge-success' : 'badge-ghost'}`}>{Number(member.status) === 1 ? '启用' : '停用'}</span>
                <button type="button" className="btn btn-ghost btn-xs text-error hover:bg-error/10" disabled={removingId === member.id} onClick={() => void removeUser(member.id)}>
                  {removingId === member.id ? <span className="loading loading-spinner loading-xs" /> : '移出'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {addParent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !adding && setAddParent(null)}>
          <form className="w-full max-w-sm rounded-box bg-base-100 p-6 shadow-xl" onSubmit={createChild} onClick={(event) => event.stopPropagation()}>
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-lg font-bold">新增子层级</h2>
              <button type="button" className="btn btn-ghost btn-square btn-sm" onClick={() => setAddParent(null)} disabled={adding} aria-label="关闭">✕</button>
            </div>
            <p className="mb-4 text-sm text-base-content/60">在“{addParent.name}”下新增一个子层级。</p>
            {addError && <div role="alert" className="alert alert-error mb-4 py-2 text-sm"><span>{addError}</span></div>}
            <label className="form-control">
              <span className="mb-1 block text-sm text-base-content/70">名称 <span className="text-error">*</span></span>
              <input className="input input-bordered w-full" value={addName} maxLength={64} autoFocus placeholder="请输入节点名称" onChange={(event) => setAddName(event.target.value)} />
            </label>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" className="btn btn-ghost" onClick={() => setAddParent(null)} disabled={adding}>取消</button>
              <button type="submit" className="btn btn-primary" disabled={adding}>{adding && <span className="loading loading-spinner loading-sm" />}创建</button>
            </div>
          </form>
        </div>
      )}

      {renameTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !renaming && setRenameTarget(null)}>
          <form className="w-full max-w-sm rounded-box bg-base-100 p-6 shadow-xl" onSubmit={renameNode} onClick={(event) => event.stopPropagation()}>
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-lg font-bold">重命名</h2>
              <button type="button" className="btn btn-ghost btn-square btn-sm" onClick={() => setRenameTarget(null)} disabled={renaming} aria-label="关闭">✕</button>
            </div>
            {renameError && <div role="alert" className="alert alert-error mb-4 py-2 text-sm"><span>{renameError}</span></div>}
            <label className="form-control">
              <span className="mb-1 block text-sm text-base-content/70">名称 <span className="text-error">*</span></span>
              <input className="input input-bordered w-full" value={renameName} maxLength={64} autoFocus onChange={(event) => setRenameName(event.target.value)} />
            </label>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" className="btn btn-ghost" onClick={() => setRenameTarget(null)} disabled={renaming}>取消</button>
              <button type="submit" className="btn btn-primary" disabled={renaming}>{renaming && <span className="loading loading-spinner loading-sm" />}保存</button>
            </div>
          </form>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !deleting && setDeleteTarget(null)}>
          <div className="w-full max-w-sm rounded-box bg-base-100 p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <h2 className="text-lg font-bold">删除节点</h2>
            <p className="mt-3 text-sm text-base-content/70">确定删除“{deleteTarget.name}”吗？其下所有子层级会一并删除，且不可恢复。</p>
            {deleteError && <div role="alert" className="alert alert-error mt-3 py-2 text-sm"><span>{deleteError}</span></div>}
            <div className="mt-6 flex justify-end gap-3">
              <button className="btn btn-ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>取消</button>
              <button className="btn btn-error" onClick={deleteNode} disabled={deleting}>{deleting && <span className="loading loading-spinner loading-sm" />}确认删除</button>
            </div>
          </div>
        </div>
      )}

      {showAddUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !assigningId && setShowAddUser(false)}>
          <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-box bg-base-100 p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-2 flex shrink-0 items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">添加用户</h2>
                <p className="mt-1 text-sm text-base-content/50">到「{selectedNode?.name}」</p>
              </div>
              <button type="button" className="btn btn-ghost btn-square btn-sm" onClick={() => setShowAddUser(false)} disabled={assigningId != null} aria-label="关闭">✕</button>
            </div>
            {addUserError && <div role="alert" className="alert alert-error my-3 py-2 text-sm"><span>{addUserError}</span></div>}
            {addUserLoading ? (
              <div className="flex justify-center py-12"><span className="loading loading-spinner text-primary" /></div>
            ) : !allUsers.length ? (
              <div className="py-12 text-center text-sm text-base-content/40">暂无可添加的用户</div>
            ) : (
              <div className="mt-3 -mr-2 min-h-0 flex-1 overflow-auto pr-2">
                {allUsers.map((user) => {
                  const inCurrent = user.orgNodeId === selectedId
                  return (
                    <div key={user.id} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-base-200">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-base-200 text-sm font-medium text-base-content">{displayName(user).charAt(0)}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{displayName(user)}</div>
                        <div className="truncate text-xs text-base-content/50">{user.username}</div>
                      </div>
                      <span className="shrink-0 text-xs text-base-content/50">{inCurrent ? '已在当前层级' : (user.orgNodeId ? `当前：${nodeMap.get(user.orgNodeId)?.name || '未知层级'}` : '未分配')}</span>
                      <button type="button" className="btn btn-primary btn-sm" disabled={inCurrent || assigningId === user.id} onClick={() => void assignUser(user.id)}>
                        {assigningId === user.id ? <span className="loading loading-spinner loading-xs" /> : '加入'}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
            <div className="mt-4 flex shrink-0 justify-end gap-3">
              <button type="button" className="btn btn-ghost" onClick={() => setShowAddUser(false)} disabled={assigningId != null}>关闭</button>
            </div>
          </div>
        </div>
      )}
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
  // 新增用户不填密码：初始密码由后端统一给（userService.DEFAULT_INITIAL_PASSWORD），
  // 前端不传 password 字段，也不在客户端留存这个明文口令。
  const [form, setForm] = useState({ username: '', nickname: '', status: 1 })
  const [editing, setEditing] = useState<UserRecord | null>(null)
  // 编辑同样不含密码：改密走操作菜单里的「重置密码」（= 恢复为默认初始密码）。
  const [editForm, setEditForm] = useState({ username: '', nickname: '', status: 1 })
  const [editError, setEditError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<UserRecord | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [resetTarget, setResetTarget] = useState<UserRecord | null>(null)
  const [resetting, setResetting] = useState(false)
  const [resetError, setResetError] = useState('')
  const [configTarget, setConfigTarget] = useState<UserRecord | null>(null)
  const [permissions, setPermissions] = useState<ConfigurablePermission[]>([])
  const [configLoading, setConfigLoading] = useState(false)
  const [configError, setConfigError] = useState('')
  const [tab, setTab] = useState<'users' | 'org'>('users')
  const [orgNameById, setOrgNameById] = useState<Map<number, string>>(new Map())

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

  // 组织架构路径映射：用户列表显示从根节点到所属节点的完整层级。
  // 切回用户列表时重拉一次，保证在组织架构页重命名节点后这里不显示旧名。
  useEffect(() => {
    if (tab !== 'users') return
    const controller = new AbortController()
    const loadOrgNames = async () => {
      try {
        const token = localStorage.getItem('access_token')
        const response = await fetch(`${V1_BASE}/org`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: controller.signal,
        })
        const result = await response.json()
        if (!response.ok || result.code !== 0) return
        const map = new Map<number, string>()
        const walk = (node: OrgNode | null, ancestors: string[] = []) => {
          if (!node) return
          const path = [...ancestors, node.name]
          map.set(node.id, path.join('/'))
          node.children.forEach((child) => walk(child, path))
        }
        walk(result.data.tree as OrgNode | null)
        setOrgNameById(map)
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        // 部门名加载失败不阻塞用户列表 —— 部门列全部落到「未分配」。
      }
    }
    void loadOrgNames()
    return () => controller.abort()
  }, [tab])

  const closeCreate = () => {
    if (creating) return
    setShowCreate(false)
    setFormError('')
    setForm({ username: '', nickname: '', status: 1 })
  }

  const createUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!form.username.trim()) return setFormError('请输入账号')
    if (!form.nickname.trim()) return setFormError('请输入名称')
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
          status: form.status,
        }),
      })
      const result = await response.json()
      if (!response.ok || result.code !== 0) throw new Error(result.message || '用户创建失败')
      setUsers((current) => [result.data.user as UserRecord, ...current])
      setShowCreate(false)
      setForm({ username: '', nickname: '', status: 1 })
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : '用户创建失败')
    } finally {
      setCreating(false)
    }
  }

  const openEdit = (user: UserRecord) => {
    setEditing(user)
    setEditError('')
    setEditForm({ username: user.username, nickname: user.nickname || '', status: Number(user.status) })
  }

  const saveUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editing) return
    if (!editForm.username.trim()) return setEditError('请输入账号')
    if (!editForm.nickname.trim()) return setEditError('请输入名称')
    setSaving(true)
    setEditError('')
    try {
      const token = localStorage.getItem('access_token')
      const response = await fetch(`${V1_BASE}/users/${editing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ username: editForm.username.trim(), nickname: editForm.nickname.trim(), status: editForm.status }),
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

  const openResetPassword = (user: UserRecord) => {
    setResetTarget(user)
    setResetError('')
  }

  // 重置为默认初始密码（后端决定具体口令，前端不传任何字段）。
  const resetPassword = async () => {
    if (!resetTarget) return
    setResetting(true)
    setResetError('')
    try {
      const token = localStorage.getItem('access_token')
      const response = await fetch(`${V1_BASE}/users/${resetTarget.id}/password/reset`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const result = await response.json()
      if (!response.ok || result.code !== 0) throw new Error(result.message || '密码重置失败')
      setResetTarget(null)
    } catch (reason) {
      setResetError(reason instanceof Error ? reason.message : '密码重置失败')
    } finally {
      setResetting(false)
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-4 flex shrink-0 items-center justify-between">
        <h1 className="text-2xl font-bold">用户管理</h1>
      </div>

      {/* 二级菜单标签页 —— 与日志页同款下划线样式（参见 Logs.tsx），不再是 tabs-box 方框按钮 */}
      <div className="mb-4 flex shrink-0 items-center gap-1">
        <div role="tablist" className="flex items-center gap-6 border-b border-base-200">
          {([['users', '用户列表'], ['org', '组织架构']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={`relative pb-2 text-sm font-medium transition-colors ${tab === key ? 'text-primary' : 'text-base-content/60 hover:text-base-content'}`}
              onClick={() => setTab(key)}
            >
              {label}
              {tab === key && <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-primary" />}
            </button>
          ))}
        </div>
      </div>
      {tab === 'users' ? (
        loading ? (
          <div className="flex flex-1 items-center justify-center"><span className="loading loading-spinner loading-lg text-primary" /></div>
        ) : error ? (
          <div role="alert" className="alert alert-error"><span>{error}</span></div>
        ) : (
          <UserTable users={users} orgNameById={orgNameById} onEdit={openEdit} onDelete={setDeleteTarget} onConfig={openConfig} onResetPassword={openResetPassword} onCreate={() => setShowCreate(true)} />
        )
      ) : (
        <OrgTree />
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
                <span className="mb-1 block text-sm text-base-content/70">名称 <span className="text-error">*</span></span>
                {/* 不加原生 required：它会让浏览器先拦下提交并弹自己的提示气泡，
                    下面的 setFormError('请输入名称') 就永远不执行了。账号同样只用 JS 校验。 */}
                <input className="input input-bordered w-full" value={form.nickname} maxLength={64} placeholder="请输入名称" onChange={(event) => setForm({ ...form, nickname: event.target.value })} />
              </label>
              {/* 初始密码由后端统一分配（见 userService.DEFAULT_INITIAL_PASSWORD），
                  这里不收密码也不做提示文案。 */}
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
              {/* 名称必填，与新增用户一致。同样不加原生 required —— 它会让浏览器抢先拦截提交，
                  setEditError('请输入名称') 就永远不执行（新增弹窗踩过这个坑）。 */}
              <label className="form-control sm:col-span-2"><span className="mb-1 block text-sm text-base-content/70">名称 <span className="text-error">*</span></span><input className="input input-bordered w-full" value={editForm.nickname} maxLength={64} placeholder="请输入名称" onChange={(event) => setEditForm({ ...editForm, nickname: event.target.value })} /></label>
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
      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !resetting && setResetTarget(null)}>
          <div className="w-full max-w-sm rounded-box bg-base-100 p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <h2 className="text-lg font-bold">重置密码</h2>
            <p className="mt-3 text-sm text-base-content/70">确定重置用户“{resetTarget.nickname || resetTarget.username}”的密码吗？密码将恢复为初始密码，请重置后告知该用户。</p>
            {resetError && <div role="alert" className="alert alert-error mt-4 py-2 text-sm"><span>{resetError}</span></div>}
            <div className="mt-6 flex justify-end gap-3"><button className="btn btn-ghost" onClick={() => setResetTarget(null)} disabled={resetting}>取消</button><button className="btn btn-primary" onClick={resetPassword} disabled={resetting}>{resetting && <span className="loading loading-spinner loading-sm" />}确认重置</button></div>
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
