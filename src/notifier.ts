import { Bot, Context, Logger } from 'koishi'
import { Config, MasterAccount } from './config'

const logger = new Logger('no-strange-channel:notifier')

export interface AuditReportData {
  platform: string
  botId: string
  targetGuildId: string
  operatorUserId?: string
  action: 'reject-invite' | 'leave-group'
  reason?: string
}

/**
 * 拦截与退群安全审计通知器
 */
export class MasterNotifier {
  constructor(
    private ctx: Context,
    private config: Config
  ) {}

  /**
   * 向所有启用的主人账号推送安全审计私聊报告
   */
  async notifyMasters(data: AuditReportData): Promise<void> {
    if (!this.config.notifyMaster) return

    const masters = this.config.masterAccounts.filter(m => m.enabled)
    if (masters.length === 0) return

    const actionText = data.action === 'reject-invite'
      ? '🚫 已自动拒绝陌生群入群邀请'
      : '🚪 已自动退出非白名单陌生群'

    const nowStr = new Date().toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })

    const lines = [
      `🛡️ 【陌生群安全防御报告】`,
      `━━━━━━━━━━━━━━━━`,
      `🌐 平台: ${data.platform}`,
      `🤖 涉及 Bot: ${data.botId}`,
      `💬 目标群号: ${data.targetGuildId}`,
      `👤 触发/邀请者: ${data.operatorUserId || '未知'}`,
      `⚡ 处置动作: ${actionText}`,
      `📝 详情/理由: ${data.reason || '非授权白名单群聊'}`,
      `⏱️ 处理时间: ${nowStr}`,
    ]

    const messageText = lines.join('\n')

    for (const master of masters) {
      // 匹配同平台的 Bot 实例下发私聊
      const candidateBots = this.ctx.bots.filter(b => b.platform === master.platform)
      if (candidateBots.length === 0) {
        logger.warn(`未找到平台 [${master.platform}] 的任何有效 Bot 实例，跳过向主人推送`)
        continue
      }

      for (const targetBot of candidateBots) {
        try {
          await this.sendDirectMessage(targetBot, master.userId, messageText)
          logger.info(`已通过 Bot [${targetBot.selfId}] 向主人 [${master.platform}:${master.userId}] 推送防御审计报告`)
        } catch (err) {
          logger.warn(`通过 Bot [${targetBot.selfId}] 向主人推送失败:`, err)
        }
      }
    }
  }

  /**
   * 底层私聊消息下发
   */
  private async sendDirectMessage(bot: Bot, userId: string, content: string): Promise<void> {
    if (typeof bot.createDirectChannel === 'function') {
      const channel = await bot.createDirectChannel(userId)
      await bot.sendMessage(channel.id, content)
    } else if (typeof (bot as any).sendPrivateMessage === 'function') {
      await (bot as any).sendPrivateMessage(userId, content)
    } else {
      await bot.sendMessage(userId, content)
    }
  }
}
