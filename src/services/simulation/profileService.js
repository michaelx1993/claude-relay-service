/**
 * Profile Service — Claude Code 版本 Profile 管理
 *
 * 提供 getActiveProfile()、setActiveProfile(version)、
 * loadProfileFromFile(path)、getProfileHeaders() 等功能。
 * 内存缓存 + Redis 持久化。
 */

const fs = require('fs')
const path = require('path')
const logger = require('../../utils/logger')

let redisClient = null

function getRedis() {
  if (!redisClient) {
    redisClient = require('../../models/redis')
  }
  return redisClient
}

// 内存缓存
let cachedProfile = null
let cachedVersion = null

const PROFILES_DIR = path.resolve(__dirname, 'profiles')

/**
 * 获取当前活跃 profile
 */
async function getActiveProfile() {
  const redis = getRedis()

  // 先检查内存缓存
  const activeVersion = await redis.getActiveClaudeCodeProfile()
  if (cachedProfile && cachedVersion === activeVersion) {
    return cachedProfile
  }

  if (!activeVersion) {
    // 没有设置活跃 profile，使用默认的 2.1.88
    const defaultProfile = loadProfileFromFile(path.join(PROFILES_DIR, '2.1.88.json'))
    if (defaultProfile) {
      await setActiveProfile('2.1.88')
      return defaultProfile
    }
    return null
  }

  // 从 Redis 读取
  let profile = await redis.getClaudeCodeProfile(activeVersion)

  if (!profile) {
    // Redis 中不存在，尝试从文件加载
    const filePath = path.join(PROFILES_DIR, `${activeVersion}.json`)
    profile = loadProfileFromFile(filePath)
    if (profile) {
      await redis.setClaudeCodeProfile(activeVersion, flattenProfileForRedis(profile))
    }
  } else {
    // Redis 中的数据需要重建完整 profile 对象
    profile = buildProfileFromRedis(profile)
  }

  // 更新内存缓存
  cachedProfile = profile
  cachedVersion = activeVersion

  return profile
}

/**
 * 设置活跃 profile 版本
 */
async function setActiveProfile(version) {
  const redis = getRedis()
  await redis.setActiveClaudeCodeProfile(version)

  // 确保 profile 数据在 Redis 中
  const existing = await redis.getClaudeCodeProfile(version)
  if (!existing) {
    const filePath = path.join(PROFILES_DIR, `${version}.json`)
    const profile = loadProfileFromFile(filePath)
    if (profile) {
      await redis.setClaudeCodeProfile(version, flattenProfileForRedis(profile))
    }
  }

  // 清除内存缓存
  cachedProfile = null
  cachedVersion = null

  // 发布变更通知（通知其他实例刷新缓存）
  try {
    await redis.publishProfileChange(version)
  } catch (_e) {
    // pub/sub 失败不影响主流程
  }

  logger.info(`[ProfileService] Active profile set to: ${version}`)
}

/**
 * 从文件加载 profile
 */
function loadProfileFromFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      logger.warn(`[ProfileService] Profile file not found: ${filePath}`)
      return null
    }
    const raw = fs.readFileSync(filePath, 'utf8')
    return JSON.parse(raw)
  } catch (err) {
    logger.error(`[ProfileService] Failed to load profile from ${filePath}: ${err.message}`)
    return null
  }
}

/**
 * 根据 profile 和账户信息构建完整 header 集
 */
function getProfileHeaders(accountId, profile, sessionId, token) {
  const { randomUUID } = require('crypto')

  const headers = {}
  const order = profile.header_order || []
  const stainless = profile.stainless || {}

  const headerValues = {
    'x-app': 'cli',
    'User-Agent': profile.user_agent,
    'X-Claude-Code-Session-Id': sessionId,
    'x-client-request-id': randomUUID(),
    'anthropic-version': profile.api_version,
    'anthropic-beta': (profile.beta_flags || []).join(','),
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'x-stainless-lang': stainless.lang || 'javascript',
    'x-stainless-package-version': stainless.package_version || '0.39.0',
    'x-stainless-os': stainless.os || 'Mac OS X',
    'x-stainless-arch': stainless.arch || 'arm64',
    'x-stainless-runtime': stainless.runtime || 'bun',
    'x-stainless-runtime-version': stainless.runtime_version || '1.2.5'
  }

  // 按 header_order 顺序构建
  for (const key of order) {
    if (headerValues[key] !== undefined) {
      headers[key] = headerValues[key]
    }
  }

  // 添加 order 中没有但 headerValues 中有的
  for (const [key, value] of Object.entries(headerValues)) {
    if (!headers[key] && value !== undefined) {
      headers[key] = value
    }
  }

  return headers
}

/**
 * 保存 profile 到 Redis
 */
async function saveProfile(version, profileData) {
  const redis = getRedis()
  await redis.setClaudeCodeProfile(version, flattenProfileForRedis(profileData))
  // 清除缓存
  if (cachedVersion === version) {
    cachedProfile = null
    cachedVersion = null
  }
}

/**
 * 列出所有可用 profile
 */
async function listProfiles() {
  const redis = getRedis()
  const redisVersions = await redis.listClaudeCodeProfiles()

  // 也扫描本地文件
  const fileVersions = []
  try {
    const files = fs.readdirSync(PROFILES_DIR)
    for (const file of files) {
      if (file.endsWith('.json')) {
        fileVersions.push(file.replace('.json', ''))
      }
    }
  } catch (_e) {
    /* dir might not exist */
  }

  const all = [...new Set([...redisVersions, ...fileVersions])]
  return all.sort()
}

/**
 * 清除内存缓存（用于热更新）
 */
function clearCache() {
  cachedProfile = null
  cachedVersion = null
}

// --- 内部工具函数 ---

function flattenProfileForRedis(profile) {
  return {
    version: profile.version,
    user_agent: profile.user_agent,
    api_version: profile.api_version,
    beta_flags: Array.isArray(profile.beta_flags) ? profile.beta_flags.join(',') : profile.beta_flags,
    fingerprint_salt: profile.fingerprint_salt,
    header_order: Array.isArray(profile.header_order)
      ? JSON.stringify(profile.header_order)
      : profile.header_order,
    stainless_lang: profile.stainless?.lang || '',
    stainless_runtime: profile.stainless?.runtime || '',
    stainless_runtime_version: profile.stainless?.runtime_version || '',
    stainless_os: profile.stainless?.os || '',
    stainless_arch: profile.stainless?.arch || '',
    stainless_package_version: profile.stainless?.package_version || ''
  }
}

function buildProfileFromRedis(data) {
  let headerOrder = data.header_order
  if (typeof headerOrder === 'string') {
    try {
      headerOrder = JSON.parse(headerOrder)
    } catch (_e) {
      headerOrder = []
    }
  }

  return {
    version: data.version,
    user_agent: data.user_agent,
    api_version: data.api_version,
    beta_flags: typeof data.beta_flags === 'string' ? data.beta_flags.split(',') : data.beta_flags,
    fingerprint_salt: data.fingerprint_salt,
    header_order: headerOrder,
    stainless: {
      lang: data.stainless_lang,
      runtime: data.stainless_runtime,
      runtime_version: data.stainless_runtime_version,
      os: data.stainless_os,
      arch: data.stainless_arch,
      package_version: data.stainless_package_version
    }
  }
}

/**
 * 订阅 Redis pub/sub 用于 profile 热更新
 * 当 claude_code_active_profile 变更时，自动刷新内存缓存
 */
let subscribed = false

async function subscribeProfileChanges() {
  if (subscribed) return

  try {
    const redis = getRedis()
    if (typeof redis.subscribeProfileChange === 'function') {
      await redis.subscribeProfileChange(() => {
        logger.info('[ProfileService] Profile change detected via pub/sub, clearing cache')
        clearCache()
      })
      subscribed = true
      logger.info('[ProfileService] Subscribed to profile change notifications')
    }
  } catch (err) {
    logger.warn(`[ProfileService] Failed to subscribe to profile changes: ${err.message}`)
  }
}

module.exports = {
  getActiveProfile,
  setActiveProfile,
  loadProfileFromFile,
  getProfileHeaders,
  saveProfile,
  listProfiles,
  clearCache,
  subscribeProfileChanges
}
