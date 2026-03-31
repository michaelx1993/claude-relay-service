/**
 * Sidecar Health — 健康检查逻辑
 *
 * 定期调用 sidecar /health 端点，更新 Redis bun_sidecar_health key，
 * 连续重启失败 3 次触发 logger.error 告警。
 */

const logger = require('./logger')

let redisClient = null
let sidecarClient = null
let consecutiveFailures = 0
const MAX_CONSECUTIVE_FAILURES = 3

function getRedisClient() {
  if (!redisClient) {
    redisClient = require('../models/redis')
  }
  return redisClient
}

function getSidecarClient() {
  if (!sidecarClient) {
    sidecarClient = require('../services/sidecar/sidecarClient')
  }
  return sidecarClient
}

async function check() {
  const client = getSidecarClient()
  const redis = getRedisClient()

  try {
    const health = await client.healthCheck()

    if (health.status === 'healthy') {
      consecutiveFailures = 0
      await redis.setSidecarHealth({
        status: 'healthy',
        pid: String(health.pid),
        restart_count: '0',
        last_heartbeat: new Date().toISOString()
      })
      return health
    }

    throw new Error(`Unhealthy status: ${health.status}`)
  } catch (err) {
    consecutiveFailures++
    logger.warn(`[SidecarHealth] Check failed (${consecutiveFailures}): ${err.message}`)

    try {
      await redis.setSidecarHealth({
        status: 'unhealthy',
        pid: '0',
        restart_count: String(consecutiveFailures)
      })
    } catch (_redisErr) {
      /* Redis 也挂了，只记日志 */
    }

    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      logger.error(
        `[SidecarHealth] Sidecar unreachable for ${consecutiveFailures} consecutive checks!`
      )
    }

    throw err
  }
}

function onRestartFailed() {
  logger.error('[SidecarHealth] Sidecar restart failed — max retries exceeded')
  const redis = getRedisClient()
  redis
    .setSidecarHealth({
      status: 'unhealthy',
      pid: '0',
      restart_count: String(MAX_CONSECUTIVE_FAILURES + 1)
    })
    .catch((_e) => {
      /* best effort */
    })
}

function resetFailures() {
  consecutiveFailures = 0
}

module.exports = {
  check,
  onRestartFailed,
  resetFailures
}
