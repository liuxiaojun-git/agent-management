import {
  useState,
  useEffect,
  useRef,
  type FormEvent,
} from 'react'
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
  permissions?: ModulePermission[]
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
    </>
  )
}
