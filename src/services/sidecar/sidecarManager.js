/**
 * Sidecar Manager — Bun 子进程生命周期管理
 *
 * 职责：spawn、退出监听、自动重启（最多3次/5秒内）、
 * 心跳检查（10秒间隔）、SIGTERM→5s→SIGKILL 优雅关闭
 */

const { spawn } = require('child_process')
const path = require('path')
const logger = require('../../utils/logger')
const config = require('../../../config/config')
const sidecarHealth = require('../../utils/sidecarHealth')

const SIDECAR_SCRIPT = path.resolve(__dirname, '../../../sidecar/bun-worker.js')
const MAX_RESTARTS = 3
const RESTART_WINDOW_MS = 5000
const HEARTBEAT_INTERVAL_MS = 10000
const GRACEFUL_SHUTDOWN_MS = 5000

class SidecarManager {
  constructor() {
    this.process = null
    this.heartbeatTimer = null
    this.restartTimestamps = []
    this.stopping = false
    this.started = false
  }

  async start() {
    if (this.started) {
      logger.warn('[SidecarManager] Already started')
      return
    }

    this.stopping = false
    this.started = true
    this._spawn()
    this._startHeartbeat()
    logger.info('[SidecarManager] Sidecar started')
  }

  _spawn() {
    if (this.stopping) return

    const socketPath = config.simulation?.sidecarSocketPath || `/tmp/bun-relay-${config.server?.port || 3000}.sock`

    this.process = spawn('bun', ['run', SIDECAR_SCRIPT], {
      env: {
        ...process.env,
        SIDECAR_SOCKET_PATH: socketPath,
        PORT: String(config.server?.port || 3000)
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    this.process.stdout.on('data', (data) => {
      logger.debug(`[bun-sidecar] ${data.toString().trim()}`)
    })

    this.process.stderr.on('data', (data) => {
      logger.error(`[bun-sidecar] ${data.toString().trim()}`)
    })

    this.process.on('exit', (code, signal) => {
      if (this.stopping) {
        logger.info(`[SidecarManager] Sidecar exited (code=${code}, signal=${signal}) — stopping`)
        return
      }

      logger.warn(`[SidecarManager] Sidecar exited unexpectedly (code=${code}, signal=${signal})`)
      this._tryRestart()
    })

    this.process.on('error', (err) => {
      logger.error(`[SidecarManager] Sidecar spawn error: ${err.message}`)
      if (!this.stopping) {
        this._tryRestart()
      }
    })
  }

  _tryRestart() {
    const now = Date.now()
    this.restartTimestamps.push(now)
    // 只保留 RESTART_WINDOW_MS 内的记录
    this.restartTimestamps = this.restartTimestamps.filter((t) => now - t < RESTART_WINDOW_MS)

    if (this.restartTimestamps.length > MAX_RESTARTS) {
      logger.error(
        `[SidecarManager] Too many restarts (${MAX_RESTARTS} in ${RESTART_WINDOW_MS}ms), giving up`
      )
      sidecarHealth.onRestartFailed()
      return
    }

    logger.info(
      `[SidecarManager] Restarting sidecar (attempt ${this.restartTimestamps.length}/${MAX_RESTARTS})`
    )
    this._spawn()
  }

  _startHeartbeat() {
    this.heartbeatTimer = setInterval(async () => {
      if (this.stopping || !this.process) return
      try {
        await sidecarHealth.check()
      } catch (err) {
        logger.warn(`[SidecarManager] Heartbeat check failed: ${err.message}`)
      }
    }, HEARTBEAT_INTERVAL_MS)
  }

  async stop() {
    this.stopping = true
    this.started = false

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }

    if (!this.process) return

    return new Promise((resolve) => {
      const forceTimer = setTimeout(() => {
        logger.warn('[SidecarManager] Force killing sidecar (SIGKILL)')
        try {
          this.process.kill('SIGKILL')
        } catch (_e) {
          /* already dead */
        }
        this.process = null
        resolve()
      }, GRACEFUL_SHUTDOWN_MS)

      this.process.on('exit', () => {
        clearTimeout(forceTimer)
        this.process = null
        resolve()
      })

      try {
        this.process.kill('SIGTERM')
      } catch (_e) {
        clearTimeout(forceTimer)
        this.process = null
        resolve()
      }
    })
  }

  isRunning() {
    return this.process !== null && !this.process.killed
  }

  getPid() {
    return this.process?.pid || null
  }
}

module.exports = new SidecarManager()
