/**
 * T032: Header 完全匹配验证
 *
 * 构造模拟请求，验证 buildSimulatedHeaders() 输出与 2.1.87-src 的
 * defaultHeaders 构造逐字段对比一致（header 名、值、顺序）
 */

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}))

const crypto = require('crypto')
const originalRandomUUID = crypto.randomUUID
beforeAll(() => {
  crypto.randomUUID = () => 'mock-uuid-v4-value'
})
afterAll(() => {
  crypto.randomUUID = originalRandomUUID
})

const { buildSimulatedHeaders } = require('../../src/utils/headerFilter')

describe('Header Fidelity', () => {
  const profile = {
    version: '2.1.87',
    user_agent: 'claude-cli/2.1.87 (external, cli)',
    api_version: '2023-06-01',
    beta_flags: ['claude-code-20250219', 'interleaved-thinking-2025-05-14', 'oauth-2025-04-20'],
    stainless: {
      lang: 'javascript',
      package_version: '0.39.0',
      os: 'Mac OS X',
      arch: 'arm64',
      runtime: 'bun',
      runtime_version: '1.2.5'
    },
    header_order: [
      'x-app',
      'User-Agent',
      'X-Claude-Code-Session-Id',
      'x-client-request-id',
      'anthropic-version',
      'anthropic-beta',
      'Authorization',
      'Content-Type',
      'x-stainless-lang',
      'x-stainless-package-version',
      'x-stainless-os',
      'x-stainless-arch',
      'x-stainless-runtime',
      'x-stainless-runtime-version'
    ]
  }

  describe('buildSimulatedHeaders', () => {
    it('should produce headers in exact profile order', () => {
      const headers = buildSimulatedHeaders('account-123', profile, 'session-456', 'test-token')

      const keys = Object.keys(headers)
      expect(keys).toEqual(profile.header_order)
    })

    it('should set correct x-app value', () => {
      const headers = buildSimulatedHeaders('a', profile, 's', 't')
      expect(headers['x-app']).toBe('cli')
    })

    it('should use profile user_agent', () => {
      const headers = buildSimulatedHeaders('a', profile, 's', 't')
      expect(headers['User-Agent']).toBe('claude-cli/2.1.87 (external, cli)')
    })

    it('should set session ID', () => {
      const headers = buildSimulatedHeaders('a', profile, 'my-session', 't')
      expect(headers['X-Claude-Code-Session-Id']).toBe('my-session')
    })

    it('should generate UUID v4 for x-client-request-id', () => {
      const headers = buildSimulatedHeaders('a', profile, 's', 't')
      expect(headers['x-client-request-id']).toBe('mock-uuid-v4-value')
    })

    it('should set correct anthropic-version', () => {
      const headers = buildSimulatedHeaders('a', profile, 's', 't')
      expect(headers['anthropic-version']).toBe('2023-06-01')
    })

    it('should join beta flags with comma', () => {
      const headers = buildSimulatedHeaders('a', profile, 's', 't')
      expect(headers['anthropic-beta']).toBe(
        'claude-code-20250219,interleaved-thinking-2025-05-14,oauth-2025-04-20'
      )
    })

    it('should set Bearer token in Authorization', () => {
      const headers = buildSimulatedHeaders('a', profile, 's', 'my-access-token')
      expect(headers['Authorization']).toBe('Bearer my-access-token')
    })

    it('should set Content-Type to application/json', () => {
      const headers = buildSimulatedHeaders('a', profile, 's', 't')
      expect(headers['Content-Type']).toBe('application/json')
    })

    it('should include all stainless headers', () => {
      const headers = buildSimulatedHeaders('a', profile, 's', 't')
      expect(headers['x-stainless-lang']).toBe('javascript')
      expect(headers['x-stainless-package-version']).toBe('0.39.0')
      expect(headers['x-stainless-os']).toBe('Mac OS X')
      expect(headers['x-stainless-arch']).toBe('arm64')
      expect(headers['x-stainless-runtime']).toBe('bun')
      expect(headers['x-stainless-runtime-version']).toBe('1.2.5')
    })

    it('should NOT include accept-encoding header', () => {
      const headers = buildSimulatedHeaders('a', profile, 's', 't')
      expect(headers['accept-encoding']).toBeUndefined()
    })

    it('should have exactly 14 headers matching header_order', () => {
      const headers = buildSimulatedHeaders('a', profile, 's', 't')
      expect(Object.keys(headers)).toHaveLength(14)
    })

    it('should NOT contain fine-grained-tool-streaming (not a real CLI beta)', () => {
      const realProfile = require('../../src/services/simulation/profiles/2.1.87.json')
      const headers = buildSimulatedHeaders('a', realProfile, 's', 't')
      expect(headers['anthropic-beta']).not.toContain('fine-grained-tool-streaming')
    })

    it('should NOT contain task-budgets (API rejects it)', () => {
      const realProfile = require('../../src/services/simulation/profiles/2.1.87.json')
      const headers = buildSimulatedHeaders('a', realProfile, 's', 't')
      expect(headers['anthropic-beta']).not.toContain('task-budgets')
    })

    it('should NOT contain afk-mode (external build does not have it)', () => {
      const realProfile = require('../../src/services/simulation/profiles/2.1.87.json')
      const headers = buildSimulatedHeaders('a', realProfile, 's', 't')
      expect(headers['anthropic-beta']).not.toContain('afk-mode')
    })
  })
})
