# 知识库问答记录持久化 · API 契约（外部后端 → MySQL）

> 本契约供外部后端（端口 3000 的 `/api/knowledge` 链路）实现。前端已按此对接：
> - 前端每次问答/增删会话后调用 `POST /api/knowledge/conversations` 全量同步记录；
> - 前端页面加载时调用 `GET /api/knowledge/conversations` 读取当前用户全部记录。
>
> 前端文件：`src/utils/api.ts`（`getKnowledgeConversations` / `saveKnowledgeConversations`）、`src/pages/Knowledge.tsx`（`persistConversations`）。

## 通用约定

- 请求/响应均为 JSON，`charset=utf-8`。
- 鉴权：请求头 `Authorization: Bearer <access_token>`（与 `/api/knowledge/ask` 一致）。未登录返回 `401`，前端会自动跳转登录页。
- 响应结构：`{ success: boolean, data?: any, error?: string }`。
  - 成功：`200` + `{ success: true, data: ... }`（或仅 `{ success: true }`）。
  - 失败：非 `200`，body 尽量带 `{ success: false, error: '...' }`。
- ⚠️ 前端判断「未实现」不能只依赖 `404`：本仓库 `server/app.mjs` 对未知路径会回 `200 + index.html`。前端会校验响应体是否满足 `payload.success === true`，否则视为失败并**静默降级**（问答照常进行，仅记录不持久化）。因此后端务必返回规范的 JSON 响应。

## 数据结构

与前端 `Knowledge.tsx` 的会话模型一致：

```ts
type Citation = {
  id: number
  title: string
  path?: string        // 引用文件路径，可空
  updated?: string     // 更新时间，可空
}

type ChatMessage = {
  role: 'user' | 'assistant'
  text: string
  citations?: Citation[]   // 仅 assistant 消息可能带参考资料，可空
  createdAt?: string       // ISO 8601
}

type Conversation = {
  id: string        // 会话 uuid（前端 crypto.randomUUID() 生成）
  title: string     // 会话标题（取首个用户问题截断 20 字，空会话为「新对话」）
  messages: ChatMessage[]
  createdAt: string // ISO 8601
  updatedAt: string // ISO 8601
}

// scopeKey：作用域标识，会话归属于某一个作用域
//   'library:<id>'                → 某个知识库，如 'library:1'
//   'collection:<key>'            → 某个知识库集合，如 'collection:personal'
//   'folder:<libraryId>:<路径>'    → 库内文件夹，如 'folder:1:产品规划/需求文档'
type ConversationMap = Record<string, Conversation[]>  // 每个 scope 一个会话数组，最新在前
```

## 端点

### 1. 读取全部问答记录

`GET /api/knowledge/conversations`

**响应 200：**
```json
{
  "success": true,
  "data": {
    "library:1": [
      { "id": "...", "title": "如何配置模型？", "messages": [ ... ], "createdAt": "...", "updatedAt": "..." }
    ],
    "collection:personal": []
  }
}
```
- `data` 为当前用户的全部会话，按 scopeKey 分组；无记录时返回 `{}`。
- 数组顺序：最新会话在前（前端会展示第一个为活跃会话）。

### 2. 全量替换问答记录

`POST /api/knowledge/conversations`

**请求体：**
```json
{
  "conversations": {
    "library:1": [ { "id": "...", "title": "...", "messages": [ ... ], "createdAt": "...", "updatedAt": "..." } ]
  }
}
```

**语义：replace-all**。MySQL 中与本次传入 map 完全一致：

- 前端每次调用携带的是**全量**快照（跨所有 scope），不是增量。
- 后端应在**同一事务**内完成：先删除当前用户的全部记录，再批量插入本次传入的会话（或按主键 upsert，并删除不在本次数据中的记录）。

**响应 200：**
```json
{ "success": true }
```

## MySQL 表结构（参考实现）

```sql
CREATE TABLE IF NOT EXISTS knowledge_conversations (
  id          CHAR(36)     NOT NULL,                 -- 会话 uuid
  scope_key   VARCHAR(255) NOT NULL,                 -- library:1 / collection:personal / folder:1:产品规划
  title       VARCHAR(200) NOT NULL DEFAULT '',
  messages    JSON         NOT NULL,                 -- ChatMessage[] 数组（原样存取）
  created_at  DATETIME(3)  NOT NULL,
  updated_at  DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  KEY idx_scope_key (scope_key),
  KEY idx_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

实现要点：

- `messages` 直接存取完整 JSON 数组（前端按原样读写），后端不做结构解析。
- **用户隔离**：默认不按用户隔离，与现有 `knowledge-workspace` 行为一致（单租户共享）。若部署为多租户，请增加 `user_id` 列并在读写时按当前登录用户过滤。
- 事务写法示例（伪代码）：
  ```sql
  START TRANSACTION;
  DELETE FROM knowledge_conversations /* WHERE user_id = ? */;
  INSERT INTO knowledge_conversations (id, scope_key, title, messages, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?);   -- 逐条
  COMMIT;
  ```

## 前端调用时机（对照）

| 时机 | 说明 |
| --- | --- |
| 页面加载 | `GET` 读取；后端为空时若 `knowledge-workspace` 有历史会话，则迁移（`POST` 一次） |
| 提问（用户消息入列） | `POST` 全量快照（含被「停止生成」中断的情况） |
| 回答回填 | `POST` 全量快照 |
| 编辑重生成 | 同上，两步各 `POST` 一次 |
| 新建对话 | `POST` |
| 历史对话置顶查看 | `POST`（仅发生重排时） |
| 删除对话 | `POST` |
| 删除知识库/文件夹/集合 | `POST`（会话随之清理） |

> 前端 `persistConversations` 内部对多次 `POST` 做了**串行化**，避免 replace-all 语义下并发乱序；后端按事务全量替换即可。
