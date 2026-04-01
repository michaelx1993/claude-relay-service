/**
 * Fingerprint Helper — 首消息指纹计算
 *
 * 算法：SHA256(SALT + msg[4] + msg[7] + msg[20] + version)[:3]
 * 与 2.1.87-src/src/utils/fingerprint.ts 完全一致
 */

const { createHash } = require('crypto')

const FINGERPRINT_SALT = '59cf53e54c78'

/**
 * 从消息数组中提取第一条用户消息的文本
 * 支持 API 格式的 messages（role: 'user', content: string|array）
 */
function extractFirstMessageText(messages) {
  if (!Array.isArray(messages)) return ''

  const firstUserMsg = messages.find((m) => m.role === 'user')
  if (!firstUserMsg) return ''

  const content = firstUserMsg.content
  if (typeof content === 'string') return content

  if (Array.isArray(content)) {
    const textBlock = content.find((block) => block.type === 'text')
    if (textBlock && textBlock.text) {
      return textBlock.text
    }
  }

  return ''
}

/**
 * 计算 3 字符指纹
 * @param {string} messageText - 第一条用户消息文本
 * @param {string} version - 版本字符串（如 '2.1.87'）
 * @returns {string} 3 个十六进制字符
 */
function computeFingerprint(messageText, version) {
  const indices = [4, 7, 20]
  const chars = indices.map((i) => messageText[i] || '0').join('')
  const fingerprintInput = `${FINGERPRINT_SALT}${chars}${version}`
  const hash = createHash('sha256').update(fingerprintInput).digest('hex')
  return hash.slice(0, 3)
}

/**
 * 从消息数组计算指纹
 * @param {Array} messages - API 格式的消息数组
 * @param {string} version - 版本字符串
 * @returns {string} 3 个十六进制字符
 */
function computeFingerprintFromMessages(messages, version) {
  const text = extractFirstMessageText(messages)
  return computeFingerprint(text, version)
}

/**
 * 构建 attribution header 字符串（注入到 system prompt 中）
 * 格式：x-anthropic-billing-header: cc_version={version}.{fingerprint}; cc_entrypoint=cli;
 */
function buildAttributionHeader(fingerprint, version) {
  return `x-anthropic-billing-header: cc_version=${version}.${fingerprint}; cc_entrypoint=cli;`
}

module.exports = {
  FINGERPRINT_SALT,
  extractFirstMessageText,
  computeFingerprint,
  computeFingerprintFromMessages,
  buildAttributionHeader
}
