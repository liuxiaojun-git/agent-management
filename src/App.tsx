// 应用入口 — 路由配置，定义所有页面路径与 Layout 布局
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import ApiTest from './pages/ApiTest'
import Logs from './pages/Logs'
import Models from './pages/Models'

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/home" replace />} />
          <Route path="home" element={<Home />} />
          <Route path="api-test" element={<ApiTest />} />
          <Route path="logs" element={<Logs />} />
          <Route path="models" element={<Models />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
