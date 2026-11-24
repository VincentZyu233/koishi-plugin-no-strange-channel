import { Context, Logger } from 'koishi'
import { Config } from './config'
import { usage } from './usage'
import { MasterNotifier } from './notifier'
import { ChannelGuardHandler } from './handler'

export const name = 'no-strange-channel'

export { Config, usage }

const logger = new Logger('no-strange-channel')

export function apply(ctx: Context, config: Config) {
  logger.info('no-strange-channel 插件正在初始化...')

  // 1. 初始化主人审计通知器
  const notifier = new MasterNotifier(ctx, config)

  // 2. 初始化核心安全处理器
  const handler = new ChannelGuardHandler(ctx, config, notifier)

  // 3. 注册第一道防线：拦截入群邀请事件 (guild-request)
  ctx.on('guild-request', async (session) => {
    await handler.handleGuildRequest(session)
  })

  // 4. 注册第二道防线：拦截 Bot 被拉入新群事件 (guild-added)
  ctx.on('guild-added', async (session) => {
    await handler.handleGuildAdded(session)
  })

  // 5. 注册第三道防线：拦截未授权群发言事件巡检 (message)
  ctx.on('message', async (session) => {
    await handler.handleGroupMessage(session)
  })

  // 6. 注册状态查询快捷指令
  ctx.command('nsc', '查看陌生群拦截卫士状态与白名单列表', { authority: 3 })
    .action(() => {
      const statusText = config.enabled ? '🟢 运行中' : '🔴 已停用'
      const count = config.whitelist.length
      const listStr = count > 0 ? config.whitelist.join(', ') : '（空）'
      return [
        `🛡️ 【no-strange-channel 防御状态】`,
        `运行状态: ${statusText}`,
        `自动拒绝邀请: ${config.autoRejectInvite ? '开启' : '关闭'}`,
        `自动退出陌生群: ${config.autoLeaveGroup ? '开启' : '关闭'}`,
        `白名单群总数: ${count} 个`,
        `白名单列表: ${listStr}`,
      ].join('\n')
    })

  logger.info(`no-strange-channel 插件加载就绪，当前共授权 ${config.whitelist.length} 个白名单群聊`)
}
