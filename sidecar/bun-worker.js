/**
 * Bun Sidecar Worker — TLS 代理服务
 *
 * 通过 Unix Domain Socket 接收 Node.js relay 的请求，
 * 使用 Bun 原生 fetch（BoringSSL）转发到上游 API，
 * 确保 TLS 指纹与真实 Claude Code CLI 一致。
 *
 * Endpoints:
 *   POST /          — 代理上游请求（支持 SSE 流式）
 *   POST /telemetry — 代理遥测上报
 *   GET  /health    — 健康检查
 */

const startTime = Date.now()
let connectionsActive = 0

const socketPath = process.env.SIDECAR_SOCKET_PATH || `/tmp/bun-relay-${process.env.PORT || 3000}.sock`

// 清理残留 socket 文件
try {
  const { unlinkSync } = require('fs')
  unlinkSync(socketPath)
} catch (_e) {
  // socket 文件不存在，正常情况
}

const server = Bun.serve({
  unix: socketPath,

  async fetch(req) {
    const url = new URL(req.url)

    if (req.method === 'GET' && url.pathname === '/health') {
      return handleHealth()
    }

    if (req.method === 'POST' && url.pathname === '/telemetry') {
      return handleTelemetry(req)
    }

    if (req.method === 'POST' && url.pathname === '/') {
      return handleProxy(req)
    }

    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})

console.log(`[bun-sidecar] Listening on ${socketPath} (PID: ${process.pid})`)

// --- Health Check ---
function handleHealth() {
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000)
  return Response.json({
    status: 'healthy',
    pid: process.pid,
    uptime_seconds: uptimeSeconds,
    connections_active: connectionsActive,
    tls_library: 'BoringSSL'
  })
}

// --- Telemetry Proxy ---
async function handleTelemetry(req) {
  let payload
  try {
    payload = await req.json()
  } catch (_e) {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const { url: targetUrl, headers: targetHeaders, body: targetBody, proxy: proxyUrl } = payload

  if (!targetUrl) {
    return Response.json({ error: 'missing_url' }, { status: 400 })
  }

  try {
    const telemetryFetchOptions = {
      method: 'POST',
      headers: targetHeaders || {},
      body: typeof targetBody === 'string' ? targetBody : JSON.stringify(targetBody)
    }
    if (proxyUrl) {
      telemetryFetchOptions.proxy = proxyUrl
    }
    const upstreamRes = await fetch(targetUrl, telemetryFetchOptions)

    return Response.json({
      status: 'ok',
      upstream_status: upstreamRes.status
    })
  } catch (err) {
    return Response.json(
      {
        error: 'telemetry_failed',
        message: err.message
      },
      { status: 502 }
    )
  }
}

// --- Main Proxy ---
async function handleProxy(req) {
  let payload
  try {
    payload = await req.json()
  } catch (_e) {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const {
    method = 'POST',
    url: targetUrl,
    headers: targetHeaders = {},
    body: targetBody,
    timeout = 600000,
    stream = false,
    proxy: proxyUrl = null
  } = payload

  if (!targetUrl) {
    return Response.json({ error: 'missing_url' }, { status: 400 })
  }

  connectionsActive++

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    const fetchOptions = {
      method,
      headers: targetHeaders,
      body: typeof targetBody === 'string' ? targetBody : JSON.stringify(targetBody),
      signal: controller.signal
    }

    // Bun 原生支持 proxy 参数（socks5/http/https）
    if (proxyUrl) {
      fetchOptions.proxy = proxyUrl
    }

    const upstreamRes = await fetch(targetUrl, fetchOptions)

    clearTimeout(timeoutId)

    // 收集上游 response headers
    const upstreamHeaders = {}
    upstreamRes.headers.forEach((value, key) => {
      upstreamHeaders[key] = value
    })
    const encodedHeaders = Buffer.from(JSON.stringify(upstreamHeaders)).toString('base64')

    const contentType = upstreamRes.headers.get('content-type') || ''
    const isSSE = stream && contentType.includes('text/event-stream')

    if (isSSE && upstreamRes.body) {
      // SSE 流式响应 — 直接 pipe ReadableStream
      return new Response(upstreamRes.body, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Upstream-Status': String(upstreamRes.status),
          'X-Upstream-Headers': encodedHeaders
        }
      })
    }

    // 非流式响应
    const responseBody = await upstreamRes.text()

    return new Response(responseBody, {
      status: 200,
      headers: {
        'Content-Type': contentType || 'application/json',
        'X-Upstream-Status': String(upstreamRes.status),
        'X-Upstream-Headers': encodedHeaders
      }
    })
  } catch (err) {
    if (err.name === 'AbortError') {
      return Response.json(
        {
          error: 'upstream_timeout',
          message: `Request timed out after ${timeout}ms`,
          upstream_url: targetUrl
        },
        { status: 504 }
      )
    }

    return Response.json(
      {
        error: 'upstream_connection_failed',
        message: err.message,
        upstream_url: targetUrl
      },
      { status: 502 }
    )
  } finally {
    connectionsActive--
  }
}

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('[bun-sidecar] Received SIGTERM, shutting down...')
  server.stop()
  process.exit(0)
})

process.on('SIGINT', () => {
  console.log('[bun-sidecar] Received SIGINT, shutting down...')
  server.stop()
  process.exit(0)
})
