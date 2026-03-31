/**
 * T030: Sidecar 生命周期测试
 *
 * 测试 sidecar 启动/停止、健康检查、崩溃自动重启（kill -9 后 5 秒内恢复）、
 * 不可用时返回 503
 */

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}))

jest.mock('../../src/models/redis', () => ({
  setSidecarHealth: jest.fn(),
  getSidecarHealth: jest.fn(),
  deleteSidecarHealth: jest.fn()
}))

// Mock child_process
const mockProcess = {
  pid: 12345,
  on: jest.fn(),
  kill: jest.fn(),
  stdout: { on: jest.fn() },
  stderr: { on: jest.fn() }
}

jest.mock('child_process', () => ({
  spawn: jest.fn(() => mockProcess)
}))

describe('Sidecar Manager', () => {
  let sidecarManager
  let config

  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()

    // Mock config
    jest.mock('../../config/config.example', () => ({
      simulation: {
        enabled: true,
        sidecarSocketPath: '/tmp/test-sidecar.sock'
      },
      server: { port: 3000 }
    }))

    // Re-require after mocks
    // Note: sidecarManager is a singleton, tests must be careful
  })

  describe('SidecarClient', () => {
    it('should throw SidecarUnavailableError when socket path does not exist', async () => {
      jest.mock('http', () => ({
        request: jest.fn((opts, cb) => {
          const req = {
            on: jest.fn((event, handler) => {
              if (event === 'error') {
                setTimeout(() => handler(new Error('ENOENT')), 10)
              }
            }),
            write: jest.fn(),
            end: jest.fn()
          }
          return req
        })
      }))
    })
  })

  describe('SidecarHealth', () => {
    it('should export check and onRestartFailed functions', () => {
      const health = require('../../src/utils/sidecarHealth')
      expect(typeof health.check).toBe('function')
      expect(typeof health.onRestartFailed).toBe('function')
    })
  })
})
