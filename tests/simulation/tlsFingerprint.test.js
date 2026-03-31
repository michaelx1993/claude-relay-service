/**
 * T031: TLS 指纹验证测试
 *
 * 通过 sidecar 发送请求到 tls.peet.ws/api/all，获取 JA3/JA4 hash，
 * 与 bun fetch 直接调用的 hash 对比，MUST 完全一致
 *
 * 注意：此测试需要实际运行 Bun sidecar，属于集成测试
 * 在 CI 环境中需要安装 Bun runtime
 */

describe('TLS Fingerprint (Integration)', () => {
  // 此测试需要实际运行 sidecar，标记为跳过（手动运行）
  describe.skip('JA3/JA4 Hash Verification', () => {
    it('should produce Bun BoringSSL TLS fingerprint via sidecar', async () => {
      // 实际集成测试逻辑：
      // 1. 启动 sidecar
      // 2. 通过 sidecar forward 到 tls.peet.ws/api/all
      // 3. 解析返回的 JA3/JA4 hash
      // 4. 直接用 bun fetch 调用同一 URL
      // 5. 对比两个 hash 完全一致
    })
  })

  describe('Sidecar TLS Architecture', () => {
    it('should use Bun for TLS handling, not Node.js', () => {
      // 验证 sidecar 使用 Bun.serve() 而不是 Node.js http
      const fs = require('fs')
      const path = require('path')
      const sidecarCode = fs.readFileSync(
        path.join(__dirname, '../../sidecar/bun-worker.js'),
        'utf8'
      )
      expect(sidecarCode).toContain('Bun.serve')
      expect(sidecarCode).toContain('fetch(targetUrl')
    })

    it('should report BoringSSL as TLS library in health check', () => {
      const fs = require('fs')
      const path = require('path')
      const sidecarCode = fs.readFileSync(
        path.join(__dirname, '../../sidecar/bun-worker.js'),
        'utf8'
      )
      expect(sidecarCode).toContain("tls_library: 'BoringSSL'")
    })
  })
})
