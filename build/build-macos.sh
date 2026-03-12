#!/usr/bin/env bash
set -euo pipefail

# ============================================================
#  Aurogen macOS 整合包构建脚本
#  用法：在项目根目录执行  bash build/build-macos.sh
#  产物：dist/aurogen-VERSION-macos-ARCH.tar.gz
# ============================================================

ROOT=$(cd "$(dirname "$0")/.." && pwd)
RUNTIME="$ROOT/runtime"
DOWNLOADS="$ROOT/build/downloads"
PYTHON_DIR="$RUNTIME/python"
NODE_DIR="$RUNTIME/node"

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

# ── 检测架构 ────────────────────────────────────────────────
ARCH=$(uname -m)
if [[ "$ARCH" == "arm64" ]]; then
    PY_ARCH="aarch64-apple-darwin"
    NODE_ARCH="darwin-arm64"
elif [[ "$ARCH" == "x86_64" ]]; then
    PY_ARCH="x86_64-apple-darwin"
    NODE_ARCH="darwin-x64"
else
    error "不支持的架构: $ARCH"
fi
info "检测到架构: $ARCH"

PY_FILENAME="cpython-${PYTHON_VERSION}+${PYTHON_TAG}-${PY_ARCH}-install_only.tar.gz"
PY_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_TAG}/${PY_FILENAME}"

NODE_FILENAME="node-v${NODE_VERSION}-${NODE_ARCH}.tar.gz"
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_FILENAME}"

mkdir -p "$RUNTIME" "$DOWNLOADS"

# ── 下载函数（本地缓存，已存在则跳过）──────────────────────
download() {
    local url="$1"
    local dest="$2"
    if [[ -f "$dest" ]]; then
        info "已缓存，跳过下载: $(basename "$dest")"
    else
        info "下载: $(basename "$dest")"
        curl -L --progress-bar "$url" -o "$dest" || error "下载失败: $url"
    fi
}

# ── Step 1: Python ──────────────────────────────────────────
info "========== [1/7] 准备 Python 运行时 =========="
download "$PY_URL" "$DOWNLOADS/$PY_FILENAME"

if [[ -d "$PYTHON_DIR" ]]; then
    warn "已存在 runtime/python/，清除重建..."
    rm -rf "$PYTHON_DIR"
fi

info "解压 Python..."
# install_only 包解压后目录名即为 python/
tar -xzf "$DOWNLOADS/$PY_FILENAME" -C "$RUNTIME"

[[ -f "$PYTHON_DIR/bin/python3" ]] || error "Python 解压异常，未找到 $PYTHON_DIR/bin/python3"
info "Python 就绪: $($PYTHON_DIR/bin/python3 --version)"

# ── Step 2: pip install ─────────────────────────────────────
info "========== [2/7] 安装 Python 依赖 =========="
"$PYTHON_DIR/bin/pip3" install --upgrade pip -q
"$PYTHON_DIR/bin/pip3" install -r "$ROOT/aurogen/requirements.txt" -q
info "Python 依赖安装完成"

# ── Step 3: Node.js ─────────────────────────────────────────
info "========== [3/7] 准备 Node.js 运行时 =========="
download "$NODE_URL" "$DOWNLOADS/$NODE_FILENAME"

if [[ -d "$NODE_DIR" ]]; then
    warn "已存在 runtime/node/，清除重建..."
    rm -rf "$NODE_DIR"
fi

info "解压 Node.js..."
TMP_NODE="$DOWNLOADS/.node_tmp"
rm -rf "$TMP_NODE"
mkdir -p "$TMP_NODE"
tar -xzf "$DOWNLOADS/$NODE_FILENAME" -C "$TMP_NODE"
# tar 解压后有一层子目录 node-vX.X.X-darwin-arm64/，移到目标位置
mv "$TMP_NODE"/node-v* "$NODE_DIR"
rm -rf "$TMP_NODE"

[[ -f "$NODE_DIR/bin/node" ]] || error "Node.js 解压异常，未找到 $NODE_DIR/bin/node"
info "Node.js 就绪: $($NODE_DIR/bin/node --version)"

# ── Step 4: 构建 WhatsApp Bridge ───────────────────────────
info "========== [4/7] 构建 WhatsApp Bridge =========="
export PATH="$NODE_DIR/bin:$PATH"

cd "$ROOT/aurogen/channels/bridge"
info "npm install (bridge)..."
npm install
info "npm run build (bridge)..."
npm run build
info "WhatsApp Bridge 构建完成"

# ── Step 5: 构建前端 ────────────────────────────────────────
info "========== [5/7] 构建前端 (aurogen_web) =========="

cd "$ROOT/aurogen_web"
info "npm install..."
npm install
info "npm run build..."
npm run build
info "前端构建完成"

# ── Step 6: 组装发行包 ──────────────────────────────────────
info "========== [6/7] 组装发行包 =========="

APP_VERSION=$(grep '"version"' "$ROOT/aurogen_web/package.json" \
    | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

if [[ "$ARCH" == "arm64" ]]; then
    PKG_ARCH="arm64"
else
    PKG_ARCH="x64"
fi
PACKAGE_NAME="aurogen-${APP_VERSION}-macos-${PKG_ARCH}"
DIST_DIR="$ROOT/dist"
PACKAGE_DIR="$DIST_DIR/$PACKAGE_NAME"

rm -rf "$PACKAGE_DIR"
mkdir -p "$PACKAGE_DIR"

# 复制运行时
cp -r "$RUNTIME" "$PACKAGE_DIR/runtime"

# 复制后端代码（排除敏感配置与本地工作区数据）
cp -r "$ROOT/aurogen" "$PACKAGE_DIR/aurogen"
rm -f "$PACKAGE_DIR/aurogen/.workspace/config.json"
rm -rf "$PACKAGE_DIR/aurogen/.workspace/agents/main"
rm -f "$PACKAGE_DIR/aurogen/.workspace/cron/jobs.json"

# 复制前端构建产物
mkdir -p "$PACKAGE_DIR/aurogen_web"
cp -r "$ROOT/aurogen_web/dist" "$PACKAGE_DIR/aurogen_web/dist"

# 清理 bridge 开发文件
rm -rf "$PACKAGE_DIR/aurogen/channels/bridge/src"
rm -f "$PACKAGE_DIR/aurogen/channels/bridge/tsconfig.json"

# 清理缓存和日志
find "$PACKAGE_DIR/aurogen" -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
find "$PACKAGE_DIR/aurogen" -name "*.pyc" -delete 2>/dev/null || true
find "$PACKAGE_DIR/aurogen" -name "*.log" -delete 2>/dev/null || true

# 生成 start.sh
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

(
    MAX=60; i=0
    while [[ $i -lt $MAX ]]; do
        if curl -s -o /dev/null -w "%{http_code}" http://localhost:8000 2>/dev/null | grep -qE "^[0-9]"; then
            open "http://localhost:8000"
            break
        fi
        sleep 0.5; i=$((i + 1))
    done
) &

cd "$ROOT/aurogen"
exec "$PYTHON" -m uvicorn app.app:app --host 0.0.0.0 --port 8000
STARTSH

chmod +x "$PACKAGE_DIR/start.sh"

# 打包
info "打包中..."
cd "$DIST_DIR"
tar -czf "${PACKAGE_NAME}.tar.gz" "$PACKAGE_NAME"
rm -rf "$PACKAGE_DIR"

echo ""
echo -e "${GREEN}=====================================================${NC}"
echo -e "${GREEN}  构建完成！${NC}"
echo -e "${GREEN}  产物: dist/${PACKAGE_NAME}.tar.gz${NC}"
echo -e "${GREEN}=====================================================${NC}"
