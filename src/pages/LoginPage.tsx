// 登录页 — 用户登录后进入首页
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function LoginPage() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const showError = (msg: string) => {
    setError(msg)
    setTimeout(() => setError(''), 3000)
  }

  const handleLogin = () => {
    if (!username.trim()) {
      showError('请输入用户名')
      return
    }
    if (!password) {
      showError('请输入密码')
      return
    }

    setLoading(true)
    // 模拟登录验证
    setTimeout(() => {
      if (username.trim() === 'admin' && password === '123456') {
        const user = { name: username.trim() }
        localStorage.setItem('user', JSON.stringify(user))
        navigate('/home', { replace: true })
      } else {
        showError('账号或密码错误')
      }
      setLoading(false)
    }, 500)
  }

  return (
    <div className="flex h-screen bg-base-100">
      {/* toast */}
      {error && (
        <div className="fixed z-50 px-5 py-3 text-sm text-white -translate-x-1/2 bg-error rounded-lg shadow-lg top-5 left-1/2">
          {error}
        </div>
      )}

      {/* left: login form */}
      <div className="flex items-center justify-center w-full p-4 md:p-8 lg:w-2/5 xl:w-1/3">
        <div className="w-full max-w-120">
          <div className="flex items-center gap-3">
            <img src="/src/assets/Agent_Icon_A.svg" className="h-8 w-8 md:h-10 md:w-10" alt="logo" />
            <h1 className="text-2xl font-bold md:text-4xl text-base-content">知航控制台</h1>
          </div>

          <div className="w-full p-6 mt-8 space-y-6 border shadow-sm md:p-8 md:mt-10 md:space-y-10 rounded-xl border-base-200">
            <h2 className="text-lg font-semibold text-base-content">账号登录</h2>

            <div className="space-y-6">
              <label className="flex flex-col gap-2">
                <span className="text-sm text-base-content/70">账号</span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  placeholder="请输入账号"
                  className="input input-bordered w-full h-11 text-sm"
                  autoFocus
                />
              </label>

              <label className="flex flex-col gap-2">
                <span className="text-sm text-base-content/70">密码</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  placeholder="请输入密码"
                  className="input input-bordered w-full h-11 text-sm"
                />
              </label>
            </div>

            <button
              className="btn btn-primary w-full h-11 text-sm"
              onClick={handleLogin}
              disabled={loading}
            >
              {loading ? <span className="loading loading-spinner loading-sm" /> : '登录'}
            </button>
          </div>

        </div>
      </div>

      {/* right: decoration */}
      <div className="flex-1 hidden h-screen overflow-hidden lg:flex items-center justify-center bg-base-200">
        <div className="text-center p-12">
          <div className="text-6xl mb-6">🤖</div>
          <h2 className="text-2xl font-semibold text-base-content/60">AI 管理控制台</h2>
          <p className="text-base text-base-content/40 mt-2">智能管理 · 高效协作</p>
        </div>
      </div>
    </div>
  )
}
