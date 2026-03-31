/**
 * 统一的 CDN Headers 过滤列表
 *
 * 用于各服务在原有过滤逻辑基础上，额外移除 Cloudflare CDN 和代理相关的 headers
 * 避免触发上游 API（如 88code）的安全检查
 */

// Cloudflare CDN headers（橙色云代理模式会添加这些）
const cdnHeaders = [
  'x-real-ip',
  'x-forwarded-for',
  'x-forwarded-proto',
  'x-forwarded-host',
  'x-forwarded-port',
  'x-accel-buffering',
  'cf-ray',
  'cf-connecting-ip',
  'cf-ipcountry',
  'cf-visitor',
  'cf-request-id',
  'cdn-loop',
  'true-client-ip'
]

/**
 * 为 OpenAI/Responses API 过滤 headers
 * 在原有 skipHeaders 基础上添加 CDN headers
 */
function filterForOpenAI(headers) {
  const skipHeaders = [
    'host',
    'content-length',
    'authorization',
    'x-api-key',
    'x-cr-api-key',
    'connection',
    'upgrade',
    'sec-websocket-key',
    'sec-websocket-version',
    'sec-websocket-extensions',
    ...cdnHeaders // 添加 CDN headers
  ]

  const filtered = {}
  for (const [key, value] of Object.entries(headers)) {
    if (!skipHeaders.includes(key.toLowerCase())) {
      filtered[key] = value
    }
  }
  return filtered
}

/**
 * 为 Claude/Anthropic API 过滤 headers
 * 使用白名单模式，只允许指定的 headers 通过
 */
function filterForClaude(headers) {
  // 白名单模式：只允许以下 headers
  const allowedHeaders = [
    'accept',
    'x-stainless-retry-count',
    'x-stainless-timeout',
    'x-stainless-lang',
    'x-stainless-package-version',
    'x-stainless-os',
    'x-stainless-arch',
    'x-stainless-runtime',
    'x-stainless-runtime-version',
    'x-stainless-helper-method',
    'anthropic-dangerous-direct-browser-access',
    'anthropic-version',
    'x-app',
    'anthropic-beta',
    'accept-language',
    'sec-fetch-mode',
    // 注意：不透传 accept-encoding，避免客户端发送的 zstd 等 Node.js 不支持的编码
    // 被转发到上游，导致 axios 无法解压响应（Node 18 zlib 不支持 zstd）
    'user-agent',
    'content-type',
    'connection'
  ]

  const filtered = {}
  Object.keys(headers || {}).forEach((key) => {
    const lowerKey = key.toLowerCase()
    if (allowedHeaders.includes(lowerKey)) {
      filtered[key] = headers[key]
    }
  })

  return filtered
}

/**
 * 为 Gemini API 过滤 headers（如果需要转发客户端 headers 时使用）
 * 目前 Gemini 服务不转发客户端 headers，仅提供此方法备用
 */
function filterForGemini(headers) {
  const skipHeaders = [
    'host',
    'content-length',
    'authorization',
    'x-api-key',
    'connection',
    ...cdnHeaders // 添加 CDN headers
  ]

  const filtered = {}
  for (const [key, value] of Object.entries(headers)) {
    if (!skipHeaders.includes(key.toLowerCase())) {
      filtered[key] = value
    }
  }
  return filtered
}

/**
 * 为 Claude Code 模拟模式构建完整 headers
 * 完全替换客户端 headers，使用 profile 定义的精确顺序和值
 */
function buildSimulatedHeaders(accountId, profile, sessionId, token) {
  const { randomUUID } = require('crypto')

  const stainless = profile.stainless || {}
  const order = profile.header_order || []

  // 预定义所有 header 值
  const headerValues = {
    'x-app': 'cli',
    'User-Agent': profile.user_agent,
    'X-Claude-Code-Session-Id': sessionId,
    'x-client-request-id': randomUUID(),
    'anthropic-version': profile.api_version,
    'anthropic-beta': Array.isArray(profile.beta_flags)
      ? profile.beta_flags.join(',')
      : profile.beta_flags,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'x-stainless-lang': stainless.lang || 'javascript',
    'x-stainless-package-version': stainless.package_version || '0.39.0',
    'x-stainless-os': stainless.os || 'Mac OS X',
    'x-stainless-arch': stainless.arch || 'arm64',
    'x-stainless-runtime': stainless.runtime || 'bun',
    'x-stainless-runtime-version': stainless.runtime_version || '1.2.5'
  }

  // 按 header_order 顺序构建（顺序很重要）
  const headers = {}
  for (const key of order) {
    if (headerValues[key] !== undefined) {
      headers[key] = headerValues[key]
    }
  }

  return headers
}

module.exports = {
  cdnHeaders,
  filterForOpenAI,
  filterForClaude,
  filterForGemini,
  buildSimulatedHeaders
}
