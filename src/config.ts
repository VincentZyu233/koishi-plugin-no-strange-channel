import { Schema } from 'koishi'

/** 主人账号配置 */
export interface MasterAccount {
  /** 接收通知的平台名称（如 onebot、discord、kook） */
  platform: string
  /** 主人用户 ID */
  userId: string
  /** 是否启用该接收账号 */
  enabled: boolean
}

/** 插件配置结构 */
export interface Config {
  /** 是否启用核心防护功能 */
  enabled: boolean
  /** 频道/群聊白名单列表 (在 OneBot 等平台中即为纯数字群号) */
  whitelist: string[]

  /** 收到陌生群入群邀请时是否自动拒绝 */
  autoRejectInvite: boolean
  /** 拒绝入群邀请时的理由 */
  rejectReason: string

  /** 处于非白名单群或收到消息时是否自动退群 */
  autoLeaveGroup: boolean
  /** 退群前是否在群内发送一条提醒 (默认 false 关闭，建议野生 Bot 保持静默退群防举报) */
  sendNoticeBeforeLeave: boolean
  /** 退群前发送的提醒文案 */
  leaveNotice: string
  /** 同一群退群冷却防抖时长（秒），避免群内多人同时发言造成并发重复退群 */
  leaveCooldown: number

  /** 处置拦截或退群事件时是否向主人推送审计私聊 */
  notifyMaster: boolean
  /** 接收拦截报告的主人账号列表 */
  masterAccounts: MasterAccount[]
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    enabled: Schema.boolean()
      .default(true)
      .description('🛡️ 开启陌生群防御拦截核心功能'),

    whitelist: Schema.array(Schema.string())
      .role('table')
      .default(['1085190201'])
      .description('📋 授权群聊/频道 ID 白名单（在 OneBot 协议中填入 QQ 群号）'),
  }).description('🛡️ 核心开关与白名单'),

  Schema.object({
    autoRejectInvite: Schema.boolean()
      .default(true)
      .description('🚫 自动拒绝陌生群入群邀请（检测到不在白名单中的群邀请时立即拒绝）'),

    rejectReason: Schema.string()
      .default('本 Bot 未开启该群授权，已自动拒绝入群邀请。')
      .description('💬 拒绝入群申请时的理由说明'),
  }).description('🚫 陌生群邀请防御（第一道防线）'),

  Schema.object({
    autoLeaveGroup: Schema.boolean()
      .default(true)
      .description('🚪 自动退出非白名单群聊（检测到已被拉入或在非白名单群收到消息时自动退群）'),

    sendNoticeBeforeLeave: Schema.boolean()
      .default(false)
      .description('⚠️ 退群前在群内发送警告消息（默认关闭，建议野生 Bot 保持静默退群以降低风控被举报概率）'),

    leaveNotice: Schema.string()
      .default('⚠️ 检测到本群未在授权白名单内，Bot 即将自动退出。')
      .description('📢 退群前发送的提醒文案（仅在开启退群前警告时生效）'),

    leaveCooldown: Schema.number()
      .default(30)
      .min(5)
      .max(600)
      .description('⏱️ 退群防抖冷却时长（秒，避免短时间内同一群多条并发消息重复发起退群请求）'),
  }).description('🚪 陌生群退出防御（第二/三道防线）'),

  Schema.object({
    notifyMaster: Schema.boolean()
      .default(true)
      .description('👑 处置事件时私聊通知主人（将拒绝邀请、自动退群等日志实时推送给主人账号）'),

    masterAccounts: Schema.array(Schema.object({
      platform: Schema.string()
        .description('平台名称（如 onebot、discord、kook）')
        .default('onebot'),
      userId: Schema.string()
        .description('主人用户 ID')
        .default('1830540513'),
      enabled: Schema.boolean()
        .description('是否启用')
        .default(true),
    }))
      .role('table')
      .default([{ platform: 'onebot', userId: '1830540513', enabled: true }])
      .description('👑 主人接收账号列表'),
  }).description('👑 主人通知与安全审计'),
])
