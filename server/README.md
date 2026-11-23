# AI-Girl-Battle Server（AI中转站后端）

Fork 自「谋定三国」Go 后端骨架（Gin + GORM），改造为 AI中转站服务端。

## 技术栈

- Go 1.18+ / Gin v1.8 / GORM
- 数据库：**SQLite（本地开发默认，免安装）** / MySQL（生产，`DB_DRIVER=mysql`）
- Redis：可选（`REDIS_ENABLED=true` 开启；未启用自动降级无缓存模式）
- JWT 认证（golang-jwt/v5，替代原骨架的假鉴权）

## 快速启动

```bash
cd server
go build -o ai-server.exe ./cmd
./ai-server.exe        # 默认 8800 端口，SQLite 免安装直接跑
```

首次启动会自动：
1. 建表（users / user_states / config_packages / config_meta）
2. 把 `configs/*.json` 种子配置灌入数据库（已存在的 key 不覆盖）

## API 概览（/api/v1）

| 域 | 端点 | 说明 |
|---|---|---|
| auth | POST /auth/wx-login | 微信 code2session；未配 WX_APPID 时走模拟模式（openid=`dev_<code>`） |
| auth | POST /auth/login | H5 开发直连（open_id 登录） |
| user | GET/PUT /user/profile | 用户资料与资源（coins/tokens/feed/ice_packs） |
| user | GET/PUT /user/state | **云存档**（HomeModel 快照 blob + 乐观锁版本号，冲突返回 409） |
| config | GET /config/version | 全局配置版本号（客户端启动比对） |
| config | GET /config/all | 全量配置包（key → JSON） |
| config | GET /config/:key | 单个配置包 |
| config | PUT /config/:key | 管理端更新（`X-Admin-Token` 鉴权），自动递增 configVersion |
| - | GET /health | 健康检查 |

## 配置中心（服务端权威数值）

- 数值表单一来源在服务端数据库；`configs/` 下的 JSON 只是**首装种子**
- 运营调数值：`PUT /config/<key>` → configVersion 递增 → 全端下次启动拉新，**无需提审**
- 客户端 3 张本地 JSON 是拉取失败时的兜底

## 环境变量

见 `.env.example`。要点：
- `SERVER_PORT` 默认 8800（本机 8080 被 IIS 占用）
- `WX_APPID`/`WX_SECRET` 留空 = 开发模拟登录
- `ADMIN_TOKEN` 配置中心写凭证

## 改造记录（相对谋定三国骨架）

| 项 | 原骨架 | 本仓库 |
|---|---|---|
| 鉴权 | TODO 假鉴权（固定 user_id=1） | 真 JWT 签发/解析 |
| 数据库 | MySQL 硬依赖 | sqlite/mysql 双驱动，本地免安装 |
| Redis | 硬依赖 | 可选降级 |
| 用户字段 | 金粮兵力（三国） | 金币/Token/饲料/冰垫（AI中转站） |
| 用户数据 | 三国业务字段 | 通用状态 blob + 版本乐观锁 |
| 配置 | 无 | **配置中心**（种子 + 版本 + 管理端 API） |
| 业务 | battle/tactics/shop/pvp/achievement/leaderboard | 删除，待按里程碑逐步重建（pet/pve/pvp/settlement） |
