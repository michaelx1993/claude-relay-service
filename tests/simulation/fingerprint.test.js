/**
 * T033: 首消息指纹计算验证
 *
 * 用已知输入验证 computeFingerprint() 输出与 2.1.88-src fingerprint.ts 的
 * SHA256 计算结果一致；测试边界情况（消息长度 < 21、空消息、多 content block）
 */

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}))

const {
  computeFingerprint,
  computeFingerprintFromMessages,
  extractFirstMessageText,
  buildAttributionHeader,
  FINGERPRINT_SALT
} = require('../../src/utils/fingerprintHelper')

const { createHash } = require('crypto')

describe('Fingerprint Helper', () => {
  describe('FINGERPRINT_SALT', () => {
    it('should match 2.1.88-src salt', () => {
      expect(FINGERPRINT_SALT).toBe('59cf53e54c78')
    })
  })

  describe('extractFirstMessageText', () => {
    it('should extract text from string content', () => {
      const messages = [
        { role: 'user', content: 'Hello world' }
      ]
      expect(extractFirstMessageText(messages)).toBe('Hello world')
    })

    it('should extract text from array content blocks', () => {
      const messages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Hello from array' }
          ]
        }
      ]
      expect(extractFirstMessageText(messages)).toBe('Hello from array')
    })

    it('should skip non-user messages', () => {
      const messages = [
        { role: 'assistant', content: 'I am assistant' },
        { role: 'user', content: 'I am user' }
      ]
      expect(extractFirstMessageText(messages)).toBe('I am user')
    })

    it('should return empty string for empty array', () => {
      expect(extractFirstMessageText([])).toBe('')
    })

    it('should return empty string for non-array input', () => {
      expect(extractFirstMessageText(null)).toBe('')
      expect(extractFirstMessageText(undefined)).toBe('')
      expect(extractFirstMessageText('string')).toBe('')
    })

    it('should return empty string when no user message', () => {
      const messages = [{ role: 'assistant', content: 'hi' }]
      expect(extractFirstMessageText(messages)).toBe('')
    })
  })

  describe('computeFingerprint', () => {
    it('should compute SHA256-based 3-char fingerprint', () => {
      const text = 'Hello, this is a test message!'
      // chars at indices 4, 7, 20
      const chars = `${text[4]}${text[7]}${text[20]}`
      expect(chars).toBe(`${text[4]}${text[7]}${text[20]}`)

      const version = '2.1.88'
      const expectedInput = `${FINGERPRINT_SALT}${chars}${version}`
      const expectedHash = createHash('sha256').update(expectedInput).digest('hex').slice(0, 3)

      const result = computeFingerprint(text, version)
      expect(result).toBe(expectedHash)
      expect(result).toHaveLength(3)
    })

    it('should use 0 for missing character indices when message is short', () => {
      const text = 'Hi' // length 2, indices 4,7,20 all missing
      const version = '2.1.88'
      const expectedInput = `${FINGERPRINT_SALT}000${version}`
      const expectedHash = createHash('sha256').update(expectedInput).digest('hex').slice(0, 3)

      expect(computeFingerprint(text, version)).toBe(expectedHash)
    })

    it('should handle empty message text', () => {
      const version = '2.1.88'
      const expectedInput = `${FINGERPRINT_SALT}000${version}`
      const expectedHash = createHash('sha256').update(expectedInput).digest('hex').slice(0, 3)

      expect(computeFingerprint('', version)).toBe(expectedHash)
    })

    it('should produce different fingerprints for different versions', () => {
      const text = 'Hello world test message!'
      const fp1 = computeFingerprint(text, '2.1.88')
      const fp2 = computeFingerprint(text, '2.2.0')
      expect(fp1).not.toBe(fp2)
    })

    it('should return exactly 3 hex characters', () => {
      const result = computeFingerprint('any message here!!!!!!', '2.1.88')
      expect(result).toMatch(/^[0-9a-f]{3}$/)
    })
  })

  describe('computeFingerprintFromMessages', () => {
    it('should compute fingerprint from API messages format', () => {
      const messages = [
        { role: 'user', content: 'Hello, this is a test message!' }
      ]
      const version = '2.1.88'
      const result = computeFingerprintFromMessages(messages, version)
      const expected = computeFingerprint('Hello, this is a test message!', version)
      expect(result).toBe(expected)
    })
  })

  describe('buildAttributionHeader', () => {
    it('should build correct attribution header format', () => {
      const result = buildAttributionHeader('abc', '2.1.88')
      expect(result).toBe(
        'x-anthropic-billing-header: cc_version=2.1.88.abc; cc_entrypoint=cli;'
      )
    })
  })
})
