#!/usr/bin/env bash
set -euo pipefail

# ============================================================
#  Aurogen Linux 整合包构建脚本
#  用法：bash build/build-linux.sh [arm64|x64]   (默认 arm64)
#  需要：Docker（宿主机）
#  产物：dist/aurogen-VERSION-linux-ARCH.tar.gz
# ============================================================

PYTHON_VERSION="3.11.15"
PYTHON_TAG="20260303"
NODE_VERSION="22.14.0"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[build]${NC} $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC}  $*"; }
error() { echo -e "${RED}[error]${NC} $*"; exit 1; }

TARGET_ARCH="${1:-arm64}"

# ============================================================
#  宿主机模式：检测 Docker，启动容器后退出
# ============================================================
if [[ ! -f "/.dockerenv" ]]; then
    ROOT=$(cd "$(dirname "$0")/.." && pwd)

    if [[ "$TARGET_ARCH" == "arm64" ]]; then
        DOCKER_PLATFORM="linux/arm64"
    elif [[ "$TARGET_ARCH" == "x64" ]]; then
        DOCKER_PLATFORM="linux/amd64"
    else
        error "不支持的架构: $TARGET_ARCH，可选 arm64 或 x64"
    fi

    command -v docker &>/dev/null || error "未找到 docker 命令，请先安装 Docker"

    info "目标架构: Linux $TARGET_ARCH  (Docker 平台: $DOCKER_PLATFORM)"
    info "工作目录: $ROOT"

    docker run --rm \
        --platform "$DOCKER_PLATFORM" \
        -v "$ROOT:/workspace" \
        -e TARGET_ARCH="$TARGET_ARCH" \
        ubuntu:22.04 \
        bash /workspace/build/build-linux.sh "$TARGET_ARCH"

    echo ""
    info "====================================================="
    info "  产物路径: $ROOT/dist/"
    ls "$ROOT/dist/"*.tar.gz 2>/dev/null | while read f; do info "  $(basename "$f")"; done
    info "====================================================="
    exit 0
fi

# ============================================================
#  Docker 内部模式：执行实际构建
# ============================================================
WORKSPACE="/workspace"
DOWNLOADS="$WORKSPACE/build/downloads"
DIST_BASE="$WORKSPACE/dist"

# 读取版本号（sed 兼容 GNU/BSD）
APP_VERSION=$(grep '"version"' "$WORKSPACE/aurogen_web/package.json" \
    | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

PACKAGE_NAME="aurogen-${APP_VERSION}-linux-${TARGET_ARCH}"
PACKAGE_DIR="$DIST_BASE/$PACKAGE_NAME"
RUNTIME_DIR="$PACKAGE_DIR/runtime"
PYTHON_DIR="$RUNTIME_DIR/python"
NODE_DIR="$RUNTIME_DIR/node"

info "构建包: $PACKAGE_NAME"
info "容器架构: $(uname -m)"

# 安装系统工具
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl tar > /dev/null

mkdir -p "$DOWNLOADS" "$PYTHON_DIR" "$NODE_DIR" "$PACKAGE_DIR"

# 下载函数（利用宿主机挂载的缓存目录）
download() {
    local url="$1" dest="$2"
    if [[ -f "$dest" ]]; then
        info "已缓存，跳过下载: $(basename "$dest")"
    else
        info "下载: $(basename "$dest")"
        curl -L --progress-bar "$url" -o "$dest" || error "下载失败: $url"
    fi
}

# 根据实际容器架构选包名
CONTAINER_ARCH=$(uname -m)
if [[ "$CONTAINER_ARCH" == "aarch64" ]]; then
    PY_ARCH="aarch64-unknown-linux-gnu"
    NODE_ARCH="linux-arm64"
else
    PY_ARCH="x86_64-unknown-linux-gnu"
    NODE_ARCH="linux-x64"
fi

PY_FILENAME="cpython-${PYTHON_VERSION}+${PYTHON_TAG}-${PY_ARCH}-install_only.tar.gz"
PY_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_TAG}/${PY_FILENAME}"

NODE_FILENAME="node-v${NODE_VERSION}-${NODE_ARCH}.tar.gz"
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_FILENAME}"

# ── Step 1: Python ──────────────────────────────────────────
info "========== [1/7] 准备 Python 运行时 =========="
download "$PY_URL" "$DOWNLOADS/$PY_FILENAME"

info "解压 Python..."
tar -xzf "$DOWNLOADS/$PY_FILENAME" -C "$RUNTIME_DIR"
[[ -f "$PYTHON_DIR/bin/python3" ]] || error "Python 解压异常，未找到 bin/python3"
info "Python 就绪: $($PYTHON_DIR/bin/python3 --version)"

# ── Step 2: pip install ─────────────────────────────────────
info "========== [2/7] 安装 Python 依赖 =========="
"$PYTHON_DIR/bin/pip3" install --upgrade pip -q
"$PYTHON_DIR/bin/pip3" install -r "$WORKSPACE/aurogen/requirements.txt" -q
info "Python 依赖安装完成"

# ── Step 3: Node.js ─────────────────────────────────────────
info "========== [3/7] 准备 Node.js 运行时 =========="
download "$NODE_URL" "$DOWNLOADS/$NODE_FILENAME"

info "解压 Node.js..."
TMP_NODE="$DOWNLOADS/.node_tmp_linux"
rm -rf "$TMP_NODE" && mkdir -p "$TMP_NODE"
tar -xzf "$DOWNLOADS/$NODE_FILENAME" -C "$TMP_NODE"
rm -rf "$NODE_DIR"
mv "$TMP_NODE"/node-v* "$NODE_DIR"
rm -rf "$TMP_NODE"
[[ -f "$NODE_DIR/bin/node" ]] || error "Node.js 解压异常，未找到 bin/node"
info "Node.js 就绪: $($NODE_DIR/bin/node --version)"

# ── Step 4: 构建 WhatsApp Bridge ───────────────────────────
info "========== [4/7] 构建 WhatsApp Bridge =========="
export PATH="$NODE_DIR/bin:$PATH"
cd "$WORKSPACE/aurogen/channels/bridge"
npm install -q
npm run build
info "WhatsApp Bridge 构建完成"

# ── Step 5: 构建前端 ────────────────────────────────────────
info "========== [5/7] 构建前端 (aurogen_web) =========="
cd "$WORKSPACE/aurogen_web"
npm install -q
npm run build
info "前端构建完成"

# ── Step 6: 组装发行包 ──────────────────────────────────────
info "========== [6/7] 组装发行包 =========="

# 复制后端代码（排除敏感配置与本地工作区数据）
cp -r "$WORKSPACE/aurogen" "$PACKAGE_DIR/aurogen"
rm -f "$PACKAGE_DIR/aurogen/.workspace/config.json"
rm -rf "$PACKAGE_DIR/aurogen/.workspace/agents/main"
rm -f "$PACKAGE_DIR/aurogen/.workspace/cron/jobs.json"

# 复制前端构建产物（app.py 引用路径为 ../../../aurogen_web/dist）
mkdir -p "$PACKAGE_DIR/aurogen_web"
cp -r "$WORKSPACE/aurogen_web/dist" "$PACKAGE_DIR/aurogen_web/dist"

# 清理 bridge 开发文件
rm -rf "$PACKAGE_DIR/aurogen/channels/bridge/src"
rm -f "$PACKAGE_DIR/aurogen/channels/bridge/tsconfig.json"

# 清理缓存和日志
find "$PACKAGE_DIR/aurogen" -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
find "$PACKAGE_DIR/aurogen" -name "*.pyc" -delete 2>/dev/null || true
find "$PACKAGE_DIR/aurogen" -name "*.log" -delete 2>/dev/null || true

# 生成 Linux start.sh
cat > "$PACKAGE_DIR/start.sh" << 'STARTSH'
#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")" && pwd)
RUNTIME="$ROOT/runtime"
PYTHON="$RUNTIME/python/bin/python3"
NODE_BIN="$RUNTIME/node/bin"

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[aurogen]${NC} $*"; }
error() { echo -e "${RED}[error]${NC}   $*"; exit 1; }

[[ -f "$PYTHON" ]]   || error "运行时不完整，请重新下载整合包"
[[ -d "$NODE_BIN" ]] || error "Node.js 运行时不完整，请重新下载整合包"

export PATH="$RUNTIME/python/bin:$NODE_BIN:$PATH"

info "启动 Aurogen..."
info "Python: $($PYTHON --version)"
info "Node:   $(node --version)"

# 服务就绪后打开浏览器（最多等 30 秒）
(
    MAX=60; i=0
    while [[ $i -lt $MAX ]]; do
        if curl -s -o /dev/null -w "%{http_code}" http://localhost:8000 2>/dev/null | grep -qE "^[0-9]"; then
            if command -v xdg-open &>/dev/null; then
                xdg-open "http://localhost:8000"
            else
                info "请在浏览器中访问: http://localhost:8000"
            fi
            break
        fi
        sleep 0.5; i=$((i + 1))
    done
) &

cd "$ROOT/aurogen"
exec "$PYTHON" -m uvicorn app.app:app --host 0.0.0.0 --port 8000
STARTSH

chmod +x "$PACKAGE_DIR/start.sh"

# 打包成 tar.gz
info "打包中..."
cd "$DIST_BASE"
tar -czf "${PACKAGE_NAME}.tar.gz" "$PACKAGE_NAME"
rm -rf "$PACKAGE_DIR"

echo ""
info "====================================================="
info "  产物: dist/${PACKAGE_NAME}.tar.gz"
info "====================================================="
