/**
 * T034: 遥测事件验证
 *
 * 验证每次 API 调用产生匹配的 tengu_api_query + tengu_api_success/error 事件对；
 * 验证事件格式符合 ClaudeCodeInternalEvent schema；
 * 验证 client_timestamp 时序正确
 */

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}))

jest.mock('../../src/models/redis', () => ({
  getClaudeDevice: jest.fn(),
  setClaudeDevice: jest.fn(),
  getClaudeSession: jest.fn(),
  setClaudeSession: jest.fn(),
  touchClaudeSession: jest.fn(),
  getActiveClaudeCodeProfile: jest.fn(),
  getClaudeCodeProfile: jest.fn(),
  setClaudeCodeProfile: jest.fn(),
  setActiveClaudeCodeProfile: jest.fn()
}))

jest.mock('../../src/services/sidecar/sidecarClient', () => ({
  sendTelemetry: jest.fn().mockResolvedValue({ status: 'ok' })
}))

const telemetrySimulator = require('../../src/services/simulation/telemetrySimulator')
const sidecarClient = require('../../src/services/sidecar/sidecarClient')
const redis = require('../../src/models/redis')

describe('Telemetry Simulator', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Mock device & session
    redis.getClaudeDevice.mockResolvedValue({ device_id: 'a'.repeat(64) })
    redis.getClaudeSession.mockResolvedValue({ session_id: 'test-session-id' })
    redis.getActiveClaudeCodeProfile.mockResolvedValue('2.1.87')
    redis.getClaudeCodeProfile.mockResolvedValue(null)
  })

  describe('emitApiQuery', () => {
    it('should send tengu_api_query event via sidecar', async () => {
      await telemetrySimulator.emitApiQuery('account-1', 'token-1', {
        model: 'claude-sonnet-4-20250514',
        messagesLength: 5
      })

      // 等待异步发送
      await new Promise((r) => setTimeout(r, 50))

      expect(sidecarClient.sendTelemetry).toHaveBeenCalledTimes(1)
      const call = sidecarClient.sendTelemetry.mock.calls[0][0]
      expect(call.url).toBe('https://api.anthropic.com/api/event_logging/batch')
      expect(call.body.events).toHaveLength(1)

      const event = call.body.events[0]
      expect(event.event_type).toBe('ClaudeCodeInternalEvent')
      expect(event.event_data.event_name).toBe('tengu_api_query')
      expect(event.event_data.device_id).toBe('a'.repeat(64))
      expect(event.event_data.session_id).toBe('test-session-id')
      expect(event.event_data.model).toBe('claude-sonnet-4-20250514')
    })

    it('should include correct environment metadata', async () => {
      await telemetrySimulator.emitApiQuery('account-1', 'token-1', {})
      await new Promise((r) => setTimeout(r, 50))

      const event = sidecarClient.sendTelemetry.mock.calls[0][0].body.events[0]
      expect(event.event_data.env.platform).toBe('darwin')
      expect(event.event_data.env.is_running_with_bun).toBe(true)
      expect(event.event_data.env.is_claude_ai_auth).toBe(true)
      expect(event.event_data.entrypoint).toBe('cli')
      expect(event.event_data.is_interactive).toBe(true)
    })

    it('should include valid client_timestamp', async () => {
      const before = new Date().toISOString()
      await telemetrySimulator.emitApiQuery('account-1', 'token-1', {})
      const after = new Date().toISOString()
      await new Promise((r) => setTimeout(r, 50))

      const event = sidecarClient.sendTelemetry.mock.calls[0][0].body.events[0]
      expect(event.event_data.client_timestamp >= before).toBe(true)
      expect(event.event_data.client_timestamp <= after).toBe(true)
    })
  })

  describe('emitApiSuccess', () => {
    it('should send tengu_api_success event', async () => {
      await telemetrySimulator.emitApiSuccess('account-1', 'token-1', {
        model: 'claude-sonnet-4-20250514',
        durationMs: 1500
      })
      await new Promise((r) => setTimeout(r, 50))

      const event = sidecarClient.sendTelemetry.mock.calls[0][0].body.events[0]
      expect(event.event_data.event_name).toBe('tengu_api_success')
    })
  })

  describe('emitApiError', () => {
    it('should send tengu_api_error event', async () => {
      await telemetrySimulator.emitApiError('account-1', 'token-1', {
        model: 'claude-sonnet-4-20250514',
        status: 429,
        errorType: 'rate_limit'
      })
      await new Promise((r) => setTimeout(r, 50))

      const event = sidecarClient.sendTelemetry.mock.calls[0][0].body.events[0]
      expect(event.event_data.event_name).toBe('tengu_api_error')
    })
  })

  describe('emitInit / emitExit', () => {
    it('should send tengu_init event', async () => {
      await telemetrySimulator.emitInit('account-1', 'token-1')
      await new Promise((r) => setTimeout(r, 50))

      const event = sidecarClient.sendTelemetry.mock.calls[0][0].body.events[0]
      expect(event.event_data.event_name).toBe('tengu_init')
    })

    it('should send tengu_exit event', async () => {
      await telemetrySimulator.emitExit('account-1', 'token-1')
      await new Promise((r) => setTimeout(r, 50))

      const event = sidecarClient.sendTelemetry.mock.calls[0][0].body.events[0]
      expect(event.event_data.event_name).toBe('tengu_exit')
    })
  })

  describe('Authorization headers', () => {
    it('should include Bearer token in telemetry headers', async () => {
      await telemetrySimulator.emitApiQuery('account-1', 'my-secret-token', {})
      await new Promise((r) => setTimeout(r, 50))

      const headers = sidecarClient.sendTelemetry.mock.calls[0][0].headers
      expect(headers.Authorization).toBe('Bearer my-secret-token')
    })
  })

  describe('emitToolUse / emitToolUseError', () => {
    it('should send tengu_tool_use_success event', async () => {
      await telemetrySimulator.emitToolUse('account-1', 'token-1', {
        model: 'claude-sonnet-4-20250514',
        toolName: 'Read'
      })
      await new Promise((r) => setTimeout(r, 50))

      const event = sidecarClient.sendTelemetry.mock.calls[0][0].body.events[0]
      expect(event.event_data.event_name).toBe('tengu_tool_use_success')
      const meta = JSON.parse(event.event_data.additional_metadata)
      expect(meta.tool_name).toBe('Read')
    })

    it('should send tengu_tool_use_error event', async () => {
      await telemetrySimulator.emitToolUseError('account-1', 'token-1', {
        model: 'claude-sonnet-4-20250514',
        toolName: 'Bash',
        errorType: 'permission_denied'
      })
      await new Promise((r) => setTimeout(r, 50))

      const event = sidecarClient.sendTelemetry.mock.calls[0][0].body.events[0]
      expect(event.event_data.event_name).toBe('tengu_tool_use_error')
      const meta = JSON.parse(event.event_data.additional_metadata)
      expect(meta.tool_name).toBe('Bash')
      expect(meta.error_type).toBe('permission_denied')
    })
  })
})
