// 侧边栏导航 — 主导航菜单，包含首页、API 测试、日志、模型管理等页面入口
import { NavLink, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import LoginSection from './LoginSection'

interface User {
  name: string
}

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

function getStoredUser(): User | null {
  try {
    const saved = localStorage.getItem('user')
    return saved ? JSON.parse(saved) as User : null
  } catch {
    localStorage.removeItem('user')
    return null
  }
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  const navigate = useNavigate()
  const [user, setUser] = useState<User | null>(getStoredUser)

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

      {/* 底部区域 - 用户登录 */}
      <div className="absolute bottom-0 left-0 right-0 border-t border-base-200 p-4">
        <LoginSection
          user={user}
          onLogin={(u) => setUser(u)}
          onLogout={() => setUser(null)}
        />
      </div>
    </aside>
  )
}
