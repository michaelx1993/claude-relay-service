/**
 * Profile Extractor — 从 Claude Code 源码自动提取 Profile 配置
 *
 * 读取指定版本源码目录中的关键文件，提取：
 * - beta_flags（从 constants/betas.ts + utils/betas.ts）
 * - user_agent 模板（从 utils/http.ts 或 utils/userAgent.ts）
 * - fingerprint_salt（从 utils/fingerprint.ts）
 * - version（从 package.json）
 *
 * 用于快速生成新版本 profile JSON 文件
 */

const fs = require('fs')
const path = require('path')
const logger = require('../../utils/logger')

/**
 * 从源码目录提取 profile 配置
 * @param {string} srcPath - 源码根目录（如 /path/to/2.1.88-src）
 * @returns {object|null} profile JSON
 */
function extractProfileFromSource(srcPath) {
  try {
    if (!fs.existsSync(srcPath)) {
      logger.error(`[ProfileExtractor] Source path not found: ${srcPath}`)
      return null
    }

    const profile = {
      version: extractVersion(srcPath),
      user_agent: null,
      api_version: '2023-06-01',
      beta_flags: [],
      fingerprint_salt: null,
      stainless: {
        lang: 'javascript',
        runtime: 'bun',
        runtime_version: '1.2.5',
        os: 'Mac OS X',
        arch: 'arm64',
        package_version: '0.39.0'
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

    // 提取 version
    if (profile.version) {
      profile.user_agent = `claude-cli/${profile.version} (external, cli)`
    }

    // 提取 fingerprint salt
    profile.fingerprint_salt = extractFingerprintSalt(srcPath)

    // 提取 beta flags
    profile.beta_flags = extractBetaFlags(srcPath)

    // 提取 stainless package version
    const stainlessVersion = extractStainlessVersion(srcPath)
    if (stainlessVersion) {
      profile.stainless.package_version = stainlessVersion
    }

    // 提取 api_version
    const apiVersion = extractApiVersion(srcPath)
    if (apiVersion) {
      profile.api_version = apiVersion
    }

    return profile
  } catch (err) {
    logger.error(`[ProfileExtractor] Failed to extract profile: ${err.message}`)
    return null
  }
}

/**
 * 从 package.json 提取版本号
 */
function extractVersion(srcPath) {
  try {
    const pkgPath = path.join(srcPath, 'package.json')
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
      return pkg.version || null
    }
  } catch (_e) {
    /* ignore */
  }
  return null
}

/**
 * 从 utils/fingerprint.ts 提取 FINGERPRINT_SALT
 */
function extractFingerprintSalt(srcPath) {
  const candidates = [
    path.join(srcPath, 'src/utils/fingerprint.ts'),
    path.join(srcPath, 'src/utils/fingerprint.js')
  ]

  for (const filePath of candidates) {
    try {
      if (!fs.existsSync(filePath)) continue
      const content = fs.readFileSync(filePath, 'utf8')

      // 匹配 FINGERPRINT_SALT = 'xxx' 或 const SALT = 'xxx'
      const match = content.match(/(?:FINGERPRINT_SALT|SALT)\s*=\s*['"]([a-f0-9]+)['"]/)
      if (match) {
        return match[1]
      }
    } catch (_e) {
      /* ignore */
    }
  }
  return null
}

/**
 * 从 constants/betas.ts 和 utils/betas.ts 提取 beta flags
 */
function extractBetaFlags(srcPath) {
  const flags = new Set()

  const betaFiles = [
    path.join(srcPath, 'src/constants/betas.ts'),
    path.join(srcPath, 'src/utils/betas.ts')
  ]

  for (const filePath of betaFiles) {
    try {
      if (!fs.existsSync(filePath)) continue
      const content = fs.readFileSync(filePath, 'utf8')

      // 匹配 BETA_HEADER = 'xxx-xxx-YYYY-MM-DD' 模式
      const headerMatches = content.matchAll(/BETA_HEADER\s*=\s*['"]([a-z0-9-]+)['"]/g)
      for (const m of headerMatches) {
        flags.add(m[1])
      }

      // 匹配直接的字符串字面量 'xxx-xxx-YYYY-MM-DD' 在数组或 join 调用中
      const arrayMatches = content.matchAll(/'([a-z][a-z0-9-]*-\d{4}-\d{2}-\d{2})'/g)
      for (const m of arrayMatches) {
        flags.add(m[1])
      }
    } catch (_e) {
      /* ignore */
    }
  }

  return [...flags].sort()
}

/**
 * 从 package.json dependencies 提取 @anthropic-ai/sdk 版本
 */
function extractStainlessVersion(srcPath) {
  try {
    const pkgPath = path.join(srcPath, 'package.json')
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      const sdkVersion = deps['@anthropic-ai/sdk']
      if (sdkVersion) {
        // 移除版本前缀 ^, ~, =
        return sdkVersion.replace(/^[^0-9]*/, '')
      }
    }
  } catch (_e) {
    /* ignore */
  }
  return null
}

/**
 * 从代码中提取 anthropic-version
 */
function extractApiVersion(srcPath) {
  const candidates = [
    path.join(srcPath, 'src/utils/http.ts'),
    path.join(srcPath, 'src/constants/api.ts')
  ]

  for (const filePath of candidates) {
    try {
      if (!fs.existsSync(filePath)) continue
      const content = fs.readFileSync(filePath, 'utf8')
      const match = content.match(/anthropic-version['"]\s*:\s*['"](\d{4}-\d{2}-\d{2})['"]/)
      if (match) {
        return match[1]
      }
    } catch (_e) {
      /* ignore */
    }
  }
  return null
}

module.exports = {
  extractProfileFromSource
}
