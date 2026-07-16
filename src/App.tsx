// 应用入口 — 路由配置，定义所有页面路径与 Layout 布局
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import ApiTest from './pages/ApiTest'
import Logs from './pages/Logs'
import Models from './pages/Models'
import LoginPage from './pages/LoginPage'

// 检查是否已登录
function isAuthenticated() {
  try {
    return !!localStorage.getItem('user')
  } catch {
    return false
  }
}

// 需要登录才能访问的路由
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<Layout />}>
          <Route index element={
            isAuthenticated() ? <Navigate to="/home" replace /> : <Navigate to="/login" replace />
          } />
          <Route path="home" element={<ProtectedRoute><Home /></ProtectedRoute>} />
          <Route path="api-test" element={<ProtectedRoute><ApiTest /></ProtectedRoute>} />
          <Route path="logs" element={<ProtectedRoute><Logs /></ProtectedRoute>} />
          <Route path="models" element={<ProtectedRoute><Models /></ProtectedRoute>} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
