/**
 * Telemetry Simulator — 模拟 Claude Code 2.1.87 遥测事件
 *
 * 构造并发送 ClaudeCodeInternalEvent 格式的遥测事件，
 * 通过 sidecar /telemetry 端点异步发送到 Anthropic 遥测后端。
 *
 * 事件类型：
 * - tengu_api_query: API 查询发起
 * - tengu_api_success: API 查询成功
 * - tengu_api_error: API 查询失败
 * - tengu_init: 会话初始化
 * - tengu_exit: 会话退出
 */

const { randomUUID } = require('crypto')
const logger = require('../../utils/logger')

let sidecarClient = null
let deviceIdentityService = null
let profileService = null

function getSidecarClient() {
  if (!sidecarClient) {
    sidecarClient = require('../sidecar/sidecarClient')
  }
  return sidecarClient
}

function getDeviceIdentityService() {
  if (!deviceIdentityService) {
    deviceIdentityService = require('../../utils/deviceIdentityService')
  }
  return deviceIdentityService
}

function getProfileService() {
  if (!profileService) {
    profileService = require('./profileService')
  }
  return profileService
}

/**
 * 构建基础环境元数据（模拟 2.1.87 的 EnvironmentMetadata）
 */
function buildEnvironmentMetadata(version) {
  return {
    platform: 'darwin',
    platform_raw: 'darwin',
    arch: 'arm64',
    node_version: '22.13.1',
    terminal: 'xterm-256color',
    package_managers: 'npm,bun',
    runtimes: 'node,bun',
    is_running_with_bun: true,
    is_ci: false,
    is_claubbit: false,
    is_github_action: false,
    is_claude_code_action: false,
    is_claude_ai_auth: true,
    version: version,
    is_claude_code_remote: false,
    is_local_agent_mode: false,
    is_conductor: false,
    deployment_environment: 'production',
    build_time: '',
    vcs: 'git'
  }
}

/**
 * 构建单个遥测事件
 */
async function buildEvent(accountId, eventName, additionalFields = {}) {
  const dis = getDeviceIdentityService()
  const ps = getProfileService()

  const profile = await ps.getActiveProfile()
  const version = profile?.version || '2.1.87'
  const deviceId = await dis.getOrCreateDeviceId(accountId)
  const sessionId = await dis.getOrCreateSession(accountId)

  const betas = Array.isArray(profile?.beta_flags)
    ? profile.beta_flags.join(',')
    : profile?.beta_flags || ''

  return {
    event_type: 'ClaudeCodeInternalEvent',
    event_data: {
      event_name: eventName,
      event_id: randomUUID(),
      client_timestamp: new Date().toISOString(),
      device_id: deviceId,
      session_id: sessionId,
      user_type: 'external',
      betas,
      entrypoint: 'cli',
      is_interactive: true,
      client_type: 'cli',
      env: buildEnvironmentMetadata(version),
      ...additionalFields
    }
  }
}

/**
 * 异步发送事件（不阻塞主请求）
 */
async function sendEvents(events, headers) {
  try {
    const client = getSidecarClient()
    await client.sendTelemetry({
      url: 'https://api.anthropic.com/api/event_logging/batch',
      headers: headers || {},
      body: { events }
    })
    logger.debug(`🎭 [Telemetry] Sent ${events.length} event(s)`)
  } catch (err) {
    // 遥测发送失败不影响主请求
    logger.debug(`[Telemetry] Send failed (non-blocking): ${err.message}`)
  }
}

/**
 * 构建遥测请求 headers（需要认证）
 */
function buildTelemetryHeaders(accessToken, profile) {
  return {
    'User-Agent': profile?.user_agent || 'claude-cli/2.1.87 (external, cli)',
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  }
}

/**
 * 发射 API 查询事件（请求发送前调用）
 */
async function emitApiQuery(accountId, accessToken, options = {}) {
  const { model, messagesLength, temperature, provider } = options

  try {
    const ps = getProfileService()
    const profile = await ps.getActiveProfile()

    const event = await buildEvent(accountId, 'tengu_api_query', {
      model: model || '',
      additional_metadata: JSON.stringify({
        ...(messagesLength !== undefined && { messages_length: messagesLength }),
        ...(temperature !== undefined && { temperature }),
        ...(provider && { provider })
      })
    })

    const headers = buildTelemetryHeaders(accessToken, profile)
    // 异步发送，不阻塞
    sendEvents([event], headers).catch(() => {})
  } catch (err) {
    logger.debug(`[Telemetry] emitApiQuery error: ${err.message}`)
  }
}

/**
 * 发射 API 成功事件（请求成功后调用）
 */
async function emitApiSuccess(accountId, accessToken, options = {}) {
  const { model, durationMs, inputTokens, outputTokens } = options

  try {
    const ps = getProfileService()
    const profile = await ps.getActiveProfile()

    const event = await buildEvent(accountId, 'tengu_api_success', {
      model: model || '',
      additional_metadata: JSON.stringify({
        ...(durationMs !== undefined && { duration_ms: durationMs }),
        ...(inputTokens !== undefined && { input_tokens: inputTokens }),
        ...(outputTokens !== undefined && { output_tokens: outputTokens })
      })
    })

    const headers = buildTelemetryHeaders(accessToken, profile)
    sendEvents([event], headers).catch(() => {})
  } catch (err) {
    logger.debug(`[Telemetry] emitApiSuccess error: ${err.message}`)
  }
}

/**
 * 发射 API 错误事件（请求失败后调用）
 */
async function emitApiError(accountId, accessToken, options = {}) {
  const { model, status, errorType } = options

  try {
    const ps = getProfileService()
    const profile = await ps.getActiveProfile()

    const event = await buildEvent(accountId, 'tengu_api_error', {
      model: model || '',
      additional_metadata: JSON.stringify({
        ...(status !== undefined && { http_status: status }),
        ...(errorType && { error_type: errorType })
      })
    })

    const headers = buildTelemetryHeaders(accessToken, profile)
    sendEvents([event], headers).catch(() => {})
  } catch (err) {
    logger.debug(`[Telemetry] emitApiError error: ${err.message}`)
  }
}

/**
 * 发射初始化事件
 */
async function emitInit(accountId, accessToken) {
  try {
    const ps = getProfileService()
    const profile = await ps.getActiveProfile()

    const event = await buildEvent(accountId, 'tengu_init')
    const headers = buildTelemetryHeaders(accessToken, profile)
    sendEvents([event], headers).catch(() => {})
  } catch (err) {
    logger.debug(`[Telemetry] emitInit error: ${err.message}`)
  }
}

/**
 * 发射退出事件
 */
async function emitExit(accountId, accessToken) {
  try {
    const ps = getProfileService()
    const profile = await ps.getActiveProfile()

    const event = await buildEvent(accountId, 'tengu_exit')
    const headers = buildTelemetryHeaders(accessToken, profile)
    sendEvents([event], headers).catch(() => {})
  } catch (err) {
    logger.debug(`[Telemetry] emitExit error: ${err.message}`)
  }
}

/**
 * 发射 tool_use 成功事件（响应中包含 tool_use 时调用）
 * 对照 CLI: tengu_tool_use_success
 */
async function emitToolUse(accountId, accessToken, options = {}) {
  const { model, toolName, durationMs } = options

  try {
    const ps = getProfileService()
    const profile = await ps.getActiveProfile()

    const event = await buildEvent(accountId, 'tengu_tool_use_success', {
      model: model || '',
      additional_metadata: JSON.stringify({
        ...(toolName && { tool_name: toolName }),
        ...(durationMs !== undefined && { duration_ms: durationMs })
      })
    })

    const headers = buildTelemetryHeaders(accessToken, profile)
    sendEvents([event], headers).catch(() => {})
  } catch (err) {
    logger.debug(`[Telemetry] emitToolUse error: ${err.message}`)
  }
}

/**
 * 发射 tool_use 错误事件
 * 对照 CLI: tengu_tool_use_error
 */
async function emitToolUseError(accountId, accessToken, options = {}) {
  const { model, toolName, errorType } = options

  try {
    const ps = getProfileService()
    const profile = await ps.getActiveProfile()

    const event = await buildEvent(accountId, 'tengu_tool_use_error', {
      model: model || '',
      additional_metadata: JSON.stringify({
        ...(toolName && { tool_name: toolName }),
        ...(errorType && { error_type: errorType })
      })
    })

    const headers = buildTelemetryHeaders(accessToken, profile)
    sendEvents([event], headers).catch(() => {})
  } catch (err) {
    logger.debug(`[Telemetry] emitToolUseError error: ${err.message}`)
  }
}

module.exports = {
  emitApiQuery,
  emitApiSuccess,
  emitApiError,
  emitInit,
  emitExit,
  emitToolUse,
  emitToolUseError
}
