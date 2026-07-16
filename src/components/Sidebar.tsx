// 侧边栏导航 — 主导航菜单，包含首页、API 测试、日志、模型管理等页面入口
import { NavLink } from 'react-router-dom'
import { useState, useEffect } from 'react'

interface SidebarProps {
  open: boolean
  onClose: () => void
}

const menuItems = [
  {
    label: '首页',
    path: '/home',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
  },
  {
    label: 'API 测试',
    path: '/api-test',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 3 21 3 21 8" />
        <line x1="4" y1="20" x2="21" y2="3" />
        <polyline points="21 16 21 21 16 21" />
        <line x1="15" y1="15" x2="21" y2="21" />
        <line x1="4" y1="4" x2="9" y2="9" />
      </svg>
    ),
  },
  {
    label: '日志',
    path: '/logs',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    ),
  },
  {
    label: '模型',
    path: '/models',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />
        <path d="M16 14a8 8 0 1 0-16 0" />
      </svg>
    ),
  },
]

export default function Sidebar({ open, onClose }: SidebarProps) {
  const themes = [
    { id: 'light', label: '明亮', icon: '☀️' },
    { id: 'dark', label: '暗黑', icon: '🌙' },
    { id: 'retro', label: '复古', icon: '📻' },
    { id: 'valentine', label: '情人节', icon: '💕' },
    { id: 'lemonade', label: '柠檬', icon: '🍋' },
    { id: 'aqua', label: '海洋', icon: '🌊' },
  ]
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  return (
    <aside
      className={`
        fixed inset-y-0 left-0 z-50 w-65 -translate-x-full
        bg-base-100 shadow-lg transition-transform duration-200
        lg:static lg:z-auto lg:translate-x-0
        flex flex-col
        ${open ? 'translate-x-0' : ''}
      `}
    >
      {/* Logo / 品牌 */}
      <div className="flex h-16 items-center gap-2 border-b border-base-200 px-6">
        <img src="/src/assets/Agent_Icon_A.svg" className="h-6 w-6" alt="A" />
        <span className="text-lg font-bold">知航控制台</span>
      </div>

      {/* 导航菜单 */}
      <nav className="flex-1">
        <ul className="menu gap-1 px-3">
          {menuItems.map((item) => (
            <li key={item.path}>
              <NavLink
                to={item.path}
                end={item.path === '/'}
                onClick={onClose}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-3 w-59 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-base-content/70 hover:bg-base-200 hover:text-base-content'
                  }`
                }
              >
                {item.icon}
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* 底部区域 - 已登录 */}
      <div className="absolute bottom-0 left-0 right-0 border-t border-base-200 p-4">
        <div className="dropdown dropdown-top w-full">
          <button
            tabIndex={0}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-base-200"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-content text-sm font-medium">
              A
            </div>
            <div className="flex flex-1 flex-col text-left">
              <span className="text-sm font-medium text-base-content">admin</span>
              <span className="text-xs text-base-content/40">管理员</span>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <ul
            tabIndex={0}
            className="menu dropdown-content z-1 mb-2 w-full rounded-box bg-base-100 p-2 shadow-lg"
          >
            <li className="divider my-1"></li>
            <li className="dropdown dropdown-top dropdown-end">
              <button tabIndex={0} className="flex items-center gap-3 text-sm">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
                主题切换
              </button>
              <ul tabIndex={0} className="dropdown-content menu rounded-box z-1 w-40 bg-base-100 p-2 shadow-lg" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                {themes.map(t => (
                  <li key={t.id}>
                    <button
                      className={`flex items-center gap-2 text-sm ${theme === t.id ? 'text-primary font-medium' : ''}`}
                      onClick={() => setTheme(t.id)}
                    >
                      <span>{t.icon}</span> {t.label}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
            <li className="divider my-1"></li>
            <li>
              <button className="flex items-center gap-3 text-sm text-error">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                退出登录
              </button>
            </li>
          </ul>
        </div>
      </div>
    </aside>
  )
}
