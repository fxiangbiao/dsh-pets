/**
 * The pet's local voice command set.
 *
 * A handful of short utterances are handled entirely on the client — stop
 * talking, mute, change form, cancel the running turn — so they take effect the
 * moment the transcript lands instead of costing a model round trip. Everything
 * else is a real prompt and goes to the session as before.
 *
 * Matching is deliberately strict: the *whole* utterance, once punctuation,
 * filler and a leading wake word are removed, must equal a known phrase. A
 * sentence that merely contains a keyword ("帮我停止那个服务器") is a request, not
 * a command, and is left to the model. That single rule is what keeps this from
 * hijacking conversation, and it is why no fuzzy scoring is used here.
 * @module @deepseek-ai/dsh-client-ui-pet/client/commands
 */

/** Every locally handled command. */
export type PetCommandId =
  | 'hush'
  | 'mute'
  | 'unmute'
  | 'skin'
  | 'avatar'
  | 'perform'
  | 'cancel'
  | 'pet'
  | 'home'
  | 'musicPlay'
  | 'musicPause'
  | 'musicNext'
  | 'musicStop'
  | 'musicLoud'
  | 'musicQuiet'
  | 'musicLoop'
  | 'musicShuffle'

/** One command and the exact utterances that trigger it. */
export interface PetCommand {
  readonly id: PetCommandId
  readonly phrases: readonly string[]
}

/** Leading noise a recognizer tends to prepend to a short utterance. */
const LEADING_NOISE = /^(?:嗯|呃|额|诶|哎|那个|就是|喂|嗨|哈喽|你好)+/u

/** The pet's own name is an address, not part of the instruction. */
const WAKE_WORD = /^(?:银月|小银月|月月|小月|小月亮)+/u

/**
 * Reduce a transcript to the bare instruction.
 *
 * Whitespace, punctuation and symbols go first because the recognizer's choice
 * of them is not meaningful — it writes "别说了。" for "别说了" — followed by any
 * number of leading fillers and wake words in either order ("嗯，银月，别说了").
 * @param transcript - the raw recognized text.
 * @returns the comparable instruction; '' when nothing was left.
 */
export function normalizeCommand(transcript: string): string {
  let text = transcript.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
  // Two passes: a filler can precede the wake word ("嗯银月") or follow it
  // ("银月嗯"), and one pass only strips whichever comes first.
  for (let pass = 0; pass < 2; pass += 1) {
    text = text.replace(LEADING_NOISE, '').replace(WAKE_WORD, '')
  }
  return text
}

/**
 * The command set.
 *
 * Phrases are chosen to be unambiguous at whole-utterance length: "停" and
 * "停止" mean cancel, "别说了" means stop talking, and neither is a prefix of a
 * request anyone would aim at a model. Ids are unique per phrase, which
 * `_probe/test-commands.mjs` asserts.
 */
export const COMMANDS: readonly PetCommand[] = [
  {
    id: 'hush',
    phrases: [
      '别说了', '不要说了', '别念了', '不要念了', '别讲了', '不要讲了', '别读了', '不要读了',
      '不用念了', '安静', '安静点', '安静一下', '闭嘴', '别说话', '不要说话', '别出声',
    ],
  },
  {
    id: 'mute',
    phrases: [
      '静音', '静音吧', '关掉声音', '把声音关掉', '声音关掉', '别吵', '不要吵', '别吵了',
    ],
  },
  {
    id: 'unmute',
    phrases: [
      '解除静音', '取消静音', '打开声音', '把声音打开', '可以说话了', '出声吧', '别静音了',
      '不用静音了', '恢复声音',
    ],
  },
  {
    id: 'skin',
    phrases: [
      '换皮肤', '换个皮肤', '换肤', '换个颜色', '换颜色', '变个颜色', '换个配色', '换配色', '换个色',
    ],
  },
  {
    id: 'avatar',
    phrases: [
      '换个角色', '换角色', '换个形象', '换形象', '变身', '变个身', '换个样子', '换宠物',
      '换个宠物', '换个造型',
    ],
  },
  {
    id: 'perform',
    phrases: ['表演', '表演一下', '来个才艺', '才艺表演', '跳个舞', '唱一个', '来一个', '展示一下'],
  },
  {
    id: 'cancel',
    phrases: [
      '停', '停下', '停下来', '停止', '取消', '取消任务', '停止任务', '停下任务', '别做了',
      '不要做了', '别跑了', '停下吧',
    ],
  },
  {
    id: 'pet',
    phrases: ['摸摸头', '摸摸', '摸头', '摸摸你', '摸摸头吧', '乖'],
  },
  {
    id: 'home',
    phrases: ['回到原位', '回原位', '回来', '回来吧', '复位', '回中间', '回到中间', '回去'],
  },
  // Music. Every phrase is about a *player*, never about the pet's own voice:
  // "别说了" belongs to `hush` and "别放了" to `musicStop`, and the two sets
  // share no wording, because a command that could mean either would be a coin
  // toss exactly when the user is trying to be understood.
  {
    id: 'musicPlay',
    phrases: ['放歌', '放点音乐', '播放音乐', '放音乐', '来点音乐', '听歌', '放首歌', '开音乐'],
  },
  {
    id: 'musicPause',
    phrases: ['暂停', '暂停音乐', '先暂停', '暂停一下', '暂停播放'],
  },
  {
    id: 'musicNext',
    phrases: ['下一首', '换一首', '换首歌', '下一曲', '跳过这首', '切歌'],
  },
  {
    id: 'musicStop',
    phrases: ['关掉音乐', '关闭音乐', '停止播放', '别放了', '不放音乐了', '关音乐', '不听歌了'],
  },
  {
    id: 'musicLoud',
    phrases: ['大声点', '声音大点', '音量调大', '音量大点', '大声一点', '调大音量'],
  },
  {
    id: 'musicQuiet',
    phrases: ['小声点', '声音小点', '音量调小', '音量小点', '小声一点', '调小音量'],
  },
  {
    id: 'musicLoop',
    phrases: ['循环播放', '单曲循环', '列表循环', '切换循环', '换循环模式'],
  },
  {
    id: 'musicShuffle',
    phrases: ['随机播放', '随机模式', '打乱播放', '随机听'],
  },
]

/** Phrase to command, built once so matching is a single lookup. */
const LOOKUP: ReadonlyMap<string, PetCommandId> = new Map(
  COMMANDS.flatMap(command => command.phrases.map(phrase => [phrase, command.id] as const)),
)

/**
 * Decide whether a transcript is a local command.
 * @param transcript - the raw recognized text.
 * @returns the command to run, or null when this is an ordinary prompt.
 */
export function matchCommand(transcript: string): PetCommandId | null {
  const text = normalizeCommand(transcript)
  if (text === '') return null
  return LOOKUP.get(text) ?? null
}
