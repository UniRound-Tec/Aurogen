<div align="center">
  <img src="../assets/banner.png" alt="Aurogen" width="200">
  <h2>Aurogen: More OpenClaws</h1>
</div>

<div align="right">
  <a href="../README.md">English</a> | <strong>简体中文</strong>
</div>

> **👴🏻 开发者说：** 开源社区已经有相当多的 OpenClaw 替代品，有的使用更快的编程语言重构整套系统，有的更方便用户部署，但也或多或少地减少了功能，或让二次开发对初级开发者较为困难。作为 AI 深度使用者，在尝试了大部分替代品后，我们根据更真实的痛点和需求，完全重新实现了类 OpenClaw 系统，并使其具有以下特性。

## ✨ 特性

**🗂️ 完全模组化** — Aurogen 将 OpenClaw 中 **Agent、Channel、Provider、Skills 等**概念完全模组化 / 实例化 / 并行化，使其可以完全由你自由组合编排。这意味着在 Aurogen 中你可以**部署一次养很多只龙虾**，这也是 *More OpenClaws* 的含义。

**💡 轻松配置** — Aurogen 完全舍弃了 CLI 交互和配置文件。安装完成后，打开网页 → 设置密码 → 配置第一个 Provider，即可在 Web Channel 开始使用。由于所有模组都是动态加载，任何设置**无需重启、直接生效**！

**🦀 生态兼容** — Aurogen 完全兼容 OpenClaw 生态，你可以在 [clawhub.ai](https://clawhub.ai/) 下载任意 Skills 并导入到 Aurogen 中。内置的公共 Skills 也自带 ClaWHub 技能集成。

> **词源：** *Aurogen* = *Aurora*（曙光 / 极光，罗马黎明女神）+ *generation*（时代），发音有点像🍊！所以来养一棵挂满🍊的橙子树吧！

---

## 📢 新闻

- **2026-03-10** — **Aurogen 正式发布！赶快来尝尝🍊吧！**

---

## 🏗️ 架构

![架构图](../assets/arc.png)

> *架构图还比较粗糙，后续会重新绘制一版。*

---

## 🦀 功能对比

| 功能 | Aurogen | OpenClaw | NanoBot | PicoClaw | ZeroClaw |
|---|:---:|:---:|:---:|:---:|:---:|
| 记忆能力 | ✅ | ✅ | ✅ | ✅ | ✅ |
| Tools / Skills | ✅ | ✅ | ✅ | ✅ | ✅ |
| Subagent | ✅ | ✅ | ✅ | ✅ | ✅ |
| Web 面板 | ✅ | ✅ | ✖️ | ✖️ | ✖️ |
| 多 Agent（非 Subagent） | ✅ | ✖️ | ✖️ | ✖️ | ✖️ |
| 单渠道多实例 | ✅ | ✖️ | ✖️ | ✖️ | ✖️ |
| BOOTSTRAP 机制 | ✅ | ✅ | ✖️ | ✖️ | ✖️ |
| **最低硬件成本** | Linux SBC ~$50 | Mac Mini $599 | Linux SBC ~$50 | Linux Board $10 | 任意硬件 ~$10 |

> NanoBot 目前已部分支持多实例模式，但配置稍显繁琐。
>
> 以上都是十分优秀的项目，Aurogen 从中获得了大量灵感。它们都在持续更新，此表格可能很快会过时。

更多独有功能将在后续陆续展示。

---

## 🚀 快速开始

### 一键安装包

> 正在准备中，敬请期待！

### Docker

构建镜像：

```bash
docker build -t aurogen .
```

运行 Aurogen 并持久化工作区：

```bash
docker run --rm -p 8000:8000 \
  -v "$(pwd)/aurogen/.workspace:/app/aurogen/.workspace" \
  aurogen
```

然后访问 `http://localhost:8000`。

### Docker Compose

在项目根目录直接运行：

```bash
docker compose up -d --build
```

### 开发部署

**前置依赖：** [conda](https://docs.conda.io/)（或其他 Python 环境管理器）和 [Node.js](https://nodejs.org/)。

在项目根目录运行：

**1. 启动后端：**

```bash
# 创建环境
conda create -n aurogen python=3.12

# 安装依赖
conda activate aurogen && cd ./aurogen && pip install -r requirements.txt

# 启动服务
uvicorn app.app:app --host 0.0.0.0 --port 8000 --reload
```

**2. 启动前端：**

```bash
cd ./aurogen_web && npm i
npm run dev
```

### 开始使用：设置密码和 Provider

1. 部署完成后，打开网页，设置密码（方便部署在云服务器 / VPS 上时保障安全）：

![设置密码](../assets/setup-password.png)

你将会看到主面板：

![主面板](../assets/dashboard.png)

右上角可以更换主题和语言：

![主题与语言](../assets/theme-language.png)

2. 左侧侧边栏聚集了所有功能区，首先点击 **Providers**：

![Providers 面板](../assets/providers.png)

3. 直接编辑默认的 Provider，填入 API Key 和 Base URL，点击保存。

4. 然后在侧边栏点击 **Agent**：

![Agent 配置](../assets/agent-config.png)

5. 确认 Provider 选择的是你刚刚配置好的，然后设置 Model ID。你可以选择是否启用 Thinking。

6. （可选）点击 **Channel** 面板，确认 Web Channel 使用的是你刚刚配置好的 Agent：

![Channel 配置](../assets/channel-config.png)

7. 然后就可以在 Web Channel 开始聊天啦！

![Web Channel 聊天](../assets/webchannel-chat.png)

---

### 文档

> 文档正在加急编写中，敬请期待！
