import { Context, Schema } from 'koishi'

export const name = 'no-strange-channel'

export interface Config {}

export const Config: Schema<Config> = Schema.object({})

export function apply(ctx: Context, config: Config) {
  // write your plugin here
}
