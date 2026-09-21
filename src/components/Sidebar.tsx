// 侧边栏导航 — 主导航菜单，包含首页、API 测试、日志、模型管理等页面入口
import { NavLink, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import LoginSection, { type UserInfo } from './LoginSection'
import type { ModulePermission } from '../utils/permissions'

interface SidebarProps {
  open: boolean
  onClose: () => void
}

const menuItems = [
  {
    permission: 'home' as ModulePermission,
    label: '首页',
    path: '/home',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
  },
  {
    permission: 'knowledge' as ModulePermission,
    label: 'AI 问答',
    path: '/ai-chat',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3 13.8 8.2 19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />
        <path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z" />
      </svg>
    ),
  },
  {
    permission: 'knowledge' as ModulePermission,
    label: '知识库',
    path: '/knowledge',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" /><path d="M8 7h8" /><path d="M8 11h6" />
      </svg>
    ),
  },
  {
    permission: 'users' as ModulePermission,
    label: '用户管理',
    path: '/users',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    permission: 'api_test' as ModulePermission,
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
    permission: 'logs' as ModulePermission,
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
    permission: 'models' as ModulePermission,
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

function getStoredUser(): UserInfo | null {
  try {
    const saved = localStorage.getItem('user')
    return saved ? JSON.parse(saved) as UserInfo : null
  } catch {
    localStorage.removeItem('user')
    return null
  }
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  const navigate = useNavigate()
  const [user, setUser] = useState<UserInfo | null>(getStoredUser)

  useEffect(() => {
    if (user) {
      localStorage.setItem('user', JSON.stringify(user))
      return
    }

    localStorage.removeItem('user')
    navigate('/login', { replace: true })
  }, [navigate, user])

  return (
    <aside
      className={`
        fixed inset-y-0 left-0 z-50 w-65 -translate-x-full
        bg-base-100 shadow-lg transition-[width,transform] duration-200
        md:static md:z-auto md:w-18 md:translate-x-0 xl:w-65
        flex flex-col
        ${open ? 'translate-x-0' : ''}
      `}
    >
      {/* Logo / 品牌 */}
      <div className="flex h-16 shrink-0 items-center gap-2 border-b border-base-200 px-6 md:justify-center md:px-0 xl:justify-start xl:px-6">
        <img src="/src/assets/zhiyu-favicon-package/favicon.svg" className="h-9 w-9 shrink-0" alt="智域" />
        <div className="flex flex-col leading-tight md:hidden xl:flex">
          <span className="text-lg font-bold">智域</span>
          <span className="text-xs text-base-content/60">Personal AI Workspace</span>
        </div>
      </div>

      {/* 导航菜单 */}
      <nav className="flex-1 pt-3">
        <ul className="menu w-full gap-1.5 px-3 md:px-2 xl:px-3">
          {menuItems.filter((item) => item.permission === 'knowledge' || user?.permissions?.includes(item.permission)).map((item) => (
            <li key={item.path} className="w-full">
              <NavLink
                to={item.path}
                end={item.path === '/'}
                onClick={onClose}
                title={item.label}
                aria-label={item.label}
                className={({ isActive }) =>
                  `group relative flex w-full items-center gap-3 rounded-md px-3.5 py-3 text-[15px] font-medium leading-5 transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary md:mx-auto md:flex! md:w-12! md:justify-center! md:px-0 xl:mx-0 xl:w-full! xl:justify-start! xl:px-3.5! ${
                    isActive
                      ? 'bg-primary/10 text-primary shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-primary)_10%,transparent)]'
                      : 'text-base-content/70 hover:bg-base-200/80 hover:text-base-content/90'
                  }`
                }
              >
                <span className="shrink-0 opacity-75 transition-opacity duration-200 group-hover:opacity-100">
                  {item.icon}
                </span>
                <span className="md:hidden xl:inline">{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* 底部区域 - 用户登录 */}
      <div className="absolute bottom-0 left-0 right-0 border-t border-base-200 p-4 md:p-3 xl:p-4">
        <LoginSection
          user={user}
          onLogin={(u) => setUser(u)}
          onLogout={() => setUser(null)}
          compactAtMedium
        />
      </div>
    </aside>
  )
}
