# 《AI中转站》技术方案文档

> 微信小游戏 · 洛克王国式宝可梦like · 宠物 = AI 拟人娘化形象 · 核心玩法 = 对战 + 培养

| 文档信息 | |
|---|---|
| 版本 | v1.2（新增配置中心与热更新策略） |
| 日期 | 2026-11-23 |
| 平台路径 | **上线目标：微信小游戏（裂变主场）；开发期：H5 构建日常迭代；抖音小游戏为第二落点** |
| 引擎 | Cocos Creator 3.8.7（首选）/ 3.8.6（备选） |
| 形态 | 竖屏 2D，单局 3~5 分钟，广告变现为主 |
| 服务器 | Go（fork 谋定三国后端骨架）+ MySQL + Redis |

---

## 1. 项目定位与 MVP 边界

### 1.1 一句话定位

> 你是破烂 AI 中转站的站长，租来的 AI 娘是过客，部署下来的 AI 娘是家人。管她们吃住散热，带她们接工单处理麻烦，带她们去竞技场证明这间破站养得出好模型。

### 1.2 MVP 范围（阶段一，4~5 周）

**做**：
- 3 只部署 AI 娘 + 1 只租用 AI 娘（首批角色）
- 家园 4 设施（宿舍/电闸/风扇/小厨房），各 2 级
- 5 个 PVE 麻烦 + 1 个古董程序 Boss
- 每日维护结算（服务端权威）
- 3v3 回合制对战引擎（PVE）
- 异步 PVP（看家阵容 + 段位，确定性战斗）
- 广告变现 4 个触发点
- 微信登录 + 云存档

**不做（明确推迟）**：
- Live2D（MVP 用静态立绘 + 表情帧/Spine）
- 实时对战（阶段二用 WS hub 扩展，异步 PVP 先行）
- 抽卡、内购（MVP 只做广告）
- 好友关系链（逛家园/留言/送礼 → 阶段二）
- 训练角、客厅的完整功能（MVP 只留入口占位）

### 1.3 验证目标

> 玩家是否愿意为"养得起这群 AI 娘"而认真过日子、接麻烦？

---

## 2. 核心玩法系统设计

### 2.1 家园设施（六个空间，MVP 实现 4 个）

| 空间 | 作用 | 核心压力 | MVP |
|---|---|---|---|
| 宿舍 | 部署 AI 娘的床位 | 床位不够→睡机架旁→心情掉得快 | ✅ 2 级 |
| 电闸 | 全站用电上限（租用也占电） | 欠费跳闸→全站停摆 | ✅ 2 级 |
| 风扇 | 散热上限 | 不足→过热宕机→手动拍机箱/买冰垫 | ✅ 2 级 |
| 小厨房 | 算力饲料生产 | 断粮→AI 娘变蔫→技能软绵绵 | ✅ 2 级 |
| 客厅 | 好感与闲聊、情感事件 | — | 占位 |
| 训练角 | 部署专用训练槽 | — | 占位 |

### 2.2 宠物双轨：租用 vs 部署

| 维度 | 租用 AI 娘 | 部署 AI 娘 |
|---|---|---|
| 获取 | 低门槛即时可用，有租期 | 捕获/修复/部署 |
| 成本 | 每日 Token 工资（零售后） | 一次性获取 + 每日吃住散热 |
| 培养 | 不可培养，强度固定 | 训练/升星/学技能 |
| PVP | 最多带 1 只，部分赛季禁用 | 核心 PVP 单位 |
| 情感 | 到期离开→告别事件 | 长期绑定→专属台词/事件 |
| 风险 | 涨价/到期/被召回 | 过热宕机/断粮掉状态/离家出走 |

### 2.3 战斗系统（一套骨架，PVE/PVP 共用）

- **3v3 回合制，每宠 3 技能，PP 值制**
- 出手顺序 = **先手值 > 带宽（速度）**；换宠指令优先级高于普通技能
- **四系单属性克制**：算力 / 网络 / 硬件 / 异常

```
克制矩阵（行攻击 → 列防御）：
            算力   网络   硬件   异常
算力(攻)     1    2     0.5    1
网络(攻)    0.5   1     2      1
硬件(攻)     1   0.5    1      2
异常(攻)     2    1    0.5     1
（环状克制：算力克网络克硬件克异常克算力）
```

- 技能分攻击/防御/状态三类，保留轻度应对关系，不做完整猜拳
- 宠物四维：
  - **算力** = 攻击
  - **带宽** = 速度
  - **稳定** = 防御/命中
  - **散热** = 耐久/状态抗性

**伤害公式（MVP 基础版，数值表待专项细化）**：

```
伤害 = floor( (攻击方算力 × 技能威力 / 50 + 2) × 克制系数 × 随机数(0.85~1.0) − 防守方稳定/3 )
下限 = 1
```

### 2.4 PVE：中转站日常的麻烦（MVP 5+1 个）

| # | 麻烦 | 机制特点 | 打完后续 |
|---|---|---|---|
| 1 | 跑丢的旧模型 | 低强度教学战 | 送回/收留（低星部署）/拆零件 |
| 2 | 赖着不走的缓存幽灵 | 复制你上一个技能，逼换技能顺序 | 掉带宽零件 |
| 3 | 做窝的野生小AI | 可捕获，低星但散热天生高 | 宿舍上铺安家事件 |
| 4 | 被啃的电线残局 | 连战小波次 | 掉电闸修理材料 |
| 5 | 隔壁站捣乱的租用宠物 | 掉信誉和零件，偶尔掉对方情报 | 信誉小事件 |
| Boss | 断电复活的古董程序 | 高稳定低带宽，叠"过热"，逼用散热/异常系磨 | 解锁 PVP + 剧情 |

### 2.5 异步 PVP（确定性战斗，阶段一）

- 玩家布置**看家阵容**：3 只部署 AI 娘 + 设施加成快照，存服务端
- 挑战：服务端取出对方阵容快照，**用与 PVE 完全相同的战斗规则引擎跑一遍**，返回战报（回放数据）
- 对方不在线也可被挑战；防守结果异步通知
- 租用 AI 娘最多带 1 只；段位上限与宿舍床位、电闸等级挂钩
- 奖励：零件、限定饲料口味、设施装饰、情感道具（不做纯数值碾压）
- 乐子：赛前嘴炮短对话、赛后安慰/庆祝事件（文本配置表驱动）

### 2.6 每日维护结算（服务端权威，纯函数规则）

```
结算(设施等级表, AI娘列表, 上次结算时间) → 账单 + 状态变化
```

| 结算项 | 规则（初版数值，待平衡） |
|---|---|
| 电费 | 每只 AI 娘（部署+租用）× 基础功耗 × 电闸等级折算；金币不足→跳闸（全站状态异常 24h） |
| 饲料 | 每只部署 AI 娘 × 饲料消耗；断粮→状态"蔫"，技能效果 ×0.6 |
| 散热 | Σ(宠热度) > 风扇容量 → 随机 1 只"过热宕机"（无法出战，需拍机箱/冰垫解） |
| 心情 | 床位人均 ≥1 → 正常；<1 → 心情衰减加速 |
| 租用工资 | 每日扣 Token；不足 → 租用 AI 娘提前离场（告别事件） |
| 离线收益 | 离线时长 × 产能上限（广告可翻倍） |

**实现要求**：结算逻辑做成与 UI/网络无关的纯函数包（客户端预演用同一份逻辑表，服务端为权威结果源）。

---

## 3. 总体技术架构

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  Cocos Creator 3.8.7 客户端  │  HTTPS │   Go 服务端（fork 谋定三国）    │
│                             │ ─────→ │  Gin + GORM + Redis + JWT     │
│  场景流程 / UI / 战斗表现     │  WSS   │  ├─ auth        登录鉴权(保留) │
│  ├─ 战斗规则引擎(纯TS)       │ (阶段2)│  ├─ user        云存档(保留)  │
│  ├─ 数据表(config JSON)     │        │  ├─ pet         宠物(新写)    │
│  ├─ 管理器层(单例)           │        │  ├─ facility    设施(新写)    │
│  └─ 平台适配(wx.* 封装)      │        │  ├─ battle      战斗结算(新写)│
└─────────────────────────────┘        │  ├─ pvp         异步PVP(改造) │
                                       │  ├─ shop/ad     商店/成就(改造)│
                                       │  └─ cron        每日结算(新写)│
        微信小游戏运行时                 └──────────────────────────────┘
        (wx.request/wx.login/                    │
         广告/云存档)                       MySQL（持久化）+ Redis（缓存/锁）
```

**核心架构原则**：
1. **服务端权威**：战斗结算、每日维护、PVP 全部服务端计算；客户端只做预演与表现
2. **确定性战斗**：同一套战斗规则引擎（TS 版客户端预演 / Go 版服务端权威），随机数用可播种 PRNG，战报可回放
3. **数据与表现分离**：战斗规则引擎不 import `cc`，可在 Node 里单测

---

## 4. 服务端设计

### 4.1 谋定三国后端代码处置清单

| 模块 | 处置 | 说明 |
|---|---|---|
| cmd/main.go 路由骨架 | **保留** | 路由分组结构照抄 |
| middleware（JWT/Auth/CORS） | **保留** | 直接用 |
| user handler + 登录 | **改造** | 增加 wx code2session 换 openid 流程 |
| WebSocket hub | **保留备用** | 阶段二实时对战启用 |
| PVP room handler | **改造** | 实时房间 → 异步防守阵容 + 挑战结算 |
| battle/levels handler | **重写** | 三国关卡 → PVE 麻烦关卡 |
| tactics（锦囊） | **删除** | → skills 技能表 |
| shop / achievement / leaderboard | **改字段** | 路由组织保留 |
| GORM models（三国业务） | **重写** | 见 4.2 |
| go.mod 依赖 | **保留** | gin/gorm/redis/jwt/websocket/godotenv 全部继续用 |

### 4.2 数据库模型（GORM 表）

```
users            用户：id, openid, nickname, avatar, gold, token(工资币), power(战力), created_at
pets             宠物实例：id, user_id, species_id, nickname, star(星级), level, exp,
                 iv_四维(算力/带宽/稳定/散热), skills(JSON,≤3+1), pp_current(JSON),
                 status(normal/tired/overheat/hungry/mood_low), mood, source(deploy/rent),
                 rent_expire_at, wage_per_day
pet_species      种族表：id, name, rarity(1~5), base_四维, type(算力/网络/硬件/异常),
                 skill_pool(JSON), capture_rate, evolve_to
skills           技能表：id, name, type(攻/防/状), element(四系), power, pp_max, priority(先手值),
                 effect(JSON: buff/debuff/heal/shield...)
facilities       设施：user_id, dormitory_lv, power_lv, fan_lv, kitchen_lv, living_lv, train_lv
settlements      每日结算账单：id, user_id, settle_date, bill(JSON), snapshot(JSON), created_at
formations       PVP 防守阵容：user_id, pet_ids(JSON×3), facility_snapshot(JSON), rating, season_id
pvp_battles      PVP 战报：id, attacker_id, defender_id, seed, report(JSON), result, created_at
pve_progress     PVE 进度：user_id, level_id, cleared, stars, best_report
items / inventory  物料：零件/饲料/冰垫/装饰/情感道具
ad_rewards       广告奖励记录：user_id, ad_type, reward, ts（防刷限额）
```

### 4.3 REST API 契约 v1

统一前缀 `/api/v1`，鉴权头 `Authorization: Bearer <jwt>`，响应包 `{ code, msg, data }`。

**认证**
```
POST /auth/wx-login       { code } → { token, user }        微信 code2session
GET  /health              → 状态检查
```

**配置中心（服务端权威数值，见 §4.6）**
```
GET  /config/version      → { configVersion }               客户端启动时比对
GET  /config/all          → 全量配置包（种族/技能/设施/结算规则/掉落/文案）
GET  /config/diff         { fromVersion } → 增量（阶段二可选）
```

**用户/云存档**
```
GET  /user/data           → 完整用户状态（含设施/宠物列表/资源）
PUT  /user/data           { partial } → 同步非权威字段（昵称/设置）
```

**家园/设施**
```
GET  /facility            → 设施等级与当前负载（用电/散热/床位占用）
POST /facility/upgrade    { facility, } → { cost, new_lv }   校验资源与前置
GET  /facility/load       → 实时负载快照（含超载预警）
```

**宠物**
```
GET  /pet/list            → 我的宠物（部署+租用，含状态）
GET  /pet/:id             → 单只详情（四维/技能/PP/心情）
POST /pet/capture         { species_id, battle_report_id } → 捕获结算（PVE 战斗胜利后）
POST /pet/train           { pet_id, slot }   → 训练角培养（阶段一占位）
POST /pet/star-up         { pet_id, materials } → 升星
POST /pet/skill-set       { pet_id, skill_ids[≤3] } → 配技能
```

**PVE**
```
GET  /pve/levels          → 麻烦列表（含解锁状态）
GET  /pve/level/:id       → 关卡敌人配置
POST /pve/battle/start    { level_id, team[≤3] } → { battle_id, seed }
POST /pve/battle/cmd      { battle_id, cmd } → 服务端逐回合权威执行（或整场托管结算，见 4.4）
POST /pve/battle/end      { battle_id } → { result, rewards, report }
```

**异步 PVP**
```
PUT  /pvp/formation       { pet_ids[3], } → 保存看家阵容（快照四维+设施加成）
GET  /pvp/opponent        → 匹配对手（rating 近邻 + 随机）
POST /pvp/challenge       { defender_id } → { battle_id, report, result, rating_delta }
GET  /pvp/ranking         { season, page } → 段位榜
GET  /pvp/history         → 我的挑战记录
```

**每日结算/离线**
```
GET  /settlement/today    → 今日账单（含离线期间账单 + 离线收益）
POST /settlement/claim    { } → 领取离线收益（广告翻倍走 ad 接口）
```

**广告**
```
POST /ad/reward           { ad_type: offline_x2|maintenance_off|extra_job|pvp_extra, ticket } → 发放奖励
                          （服务端校验微信广告回调凭证 + 每日限额）
```

### 4.4 战斗结算的两种模式（MVP 采用 B）

- A. 逐回合指令：客户端每回合 POST cmd，服务端执行并返回帧。**实时性最好，开发量最大**
- B. **整场托管（MVP）**：客户端用本地同款规则引擎预演整场 → 提交完整操作序列 + 随机种子 → 服务端重放校验 → 权威结果。**开发量小、天然防作弊（重放不一致即判无效）、战报自动可回放**

> 战斗规则引擎需要 TS 与 Go 双实现（同一份规则表 JSON 驱动，逻辑对拍测试保证一致）。这是全项目最重要的工程约定。

### 4.5 定时任务（cron）

```
每日 05:00   每日维护结算：电费/饲料/散热/心情/租用工资 → settlements 落库 + push 账单
每小时      散热余量巡检（过热宕机判定）
每小时      租期到期检查 → 租用 AI 娘离场 + 告别事件入队
每周一 05:00 PVP 赛季重置（段位软重置 + 奖励结算）
```

### 4.6 配置中心（服务端权威数值，v1.2 新增）

**原则：一切数值配置以服务端为唯一权威，客户端只是缓存与展示层。**

| 配置域 | 内容 | 服务端存储 |
|---|---|---|
| species / skills | 种族四维、技能威力/PP/效果 | MySQL 表（运营可改）|
| facilities / settlement | 设施容量、结算规则常数 | MySQL 表 + 单例 config 包 |
| gacha / drop | 捕获率、掉落表、离线收益 | MySQL 表 |
| copy / events | 文案、嘴炮台词、事件文本 | JSON 资源包 |

- 服务端持有 `configVersion`（配置变更即递增）；客户端启动时 `GET /config/version` 比对，不一致则拉全量并缓存到本地（wx.setStorageSync）
- 战斗/结算引擎的**规则表 JSON 以服务端下发为准**，TS/Go 双端对拍也用同一份
- 客户端工程里现存的 3 张 config JSON 降级为「开发垫脚片」：服务端接入后仅作 ConfigManager 拉取失败时的兜底
- 运营调数值 → 改服务端配置 → 递增 configVersion → 全端下次启动生效，**无需提审**

### 4.7 热更新策略（微信小游戏，v1.2 新增）

**常见误区澄清**：Cocos Creator 自带的 AssetsManager 热更新只适用于原生 App 构建（Android/iOS），**微信小游戏不支持、也不允许代码级热更新**——平台禁止运行时从网络加载脚本，违规提审会被驳回。

微信小游戏的三层热更策略：

| 层 | 内容 | 方式 | 合规性 |
|---|---|---|---|
| L1 配置热更 | 数值/规则/文案/开关 | `/config` API + configVersion（§4.6） | ✅ 随时生效，无需提审 |
| L2 资源热更 | 立绘差分、Spine、音频、活动图 | CDN 直链 + `wx.getFileSystemManager` 下载缓存 + 本地路径加载 | ✅ 合规（资源非代码） |
| L3 逻辑修复 | 脚本 bug 修复、新玩法 | 小版本快速提审；重大更新走微信「加急审核」 | 平台唯一路径 |

**落地约定**：
1. 客户端所有美术加载优先查本地缓存（CDN 下载过的），未命中再走包内 resources——ResourceProxy 统一收口
2. 配置加载优先级：本地缓存（版本匹配）→ 服务端拉取 → 包内垫脚片（开发期）
3. L3 依赖的快速提审，要求构建流程 CI 化（一键出包+上传），W4 建立

---

## 5. 客户端设计（Cocos Creator 3.8.7）

### 5.1 工程目录

```
client/
├── assets/
│   ├── scenes/          gameStart / home / battle / pvpHall / warehouse
│   ├── scripts/
│   │   ├── core/        GameManager / NetManager(wx.request) / WxAdapter / AudioManager / AdManager
│   │   ├── battle/      BattleEngine(纯逻辑) / BattlePresenter(表现) / SkillFactory / PRNG
│   │   ├── pet/         PetData / PetFactory / TypeChart / ExpCurve
│   │   ├── home/        FacilitySystem / SettlementPreview(纯函数)
│   │   ├── ui/          HomeUI / BattleUI / WarehouseUI / PvpUI / SettlementUI / ToastUI
│   │   └── data/        config 加载与本地缓存
│   ├── resources/       config JSON(种族/技能/克制表/关卡/数值) / Spine / audio
│   └── prefabs/
└── settings/
```

### 5.2 场景清单与流程（参考 Cocos_Roco 的流程骨架）

```
gameStart（启动/登录/公告）
   → home（中转站主界面：设施状态/AI娘日常/入口聚合）
   → battle（PVE 对战，战斗内换宠/技能/道具）
   → pvpHall（阵容布置/挑战/段位）
   → warehouse（宠物仓库/详情/养成）
```

### 5.3 核心管理器（单例，参照谋定三国范式）

| 管理器 | 职责 | 关键约定 |
|---|---|---|
| GameManager | 全局状态机 + 管理器编排 | 常驻节点 |
| NetManager | wx.request 封装、token 刷新、重试 | **禁用 fetch**，接口分域：auth/pet/battle/pvp |
| WxAdapter | **平台 API 统一收口**：wx.login / 激励视频 / 分享卡片 / 订阅消息 / 心跳 WS | **一套工程双构建：日常 H5 迭代，上线微信小游戏**；业务层永不直接碰 wx.* |
| AdManager | 4 个激励视频位：离线翻倍/维护减免/额外工单/PVP 次数 | 频次控制 + 服务端凭证校验 |
| AudioManager | BGM/音效 | 分包加载 |

### 5.3.1 平台策略：为什么"开发用 H5、上线靠微信"

| 阶段 | 构建目标 | 用途 |
|---|---|---|
| 日常开发 | H5（web-desktop） | 改代码刷新即见、无需域名/真机，验证玩法循环与数值 |
| 平台功能 | 微信开发者工具 + 真机预览 | wx.login/广告/分享卡片/订阅消息——从 W1 就按 wx API 写入 WxAdapter，不后补 |
| **上线** | **仅微信小游戏** | 裂变引擎（分享卡/竞技场/订阅召回）+ 广告变现均只在微信生态 |
| 第二落点 | 抖音小游戏（推迟） | Cocos 同引擎一键构建，微信裂变模型跑通后移植 |

裂变循环（PVP 挑战 → 战报卡片分享 → 好友点卡应战）只有微信能跑通，故上线目标唯一锁定微信；H5 仅作开发工具不上线。

### 5.4 战斗逻辑层（纯逻辑 / 表现分离）

```
BattleEngine（不 import 'cc'，Node 可单测）
  输入：双方阵容(种族/个体值/技能/PP/状态) + 操作序列 + seed
  输出：帧列表 [{round, actor, action, damage, hp_from, hp_to, events[]}]
BattlePresenter
  输入：帧列表 → 驱动 Spine 动画/飘字/转场
```

### 5.5 广告触发点（符合微信广告合规，无诱导）

| 触发点 | 类型 | 时机 |
|---|---|---|
| 离线收益翻倍 | 激励视频 | 上线领取离线账单时 |
| 今日维护费减免一次 | 激励视频 | 每日结算弹窗 |
| 额外工单（PVE 体力/次数） | 激励视频 | 工单耗尽时 |
| PVP 挑战次数 +1 | 激励视频 | 次数耗尽时 |

---

## 6. 联调与上线

| 事项 | 说明 | 启动时机 |
|---|---|---|
| **域名 + 备案** | 云轻量服务器 + HTTPS + ICP 备案（约 2~3 周） | **立即并行启动，最长等待项** |
| 微信小游戏后台 | request 合法域名配置；个人主体无法选"角色类"目 → 个体工商户/企业资质 | 备案同期 |
| 开发调试 | 开发者工具勾"不校验合法域名"，localhost 联调 | 第一天 |
| 分包 | 主包 ≤4MB；config+首场景主包，Spine/音频/其他场景分包 | 构建期 |
| 提审 | 类目、广告合规（无诱导）、隐私协议、适龄 | 阶段一末 |

---

## 7. 里程碑计划（总 4~5 周）

| 周 | 里程碑 | 验收标准 |
|---|---|---|
| W1 | API 契约冻结 + Go 后端骨架跑通（fork→登录→云存档→**配置中心 /config**）+ 客户端工程建立 + **WxAdapter 四件套** + **ConfigManager（服务端配置缓存）** | wx 登录闭环，curl 可打全部 stub 接口；客户端数值改服务端配置后启动即生效；**H5 与微信双构建均可在开发者工具运行** |
| W2 | 宠物/设施模型 + 战斗规则引擎 TS/Go 双实现 + 对拍测试 | 同种子同操作序列，双端帧列表完全一致 |
| W3 | PVE 闭环：5+1 关卡 + 捕获 + 每日结算 cron | 编辑器可完整玩通 PVE + 看到账单 |
| W4 | 异步 PVP + 广告 4 触点 + warehouse/养成 UI | 真机可玩，广告有回调 |
| W5 | 数值平衡 + 真机性能（首屏/内存）+ 提审材料 | 提审提交 |

**并行线（本周即启动）**：域名备案、微信资质（个体户）、首批 3 只 AI 娘人设与立绘需求单、每日开销数值表。

---

## 8. 风险与待决事项

| # | 风险/待决 | 影响 | 对策 |
|---|---|---|---|
| 1 | TS/Go 战斗引擎对拍不一致 | 致命：判负/纠纷 | 规则表 JSON 单一来源（服务端配置中心下发）+ 每日 CI 对拍随机 1 万场 |
| 2 | 微信"角色类"主体限制 | 无法上线 | 备案同期办个体户；先用工具类目试审 |
| 3 | 鲸鱼娘等社区素材 CC BY-NC-SA 非商用 | 法务 | MVP 全部原创/免费商用素材占位（DeepSeek娘需核对 codex-pet 仓库授权） |
| 4 | 数值表未细化 | 结算/战斗失衡 | W2 前出数值表 v0（已入配置 JSON，迁移服务端） |
| 5 | 首批 3 只 AI 娘人设未定 | 美术阻塞 | 与数值表并行出需求单 |
| 6 | Spine AI 生成初稿质量不可控 | 美术工期 | AI 出初稿+人工精修流程，MVP 可降级表情帧 |
| 7 | 个人服务器被刷/压测不足 | 线上事故 | 广告凭证校验+接口限频；上线前简易压测 |
| 8 | 误用原生热更方案于小游戏（AssetsManager） | 提审驳回 | 严格遵守 §4.7 三层策略：配置 API 热更 + 资源 CDN 缓存，代码走快速提审 |

---

## 9. 参考项目使用说明（已实测）

| 项目 | 实测结论 | 用法 |
|---|---|---|
| 谋定三国 `wynnforthework/moudingsanguo`（3.8.6） | 前端 1.27 万行但编译断链、0 场景；**Go 后端 22 文件/49 路由完整** | **只 fork 后端**；前端 manager 范式/API 分域当教材 |
| Cocos_Roco `2061360308/Cocos_Roco`（3.7.4） | **v1.1 深度实测（源码级）**：7 场景 + 44MB 素材完整，但**对战场景 play 零脚本**——战斗逻辑完全不存在；15 个 TS 共 1300 行；websocket.ts（188 行）是质量不错的 WS 封装（心跳/重连/信号分发）但用的是浏览器原生 WebSocket 且硬编码腾讯云网关地址；宠物数据仅类型定义+残缺示例；Python 服务器 146 行纯消息转发 | **不能当底座**。可移植资产：①websocket.ts 的心跳/重连/信号模式（改 wx.connectSocket）；②场景流程组织与免费 UI 素材/动画做占位；③宠物属性类型模型（含 buff/debuff 槽位）做数据结构参考 |
| CocoKnightManager（社区包，非 GitHub） | 纯逻辑战斗骨架 22 文件，数据/表现分离 | 战斗引擎骨架参照；需从 CSDN 找下载入口 |
| olua `WebCoderT/olua`（3.8.7 + NestJS） | 数据架构教材，非游戏模板 | 养成曲线表设计参照 |
| Cocos-PetBattle `gokepler/Cocos-PetBattle`（2.3.3） | 2021 停更，**不采用** | 仅收藏 |

---

## 10. 下一步行动（按序）

1. ☑ 数值表 v0：每日开销/设施升级费用/四维成长/技能威力（已完成客户端版 → 迁服务端配置中心）
2. ☑ Go 后端 fork：骨架 + 登录 + 云存档 + **配置中心 /config（数值表入库，服务端权威）**（W1）
3. ☑ 客户端 ConfigManager：configVersion 比对 → 拉取/缓存 → 垫脚片兜底（W1，替代直读本地 JSON）
4. ☐ 客户端 WxAdapter 双构建验收（四件套代码已就绪：登录/请求/分享/激励视频/订阅消息，待微信开发者工具真机验收）
5. ☑ 战斗规则引擎 TS 版 + Go 版 + 对拍用例（W2，206 场对拍全通过）
6. ☑ PVE 闭环：关卡 + 战斗 + 捕获（W3，E2E 全通）
7. ☑ 异步 PVP：防守阵容 + 挑战 + 积分排行（W4，E2E 全通）+ 广告/分享触点
8. ☐ 交互式逐回合指令 + 养成/仓库 UI + 微信真机验收（W5）
9. ☐ 首批 3 只 AI 娘人设需求单（并行）
