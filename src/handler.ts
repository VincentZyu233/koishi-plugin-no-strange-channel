import { Bot, Context, Logger, Session } from 'koishi'
import { Config, DEFAULT_WHITELIST } from './config'
import { MasterNotifier } from './notifier'

const logger = new Logger('no-strange-channel:handler')

/**
 * 陌生群安全防御核心处理器
 */
export class ChannelGuardHandler {
  /** 退群冷却记录映射表 (guildId -> timestamp) */
  private leaveCooldownMap = new Map<string, number>()

  constructor(
    private ctx: Context,
    private config: Config,
    private notifier: MasterNotifier
  ) {}

  /**
   * 检查指定群号/频道 ID 是否在授权白名单中
   */
  isWhitelisted(channelOrGuildId?: string): boolean {
    if (!channelOrGuildId) return false
    const normalized = channelOrGuildId.trim().toLowerCase()
    const list = Array.isArray(this.config.whitelist) && this.config.whitelist.length > 0
      ? this.config.whitelist
      : DEFAULT_WHITELIST
    return list.some(item => item && item.trim().toLowerCase() === normalized)
  }

  /**
   * 拦截与处理入群邀请事件 (guild-request)
   */
  async handleGuildRequest(session: Session): Promise<void> {
    if (!this.config.enabled) return

    const targetGuildId = session.guildId || session.channelId
    if (!targetGuildId) {
      logger.warn(`收到无法识别群号的 guild-request 事件，跳过自动处理`)
      return
    }

    const operatorUserId = session.userId || session.operatorId

    // 1. 白名单放行
    if (this.isWhitelisted(targetGuildId)) {
      logger.info(`[${session.platform}] 收到针对白名单群 [${targetGuildId}] 的加群邀请 (来自: ${operatorUserId || '未知'})，白名单已通过`)
      return
    }

    // 2. 陌生群邀请自动拒绝
    if (!this.config.autoRejectInvite) {
      logger.info(`[${session.platform}] 收到非白名单群 [${targetGuildId}] 邀请，但自动拒绝功能未启用，跳过拦截`)
      return
    }

    logger.warn(`[${session.platform}] 检测到非白名单陌生群 [${targetGuildId}] 入群邀请 (邀请人: ${operatorUserId})，准备执行自动拒绝...`)

    try {
      if (typeof session.bot.handleGuildRequest === 'function') {
        await session.bot.handleGuildRequest(session.messageId, false, this.config.rejectReason)
      } else if ((session.bot.internal as any)?.setGroupAddRequest) {
        await (session.bot.internal as any).setGroupAddRequest(session.messageId, 'invite', false, this.config.rejectReason)
      } else {
        logger.error(`Bot 实例未提供 handleGuildRequest 或 setGroupAddRequest 接口，无法拒绝入群`)
        return
      }

      logger.info(`[${session.platform}] 已成功拒绝非白名单群 [${targetGuildId}] 的入群邀请！`)

      // 3. 向主人私聊上报审计日志
      await this.notifier.notifyMasters({
        platform: session.platform,
        botId: session.selfId,
        targetGuildId,
        operatorUserId,
        action: 'reject-invite',
        reason: this.config.rejectReason,
      })
    } catch (err) {
      logger.error(`[${session.platform}] 拒绝加群邀请失败 (群: ${targetGuildId}, flag: ${session.messageId}):`, err)
    }
  }

  /**
   * 拦截与处理 Bot 被加入群聊事件 (guild-added)
   */
  async handleGuildAdded(session: Session): Promise<void> {
    if (!this.config.enabled) return

    const targetGuildId = session.guildId || session.channelId
    if (!targetGuildId) return

    // 1. 白名单放行
    if (this.isWhitelisted(targetGuildId)) {
      logger.info(`[${session.platform}] Bot [${session.selfId}] 成功加入白名单群聊 [${targetGuildId}]`)
      return
    }

    // 2. 陌生群立即退群
    if (!this.config.autoLeaveGroup) {
      logger.warn(`[${session.platform}] Bot 被加入非白名单群 [${targetGuildId}]，但自动退群开关已关闭`)
      return
    }

    logger.warn(`[${session.platform}] Bot 被强行拉入非白名单群 [${targetGuildId}]，立即触发退出防御！`)
    await this.executeLeaveGroup(session.bot, targetGuildId, session.userId)
  }

  /**
   * 拦截与巡检群消息事件 (message)
   */
  async handleGroupMessage(session: Session): Promise<void> {
    if (!this.config.enabled) return
    if (session.isDirect) return

    const targetGuildId = session.guildId || session.channelId
    if (!targetGuildId) return

    // 1. 白名单放行
    if (this.isWhitelisted(targetGuildId)) return

    // 2. 陌生群自动退群
    if (!this.config.autoLeaveGroup) return

    // 3. 防抖检查
    const now = Date.now()
    const cooldownMs = (this.config.leaveCooldown || 30) * 1000
    const lastLeaveTime = this.leaveCooldownMap.get(targetGuildId) || 0

    if (now - lastLeaveTime < cooldownMs) {
      return // 仍在防抖冷却中，不重复触发
    }

    this.leaveCooldownMap.set(targetGuildId, now)
    logger.warn(`[${session.platform}] 在非白名单群 [${targetGuildId}] 收到发言，触发保底自动退群巡检！`)
    await this.executeLeaveGroup(session.bot, targetGuildId, session.userId)
  }

  /**
   * 执行退出群聊全链路操作
   */
  private async executeLeaveGroup(bot: Bot, guildId: string, operatorUserId?: string): Promise<void> {
    // 1. 发送退群前告警（若开启）
    if (this.config.sendNoticeBeforeLeave && this.config.leaveNotice) {
      try {
        await bot.sendMessage(guildId, this.config.leaveNotice)
        await new Promise(r => setTimeout(r, 600)) // 等待消息落地
      } catch (err) {
        logger.warn(`发送退群前告警消息失败 (群: ${guildId}):`, err)
      }
    }

    // 2. 多级探测并执行退群
    let leaveSuccess = false

    // 方案 A: OneBot 协议端原生 setGroupLeave
    try {
      if ((bot.internal as any)?.setGroupLeave) {
        await (bot.internal as any).setGroupLeave(guildId, false)
        leaveSuccess = true
      } else if (typeof (bot.internal as any)?._request === 'function') {
        await (bot.internal as any)._request('set_group_leave', { group_id: Number(guildId) })
        leaveSuccess = true
      }
    } catch (err) {
      logger.warn(`调用 OneBot setGroupLeave 失败:`, err)
    }

    // 方案 B: 通用 Satori/扩展 API 探测兜底
    if (!leaveSuccess) {
      try {
        if (typeof (bot as any).leaveGuild === 'function') {
          await (bot as any).leaveGuild(guildId)
          leaveSuccess = true
        } else if (typeof (bot as any).deleteGuild === 'function') {
          await (bot as any).deleteGuild(guildId)
          leaveSuccess = true
        }
      } catch (err) {
        logger.warn(`调用通用 leaveGuild/deleteGuild 失败:`, err)
      }
    }

    if (leaveSuccess) {
      logger.info(`[${bot.platform}] Bot [${bot.selfId}] 已成功退出非白名单群 [${guildId}]！`)
      // 3. 向主人私聊上报审计日志
      await this.notifier.notifyMasters({
        platform: bot.platform,
        botId: bot.selfId,
        targetGuildId: guildId,
        operatorUserId,
        action: 'leave-group',
        reason: '检测到非白名单陌生群，已自动安全退出',
      })
    } else {
      logger.error(`[${bot.platform}] 退出群 [${guildId}] 失败，当前适配器未支持对应退群 API`)
    }
  }
}
