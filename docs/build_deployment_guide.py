from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.section import WD_SECTION
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.text import WD_BREAK

OUT = r"E:\agent-management\docs\AI 工作台部署手册.docx"

BLUE = "2E74B5"
DARK = "1F4D78"
LIGHT = "E8EEF5"
GRAY = "F2F4F7"
MUTED = RGBColor(95, 105, 120)


def set_font(run, name="Microsoft YaHei", size=11, bold=False, color=None):
    run.font.name = name
    run._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), name)
    run.font.size = Pt(size)
    run.bold = bold
    if color:
        run.font.color.rgb = RGBColor.from_string(color)


def shade(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_margins(cell, top=90, start=120, bottom=90, end=120):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    tcMar = tcPr.first_child_found_in("w:tcMar")
    if tcMar is None:
        tcMar = OxmlElement("w:tcMar")
        tcPr.append(tcMar)
    for m, v in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tcMar.find(qn(f"w:{m}"))
        if node is None:
            node = OxmlElement(f"w:{m}")
            tcMar.append(node)
        node.set(qn("w:w"), str(v))
        node.set(qn("w:type"), "dxa")


def set_repeat_header(row):
    trPr = row._tr.get_or_add_trPr()
    el = OxmlElement("w:tblHeader")
    el.set(qn("w:val"), "true")
    trPr.append(el)


def set_table_widths(table, widths):
    table.autofit = False
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    for row in table.rows:
        for i, w in enumerate(widths):
            row.cells[i].width = Inches(w)
            set_cell_margins(row.cells[i])
            row.cells[i].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER


def add_table(doc, headers, rows, widths):
    table = doc.add_table(rows=1, cols=len(headers))
    table.style = "Table Grid"
    set_table_widths(table, widths)
    set_repeat_header(table.rows[0])
    for i, value in enumerate(headers):
        cell = table.rows[0].cells[i]
        shade(cell, LIGHT)
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(value)
        set_font(r, size=9.5, bold=True, color=DARK)
    for row_data in rows:
        cells = table.add_row().cells
        for i, value in enumerate(row_data):
            p = cells[i].paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER if i == 0 else WD_ALIGN_PARAGRAPH.LEFT
            r = p.add_run(str(value))
            set_font(r, size=9.2)
    doc.add_paragraph().paragraph_format.space_after = Pt(0)
    return table


def add_code(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Inches(0.15)
    p.paragraph_format.right_indent = Inches(0.15)
    p.paragraph_format.space_before = Pt(3)
    p.paragraph_format.space_after = Pt(7)
    p.paragraph_format.line_spacing = 1.05
    pPr = p._p.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), "F5F7FA")
    pPr.append(shd)
    for idx, line in enumerate(text.splitlines()):
        if idx:
            p.add_run().add_break()
        r = p.add_run(line)
        set_font(r, name="Consolas", size=8.5)


def add_note(doc, label, text, risk=False):
    table = doc.add_table(rows=1, cols=1)
    table.style = "Table Grid"
    set_table_widths(table, [6.5])
    shade(table.cell(0, 0), "FFF4E5" if risk else "EEF5FB")
    p = table.cell(0, 0).paragraphs[0]
    r = p.add_run(label + "：")
    set_font(r, size=9.5, bold=True, color="9B1C1C" if risk else DARK)
    r = p.add_run(text)
    set_font(r, size=9.5)
    doc.add_paragraph().paragraph_format.space_after = Pt(0)


def bullet(doc, text, level=0):
    p = doc.add_paragraph(style="List Bullet" if level == 0 else "List Bullet 2")
    p.paragraph_format.left_indent = Inches(0.375 + level * 0.25)
    p.paragraph_format.first_line_indent = Inches(-0.188)
    p.paragraph_format.space_after = Pt(4)
    r = p.add_run(text)
    set_font(r)
    return p


def numbered(doc, text):
    p = doc.add_paragraph(style="List Number")
    p.paragraph_format.left_indent = Inches(0.375)
    p.paragraph_format.first_line_indent = Inches(-0.188)
    p.paragraph_format.space_after = Pt(4)
    r = p.add_run(text)
    set_font(r)
    return p


doc = Document()
section = doc.sections[0]
section.top_margin = Inches(0.8)
section.bottom_margin = Inches(0.75)
section.left_margin = Inches(1)
section.right_margin = Inches(1)
section.header_distance = Inches(0.35)
section.footer_distance = Inches(0.35)

styles = doc.styles
normal = styles["Normal"]
normal.font.name = "Microsoft YaHei"
normal._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
normal.font.size = Pt(10.5)
normal.paragraph_format.space_after = Pt(6)
normal.paragraph_format.line_spacing = 1.22
for name, size, color, before, after in [
    ("Title", 28, DARK, 0, 10),
    ("Subtitle", 12, "5F6978", 0, 16),
    ("Heading 1", 16, BLUE, 16, 8),
    ("Heading 2", 13, BLUE, 12, 6),
    ("Heading 3", 11.5, DARK, 9, 4),
]:
    st = styles[name]
    st.font.name = "Microsoft YaHei"
    st._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
    st.font.size = Pt(size)
    st.font.bold = name != "Subtitle"
    st.font.color.rgb = RGBColor.from_string(color)
    st.paragraph_format.space_before = Pt(before)
    st.paragraph_format.space_after = Pt(after)
    st.paragraph_format.keep_with_next = True

header = section.header.paragraphs[0]
header.alignment = WD_ALIGN_PARAGRAPH.RIGHT
r = header.add_run("AI 工作台 · 部署手册")
set_font(r, size=8.5, color="7A8494")
footer = section.footer.paragraphs[0]
footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = footer.add_run("内部部署交付资料  |  版本 1.0  |  2026-08-18")
set_font(r, size=8, color="7A8494")

p = doc.add_paragraph(style="Title")
p.alignment = WD_ALIGN_PARAGRAPH.LEFT
p.add_run("AI 工作台部署手册")
p = doc.add_paragraph(style="Subtitle")
p.add_run("适用于部署、运维及验收人员")
add_table(doc, ["文档版本", "适用系统", "部署方式", "编制日期"], [["V1.0", "Linux 服务器", "前后端分离 / Node.js 服务化", "2026-08-18"]], [1.2, 1.7, 2.3, 1.3])
add_note(doc, "交付结论", "推荐将后端部署为 3000 端口的 Node.js 服务，将前端构建后通过自带 Node.js 服务在 8081 端口运行，再由统一 Nginx/网关提供 HTTPS 域名访问。")

doc.add_heading("1. 文档目的与范围", level=1)
doc.add_paragraph("本文说明 AI 工作台在生产或预交付环境中的安装、配置、启动、验证、升级与回滚方法。部署人员无需修改业务代码，但必须准备 Node.js、MySQL、反向代理及外部模型网络访问条件。")
bullet(doc, "前端工程目录：agent-management")
bullet(doc, "后端工程目录：qingzhou-backend")
bullet(doc, "后端提供鉴权、平台数据、知识库及知识问答接口。")
bullet(doc, "前端自带 /api/proxy 转发能力，API 测试模块依赖该能力。")

doc.add_heading("2. 部署架构", level=1)
add_code(doc, "用户浏览器\n  └─ HTTPS 443 / HTTP 80\n      └─ Nginx 或统一网关\n          ├─ /              → 前端服务 127.0.0.1:8081\n          └─ /backend-api/  → 后端服务 127.0.0.1:3000\n                                 ├─ MySQL 3306\n                                 └─ DeepSeek/兼容模型 API（HTTPS 出网）")
add_note(doc, "端口原则", "3000 与 8081 建议仅监听内网或由防火墙限制访问，对外只开放 80/443。MySQL 3306 不应暴露到公网。", risk=True)

doc.add_heading("3. 服务器与软件要求", level=1)
add_table(doc, ["项目", "最低建议", "说明"], [
    ["操作系统", "Linux x86_64", "推荐 Ubuntu 22.04+/Rocky Linux 9+"],
    ["CPU", "4 核", "并发问答较高时按实际扩容"],
    ["内存", "8 GB", "前端构建和文档解析会占用额外内存"],
    ["磁盘", "20 GB 可用", "另行规划数据库备份空间"],
    ["Node.js", "20 LTS", "后端最低要求 >=18，统一使用 20 LTS"],
    ["MySQL", "8.0", "字符集建议 utf8mb4"],
    ["Nginx", "1.20+", "负责域名、TLS 和反向代理"],
], [1.15, 1.55, 3.8])

doc.add_heading("4. 交付目录与文件", level=1)
doc.add_heading("4.1 前端交付目录", level=2)
add_code(doc, "agent-management/\n├─ src/\n├─ public/\n├─ server/\n├─ index.html\n├─ package.json\n├─ package-lock.json\n├─ tsconfig.json\n├─ tsconfig.app.json\n├─ tsconfig.node.json\n├─ vite.config.ts\n├─ .env.production\n├─ start.sh\n└─ deploy.service")
doc.add_heading("4.2 后端交付目录", level=2)
add_code(doc, "qingzhou-backend/\n├─ src/\n├─ scripts/\n├─ sql/001_init.sql ... 010_document_conversations.sql\n├─ package.json\n├─ package-lock.json\n├─ .env.example\n└─ README.md")
doc.add_heading("4.3 禁止交付", level=2)
bullet(doc, "node_modules、.git、开发日志、临时文件及本地缓存。")
bullet(doc, "含真实数据库密码、JWT 密钥或模型 API Key 的 .env 文件。")
bullet(doc, "未经确认的历史 dist 目录；应由目标环境重新构建。")

doc.add_heading("5. 部署前准备", level=1)
numbered(doc, "申请部署域名和 TLS 证书，并确认 DNS 已指向服务器或负载均衡。")
numbered(doc, "创建低权限运行用户，例如 appsvc；创建 /opt/agent-management 与 /opt/qingzhou-backend。")
numbered(doc, "安装 Node.js 20 LTS、MySQL 8.0 和 Nginx。")
numbered(doc, "确认服务器可访问 npm 源以及所配置的模型 API 地址。")
numbered(doc, "准备 MySQL 数据库 qingzhou 和专用账号，授予该库所需权限。")

doc.add_heading("6. 数据库初始化", level=1)
doc.add_paragraph("使用专用数据库账号登录 MySQL，按文件名顺序执行 sql 目录下 001 至 010 的全部脚本。不得跳号执行。")
add_code(doc, "mysql -h <DB_HOST> -P 3306 -u <DB_USER> -p < sql/001_init.sql\nmysql -h <DB_HOST> -P 3306 -u <DB_USER> -p < sql/002_app_data.sql\n# 继续依次执行 003、004、005、006、007、008、009、010")
add_note(doc, "执行要求", "执行前先备份已有 qingzhou 数据库；重复部署时应先在测试环境验证脚本兼容性。")

doc.add_heading("7. 后端部署", level=1)
doc.add_heading("7.1 安装依赖", level=2)
add_code(doc, "cd /opt/qingzhou-backend\nnpm ci --omit=dev")
doc.add_heading("7.2 配置环境变量", level=2)
add_code(doc, "PORT=3000\nHOST=127.0.0.1\n\nDB_HOST=<MySQL地址>\nDB_PORT=3306\nDB_USER=<数据库账号>\nDB_PASSWORD=<强密码>\nDB_NAME=qingzhou\n\nJWT_SECRET=<至少32字节的随机字符串>\nJWT_EXPIRES_IN=2h\nCORS_ORIGIN=https://<平台域名>\n\nDEEPSEEK_API_KEY=<模型API密钥>\nDEEPSEEK_BASE_URL=https://api.deepseek.com\nDEEPSEEK_MODEL=<已开通的模型名称>\nDEEPSEEK_TIMEOUT_MS=45000")
add_note(doc, "安全要求", ".env 权限建议设置为 600；JWT_SECRET 与模型 API Key 不得写入部署文档、代码仓库或聊天记录。", risk=True)
doc.add_heading("7.3 创建管理员", level=2)
add_code(doc, "npm run create-admin -- admin '<首次登录强密码>' '管理员'")
doc.add_heading("7.4 配置 systemd", level=2)
add_code(doc, "[Unit]\nDescription=Qingzhou Backend\nAfter=network.target mysql.service\n\n[Service]\nType=simple\nUser=appsvc\nWorkingDirectory=/opt/qingzhou-backend\nExecStart=/usr/bin/node /opt/qingzhou-backend/src/server.js\nRestart=always\nRestartSec=5\nEnvironment=NODE_ENV=production\nEnvironmentFile=/opt/qingzhou-backend/.env\n\n[Install]\nWantedBy=multi-user.target")
add_code(doc, "sudo systemctl daemon-reload\nsudo systemctl enable --now qingzhou-backend\nsudo systemctl status qingzhou-backend")

doc.add_heading("8. 前端部署", level=1)
doc.add_heading("8.1 配置生产环境", level=2)
add_code(doc, "VITE_APP_BASE=/\nVITE_API_BASE_URL=https://<平台域名>/backend-api\nVITE_API_URL=https://<平台域名>/backend-api/api/data")
doc.add_paragraph("Vite 环境变量会在构建时写入前端产物。修改上述地址后必须重新执行构建。")
doc.add_heading("8.2 构建与启动", level=2)
add_code(doc, "cd /opt/agent-management\nnpm ci\nnpm run build\nnode server/app.mjs")
doc.add_paragraph("生产环境应通过 systemd 启动。仓库中的 deploy.service 可作为模板，确认 WorkingDirectory 与 Node.js 路径后安装。")
add_code(doc, "sudo cp deploy.service /etc/systemd/system/agent-management.service\nsudo systemctl daemon-reload\nsudo systemctl enable --now agent-management\nsudo systemctl status agent-management")
add_note(doc, "为什么不直接使用当前 Dockerfile", "当前 Dockerfile 最终只运行 Nginx，未启动 server/app.mjs，因此 /api/proxy 不可用；API 测试模块会受到影响。若使用 Docker，必须改为同时提供前端 Node 服务或为 /api/proxy 提供等价后端。", risk=True)

doc.add_heading("9. Nginx 反向代理", level=1)
add_code(doc, "server {\n    listen 80;\n    server_name <平台域名>;\n\n    client_max_body_size 64m;\n\n    location / {\n        proxy_pass http://127.0.0.1:8081;\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_set_header X-Forwarded-Proto $scheme;\n    }\n\n    location /backend-api/ {\n        proxy_pass http://127.0.0.1:3000/;\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_set_header X-Forwarded-Proto $scheme;\n        proxy_read_timeout 60s;\n    }\n}")
add_note(doc, "路径校验", "上述 proxy_pass 会将 /backend-api/api/health 转发为后端 /api/health。启用 HTTPS 后，应将 80 端口重定向至 443。")
add_code(doc, "sudo nginx -t\nsudo systemctl reload nginx")

doc.add_heading("10. 部署验收", level=1)
add_table(doc, ["序号", "检查项", "预期结果"], [
    ["1", "访问 /backend-api/api/health", "HTTP 200，message 为 ok"],
    ["2", "打开平台登录页", "页面、图标和样式加载正常"],
    ["3", "管理员登录", "登录成功并进入有权限的首个模块"],
    ["4", "首页/模型/日志", "数据读取正常，无 401/404/5xx"],
    ["5", "知识库问答", "能返回答案；模型配置异常时有明确错误"],
    ["6", "API 测试", "普通请求和 /api/proxy 转发均可用"],
    ["7", "服务自启", "服务器重启后两个 systemd 服务均为 active"],
], [0.65, 2.2, 3.65])
add_code(doc, "curl -i http://127.0.0.1:3000/api/health\ncurl -i http://127.0.0.1:8081/\ncurl -i https://<平台域名>/backend-api/api/health\nsystemctl is-active qingzhou-backend agent-management")

doc.add_heading("11. 常见故障排查", level=1)
add_table(doc, ["现象", "优先检查"], [
    ["登录提示网络错误", "VITE_API_BASE_URL、Nginx /backend-api/ 路由、后端 3000 端口"],
    ["接口返回 401", "令牌是否过期、JWT_SECRET 是否变化、用户权限是否初始化"],
    ["知识问答失败", "DEEPSEEK_API_KEY、模型名称、HTTPS 出网、45 秒超时"],
    ["API 测试失败", "前端是否由 server/app.mjs 启动，/api/proxy 是否可达"],
    ["数据库连接失败", "地址、账号权限、防火墙、MySQL bind-address 与字符集"],
    ["刷新页面 404", "请求是否进入前端 Node 服务或 Nginx 是否正确回源"],
], [2.15, 4.35])
add_code(doc, "journalctl -u qingzhou-backend -n 200 --no-pager\njournalctl -u agent-management -n 200 --no-pager\ntail -n 200 /var/log/nginx/error.log")

doc.add_heading("12. 升级、备份与回滚", level=1)
numbered(doc, "升级前备份 MySQL、.env、Nginx 配置和当前前端 dist。")
numbered(doc, "在新目录解压版本，执行 npm ci；数据库脚本必须先评审再执行。")
numbered(doc, "重新构建前端并分别重启后端、前端服务。")
numbered(doc, "完成第 10 章验收后再结束变更窗口。")
numbered(doc, "若失败，恢复旧目录与数据库备份，重启服务并重新验收。")
add_note(doc, "备份建议", "数据库至少每日备份，并定期进行恢复演练；应用配置应进入受控配置库，但不得保存明文密钥。")

doc.add_heading("附录 A：部署交接清单", level=1)
for item in [
    "前后端交付包完整，文件校验值已记录",
    "域名、证书、端口及防火墙策略已确认",
    "数据库已备份并完成 001—010 脚本初始化",
    "生产 .env 已创建且权限为 600",
    "管理员首次密码已通过安全渠道交接",
    "前后端服务已设置开机自启",
    "健康检查、登录、知识问答、API 测试均通过",
    "日志路径、监控方式、备份策略和回滚负责人已交接",
]:
    bullet(doc, "□ " + item)

doc.add_heading("附录 B：关键路径速查", level=1)
add_table(doc, ["用途", "路径或地址"], [
    ["前端目录", "/opt/agent-management"],
    ["后端目录", "/opt/qingzhou-backend"],
    ["前端本地地址", "http://127.0.0.1:8081"],
    ["后端健康检查", "http://127.0.0.1:3000/api/health"],
    ["后端环境文件", "/opt/qingzhou-backend/.env"],
    ["Nginx 配置", "/etc/nginx/conf.d/ 或 /etc/nginx/sites-enabled/"],
    ["服务日志", "journalctl -u qingzhou-backend / agent-management"],
], [2.0, 4.5])

doc.core_properties.title = "AI 工作台部署手册"
doc.core_properties.subject = "AI 工作台前后端生产部署操作说明"
doc.core_properties.author = "项目交付组"
doc.core_properties.keywords = "部署, Node.js, Nginx, MySQL, AI 工作台"
doc.save(OUT)
print(OUT)
