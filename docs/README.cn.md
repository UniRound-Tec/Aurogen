<div align="center">
  <img src="../assets/banner.png" alt="Aurogen" width="600">
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

- **2026-03-14** — **Aurogen原生支持Agent Group模式啦！可以完成复杂任务，也可以闲聊**
- **2026-03-12** — **文档网站上线，优化 UX 交互体验**
- **2026-03-11** — **发布一键启动整合包，前往 [Releases](https://github.com/UniRound-Tec/Aurogen/releases) 下载使用！**
- **2026-03-10** — **Aurogen 正式发布！赶快来尝尝🍊吧！**

---

## 📖 文档

前往 [docs.aurogen.site](https://docs.aurogen.site) 查看完整文档。

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

前往 [Releases](https://github.com/UniRound-Tec/Aurogen/releases) 下载对应平台的整合包，内置 Python 和 Node.js 运行时，无需安装任何额外软件。

| 平台 | 架构 | 文件 |
|------|------|------|
| macOS | Apple Silicon (M1/M2/M3/M4) | `aurogen-x.x.x-macos-arm64.tar.gz` |
| Linux | ARM64 | `aurogen-x.x.x-linux-arm64.tar.gz` |
| Linux | x86_64 | `aurogen-x.x.x-linux-x64.tar.gz` |
| Windows | x64 | `aurogen-x.x.x-windows-x64.zip` |

**macOS / Linux：**

```bash
tar -xzf aurogen-x.x.x-<平台>.tar.gz
cd aurogen-x.x.x-<平台>
bash start.sh
```

**Windows：** 解压后双击 `start.bat`

在浏览器中打开 `http://localhost:8000`，所有配置均在 Web 界面中完成。


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

前往 [docs.aurogen.site](https://docs.aurogen.site) 查看文档。
