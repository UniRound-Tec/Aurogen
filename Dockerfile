# ────────────────────────────────────────────
# Stage 1: 构建前端 + WhatsApp Bridge
# ────────────────────────────────────────────
FROM nikolaik/python-nodejs:python3.12-nodejs22-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

# 构建前端
WORKDIR /build/aurogen_web

COPY aurogen_web/package.json aurogen_web/package-lock.json ./
RUN npm ci

COPY aurogen_web/ ./

# 设置空字符串，使前端 API 调用使用相对路径，适配任意访问地址
RUN VITE_API_BASE_URL="" npm run build

# 构建 WhatsApp Bridge
WORKDIR /build/bridge

COPY aurogen/channels/bridge/package.json aurogen/channels/bridge/package-lock.json* ./
RUN npm ci 2>/dev/null || npm install

COPY aurogen/channels/bridge/ ./
RUN npm run build

# ────────────────────────────────────────────
# Stage 2: 运行时
# ────────────────────────────────────────────
FROM nikolaik/python-nodejs:python3.12-nodejs22-slim

WORKDIR /app

COPY aurogen/requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

COPY aurogen/ ./aurogen/

# 从 Stage 1 复制前端构建产物
COPY --from=builder /build/aurogen_web/dist ./aurogen_web/dist

# 从 Stage 1 复制 Bridge 构建产物和运行时依赖
COPY --from=builder /build/bridge/dist ./aurogen/channels/bridge/dist
COPY --from=builder /build/bridge/node_modules ./aurogen/channels/bridge/node_modules
COPY --from=builder /build/bridge/package.json ./aurogen/channels/bridge/package.json

# 预创建 .workspace 目录，实际数据通过卷挂载
RUN mkdir -p /app/aurogen/.workspace

EXPOSE 8000

WORKDIR /app/aurogen

CMD ["uvicorn", "app.app:app", "--host", "0.0.0.0", "--port", "8000"]
