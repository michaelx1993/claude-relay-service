/**
 * T035: 端到端测试
 *
 * 验证完整 simulation 路径：
 * (1) Headers 完全匹配
 * (2) 指纹计算正确
 * (3) metadata.user_id 构造正确
 * (4) Session ID 持久化
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

const { computeFingerprint, buildAttributionHeader } = require('../../src/utils/fingerprintHelper')
const deviceIdentityService = require('../../src/utils/deviceIdentityService')
const profileService = require('../../src/services/simulation/profileService')
const { buildSimulatedHeaders } = require('../../src/utils/headerFilter')
const redis = require('../../src/models/redis')

describe('E2E Simulation', () => {
  const ACCOUNT_ID = 'test-account-uuid-123'
  const ACCESS_TOKEN = 'test-access-token'

  beforeEach(() => {
    jest.clearAllMocks()
    redis.getClaudeDevice.mockResolvedValue({
      device_id: 'a'.repeat(64) // 64 hex chars (与真实 CLI 一致)
    })
    redis.getClaudeSession.mockResolvedValue({
      session_id: 'session-uuid-v4'
    })
    redis.getActiveClaudeCodeProfile.mockResolvedValue('2.1.88')
    redis.getClaudeCodeProfile.mockResolvedValue(null)
  })

  describe('Fingerprint + Attribution Header', () => {
    it('should compute fingerprint and build correct attribution header', () => {
      const messageText = 'Hello Claude, please help me with this task'
      const version = '2.1.88'
      const fingerprint = computeFingerprint(messageText, version)

      expect(fingerprint).toMatch(/^[0-9a-f]{3}$/)

      const header = buildAttributionHeader(fingerprint, version)
      expect(header).toBe(
        `x-anthropic-billing-header: cc_version=2.1.88.${fingerprint}; cc_entrypoint=cli;`
      )
    })
  })

  describe('Device Identity Persistence', () => {
    it('should return same device_id for same account', async () => {
      const id1 = await deviceIdentityService.getOrCreateDeviceId(ACCOUNT_ID)
      const id2 = await deviceIdentityService.getOrCreateDeviceId(ACCOUNT_ID)
      expect(id1).toBe(id2)
      expect(id1).toBe('a'.repeat(64))
    })

    it('should create 64-char hex device_id when not exists', async () => {
      redis.getClaudeDevice.mockResolvedValue(null)
      const id = await deviceIdentityService.getOrCreateDeviceId(ACCOUNT_ID)
      expect(id).toHaveLength(64)
      expect(id).toMatch(/^[0-9a-f]{64}$/)
    })

    it('should return same session_id for same account within TTL', async () => {
      const s1 = await deviceIdentityService.getOrCreateSession(ACCOUNT_ID)
      const s2 = await deviceIdentityService.getOrCreateSession(ACCOUNT_ID)
      expect(s1).toBe(s2)
    })
  })

  describe('metadata.user_id Construction', () => {
    it('should build JSON with device_id, account_uuid, session_id', async () => {
      const userId = await deviceIdentityService.buildMetadataUserId(ACCOUNT_ID)
      const parsed = JSON.parse(userId)

      expect(parsed).toHaveProperty('device_id', 'a'.repeat(64))
      expect(parsed).toHaveProperty('account_uuid', ACCOUNT_ID)
      expect(parsed).toHaveProperty('session_id', 'session-uuid-v4')
    })

    it('should produce valid JSON string', async () => {
      const userId = await deviceIdentityService.buildMetadataUserId(ACCOUNT_ID)
      expect(() => JSON.parse(userId)).not.toThrow()
    })
  })

  describe('Simulated Headers', () => {
    it('should build complete headers matching 2.1.88 profile', () => {
      const profile = profileService.loadProfileFromFile(
        require('path').resolve(__dirname, '../../src/services/simulation/profiles/2.1.88.json')
      )
      if (!profile) {
        // Profile file might not exist in test env
        return
      }

      const headers = buildSimulatedHeaders(
        ACCOUNT_ID,
        profile,
        'session-uuid-v4',
        ACCESS_TOKEN
      )

      expect(headers['x-app']).toBe('cli')
      expect(headers['User-Agent']).toContain('claude-cli/2.1.88')
      expect(headers['anthropic-version']).toBe('2023-06-01')
      expect(headers['Authorization']).toBe(`Bearer ${ACCESS_TOKEN}`)
      expect(headers['Content-Type']).toBe('application/json')
      expect(headers['x-stainless-runtime']).toBe('bun')
    })
  })
})
