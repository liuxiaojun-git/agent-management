import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { firstAllowedPath } from '../utils/permissions'
// base URL 已收敛到 utils/apiBase.ts（原本此处有一份与另外 3 个文件逐字重复的定义）
import { V1_BASE } from '../utils/apiBase'

import loginBgImage from '../assets/智域：AI工作搭档登录页 2.png'

export default function LoginPage() {
  const navigate = useNavigate()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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
      const response = await fetch(`${V1_BASE}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: username.trim(),
          password,
        }),
      })

      const result = await response.json()

      if (!response.ok || result.code !== 0) {
        throw new Error(result.message || '账号或密码错误')
      }

      localStorage.setItem(
        'access_token',
        result.data.accessToken
      )

      localStorage.setItem(
        'user',
        JSON.stringify(result.data.user)
      )

      navigate(firstAllowedPath(result.data.user.permissions), { replace: true })
    } catch (err) {
      if (err instanceof TypeError) {
        showError('无法连接后端，请确认后端运行在 3000 端口')
      } else {
        showError(
          err instanceof Error
            ? err.message
            : '登录失败，请稍后重试'
        )
      }
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void handleLogin()
  }

  return (
    <div className="flex h-screen bg-base-100">
      {error && (
        <div
          role="alert"
          className="fixed left-1/2 top-5 z-50 -translate-x-1/2 rounded-lg bg-error px-5 py-3 text-sm text-white shadow-lg"
        >
          {error}
        </div>
      )}

      {/* 左侧：登录表单（保持原来的左右宽度比例） */}
      <div className="flex w-full items-center justify-center p-4 md:p-8 lg:w-2/5 xl:w-1/3 min-w-0">
        <div className="w-full max-w-xl">
          <div className="flex items-center gap-4 mb-8">
            <img
              src="/src/assets/zhiyu-favicon-package/favicon.svg"
              className="h-12 w-12 shrink-0"
              alt="智域 Logo"
            />

            <h1 className="text-2xl font-bold text-base-content md:text-4xl">
              智域
            </h1>
          </div>

          <form
            onSubmit={handleSubmit}
            className="mt-8 w-full space-y-6 rounded-xl border border-base-200 p-6 shadow-sm md:mt-10 md:space-y-10 md:p-8"
          >
            <h2 className="text-lg font-semibold text-base-content">
              账号登录
            </h2>

            <div className="space-y-6">
              <label className="flex flex-col gap-2">
                <span className="text-sm text-base-content/70">
                  账号
                </span>

                <input
                  type="text"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="请输入账号"
                  autoFocus
                  autoComplete="username"
                  className="input input-bordered h-11 w-full text-sm"
                />
              </label>

              <label className="flex flex-col gap-2">
                <span className="text-sm text-base-content/70">
                  密码
                </span>

                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="请输入密码"
                    autoComplete="current-password"
                    className="input input-bordered h-11 w-full pr-11 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-base-content/45 transition-colors hover:text-base-content focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                    title={showPassword ? '隐藏密码' : '显示密码'}
                  >
                    {showPassword ? (
                      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M3 3l18 18" />
                        <path d="M10.6 10.7a2 2 0 0 0 2.7 2.7" />
                        <path d="M9.9 4.2A10.8 10.8 0 0 1 12 4c5.5 0 9 5 9 5a16.7 16.7 0 0 1-2.1 2.7" />
                        <path d="M6.6 6.6C4.4 8.1 3 10 3 10s3.5 5 9 5a10.8 10.8 0 0 0 3.4-.5" />
                      </svg>
                    ) : (
                      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
                        <circle cx="12" cy="12" r="2.5" />
                      </svg>
                    )}
                  </button>
                </div>
              </label>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary h-11 w-full text-sm"
            >
              {loading ? (
                <span className="loading loading-spinner loading-sm" />
              ) : (
                '登录'
              )}
            </button>
          </form>
        </div>
      </div>

      {/* 右侧：底图（保持原来 flex-1 剩余宽度） */}
      <div className="hidden h-screen flex-1 relative overflow-hidden lg:flex">
        <img
          src={loginBgImage}
          className="w-full h-full object-cover"
          alt="登录页底图"
        />
        <div className="absolute inset-0 bg-base-100/30" />
      </div>
    </div>
  )
}
