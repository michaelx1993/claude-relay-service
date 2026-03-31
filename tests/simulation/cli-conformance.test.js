/**
 * CLI 一致性测试 — 验证每一处模拟实现都与 2.1.88-src 源码完全一致
 *
 * 对照源码文件：
 * - 2.1.88-src/src/utils/fingerprint.ts     → fingerprintHelper.js
 * - 2.1.88-src/src/utils/config.ts           → deviceIdentityService.js
 * - 2.1.88-src/src/services/api/claude.ts    → deviceIdentityService.js (buildMetadataUserId)
 * - 2.1.88-src/src/constants/system.ts       → fingerprintHelper.js (buildAttributionHeader)
 * - 2.1.88-src/src/services/api/client.ts    → headerFilter.js (buildSimulatedHeaders)
 * - 2.1.88-src/src/utils/http.ts             → profiles/2.1.88.json (user_agent)
 * - 2.1.88-src/src/utils/betas.ts            → profiles/2.1.88.json (beta_flags)
 */

const { createHash } = require('crypto')

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

const {
  FINGERPRINT_SALT,
  extractFirstMessageText,
  computeFingerprint,
  computeFingerprintFromMessages,
  buildAttributionHeader
} = require('../../src/utils/fingerprintHelper')
const deviceIdentityService = require('../../src/utils/deviceIdentityService')
const { buildSimulatedHeaders } = require('../../src/utils/headerFilter')
const redis = require('../../src/models/redis')
const path = require('path')

// ---------------------------------------------------------------------------
// 真实 CLI 2.1.88-src 中的常量（用于对照验证）
// ---------------------------------------------------------------------------
const CLI_FINGERPRINT_SALT = '59cf53e54c78'
const CLI_FINGERPRINT_INDICES = [4, 7, 20]
const CLI_DEVICE_ID_LENGTH = 64 // randomBytes(32).toString('hex')
const CLI_API_VERSION = '2023-06-01'
const CLI_USER_AGENT_FORMAT = /^claude-cli\/[\d.]+\s+\(.+\)$/
const CLI_X_APP = 'cli'
const CLI_STAINLESS_LANG = 'js' // @anthropic-ai/sdk 使用 'js'
const CLI_STAINLESS_RUNTIME = 'bun' // CLI 由 bun 打包运行

// 2.1.88-src/src/constants/betas.ts 中定义的所有 beta header 常量
const CLI_ALL_KNOWN_BETAS = [
  'claude-code-20250219',
  'interleaved-thinking-2025-05-14',
  'context-1m-2025-08-07',
  'context-management-2025-06-27',
  'structured-outputs-2025-12-15',
  'web-search-2025-03-05',
  'advanced-tool-use-2025-11-20',
  'tool-search-tool-2025-10-19',
  'effort-2025-11-24',
  'task-budgets-2026-03-13',
  'prompt-caching-scope-2026-01-05',
  'fast-mode-2026-02-01',
  'redact-thinking-2026-02-12',
  'token-efficient-tools-2026-03-28',
  'summarize-connector-text-2026-03-13',
  'afk-mode-2026-01-31',
  'cli-internal-2026-02-09',
  'advisor-tool-2026-03-01',
  'oauth-2025-04-20'
]

// 真实 CLI 中需要特殊条件才能启用的 betas（不应该无条件包含）
const CLI_CONDITIONAL_BETAS = [
  'context-1m-2025-08-07', // 需要 has1mContext(model)
  'afk-mode-2026-01-31', // 需要 feature flag
  'cli-internal-2026-02-09', // 需要 USER_TYPE === 'ant'
  'web-search-2025-03-05', // 需要 vertex + Claude 4.0+ 或 foundry
  'tool-search-tool-2025-10-19', // 3P only (Vertex/Bedrock)
  'token-efficient-tools-2026-03-28', // 需要 ant + feature flag
  'summarize-connector-text-2026-03-13' // 需要 ant + feature flag
]

describe('CLI Conformance Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    redis.getClaudeDevice.mockResolvedValue({ device_id: 'a'.repeat(64) })
    redis.getClaudeSession.mockResolvedValue({ session_id: 'test-session-uuid' })
    redis.getActiveClaudeCodeProfile.mockResolvedValue('2.1.88')
    redis.getClaudeCodeProfile.mockResolvedValue(null)
  })

  // =========================================================================
  // 1. 指纹算法一致性（对照 2.1.88-src/src/utils/fingerprint.ts）
  // =========================================================================
  describe('Fingerprint Algorithm (vs fingerprint.ts)', () => {
    it('should use exact same salt as CLI source: 59cf53e54c78', () => {
      expect(FINGERPRINT_SALT).toBe(CLI_FINGERPRINT_SALT)
    })

    it('should extract chars at indices [4, 7, 20] exactly like CLI', () => {
      // CLI: indices.map(i => messageText[i] || '0').join('')
      const msg = 'Hello Claude, please help me with this task'
      // msg[4] = 'o', msg[7] = 'l', msg[20] = ' ' (space before "me")
      expect(msg[4]).toBe('o')
      expect(msg[7]).toBe('l')
      expect(msg[20]).toBe(' ')

      // 验证我们的实现产生相同结果
      const version = '2.1.88'
      const expectedInput = `${CLI_FINGERPRINT_SALT}ol ${version}`
      const expectedHash = createHash('sha256').update(expectedInput).digest('hex')
      const expectedFingerprint = expectedHash.slice(0, 3)

      expect(computeFingerprint(msg, version)).toBe(expectedFingerprint)
    })

    it('should use "0" for out-of-bounds indices (matching CLI)', () => {
      // CLI: messageText[i] || '0'
      const shortMsg = 'Hi' // length=2, indices 4,7,20 all out of bounds
      const version = '2.1.88'
      const expectedInput = `${CLI_FINGERPRINT_SALT}000${version}`
      const expectedHash = createHash('sha256').update(expectedInput).digest('hex')
      const expectedFingerprint = expectedHash.slice(0, 3)

      expect(computeFingerprint(shortMsg, version)).toBe(expectedFingerprint)
    })

    it('should return exactly 3 hex characters', () => {
      const fingerprint = computeFingerprint('test message for fingerprint', '2.1.88')
      expect(fingerprint).toMatch(/^[0-9a-f]{3}$/)
      expect(fingerprint).toHaveLength(3)
    })

    it('should use SHA256 hash (not MD5 or other)', () => {
      const msg = 'Hello Claude'
      const version = '2.1.88'
      const chars = CLI_FINGERPRINT_INDICES.map((i) => msg[i] || '0').join('')
      const input = `${CLI_FINGERPRINT_SALT}${chars}${version}`

      // 直接用 SHA256 计算对比
      const sha256Result = createHash('sha256').update(input).digest('hex').slice(0, 3)
      // 用 MD5 计算对比（应该不同）
      const md5Result = createHash('md5').update(input).digest('hex').slice(0, 3)

      expect(computeFingerprint(msg, version)).toBe(sha256Result)
      // MD5 和 SHA256 极有可能不同（除非极端巧合）
      if (sha256Result !== md5Result) {
        expect(computeFingerprint(msg, version)).not.toBe(md5Result)
      }
    })

    it('should produce deterministic output for same input', () => {
      const fp1 = computeFingerprint('same message', '2.1.88')
      const fp2 = computeFingerprint('same message', '2.1.88')
      expect(fp1).toBe(fp2)
    })

    it('should produce different output for different messages', () => {
      // 确保两个消息在 indices [4,7,20] 处字符不同
      const fp1 = computeFingerprint('AAAABBBCCCCDDDDEEEEFFFFF', '2.1.88') // [4]=B [7]=C [20]=F
      const fp2 = computeFingerprint('XXXXYYYYZZZZWWWWVVVVUUUUU', '2.1.88') // [4]=Y [7]=Z [20]=U
      expect(fp1).not.toBe(fp2)
    })

    it('should handle empty string same as CLI (all indices use "0")', () => {
      const version = '2.1.88'
      const expectedInput = `${CLI_FINGERPRINT_SALT}000${version}`
      const expected = createHash('sha256').update(expectedInput).digest('hex').slice(0, 3)
      expect(computeFingerprint('', version)).toBe(expected)
    })
  })

  // =========================================================================
  // 2. 首消息提取（对照 fingerprint.ts extractFirstMessageText）
  // =========================================================================
  describe('First Message Extraction (vs fingerprint.ts)', () => {
    it('should find first user message from API messages array', () => {
      // CLI 使用 msg.type === 'user'，我们使用 msg.role === 'user'（API 格式差异）
      const messages = [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello Claude' },
        { role: 'assistant', content: 'Hi there' }
      ]
      expect(extractFirstMessageText(messages)).toBe('Hello Claude')
    })

    it('should handle content blocks array (API format)', () => {
      const messages = [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Hello from blocks' }]
        }
      ]
      expect(extractFirstMessageText(messages)).toBe('Hello from blocks')
    })

    it('should return empty string when no user message exists', () => {
      const messages = [{ role: 'assistant', content: 'Hi' }]
      expect(extractFirstMessageText(messages)).toBe('')
    })

    it('should return empty string for non-array input', () => {
      expect(extractFirstMessageText(null)).toBe('')
      expect(extractFirstMessageText(undefined)).toBe('')
      expect(extractFirstMessageText('string')).toBe('')
    })

    it('should skip assistant messages and find first user message', () => {
      const messages = [
        { role: 'assistant', content: 'prefill' },
        { role: 'user', content: 'actual user message' },
        { role: 'user', content: 'second user message' }
      ]
      // 只取第一条 user 消息
      expect(extractFirstMessageText(messages)).toBe('actual user message')
    })
  })

  // =========================================================================
  // 3. computeFingerprintFromMessages 整合测试
  // =========================================================================
  describe('computeFingerprintFromMessages', () => {
    it('should compute fingerprint from messages array end-to-end', () => {
      const messages = [
        { role: 'user', content: 'Hello Claude, please help me with this task' }
      ]
      const fp = computeFingerprintFromMessages(messages, '2.1.88')
      const directFp = computeFingerprint(
        'Hello Claude, please help me with this task',
        '2.1.88'
      )
      expect(fp).toBe(directFp)
    })
  })

  // =========================================================================
  // 4. Attribution Header 格式（对照 constants/system.ts getAttributionHeader）
  // =========================================================================
  describe('Attribution Header Format (vs system.ts)', () => {
    it('should match CLI format: cc_version={version}.{fp}; cc_entrypoint=cli;', () => {
      const header = buildAttributionHeader('a1f', '2.1.88')
      expect(header).toBe(
        'x-anthropic-billing-header: cc_version=2.1.88.a1f; cc_entrypoint=cli;'
      )
    })

    it('should use "cli" as entrypoint (matching process.env.CLAUDE_CODE_ENTRYPOINT default)', () => {
      const header = buildAttributionHeader('000', '2.1.88')
      expect(header).toContain('cc_entrypoint=cli;')
    })

    it('should embed fingerprint after version with dot separator', () => {
      const header = buildAttributionHeader('abc', '2.1.88')
      expect(header).toContain('cc_version=2.1.88.abc;')
    })

    it('should NOT include cch= (NATIVE_CLIENT_ATTESTATION is build-time feature flag)', () => {
      // cch=00000 只在 NATIVE_CLIENT_ATTESTATION 启用时才出现
      // 外部用户不会有这个字段
      const header = buildAttributionHeader('abc', '2.1.88')
      expect(header).not.toContain('cch=')
    })
  })

  // =========================================================================
  // 5. device_id 生成（对照 config.ts getOrCreateUserID）
  // =========================================================================
  describe('device_id Generation (vs config.ts getOrCreateUserID)', () => {
    it('should generate 64-char hex string = randomBytes(32)', () => {
      // CLI: randomBytes(32).toString('hex') = 64 hex chars
      redis.getClaudeDevice.mockResolvedValue(null)
      return deviceIdentityService.getOrCreateDeviceId('test-account').then((id) => {
        expect(id).toHaveLength(CLI_DEVICE_ID_LENGTH)
        expect(id).toMatch(/^[0-9a-f]{64}$/)
      })
    })

    it('should NOT generate 128-char device_id (old bug: randomBytes(64))', () => {
      redis.getClaudeDevice.mockResolvedValue(null)
      return deviceIdentityService.getOrCreateDeviceId('test-account').then((id) => {
        expect(id).not.toHaveLength(128)
      })
    })

    it('should persist device_id (same account returns same id)', () => {
      const existingId = 'b'.repeat(64)
      redis.getClaudeDevice.mockResolvedValue({ device_id: existingId })
      return deviceIdentityService.getOrCreateDeviceId('test-account').then((id) => {
        expect(id).toBe(existingId)
      })
    })

    it('should auto-migrate old 128-char device_id to 64 chars', () => {
      const oldId = 'c'.repeat(128)
      redis.getClaudeDevice.mockResolvedValue({
        device_id: oldId,
        created_at: '2024-01-01T00:00:00.000Z'
      })
      return deviceIdentityService.getOrCreateDeviceId('test-account').then((id) => {
        expect(id).toHaveLength(64)
        expect(id).toMatch(/^[0-9a-f]{64}$/)
        expect(id).not.toBe(oldId)
        // 验证调用了 setClaudeDevice 进行迁移
        expect(redis.setClaudeDevice).toHaveBeenCalledWith(
          'test-account',
          expect.objectContaining({
            device_id: expect.stringMatching(/^[0-9a-f]{64}$/),
            migrated_at: expect.any(String)
          })
        )
      })
    })

    it('should NOT migrate valid 64-char device_id', () => {
      const validId = 'd'.repeat(64)
      redis.getClaudeDevice.mockResolvedValue({ device_id: validId })
      return deviceIdentityService.getOrCreateDeviceId('test-account').then((id) => {
        expect(id).toBe(validId)
        expect(redis.setClaudeDevice).not.toHaveBeenCalled()
      })
    })
  })

  // =========================================================================
  // 6. session_id 格式（对照 CLI 使用 UUID v4）
  // =========================================================================
  describe('session_id Format', () => {
    it('should generate UUID v4 format session_id', () => {
      redis.getClaudeSession.mockResolvedValue(null)
      return deviceIdentityService.getOrCreateSession('test-account').then((sid) => {
        // UUID v4: xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx
        expect(sid).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
        )
      })
    })

    it('should reuse existing session_id', () => {
      redis.getClaudeSession.mockResolvedValue({ session_id: 'existing-session' })
      return deviceIdentityService.getOrCreateSession('test-account').then((sid) => {
        expect(sid).toBe('existing-session')
      })
    })
  })

  // =========================================================================
  // 7. metadata.user_id JSON 结构（对照 claude.ts getAPIMetadata）
  // =========================================================================
  describe('metadata.user_id JSON (vs claude.ts getAPIMetadata)', () => {
    it('should contain exactly device_id, account_uuid, session_id', async () => {
      const userId = await deviceIdentityService.buildMetadataUserId('account-123')
      const parsed = JSON.parse(userId)

      // CLI: JSON.stringify({ ...extra, device_id, account_uuid, session_id })
      expect(Object.keys(parsed)).toEqual(
        expect.arrayContaining(['device_id', 'account_uuid', 'session_id'])
      )
      expect(Object.keys(parsed)).toHaveLength(3)
    })

    it('should use account_uuid (not account_id) as key name', async () => {
      const userId = await deviceIdentityService.buildMetadataUserId('my-account')
      const parsed = JSON.parse(userId)

      // CLI 使用 account_uuid 而不是 account_id
      expect(parsed).toHaveProperty('account_uuid')
      expect(parsed).not.toHaveProperty('account_id')
    })

    it('should set device_id to 64-char hex string', async () => {
      const userId = await deviceIdentityService.buildMetadataUserId('account-123')
      const parsed = JSON.parse(userId)
      expect(parsed.device_id).toHaveLength(64)
      expect(parsed.device_id).toMatch(/^[0-9a-f]{64}$/)
    })

    it('should produce valid JSON string', async () => {
      const userId = await deviceIdentityService.buildMetadataUserId('account-123')
      expect(typeof userId).toBe('string')
      expect(() => JSON.parse(userId)).not.toThrow()
    })
  })

  // =========================================================================
  // 8. Profile 2.1.88 字段验证（对照 CLI 各源码文件）
  // =========================================================================
  describe('Profile 2.1.88 Fields', () => {
    const profile = require('../../src/services/simulation/profiles/2.1.88.json')

    it('should have version matching target', () => {
      expect(profile.version).toBe('2.1.88')
    })

    // 对照 http.ts getUserAgent()
    // 格式: claude-cli/{VERSION} ({USER_TYPE}, {ENTRYPOINT})
    it('should have user_agent matching CLI getUserAgent() format', () => {
      expect(profile.user_agent).toBe('claude-cli/2.1.88 (external, cli)')
      // external = OAuth 用户类型
      // cli = 默认 entrypoint
    })

    // 对照 client.ts: apiVersion: '2023-06-01'
    it('should have api_version = 2023-06-01', () => {
      expect(profile.api_version).toBe(CLI_API_VERSION)
    })

    // 对照 fingerprint.ts FINGERPRINT_SALT
    it('should have fingerprint_salt matching CLI constant', () => {
      expect(profile.fingerprint_salt).toBe(CLI_FINGERPRINT_SALT)
    })

    describe('Beta Flags', () => {
      it('should only contain betas defined in CLI source (no invented ones)', () => {
        for (const beta of profile.beta_flags) {
          expect(CLI_ALL_KNOWN_BETAS).toContain(beta)
        }
      })

      it('should NOT contain ant-only betas', () => {
        // cli-internal-2026-02-09 requires USER_TYPE === 'ant'
        expect(profile.beta_flags).not.toContain('cli-internal-2026-02-09')
      })

      it('should NOT contain feature-flag-gated betas that external users cannot have', () => {
        // afk-mode: requires GrowthBook feature flag
        expect(profile.beta_flags).not.toContain('afk-mode-2026-01-31')
        // token-efficient-tools: requires ant + feature flag
        expect(profile.beta_flags).not.toContain('token-efficient-tools-2026-03-28')
        // summarize-connector-text: requires ant + feature flag
        expect(profile.beta_flags).not.toContain('summarize-connector-text-2026-03-13')
      })

      it('should NOT contain context-1m beta (requires model-specific check)', () => {
        // context-1m-2025-08-07: requires has1mContext(model), not always true
        expect(profile.beta_flags).not.toContain('context-1m-2025-08-07')
      })

      it('should contain claude-code base beta (always included for non-haiku)', () => {
        expect(profile.beta_flags).toContain('claude-code-20250219')
      })

      it('should contain oauth beta (we are Claude AI subscriber)', () => {
        expect(profile.beta_flags).toContain('oauth-2025-04-20')
      })

      it('should contain interleaved-thinking beta (default enabled)', () => {
        expect(profile.beta_flags).toContain('interleaved-thinking-2025-05-14')
      })

      it('should contain redact-thinking beta (firstParty + ISP model)', () => {
        expect(profile.beta_flags).toContain('redact-thinking-2026-02-12')
      })

      it('should contain prompt-caching-scope beta (firstParty)', () => {
        expect(profile.beta_flags).toContain('prompt-caching-scope-2026-01-05')
      })

      it('should contain effort beta', () => {
        expect(profile.beta_flags).toContain('effort-2025-11-24')
      })

      it('should contain task-budgets beta', () => {
        expect(profile.beta_flags).toContain('task-budgets-2026-03-13')
      })

      it('should contain fast-mode beta', () => {
        expect(profile.beta_flags).toContain('fast-mode-2026-02-01')
      })

      it('should contain advisor-tool beta', () => {
        expect(profile.beta_flags).toContain('advisor-tool-2026-03-01')
      })

      it('should have reasonable count for external OAuth user (8-14)', () => {
        // 外部 OAuth 用户通常有 8-14 个 betas
        expect(profile.beta_flags.length).toBeGreaterThanOrEqual(8)
        expect(profile.beta_flags.length).toBeLessThanOrEqual(14)
      })
    })

    // 对照 @anthropic-ai/sdk Stainless headers
    describe('Stainless SDK Metadata', () => {
      it('should have lang = "js" (not "javascript")', () => {
        // @anthropic-ai/sdk 发送 x-stainless-lang: js
        expect(profile.stainless.lang).toBe(CLI_STAINLESS_LANG)
      })

      it('should have runtime = "bun" (CLI runs on bun)', () => {
        expect(profile.stainless.runtime).toBe(CLI_STAINLESS_RUNTIME)
      })

      it('should have os = "Mac OS X" (darwin platform name)', () => {
        expect(profile.stainless.os).toBe('Mac OS X')
      })

      it('should have arch = "arm64" (Apple Silicon)', () => {
        expect(profile.stainless.arch).toBe('arm64')
      })

      it('should have valid semver runtime_version', () => {
        expect(profile.stainless.runtime_version).toMatch(/^\d+\.\d+\.\d+$/)
      })

      it('should have valid semver package_version', () => {
        expect(profile.stainless.package_version).toMatch(/^\d+\.\d+\.\d+$/)
      })
    })

    // 对照 client.ts defaultHeaders 构建顺序
    describe('Header Order', () => {
      it('should define header_order array', () => {
        expect(Array.isArray(profile.header_order)).toBe(true)
        expect(profile.header_order.length).toBeGreaterThan(0)
      })

      it('should start with x-app (matching client.ts defaultHeaders)', () => {
        expect(profile.header_order[0]).toBe('x-app')
      })

      it('should have User-Agent second', () => {
        expect(profile.header_order[1]).toBe('User-Agent')
      })

      it('should include all required Claude Code headers', () => {
        const required = [
          'x-app',
          'User-Agent',
          'X-Claude-Code-Session-Id',
          'anthropic-version',
          'anthropic-beta',
          'Authorization',
          'Content-Type'
        ]
        for (const h of required) {
          expect(profile.header_order).toContain(h)
        }
      })

      it('should include all stainless headers', () => {
        const stainlessHeaders = [
          'x-stainless-lang',
          'x-stainless-package-version',
          'x-stainless-os',
          'x-stainless-arch',
          'x-stainless-runtime',
          'x-stainless-runtime-version'
        ]
        for (const h of stainlessHeaders) {
          expect(profile.header_order).toContain(h)
        }
      })
    })
  })

  // =========================================================================
  // 9. buildSimulatedHeaders 输出验证（对照 client.ts getAnthropicClient）
  // =========================================================================
  describe('buildSimulatedHeaders Output (vs client.ts)', () => {
    const profile = require('../../src/services/simulation/profiles/2.1.88.json')
    const SESSION_ID = 'session-uuid-v4'
    const TOKEN = 'test-oauth-token'

    let headers
    beforeEach(() => {
      headers = buildSimulatedHeaders('account-1', profile, SESSION_ID, TOKEN)
    })

    // 对照 client.ts: 'x-app': 'cli'
    it('should set x-app = "cli"', () => {
      expect(headers['x-app']).toBe(CLI_X_APP)
    })

    // 对照 http.ts getUserAgent()
    it('should set User-Agent = "claude-cli/2.1.88 (external, cli)"', () => {
      expect(headers['User-Agent']).toBe('claude-cli/2.1.88 (external, cli)')
    })

    // 对照 client.ts: 'X-Claude-Code-Session-Id': getSessionId()
    it('should set X-Claude-Code-Session-Id', () => {
      expect(headers['X-Claude-Code-Session-Id']).toBe(SESSION_ID)
    })

    // 对照 client.ts: x-client-request-id (UUID v4)
    it('should set x-client-request-id as UUID', () => {
      expect(headers['x-client-request-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      )
    })

    // 对照 client.ts: apiVersion
    it('should set anthropic-version = "2023-06-01"', () => {
      expect(headers['anthropic-version']).toBe(CLI_API_VERSION)
    })

    // 对照 client.ts: beta 由 SDK 从 betas 参数转为 header
    it('should set anthropic-beta as comma-separated string', () => {
      expect(typeof headers['anthropic-beta']).toBe('string')
      const betas = headers['anthropic-beta'].split(',')
      expect(betas.length).toBeGreaterThan(1)
      // 每个 beta 都应该是已知的
      for (const b of betas) {
        expect(CLI_ALL_KNOWN_BETAS).toContain(b.trim())
      }
    })

    // 对照 client.ts: Authorization header
    it('should set Authorization = "Bearer {token}"', () => {
      expect(headers['Authorization']).toBe(`Bearer ${TOKEN}`)
    })

    it('should set Content-Type = "application/json"', () => {
      expect(headers['Content-Type']).toBe('application/json')
    })

    // Stainless headers
    it('should set x-stainless-lang = "js"', () => {
      expect(headers['x-stainless-lang']).toBe(CLI_STAINLESS_LANG)
    })

    it('should set x-stainless-runtime = "bun"', () => {
      expect(headers['x-stainless-runtime']).toBe(CLI_STAINLESS_RUNTIME)
    })

    it('should set x-stainless-os = "Mac OS X"', () => {
      expect(headers['x-stainless-os']).toBe('Mac OS X')
    })

    it('should set x-stainless-arch = "arm64"', () => {
      expect(headers['x-stainless-arch']).toBe('arm64')
    })

    it('should set x-stainless-package-version', () => {
      expect(headers['x-stainless-package-version']).toMatch(/^\d+\.\d+\.\d+$/)
    })

    it('should set x-stainless-runtime-version', () => {
      expect(headers['x-stainless-runtime-version']).toMatch(/^\d+\.\d+\.\d+$/)
    })

    // 确保 header 顺序与 profile.header_order 一致
    it('should output headers in profile.header_order sequence', () => {
      const outputKeys = Object.keys(headers)
      const expectedOrder = profile.header_order.filter((k) => headers[k] !== undefined)
      expect(outputKeys).toEqual(expectedOrder)
    })

    // 不应该包含 API Key 认证 headers（我们只用 OAuth）
    it('should NOT include x-api-key header', () => {
      expect(headers['x-api-key']).toBeUndefined()
    })

    // 不应该包含 ant-only headers
    it('should NOT include x-anthropic-additional-protection', () => {
      expect(headers['x-anthropic-additional-protection']).toBeUndefined()
    })
  })

  // =========================================================================
  // 10. 跨算法一致性（端到端验证）
  // =========================================================================
  describe('Cross-Algorithm Consistency', () => {
    it('should produce consistent fingerprint→attribution pipeline', () => {
      const msg = 'Can you help me write a function to sort an array?'
      const version = '2.1.88'

      const fp = computeFingerprint(msg, version)
      const header = buildAttributionHeader(fp, version)

      // 验证 header 包含正确的版本和指纹
      expect(header).toContain(`cc_version=${version}.${fp}`)
      expect(fp).toMatch(/^[0-9a-f]{3}$/)
    })

    it('should produce consistent message→fingerprint pipeline', () => {
      const messages = [
        { role: 'user', content: 'Can you help me write a function to sort an array?' }
      ]
      const version = '2.1.88'

      const fpFromMessages = computeFingerprintFromMessages(messages, version)
      const fpDirect = computeFingerprint(messages[0].content, version)

      expect(fpFromMessages).toBe(fpDirect)
    })
  })

  // =========================================================================
  // 11. 边界条件和安全性
  // =========================================================================
  describe('Edge Cases & Safety', () => {
    it('should handle unicode messages in fingerprint', () => {
      const msg = '你好 Claude，请帮我写一个排序函数'
      const fp = computeFingerprint(msg, '2.1.88')
      expect(fp).toMatch(/^[0-9a-f]{3}$/)
    })

    it('should handle extremely long messages', () => {
      const msg = 'x'.repeat(100000)
      const fp = computeFingerprint(msg, '2.1.88')
      expect(fp).toMatch(/^[0-9a-f]{3}$/)
    })

    it('should handle single character message', () => {
      const msg = 'a'
      const fp = computeFingerprint(msg, '2.1.88')
      expect(fp).toMatch(/^[0-9a-f]{3}$/)
    })

    it('should not leak token in headers (no x-api-key)', () => {
      const profile = require('../../src/services/simulation/profiles/2.1.88.json')
      const headers = buildSimulatedHeaders('acc', profile, 'sess', 'secret-token')
      // Token 只应该出现在 Authorization header 中
      const headerStr = JSON.stringify(headers)
      const tokenOccurrences = headerStr.split('secret-token').length - 1
      expect(tokenOccurrences).toBe(1) // 只在 Authorization 中出现一次
    })
  })
})
