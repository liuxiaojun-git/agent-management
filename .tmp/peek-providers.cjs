// 只读：模型管理页那份配置（data 接口的 model-providers）实际存的是什么。
const { getModelProviders } = require('E:/zhiyu-backend/src/services/providerService')
const pool = require('E:/zhiyu-backend/src/db')
;(async () => {
  const rows = await getModelProviders(1)
  console.log(JSON.stringify(rows, null, 2))
  await pool.end()
})().catch((e) => { console.error(String(e).split('\n')[0]); process.exit(1) })
