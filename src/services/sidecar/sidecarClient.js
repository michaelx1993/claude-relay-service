/**
 * Sidecar Client — Unix Socket HTTP 转发
 *
 * 通过 Unix Domain Socket 将请求转发给 Bun sidecar，
 * 支持 SSE 流式响应逐 chunk 透传，600s 超时，
 * sidecar 不可用时返回 503。
 */

const http = require('http')
const config = require('../../../config/config')
const logger = require('../../utils/logger')

const DEFAULT_TIMEOUT = 600000 // 600s

class SidecarClient {
  constructor() {
    this.agent = null
  }

  _getSocketPath() {
    return (
      config.simulation?.sidecarSocketPath ||
      `/tmp/bun-relay-${config.server?.port || 3000}.sock`
    )
  }

  _getAgent() {
    if (!this.agent) {
      this.agent = new http.Agent({
        socketPath: this._getSocketPath(),
        keepAlive: true,
        maxSockets: 50
      })
    }
    return this.agent
  }

  /**
   * 转发请求到 sidecar（非流式）
   * @returns {{ status: number, headers: object, body: string }}
   */
  async forward(payload) {
    const { timeout = DEFAULT_TIMEOUT } = payload
    const socketPath = this._getSocketPath()

    return new Promise((resolve, reject) => {
      const postData = JSON.stringify(payload)

      const req = http.request(
        {
          socketPath,
          path: '/',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
          },
          timeout
        },
        (res) => {
          const chunks = []
          res.on('data', (chunk) => chunks.push(chunk))
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString()
            const upstreamStatus = parseInt(res.headers['x-upstream-status']) || res.statusCode
            let upstreamHeaders = {}
            if (res.headers['x-upstream-headers']) {
              try {
                upstreamHeaders = JSON.parse(
                  Buffer.from(res.headers['x-upstream-headers'], 'base64').toString()
                )
              } catch (_e) {
                /* ignore */
              }
            }
            resolve({ status: upstreamStatus, headers: upstreamHeaders, body })
          })
          res.on('error', reject)
        }
      )

      req.on('error', (err) => {
        if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
          reject(new SidecarUnavailableError('Sidecar not available'))
        } else {
          reject(err)
        }
      })

      req.on('timeout', () => {
        req.destroy(new Error('Sidecar request timeout'))
      })

      req.write(postData)
      req.end()
    })
  }

  /**
   * 转发流式请求到 sidecar
   * 返回 { status, headers, stream } 其中 stream 是 Node.js IncomingMessage
   */
  forwardStream(payload) {
    const { timeout = DEFAULT_TIMEOUT } = payload
    const socketPath = this._getSocketPath()

    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({ ...payload, stream: true })

      const req = http.request(
        {
          socketPath,
          path: '/',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
          },
          timeout
        },
        (res) => {
          const upstreamStatus = parseInt(res.headers['x-upstream-status']) || res.statusCode
          let upstreamHeaders = {}
          if (res.headers['x-upstream-headers']) {
            try {
              upstreamHeaders = JSON.parse(
                Buffer.from(res.headers['x-upstream-headers'], 'base64').toString()
              )
            } catch (_e) {
              /* ignore */
            }
          }

          // 如果 sidecar 返回错误状态码，读取完整 body
          if (res.statusCode >= 400) {
            const chunks = []
            res.on('data', (chunk) => chunks.push(chunk))
            res.on('end', () => {
              const body = Buffer.concat(chunks).toString()
              resolve({ status: upstreamStatus, headers: upstreamHeaders, body, stream: null })
            })
            return
          }

          resolve({ status: upstreamStatus, headers: upstreamHeaders, body: null, stream: res })
        }
      )

      req.on('error', (err) => {
        if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
          reject(new SidecarUnavailableError('Sidecar not available'))
        } else {
          reject(err)
        }
      })

      req.on('timeout', () => {
        req.destroy(new Error('Sidecar stream request timeout'))
      })

      req.write(postData)
      req.end()
    })
  }

  /**
   * 发送遥测数据到 sidecar /telemetry 端点
   */
  async sendTelemetry(payload) {
    const socketPath = this._getSocketPath()

    return new Promise((resolve, reject) => {
      const postData = JSON.stringify(payload)

      const req = http.request(
        {
          socketPath,
          path: '/telemetry',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
          },
          timeout: 10000 // 遥测 10s 超时
        },
        (res) => {
          const chunks = []
          res.on('data', (chunk) => chunks.push(chunk))
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString()
            try {
              resolve(JSON.parse(body))
            } catch (_e) {
              resolve({ status: 'ok', raw: body })
            }
          })
        }
      )

      req.on('error', (err) => {
        logger.debug(`[SidecarClient] Telemetry send failed: ${err.message}`)
        reject(err)
      })

      req.on('timeout', () => {
        req.destroy(new Error('Telemetry request timeout'))
      })

      req.write(postData)
      req.end()
    })
  }

  /**
   * 健康检查
   */
  async healthCheck() {
    const socketPath = this._getSocketPath()

    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          socketPath,
          path: '/health',
          method: 'GET',
          timeout: 5000
        },
        (res) => {
          const chunks = []
          res.on('data', (chunk) => chunks.push(chunk))
          res.on('end', () => {
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString()))
            } catch (_e) {
              reject(new Error('Invalid health response'))
            }
          })
        }
      )

      req.on('error', reject)
      req.on('timeout', () => {
        req.destroy(new Error('Health check timeout'))
      })
      req.end()
    })
  }

  destroy() {
    if (this.agent) {
      this.agent.destroy()
      this.agent = null
    }
  }
}

class SidecarUnavailableError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SidecarUnavailableError'
    this.statusCode = 503
  }
}

module.exports = new SidecarClient()
module.exports.SidecarUnavailableError = SidecarUnavailableError
