// 用户登录信息 & 主题切换组件
import { useState, useEffect, useRef } from 'react'

const themes = [
  { id: 'light', label: '明亮', desc: '专业亮色' },
  { id: 'dark', label: '暗黑', desc: '深色模式' },
  { id: 'retro', label: '复古', desc: '暖黄复古' },
  { id: 'valentine', label: '情人节', desc: '粉红浪漫' },
  { id: 'lemonade', label: '柠檬', desc: '黄绿清新' },
  { id: 'aqua', label: '海洋', desc: '深海暗色' },
]

interface UserInfo {
  name: string
}

interface LoginSectionProps {
  user: UserInfo | null
  onLogin: (user: UserInfo) => void
  onLogout: () => void
}

export default function LoginSection({ user, onLogin, onLogout }: LoginSectionProps) {
  const [showModal, setShowModal] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const [currentTheme, setCurrentTheme] = useState(() => localStorage.getItem('theme') || 'light')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', currentTheme)
    localStorage.setItem('theme', currentTheme)
  }, [currentTheme])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const handleLogin = () => {
    if (!username.trim()) return
    onLogin({ name: username.trim() })
    setShowModal(false)
    setUsername('')
    setPassword('')
  }

  return (
    <>
      {user ? (
        <div className="relative" ref={menuRef}>
          <button
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-base-200"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-content text-sm font-medium">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex flex-1 flex-col text-left">
              <span className="text-sm font-medium text-base-content">{user.name}</span>
              <span className="text-xs text-base-content/40">已登录</span>
            </div>
            <svg className={`h-4 w-4 text-base-content/30 transition-transform ${menuOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {menuOpen && (
            <div className="absolute bottom-full left-0 right-0 z-20 mb-2 rounded-box bg-base-100 p-3 shadow-lg border border-base-200">
              <div className="mb-3 px-1 text-xs font-medium text-base-content/40">主题切换</div>
              <select
                className="select select-bordered select-sm w-full text-sm"
                value={currentTheme}
                onChange={(e) => setCurrentTheme(e.target.value)}
              >
                {themes.map((t) => (
                  <option key={t.id} value={t.id}>{t.label} — {t.desc}</option>
                ))}
              </select>
              <div className="divider my-2" />
              <button
                className="flex items-center gap-3 w-full px-3 py-2 text-sm rounded-lg text-error hover:bg-base-200 transition-colors"
                onClick={() => { setMenuOpen(false); onLogout() }}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
                </svg>
                退出登录
              </button>
            </div>
          )}
        </div>
      ) : (
        <button
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-base-200"
          onClick={() => setShowModal(true)}
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-base-200 text-base-content/50">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" /><path d="M20 21a8 8 0 1 0-16 0" />
            </svg>
          </div>
          <div className="flex flex-1 flex-col text-left">
            <span className="text-sm font-medium text-base-content/60">登录</span>
            <span className="text-xs text-base-content/40">点击登录</span>
          </div>
        </button>
      )}

      {/* 登录弹窗 */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowModal(false)}>
          <div className="w-full max-w-sm rounded-xl bg-base-100 p-6 shadow-xl border border-base-200" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-base-content mb-6">登录</h3>
            <div className="space-y-4">
              <label className="block space-y-1.5">
                <span className="text-sm text-base-content/70">用户名</span>
                <input
                  type="text" value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  placeholder="admin"
                  className="input input-bordered w-full h-10 text-sm"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm text-base-content/70">密码</span>
                <input
                  type="password" value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  placeholder="123456"
                  className="input input-bordered w-full h-10 text-sm"
                />
              </label>
            </div>
            <div className="flex items-center gap-3 mt-6">
              <button className="btn btn-ghost flex-1 h-10 text-sm" onClick={() => setShowModal(false)}>取消</button>
              <button className="btn btn-primary flex-1 h-10 text-sm" onClick={handleLogin}>登录</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
