/**
 * Simulation Profile 管理 API 路由
 * 管理 Claude Code 版本 Profile（热更新、查看、切换）
 */

const express = require('express')
const { authenticateAdmin } = require('../../middleware/auth')
const profileService = require('../../services/simulation/profileService')
const logger = require('../../utils/logger')

const router = express.Router()

/**
 * GET /admin/simulation/profiles
 * 列出所有可用 profile
 */
router.get('/simulation/profiles', authenticateAdmin, async (req, res) => {
  try {
    const versions = await profileService.listProfiles()
    return res.json({ success: true, profiles: versions })
  } catch (error) {
    logger.error('❌ Failed to list simulation profiles:', error)
    return res.status(500).json({
      error: 'Failed to list profiles',
      message: error.message
    })
  }
})

/**
 * GET /admin/simulation/profiles/:version
 * 查看指定版本的 profile
 */
router.get('/simulation/profiles/:version', authenticateAdmin, async (req, res) => {
  try {
    const { version } = req.params
    const profile = profileService.loadProfileFromFile(
      require('path').resolve(__dirname, `../../services/simulation/profiles/${version}.json`)
    )
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' })
    }
    return res.json({ success: true, profile })
  } catch (error) {
    logger.error('❌ Failed to get simulation profile:', error)
    return res.status(500).json({
      error: 'Failed to get profile',
      message: error.message
    })
  }
})

/**
 * POST /admin/simulation/profiles
 * 创建或更新 profile
 */
router.post('/simulation/profiles', authenticateAdmin, async (req, res) => {
  try {
    const profileData = req.body
    if (!profileData.version) {
      return res.status(400).json({ error: 'Missing required field: version' })
    }

    await profileService.saveProfile(profileData.version, profileData)
    logger.info(`[SimulationAdmin] Profile saved: ${profileData.version}`)
    return res.json({ success: true, version: profileData.version })
  } catch (error) {
    logger.error('❌ Failed to save simulation profile:', error)
    return res.status(500).json({
      error: 'Failed to save profile',
      message: error.message
    })
  }
})

/**
 * PUT /admin/simulation/active
 * 切换活跃版本
 */
router.put('/simulation/active', authenticateAdmin, async (req, res) => {
  try {
    const { version } = req.body
    if (!version) {
      return res.status(400).json({ error: 'Missing required field: version' })
    }

    await profileService.setActiveProfile(version)
    logger.info(`[SimulationAdmin] Active profile switched to: ${version}`)
    return res.json({ success: true, activeVersion: version })
  } catch (error) {
    logger.error('❌ Failed to set active simulation profile:', error)
    return res.status(500).json({
      error: 'Failed to set active profile',
      message: error.message
    })
  }
})

module.exports = router
