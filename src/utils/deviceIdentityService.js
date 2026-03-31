/**
 * Device Identity Service — 设备身份与会话管理
 *
 * 提供 per-account 的 device_id 持久化、session_id 轮换、
 * 以及 metadata.user_id JSON 构建。
 *
 * 与 2.1.88-src/src/services/api/claude.ts getAPIMetadata() 一致：
 * metadata.user_id = JSON.stringify({ device_id, account_uuid, session_id })
 */

const { randomBytes, randomUUID } = require('crypto')
const logger = require('./logger')

let redisClient = null

function getRedis() {
  if (!redisClient) {
    redisClient = require('../models/redis')
  }
  return redisClient
}

/**
 * 获取或创建设备 ID（per-account 持久化，无 TTL）
 * 格式：randomBytes(64).toString('hex') = 128 个十六进制字符
 *
 * @param {string} accountId
 * @returns {Promise<string>} 128-char hex device ID
 */
async function getOrCreateDeviceId(accountId) {
  const redis = getRedis()

  const existing = await redis.getClaudeDevice(accountId)
  if (existing && existing.device_id) {
    return existing.device_id
  }

  // 生成新 device_id
  const deviceId = randomBytes(64).toString('hex')

  await redis.setClaudeDevice(accountId, {
    device_id: deviceId,
    created_at: new Date().toISOString()
  })

  logger.info(`[DeviceIdentity] Created new device_id for account ${accountId.slice(0, 8)}...`)
  return deviceId
}

/**
 * 获取或创建 session ID（per-account，TTL 86400s = 24h）
 * 格式：UUID v4
 *
 * @param {string} accountId
 * @returns {Promise<string>} UUID v4 session ID
 */
async function getOrCreateSession(accountId) {
  const redis = getRedis()

  const existing = await redis.getClaudeSession(accountId)
  if (existing && existing.session_id) {
    // 刷新 TTL
    await redis.touchClaudeSession(accountId)
    return existing.session_id
  }

  // 生成新 session
  const sessionId = randomUUID()

  await redis.setClaudeSession(accountId, {
    session_id: sessionId,
    created_at: new Date().toISOString()
  })

  logger.info(`[DeviceIdentity] Created new session for account ${accountId.slice(0, 8)}...`)
  return sessionId
}

/**
 * 构建 metadata.user_id JSON 字符串
 * 与 2.1.88-src getAPIMetadata() 完全一致：
 * JSON.stringify({ device_id, account_uuid, session_id })
 *
 * @param {string} accountId - 用作 account_uuid
 * @returns {Promise<string>} JSON string
 */
async function buildMetadataUserId(accountId) {
  const deviceId = await getOrCreateDeviceId(accountId)
  const sessionId = await getOrCreateSession(accountId)

  return JSON.stringify({
    device_id: deviceId,
    account_uuid: accountId,
    session_id: sessionId
  })
}

/**
 * 获取 session ID（仅查询，不创建）
 * @param {string} accountId
 * @returns {Promise<string|null>}
 */
async function getSessionId(accountId) {
  const redis = getRedis()
  const existing = await redis.getClaudeSession(accountId)
  if (existing && existing.session_id) {
    return existing.session_id
  }
  return null
}

module.exports = {
  getOrCreateDeviceId,
  getOrCreateSession,
  buildMetadataUserId,
  getSessionId
}
