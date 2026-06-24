# NIUMA Frontend Optimized Prototype

## Run
```bash
cd prototype
python3 -m http.server 4173
```
Open `http://localhost:4173`.

## Included Pages
- `index.html`: 首页（价值主张 + CTA + 钱包状态）
- `publish.html`: 发布任务 4 步表单
- `tasks.html`: 我的任务（角色视图 + 状态筛选）
- `messages.html`: 消息中心（会话/系统通知）
- `profile.html`: 个人中心（信誉 + 安全中心）

## Shared Assets
- `styles.css`: 统一视觉系统与响应式规则
- `app.js`: 钱包状态机、语言切换、Toast、发布流程步进
