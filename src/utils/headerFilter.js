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
 * 根据模型动态调整 beta flags
 * 基于 2.1.87-src/src/utils/betas.ts getAllModelBetas() + getMergedBetas()
 *
 * relay 所有请求均为 agentic（用户对话转发），因此：
 * - 所有模型（含 Haiku）都包含 claude-code-20250219（对应 isAgenticQuery: true）
 * - claude-3-* 模型排除 ISP 相关 beta（不支持 interleaved thinking）
 * - structured-outputs 仅对支持的模型启用
 */
function getModelBetas(profileBetas, modelId) {
  if (!Array.isArray(profileBetas)) return profileBetas

  const model = (modelId || '').toLowerCase()
  let betas = [...profileBetas]

  // claude-3-*: 排除 ISP 相关 beta（modelSupportsISP / modelSupportsContextManagement）
  if (model.includes('claude-3-')) {
    const ispBetas = [
      'interleaved-thinking-2025-05-14',
      'redact-thinking-2026-02-12',
      'context-management-2025-06-27'
    ]
    betas = betas.filter((b) => !ispBetas.includes(b))
  }

  // structured-outputs: 仅对特定模型启用（modelSupportsStructuredOutputs）
  const supportsStructuredOutputs = [
    'claude-sonnet-4-6',
    'claude-sonnet-4-5',
    'claude-opus-4-1',
    'claude-opus-4-5',
    'claude-opus-4-6',
    'claude-haiku-4-5'
  ].some((m) => model.includes(m))
  if (!supportsStructuredOutputs) {
    betas = betas.filter((b) => b !== 'structured-outputs-2025-12-15')
  }

  return betas
}

/**
 * 为 Claude Code 模拟模式构建完整 headers
 * 完全替换客户端 headers，使用 profile 定义的精确顺序和值
 *
 * @param {string} accountId
 * @param {object} profile - 版本 profile
 * @param {string} sessionId
 * @param {string} token
 * @param {object} [options]
 * @param {string} [options.model] - 模型ID，用于动态调整 betas
 */
function buildSimulatedHeaders(accountId, profile, sessionId, token, options = {}) {
  const { randomUUID } = require('crypto')

  const stainless = profile.stainless || {}
  const order = profile.header_order || []

  // 根据模型动态调整 betas
  const betas = getModelBetas(profile.beta_flags, options.model)

  // 预定义所有 header 值
  const headerValues = {
    'x-app': 'cli',
    'User-Agent': profile.user_agent,
    'X-Claude-Code-Session-Id': sessionId,
    'x-client-request-id': randomUUID(),
    'anthropic-version': profile.api_version,
    'anthropic-beta': Array.isArray(betas) ? betas.join(',') : betas,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'x-stainless-lang': stainless.lang || 'js',
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

/**
 * 构建 anthropic-beta header 值
 * 从 profile 加载基准 beta 列表，按模型过滤，合并客户端自定义 beta（去重）
 *
 * @param {string} modelId - 模型 ID
 * @param {string} [clientBetaHeader] - 客户端传来的 beta header（逗号分隔，可选）
 * @returns {Promise<string>} 最终的 beta header 值
 */
async function buildBetaHeader(modelId, clientBetaHeader) {
  const profileService = require('../services/simulation/profileService')
  const profile = await profileService.getActiveProfile()
  const profileBetas = getModelBetas(profile?.beta_flags || [], modelId)

  if (!clientBetaHeader) return profileBetas.join(',')

  const seen = new Set(profileBetas)
  const clientBetas = clientBetaHeader
    .split(',')
    .map((b) => b.trim())
    .filter(Boolean)
  return [...profileBetas, ...clientBetas.filter((b) => !seen.has(b))].join(',')
}

module.exports = {
  cdnHeaders,
  filterForOpenAI,
  filterForClaude,
  filterForGemini,
  buildSimulatedHeaders,
  getModelBetas,
  buildBetaHeader
}
