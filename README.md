<div align="center">
  <img src="./assets/banner.png" alt="Aurogen" width="600">
  <h2>Aurogen: More OpenClaws</h1>
</div>

<div align="right">
  <strong>English</strong> | <a href="docs/README.cn.md">简体中文</a>
</div>

> **A note from the developer:** The open-source community already has many OpenClaw alternatives — some rewritten in faster languages, others easier to deploy — but most come with trade-offs: reduced features or a steeper barrier for secondary development. As heavy AI users who have tried most of the alternatives, we identified real pain points and built Aurogen as a complete reimplementation of the OpenClaw paradigm with the following characteristics.

## ✨ Features

**🗂️ Fully Modular** — Aurogen completely modularizes, instantiates, and parallelizes every OpenClaw concept — **Agents, Channels, Providers, Skills, and more** — so you can compose and orchestrate them however you like. In Aurogen, a single deployment can run **many lobsters at once**, which is exactly what *More OpenClaws* means.

**💡 Easy Configuration** — Aurogen ditches CLI interaction and config files entirely. After installation, just open the web panel → set a password → configure your first Provider, and you're ready to go in the Web Channel. All modules are loaded dynamically, so every setting takes effect immediately — **no restart required**.

**🦀 Ecosystem Compatible** — Aurogen is fully compatible with the OpenClaw ecosystem. You can download any skill from [clawhub.ai](https://clawhub.ai/) and import it directly into Aurogen. The built-in public skills also include native ClaWHub integration.

> **Etymology:** *Aurogen* = *Aurora* (dawn / aurora borealis, the Roman goddess of dawn) + *generation*. The pronunciation kind of sounds like an orange 🍊 — so come grow an orange tree full of 🍊!

---

## 📢 News

- **2026-03-12** — **Documentation site is live, with UX improvements!**
- **2026-03-11** — **We released one-click installer packages — download from [Releases](https://github.com/UniRound-Tec/Aurogen/releases)!**
- **2026-03-10** — **Aurogen is live! Come taste an 🍊!**

---

## 📖 Documentation

Visit [docs.aurogen.site](https://docs.aurogen.site) for the full documentation.

---

## 🏗️ Architecture

![Architecture Diagram](./assets/arc.png)

> *Diagram is a rough draft — a cleaner version is coming soon.*

---

## 🦀 Feature Comparison

| Feature | Aurogen | OpenClaw | NanoBot | PicoClaw | ZeroClaw |
|---|:---:|:---:|:---:|:---:|:---:|
| Memory | ✅ | ✅ | ✅ | ✅ | ✅ |
| Tools / Skills | ✅ | ✅ | ✅ | ✅ | ✅ |
| Sub-agents | ✅ | ✅ | ✅ | ✅ | ✅ |
| Web panel | ✅ | ✅ | ✖️ | ✖️ | ✖️ |
| Multi-agent (with subagents) | ✅ | ✖️ | ✖️ | ✖️ | ✖️ |
| Multi-instance per channel | ✅ | ✖️ | ✖️ | ✖️ | ✖️ |
| BOOTSTRAP mechanism | ✅ | ✅ | ✖️ | ✖️ | ✖️ |
| **Minimum hardware cost** | Linux SBC ~$50 | Mac Mini $599 | Linux SBC ~$50 | Linux Board $10 | Any hardware ~$10 |

> NanoBot has partial multi-instance support, but configuration is a bit involved.
>
> These are all excellent projects that inspired Aurogen greatly. They are actively maintained, so this table may become outdated quickly.

More unique features will be documented as the project evolves.

---

## 🚀 Quick Start

### One-click Installer

Download the package for your platform from [Releases](https://github.com/UniRound-Tec/Aurogen/releases). Each package includes Python and Node.js runtimes — no additional software installation required.

| Platform | Architecture | File |
|----------|-------------|------|
| macOS | Apple Silicon (M1/M2/M3/M4) | `aurogen-x.x.x-macos-arm64.tar.gz` |
| Linux | ARM64 | `aurogen-x.x.x-linux-arm64.tar.gz` |
| Linux | x86_64 | `aurogen-x.x.x-linux-x64.tar.gz` |
| Windows | x64 | `aurogen-x.x.x-windows-x64.zip` |

**macOS / Linux:**

```bash
tar -xzf aurogen-x.x.x-<platform>.tar.gz
cd aurogen-x.x.x-<platform>
bash start.sh
```

**Windows:** Extract the zip, then double-click `start.bat`.

Open `http://localhost:8000` in your browser. All configuration is done through the web interface.

### Docker

Build the image:

```bash
docker build -t aurogen .
```

Run Aurogen with a persistent workspace:

```bash
docker run --rm -p 8000:8000 \
  -v "$(pwd)/aurogen/.workspace:/app/aurogen/.workspace" \
  aurogen
```

Then visit `http://localhost:8000`.

### Docker Compose

From the project root directory:

```bash
docker compose up -d --build
```

### Development Setup

**Prerequisites:** [conda](https://docs.conda.io/) (or another Python environment manager) and [Node.js](https://nodejs.org/).

From the project root directory:

**1. Start the backend:**

```bash
# Create the environment
conda create -n aurogen python=3.12

# Install dependencies
conda activate aurogen && cd ./aurogen && pip install -r requirements.txt

# Start the server
uvicorn app.app:app --host 0.0.0.0 --port 8000 --reload
```

**2. Start the frontend:**

```bash
cd ./aurogen_web && npm i
npm run dev
```

### Getting Started: Set Password and Provider

1. After deployment, open the web panel and set your password (especially useful when deploying on a cloud server / VPS):

![Set Password](./assets/setup-password.png)

You will see the main dashboard:

![Dashboard](./assets/dashboard.png)

Use the top-right corner to switch themes and languages:

![Theme & Language](./assets/theme-language.png)

2. The left sidebar contains all feature panels. First, click **Providers**:

![Providers Panel](./assets/providers.png)

3. Edit the default Provider — fill in your API Key and Base URL, then click Save.

4. Next, click **Agent** in the sidebar:

![Agent Configuration](./assets/agent-config.png)

5. Make sure the Provider is set to the one you just configured, then set the Model ID. You can choose whether to enable Thinking.

6. (Optional) Click the **Channel** panel to confirm the Web Channel is using the Agent you just configured:

![Channel Configuration](./assets/channel-config.png)

7. You're all set — start chatting in the Web Channel!

![Web Channel Chat](./assets/webchannel-chat.png)

---

### Documentation

Visit [docs.aurogen.site](https://docs.aurogen.site) for the full documentation.
