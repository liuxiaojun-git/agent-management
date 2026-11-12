# 后端任务：文档问答历史记录 + 新建会话（持久化到 MySQL）

> 给外部后端（端口 3000 的 `/api/knowledge` 链路，Express + MySQL）的实现任务书。
> 适用对象：文档查看页 `/knowledge/document`（`KnowledgeDocument` 组件）里的「AI 助手」问答。
> 知识库问答的同类契约见 [knowledge-conversations-api.md](./knowledge-conversations-api.md) 与 [knowledge-conversations-backend-task.md](./knowledge-conversations-backend-task.md)。本文件的表与端点与那套**完全独立**，互不影响。

## 一、目标

给文档问答加上**历史记录**和**新建会话**能力，历史记录通过后端保存到 MySQL。

- 现状：文档页助手是**单会话内存态**（一个 `messages` 数组），刷新即丢失，无历史列表、无「新对话」按钮。
- 目标（对齐知识库页体验）：每个文档有一组会话（最新在前），支持新建/查看/删除/编辑重生成，会话随文档持久化。
- **前端尚未实现**，本任务书先把数据契约与后端方案定下来；前端按此对接。

## 二、核心设计决策

### 1. 文档身份

文档页通过 URL 参数打开：`/knowledge/document?libraryId=318&name=API接口文档&parent=产品规划&...`。

当前 `ContentItem` 模型里文档**没有稳定数字 id**，靠三元组唯一确定：

```
(libraryId, name, parent)
  libraryId  知识库 id（数字）
  name       文档名
  parent     文档所在文件夹路径；根目录下为空字符串 ''
```

> ⚠️ 已知限制：以 name 标识，文档改名后历史会「脱离」文档（与现有 workspace 按名存内容一致）。如需根治，后续给内容加稳定 id 再迁移。

### 2. 为什么单独建表 + 单独端点（不复用 `/api/knowledge/conversations`）

知识库问答的 `POST /api/knowledge/conversations` 是**全库 replace-all**（一个标签页持有所有作用域的完整快照，安全）。但**文档页每个文档单独开一个标签页**，标签页只知道自己这**一个**文档的会话。若复用全局 replace-all：
- 文档标签页 A 保存自己的切片时，会把其他文档、甚至知识库问答的记录清掉 → **跨标签页互相覆盖、数据丢失**。

因此文档会话必须**按文档维度 replace-all**，后端只动目标文档的行。故使用独立表 `document_conversations` + 独立端点 `/api/knowledge/document-conversations`。

### 3. 会话归属粒度

一个文档一份会话数组 `Conversation[]`，**最新在前**（与知识库页每个 scope 的数组语义一致）。新建会话就是往数组头插一个空会话（`id` 前端用 `crypto.randomUUID()` 生成、`title` 默认「新对话」），后端只需存取，无需专门接口。

## 三、需要实现的端点

统一约定：JSON、鉴权 `Authorization: Bearer <access_token>`（与 `/api/knowledge/ask` 一致）；响应 `{ success: boolean, data?, error? }`。未登录返回 `401`。

### 1. `GET /api/knowledge/document-conversations`

按文档读取其全部会话。

- 查询参数：`libraryId`（数字）、`name`（文档名）、`parent`（文件夹路径，根目录传空）。
- 成功响应：
  ```json
  {
    "success": true,
    "data": {
      "conversations": [
        { "id": "...", "title": "如何导出数据？", "messages": [ ... ], "createdAt": "...", "updatedAt": "..." }
      ]
    }
  }
  ```
- 无记录：`data.conversations` 为空数组 `[]`。
- 数组顺序：**最新在前**（前端把第一条当活跃会话）。

### 2. `POST /api/knowledge/document-conversations`

按文档全量替换（replace-all）其会话。

- 请求体：
  ```json
  {
    "libraryId": 318,
    "name": "API接口文档",
    "parent": "产品规划",
    "conversations": [
      { "id": "...", "title": "...", "messages": [ ... ], "createdAt": "...", "updatedAt": "..." }
    ]
  }
  ```
- 语义：**仅该文档**（`libraryId` + `name` + `parent` 三值精确匹配）在**同一事务**内先删后插，使该文档的会话与传入数组完全一致。**不得影响其他文档的行，也不得影响知识库问答表**。
- 前端每次调用携带该文档的**全量**会话快照（新建/提问/回答/编辑/删除/重排后各调一次），不是增量。
- 成功响应：`200 { "success": true }`。

## 四、MySQL 表

```sql
CREATE TABLE IF NOT EXISTS document_conversations (
  id          CHAR(36)     NOT NULL,                 -- 会话 uuid（主键）
  library_id  INT          NOT NULL,                 -- 所属知识库 id
  doc_name    VARCHAR(255) NOT NULL,                 -- 文档名
  doc_parent  VARCHAR(255) NOT NULL DEFAULT '',      -- 文档所在文件夹路径；根目录为空字符串
  title       VARCHAR(200) NOT NULL DEFAULT '',
  messages    JSON         NOT NULL,                 -- ChatMessage[] 数组，原样存取
  created_at  DATETIME(3)  NOT NULL,
  updated_at  DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  KEY idx_doc (library_id, doc_name, doc_parent, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

与 `knowledge_conversations` 表**互不相干**，两套端点各管各的。

## 五、数据结构（与前端 `Knowledge.tsx` 的会话模型一致）

```ts
Citation      = { id: number, title: string, path?: string, updated?: string }
ChatMessage   = { role: 'user' | 'assistant', text: string, citations?: Citation[], createdAt?: string }
Conversation  = { id: string(uuid), title: string, messages: ChatMessage[], createdAt: string, updatedAt: string }  // 时间均为 ISO 8601
```

- `messages` 字段直接存取完整 JSON 数组，**后端不做结构解析**，原样读写。
- `title`：首条用户问题截断 20 字；空会话为「新对话」。前端生成，后端不推导。

## 六、实现要点

- **事务写法**（伪代码）：
  ```sql
  START TRANSACTION;
  DELETE FROM document_conversations
   WHERE library_id = ? AND doc_name = ? AND doc_parent = ?;
  INSERT INTO document_conversations (id, library_id, doc_name, doc_parent, title, messages, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?);   -- 逐条插入本次传入的会话
  COMMIT;
  ```
- **用户隔离**：默认与现有 `knowledge-workspace` 一致，**单租户共享、不做用户隔离**。若部署为多租户，再增加 `user_id` 列并在读写两端按登录用户过滤。
- **响应格式规范**：两个端点都返回规范 JSON；失败用非 `200` + `{ "success": false, "error": "..." }`。**绝不能对未知路径回 `200 + index.html`** —— 前端依赖 `payload.success === true` 判断成功，格式不对会被判定为保存失败。前端会静默降级（问答照常、记录仅存内存），不会崩。
- 两个端点挂在现有 Express 鉴权中间件之后，复用登录态。
- GET 的 `parent` 参数含 URL 编码的路径分隔符 `/`，按普通 query 参数解析即可；`name`/`parent` 与请求体中的值按原样精确匹配，**不做归一化**。

## 七、前端改动方向（供后端理解上下文，另行实现）

- `KnowledgeDocument` 组件：`messages` 单数组升级为 `conversations: Conversation[]` + `activeConversationId`；助手面板加「新对话」按钮与会话历史列表。
- 打开文档时 `GET` 该文档会话，取第一条为活跃会话；提问/回答回填/编辑重生成/新建/删除/置顶重排后 `POST` 全量快照。
- 复用现有 `getKnowledgeConversations` / `saveKnowledgeConversations` 的同款辅助函数模式，新增 `document-conversations` 的 GET/POST 辅助，**带 401 登出、校验 `payload.success`、失败返回 `{ success:false }` 静默降级**。
- 无需迁移旧数据（文档页此前从不持久化，无历史遗留）。

## 八、验收标准

| 场景 | 预期 |
|---|---|
| 未登录调用 GET/POST | 返回 `401` |
| 登录后 GET（带 libraryId/name/parent） | 返回该文档全部会话，最新在前；无记录 `data.conversations = []` |
| 登录后 POST | `200 { success: true }`；仅该文档被替换，**其他文档与知识库问答记录不受影响** |
| 前端打开文档刷新 | 历史会话从 GET 读回，不丢失 |
| 新建会话 | 前端数组头插空会话后 POST，后端原样落库 |
| 双文档标签页并行 | 互不覆盖（各自只动自己的文档行） |

## 九、前后端联调

- 前端按本契约开发中；后端实现后联调用 `admin / admin@123` 登录拿 token（`POST /api/auth/login`）。
- 数据契约变更时先改本文档，再同步前端 `src/utils/api.ts` / `src/pages/Knowledge.tsx` 的文档助手部分。
