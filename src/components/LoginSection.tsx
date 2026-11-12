import {
  useState,
  useEffect,
  useRef,
  type FormEvent,
} from 'react'
import { createPortal } from 'react-dom'
import type { ModulePermission } from '../utils/permissions'
import { clearContentAssets } from '../utils/contentAsset'
// base URL 已收敛到 utils/apiBase.ts（原本此处有一份与另外 3 个文件逐字重复的定义）
import { V1_BASE } from '../utils/apiBase'

const themes = [
  { id: 'light', label: '明亮', desc: '专业亮色' },
  { id: 'dark', label: '暗黑', desc: '深色模式' },
  { id: 'retro', label: '复古', desc: '暖黄复古' },
  { id: 'valentine', label: '情人节', desc: '粉红浪漫' },
  { id: 'lemonade', label: '柠檬', desc: '黄绿清新' },
  { id: 'aqua', label: '海洋', desc: '深海暗色' },
]

export interface UserInfo {
  id?: number
  username?: string
  nickname?: string | null
  name?: string
  /** 服务端给出的角色，来自命中的那张表（admin_user / normal_user）。 */
  role?: 'admin' | 'normal'
  permissions?: ModulePermission[]
}

// 是否管理员。优先用登录响应里的 role；本次改动之前写入 localStorage 的旧会话没有这个字段，
// 退回按权限判断 —— 'users' 是管理员专属模块（它出现在 authService 的 FIELD 排序表里，
// 但不在 userService.configurableModules 里，普通用户配不出来），所以这个回退当前是精确的。
function isAdmin(user: UserInfo | null) {
  if (!user) return false
  if (user.role) return user.role === 'admin'
  return (user.permissions ?? []).includes('users')
}

interface LoginResponse {
  code: number
  message?: string
  data?: {
    accessToken?: string
    user?: UserInfo
  }
}

interface LoginSectionProps {
  user: UserInfo | null
  onLogin: (user: UserInfo) => void
  onLogout: () => void
  compactAtMedium?: boolean
}

export default function LoginSection({
  user,
  onLogin,
  onLogout,
  compactAtMedium = false,
}: LoginSectionProps) {
  const [showModal, setShowModal] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 修改密码（仅普通用户，见 isAdmin）
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [pwdForm, setPwdForm] = useState({ oldPassword: '', newPassword: '', confirmPassword: '' })
  const [pwdError, setPwdError] = useState('')
  const [pwdSaving, setPwdSaving] = useState(false)
  const [pwdDone, setPwdDone] = useState(false)

  const menuRef = useRef<HTMLDivElement>(null)

  const [currentTheme, setCurrentTheme] = useState(
    () => localStorage.getItem('theme') || 'light',
  )

  const displayName =
    user?.nickname ||
    user?.name ||
    user?.username ||
    '用户'

  const avatarText = Array.from(displayName)[0] || '用'

  useEffect(() => {
    document.documentElement.setAttribute(
      'data-theme',
      currentTheme,
    )

    localStorage.setItem('theme', currentTheme)
  }, [currentTheme])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node)
      ) {
        setMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)

    return () => {
      document.removeEventListener(
        'mousedown',
        handleClickOutside,
      )
    }
  }, [])

  const showError = (message: string) => {
    setError(message)

    window.setTimeout(() => {
      setError('')
    }, 3000)
  }

  const handleLogin = async () => {
    if (!username.trim()) {
      showError('请输入用户名')
      return
    }

    if (!password) {
      showError('请输入密码')
      return
    }

    setLoading(true)
    setError('')

    try {
      const response = await fetch(
        `${V1_BASE}/auth/login`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            username: username.trim(),
            password,
          }),
        },
      )

      const result =
        (await response.json()) as LoginResponse

      const loginData = result.data

      if (
        !response.ok ||
        result.code !== 0 ||
        !loginData?.accessToken ||
        !loginData.user
      ) {
        throw new Error(
          result.message || '账号或密码错误',
        )
      }

      localStorage.setItem(
        'access_token',
        loginData.accessToken,
      )

      localStorage.setItem(
        'user',
        JSON.stringify(loginData.user),
      )

      onLogin(loginData.user)

      setShowModal(false)
      setUsername('')
      setPassword('')
      setShowPassword(false)
      setError('')
    } catch (error) {
      if (error instanceof TypeError) {
        showError(
          '无法连接后端，请检查后端是否运行在 3000 端口',
        )
      } else {
        showError(
          error instanceof Error
            ? error.message
            : '登录失败，请稍后重试',
        )
      }
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void handleLogin()
  }

  const openPasswordModal = () => {
    setMenuOpen(false)
    setPwdForm({ oldPassword: '', newPassword: '', confirmPassword: '' })
    setPwdError('')
    setPwdDone(false)
    setShowPasswordModal(true)
  }

  const submitPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!pwdForm.oldPassword) return setPwdError('请输入当前密码')
    if (pwdForm.newPassword.length < 8 || pwdForm.newPassword.length > 72) return setPwdError('新密码需为8-72个字符')
    if (pwdForm.newPassword !== pwdForm.confirmPassword) return setPwdError('两次输入的新密码不一致')
    setPwdSaving(true)
    setPwdError('')
    try {
      const token = localStorage.getItem('access_token')
      const response = await fetch(`${V1_BASE}/auth/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ oldPassword: pwdForm.oldPassword, newPassword: pwdForm.newPassword }),
      })
      const result = await response.json()
      if (!response.ok || result.code !== 0) throw new Error(result.message || '密码修改失败')
      // 不自动关窗：改密是敏感操作，明确回执比"窗没了"更让人放心。
      setPwdDone(true)
      setPwdForm({ oldPassword: '', newPassword: '', confirmPassword: '' })
    } catch (reason) {
      setPwdError(reason instanceof Error ? reason.message : '密码修改失败')
    } finally {
      setPwdSaving(false)
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('access_token')
    localStorage.removeItem('user')
    // 缓存里的知识库文件字节带着上一个用户的鉴权取回，登出时必须连同 blob: URL 一起回收。
    clearContentAssets()

    setMenuOpen(false)
    onLogout()
  }

  return (
    <>
      {user ? (
        <div
          className="relative"
          ref={menuRef}
        >
          <button
            type="button"
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-base-200 ${
              compactAtMedium ? 'md:justify-center md:px-0 xl:justify-start xl:px-3' : ''
            }`}
            onClick={() => setMenuOpen((value) => !value)}
            aria-label={displayName}
            title={displayName}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-content">
              {avatarText}
            </div>

            <div className={`flex flex-1 flex-col text-left ${compactAtMedium ? 'md:hidden xl:flex' : ''}`}>
              <span className="text-sm font-medium text-base-content">
                {displayName}
              </span>
            </div>

            <svg
              className={`h-4 w-4 text-base-content/30 transition-transform ${
                compactAtMedium ? 'md:hidden xl:block' : ''
              } ${
                menuOpen ? 'rotate-180' : ''
              }`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {menuOpen && (
            <div className={`absolute bottom-full left-0 right-0 z-20 mb-2 rounded-box border border-base-200 bg-base-100 p-3 shadow-lg ${
              compactAtMedium ? 'md:left-14 md:right-auto md:w-56 xl:left-0 xl:right-0 xl:w-auto' : ''
            }`}>
              <div className="mb-3 px-1 text-xs font-medium text-base-content/40">
                主题切换
              </div>

              <select
                className="select select-bordered select-sm w-full text-sm"
                value={currentTheme}
                onChange={(event) =>
                  setCurrentTheme(event.target.value)
                }
              >
                {themes.map((theme) => (
                  <option
                    key={theme.id}
                    value={theme.id}
                  >
                    {theme.label}
                  </option>
                ))}
              </select>

              <div className="divider my-2" />

              {/* 修改密码只对普通用户开放：管理员不显示（需求如此）。 */}
              {!isAdmin(user) && (
                <button
                  type="button"
                  className="mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-base-200"
                  onClick={openPasswordModal}
                >
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect
                      x="3"
                      y="11"
                      width="18"
                      height="11"
                      rx="2"
                    />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>

                  修改密码
                </button>
              )}

              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-error transition-colors hover:bg-base-200"
                onClick={handleLogout}
              >
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line
                    x1="21"
                    y1="12"
                    x2="9"
                    y2="12"
                  />
                </svg>

                退出登录
              </button>
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-base-200"
          onClick={() => setShowModal(true)}
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-base-200 text-base-content/50">
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle
                cx="12"
                cy="8"
                r="4"
              />
              <path d="M20 21a8 8 0 1 0-16 0" />
            </svg>
          </div>

          <div className="flex flex-1 flex-col text-left">
            <span className="text-sm font-medium text-base-content/60">
              登录
            </span>

            <span className="text-xs text-base-content/40">
              点击登录
            </span>
          </div>
        </button>
      )}

      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setShowModal(false)}
        >
          <form
            className="w-full max-w-sm rounded-xl border border-base-200 bg-base-100 p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
            onSubmit={handleSubmit}
          >
            <h3 className="mb-6 text-lg font-semibold text-base-content">
              登录
            </h3>

            {error && (
              <div className="mb-4 rounded-lg bg-error/10 px-3 py-2 text-sm text-error">
                {error}
              </div>
            )}

            <div className="space-y-4">
              <label className="block space-y-1.5">
                <span className="text-sm text-base-content/70">
                  用户名
                </span>

                <input
                  type="text"
                  value={username}
                  onChange={(event) =>
                    setUsername(event.target.value)
                  }
                  placeholder="admin"
                  autoComplete="username"
                  className="input input-bordered h-10 w-full text-sm"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-sm text-base-content/70">
                  密码
                </span>

                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) =>
                      setPassword(event.target.value)
                    }
                    placeholder="admin@123"
                    autoComplete="current-password"
                    className="input input-bordered h-10 w-full pr-11 text-sm"
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-base-content/45 transition-colors hover:text-base-content focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    onClick={() => setShowPassword((visible) => !visible)}
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                    title={showPassword ? '隐藏密码' : '显示密码'}
                  >
                    {showPassword ? (
                      <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M3 3l18 18" />
                        <path d="M10.6 10.7a2 2 0 0 0 2.7 2.7" />
                        <path d="M9.9 4.2A10.8 10.8 0 0 1 12 4c5.5 0 9 5 9 5a16.7 16.7 0 0 1-2.1 2.7" />
                        <path d="M6.6 6.6C4.4 8.1 3 10 3 10s3.5 5 9 5a10.8 10.8 0 0 0 3.4-.5" />
                      </svg>
                    ) : (
                      <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
                        <circle cx="12" cy="12" r="2.5" />
                      </svg>
                    )}
                  </button>
                </div>
              </label>
            </div>

            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                className="btn btn-ghost h-10 flex-1 text-sm"
                onClick={() => {
                  setShowModal(false)
                  setError('')
                }}
              >
                取消
              </button>

              <button
                type="submit"
                className="btn btn-primary h-10 flex-1 text-sm"
                disabled={loading}
              >
                {loading ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : (
                  '登录'
                )}
              </button>
            </div>
          </form>
        </div>
      )}
      {showPasswordModal && createPortal(
        <div
          className="fixed inset-0 z-70 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !pwdSaving && setShowPasswordModal(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-base-200 bg-base-100 p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="mb-6 text-lg font-semibold text-base-content">
              修改密码
            </h3>

            {pwdDone ? (
              <>
                <div className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
                  密码已修改，下次登录请使用新密码。
                </div>

                <div className="mt-6 flex justify-end">
                  <button
                    type="button"
                    className="btn btn-primary h-10 text-sm"
                    onClick={() => setShowPasswordModal(false)}
                  >
                    完成
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={submitPassword}>
                {pwdError && (
                  <div className="mb-4 rounded-lg bg-error/10 px-3 py-2 text-sm text-error">
                    {pwdError}
                  </div>
                )}

                <div className="space-y-4">
                  <label className="block space-y-1.5">
                    <span className="text-sm text-base-content/70">
                      当前密码
                    </span>

                    <input
                      type="password"
                      value={pwdForm.oldPassword}
                      onChange={(event) =>
                        setPwdForm({ ...pwdForm, oldPassword: event.target.value })
                      }
                      autoComplete="current-password"
                      placeholder="请输入当前密码"
                      className="input input-bordered h-10 w-full text-sm"
                    />
                  </label>

                  <label className="block space-y-1.5">
                    <span className="text-sm text-base-content/70">
                      新密码
                    </span>

                    <input
                      type="password"
                      value={pwdForm.newPassword}
                      onChange={(event) =>
                        setPwdForm({ ...pwdForm, newPassword: event.target.value })
                      }
                      maxLength={72}
                      autoComplete="new-password"
                      placeholder="请输入新密码"
                      className="input input-bordered h-10 w-full text-sm"
                    />
                  </label>

                  <label className="block space-y-1.5">
                    <span className="text-sm text-base-content/70">
                      确认新密码
                    </span>

                    <input
                      type="password"
                      value={pwdForm.confirmPassword}
                      onChange={(event) =>
                        setPwdForm({ ...pwdForm, confirmPassword: event.target.value })
                      }
                      maxLength={72}
                      autoComplete="new-password"
                      placeholder="再次输入新密码"
                      className="input input-bordered h-10 w-full text-sm"
                    />
                  </label>
                </div>

                <div className="mt-6 flex items-center gap-3">
                  <button
                    type="button"
                    className="btn btn-ghost h-10 flex-1 text-sm"
                    onClick={() => setShowPasswordModal(false)}
                    disabled={pwdSaving}
                  >
                    取消
                  </button>

                  <button
                    type="submit"
                    className="btn btn-primary h-10 flex-1 text-sm"
                    disabled={pwdSaving}
                  >
                    {pwdSaving ? (
                      <span className="loading loading-spinner loading-sm" />
                    ) : (
                      '保存'
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
