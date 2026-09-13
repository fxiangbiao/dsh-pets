/**
 * Locale dictionary for the pet widget. Every product-visible string the pet
 * renders (titles, status, personality lines, voice labels, accessibility
 * names) lives here and reaches the component through the standard `t` seat.
 * @module @deepseek-ai/dsh-client-ui-pet/client/locales
 */

/** The locale namespace this plugin owns. */
export const NS = 'pet'

/** Stable dictionary keys; the union is what the LocaleNamespaceMap merge exposes. */
export type PetKey =
  | 'avatar.whale'
  | 'avatar.robot'
  | 'avatar.silverMoon'
  | 'avatar.switch'
  | 'status.idle'
  | 'status.running'
  | 'status.error'
  | 'status.waiting'
  | 'status.noSession'
  | 'status.connected'
  | 'tool.running'
  | 'queue.count'
  | 'progress.step'
  | 'emotion.calm'
  | 'emotion.happy'
  | 'emotion.satisfied'
  | 'emotion.focused'
  | 'emotion.busy'
  | 'emotion.frustrated'
  | 'emotion.concerned'
  | 'mood.idle'
  | 'mood.happy'
  | 'mood.excited'
  | 'mood.thinking'
  | 'mood.working'
  | 'mood.listen'
  | 'mood.confused'
  | 'mood.sleepy'
  | 'mood.frustrated'
  | 'mood.cute'
  | 'mood.talk'
  | 'skin.classic'
  | 'skin.sakura'
  | 'skin.mint'
  | 'skin.midnight'
  | 'skin.gold'
  | 'bond.gain'
  | 'bond.levelUp'
  | 'tool.act.read'
  | 'tool.act.search'
  | 'tool.act.think'
  | 'tool.act.edit'
  | 'tool.act.run'
  | 'tool.act.delegate'
  | 'tool.act.other'
  | 'result.error'
  | 'result.maxTokens'
  | 'result.aborted'
  | 'result.interrupted'
  | 'greeting.whale'
  | 'greeting.robot'
  | 'greeting.silverMoon'
  | 'voice.listen'
  | 'voice.stop'
  | 'voice.speak'
  | 'voice.notSupported'
  | 'voice.micBlocked'
  | 'voice.micBusy'
  | 'voice.insecure'
  | 'voice.noDevice'
  | 'voice.cloudBlocked'
  | 'voice.heardNothing'
  | 'voice.downloading'
  | 'voice.downloadPending'
  | 'voice.offlineStalled'
  | 'voice.noSpeech'
  | 'voice.error'
  | 'voice.failedSend'
  | 'voice.internal'
  | 'voice.cannotSpeak'
  | 'voice.speakFailed'
  | 'voice.armed'
  | 'voice.spoke'
  | 'voice.noVoice'
  | 'voice.mutedNote'
  | 'voice.nothingToSay'
  | 'voice.spokeNeural'
  | 'voice.neuralFailed'
  | 'voice.aria'
  | 'cmd.hush'
  | 'cmd.mute'
  | 'cmd.unmute'
  | 'cmd.skin'
  | 'cmd.avatar'
  | 'cmd.perform'
  | 'cmd.performStop'
  | 'cmd.cancel'
  | 'cmd.cancelIdle'
  | 'cmd.pet'
  | 'cmd.home'
  | 'bond.title.1'
  | 'bond.title.2'
  | 'bond.title.3'
  | 'bond.title.4'
  | 'bond.title.5'
  | 'bond.status'
  | 'bond.pets'
  | 'bond.achievements'
  | 'bond.next'
  | 'bond.allDone'
  | 'ach.firstTouch'
  | 'ach.goodFriend'
  | 'ach.inseparable'
  | 'ach.patron'
  | 'ach.chatty'
  | 'ach.chameleon'
  | 'ach.threeFaces'
  | 'ach.obedient'
  | 'ach.unlocked'
  | 'ach.unlockedMany'
  | 'action.bond'
  | 'action.clear'
  | 'action.cancel'
  | 'action.aria'
  | 'action.voice'
  | 'action.stopListening'
  | 'action.avatar'
  | 'action.perform'
  | 'action.skin'
  | 'action.pet'
  | 'action.type'
  | 'action.more'
  | 'action.less'
  | 'action.copy'
  | 'action.stt'
  | 'stt.placeholder'
  | 'stt.save'
  | 'stt.saved'
  | 'stt.recording'
  | 'stt.empty'
  | 'stt.noAudio'
  | 'stt.silentMic'
  | 'stt.unrecognized'
  | 'stt.failed'
  | 'stt.none'
  | 'stt.uploading'
  | 'stt.pick'
  | 'input.placeholder'
  | 'input.send'
  | 'input.empty'
  | 'music.aria'
  | 'music.playing'
  | 'music.paused'
  | 'music.loading'
  | 'music.pause'
  | 'music.play'
  | 'music.prev'
  | 'music.next'
  | 'music.loopAll'
  | 'music.loopOne'
  | 'music.loopOff'
  | 'music.loop'
  | 'music.close'
  | 'music.open'
  | 'music.drag'
  | 'music.folder'
  | 'music.rootsUnknown'
  | 'music.rootsScanning'
  | 'music.folderReplace'
  | 'music.folderAdd'
  | 'music.folderDefault'
  | 'music.noPicker'
  | 'music.rootsSame'
  | 'music.rootsFailed'
  | 'music.shuffle'
  | 'music.none'
  | 'music.serviceDown'
  | 'music.denied'
  | 'music.decode'
  | 'music.unsupported'
  | 'music.empty'
  | 'music.unknown'
  | 'music.videoNote'
  | 'cmd.musicPlay'
  | 'cmd.musicPause'
  | 'cmd.musicNext'
  | 'cmd.musicStop'
  | 'cmd.musicClose'
  | 'cmd.musicRoots'
  | 'cmd.musicDefault'
  | 'pet.crash'
  | 'pet.retry'
  | 'cmd.musicLoud'
  | 'cmd.musicQuiet'
  | 'cmd.musicLoop'
  | 'cmd.musicShuffle'
  | 'perform.whale'
  | 'perform.robot'
  | 'perform.silverMoon'
  | 'panel.aria'
  | 'panel.toggle'
  | 'panel.close'
  | 'activity.aria'
  | 'activity.empty'
  | 'activity.user'
  | 'activity.assistant'
  | 'activity.tool'
  | 'activity.turn'
  | 'activity.error'

/** Simplified Chinese copy. */
export const zh: Record<PetKey, string> = {
  'avatar.whale': '鲸鱼娘',
  'avatar.robot': '探机器',
  'avatar.silverMoon': '银月',
  'avatar.switch': '切换形象',
  'status.idle': '待命中',
  'status.running': '正在干活',
  'status.error': '遇到问题',
  'status.waiting': '思考中',
  'status.noSession': '尚未选择会话',
  'status.connected': '已连接工作区',
  'tool.running': '正在调用工具：{tool}',
  'queue.count': '队列 {count} 项',
  'progress.step': '第 {step} 步',
  'emotion.calm': '状态平稳',
  'emotion.happy': '心情不错',
  'emotion.satisfied': '挺满意的',
  'emotion.focused': '正专注干活',
  'emotion.busy': '有点忙',
  'emotion.frustrated': '有些烦躁',
  'emotion.concerned': '有点担心',
  'mood.idle': '陪着你，慢慢来。',
  'mood.happy': '嘿嘿，状态不错！',
  'mood.excited': '搞定啦，为你欢呼！',
  'mood.thinking': '让我想想……',
  'mood.working': '正在卖力干活~',
  'mood.listen': '我在听，你说。',
  'mood.confused': '嗯？有点摸不着头脑。',
  'mood.sleepy': '有点电量不足了…',
  'mood.frustrated': '哼，有点小烦。',
  'mood.cute': '夸夸我嘛~',
  'mood.talk': '我在说啦，听好哦~',
  'skin.classic': '经典',
  'skin.sakura': '樱花',
  'skin.mint': '薄荷',
  'skin.midnight': '暗夜',
  'skin.gold': '鎏金',
  'bond.gain': '摸摸 +1 · 亲密 {bond}',
  'bond.levelUp': '亲密升级！Lv.{level}',
  'tool.act.read': '翻资料中…',
  'tool.act.search': '找线索中…',
  'tool.act.think': '琢磨一下…',
  'tool.act.edit': '动手改文件…',
  'tool.act.run': '跑命令中…',
  'tool.act.delegate': '派小助手去办…',
  'tool.act.other': '干活中…',
  'result.error': '出错了，我盯着呢。',
  'result.maxTokens': '上下文塞满了，该清一清了…',
  'result.aborted': '任务被中止了。',
  'result.interrupted': '被打断了，等你继续。',
  'greeting.whale': '嗨，我是鲸鱼娘。放心把任务交给我，我们一步步办妥！',
  'greeting.robot': '您好，探机器人待命。任务进度已同步，随时听候指令。',
  'greeting.silverMoon': '月华所至，皆为我眼。本座陪你观棋、破局。',
  'voice.listen': '点击说话',
  'voice.stop': '停止聆听',
  'voice.speak': '朗读最新回复',
  'voice.notSupported': '浏览器不支持语音，改用打字吧。',
  'voice.micBlocked': '麦克风被浏览器阻止了。点地址栏左侧的图标 → 麦克风 → 允许，然后刷新页面再点一次。',
  'voice.micBusy': '麦克风被别的程序占用了。关掉正在用麦克风的软件（或旧标签页）后再试。',
  'voice.insecure': '当前不是安全上下文（需 https 或 127.0.0.1），麦克风不可用。',
  'voice.noDevice': '没有检测到麦克风设备。',
  'voice.cloudBlocked': '语音识别连不上（Chrome 走 Google 云服务，国内常被墙）。可换 Edge 试试，或点键盘图标直接输入。',
  'voice.heardNothing': '没拿到识别结果。Chrome 的语音识别依赖 Google 云服务（国内常被墙）——可用 Edge 打开本页，或点键盘图标直接输入。',
  'voice.downloading': '正在下载离线中文语音包（只需一次），稍后即可离线识别…',
  'voice.downloadPending': '离线语音包还在下载，装好后直接点麦克风即可（也可先用键盘输入）。',
  'voice.offlineStalled': '离线语音包下载同样被阻断（源也是 Google），本机装不了离线识别。建议：① 换 Edge 打开本页；② 点键盘图标直接输入。',
  'voice.noSpeech': '没有听到声音，请靠近麦克风再试。',
  'voice.error': '没听清，再试一次吧。',
  'voice.failedSend': '发送失败，请检查当前会话。',
  'voice.internal': '语音在第「{stage}」步出错：{reason}',
  'voice.cannotSpeak': '系统里没装中文语音包，念不出来。回复在聊天区里。',
  'voice.speakFailed': '语音播报失败了（{reason}）。回复在聊天区里。',
  'voice.armed': '🎤 收到语音提问，回复会用语音念出来。',
  'voice.spoke': '🔊 正在用「{voice}」朗读（{chars} 字）',
  'voice.noVoice': '🔇 朗读失败：浏览器里找不到可用的中文语音。',
  'voice.mutedNote': '🔇 宠物处于静音状态，所以不朗读。',
  'voice.nothingToSay': '🔇 这一轮没有可朗读的文字。',
  'voice.spokeNeural': '🔊 正在用神经语音朗读（{chars} 字，{sentences} 句逐句播放）',
  'voice.neuralFailed': '神经语音不可用：{reason}',
  'voice.aria': '宠物语音输入',
  'cmd.hush': '🤫 好，我不说了。',
  'cmd.mute': '🔇 好，我安静了（说「解除静音」我就回来）。',
  'cmd.unmute': '🔊 我又能说话了。',
  'cmd.skin': '🎨 换成「{name}」配色',
  'cmd.avatar': '✨ 变身成「{name}」',
  'cmd.perform': '🎪 好，看我表演！',
  'cmd.performStop': '🎪 表演结束，谢谢捧场～',
  'cmd.cancel': '🛑 已经叫停了当前任务。',
  'cmd.cancelIdle': '🛑 现在没有在跑的任务，我先闭嘴。',
  'cmd.pet': '💗 嘿嘿…再摸摸。',
  'cmd.home': '📍 回到原位了。',
  'bond.title.1': '初识',
  'bond.title.2': '熟悉',
  'bond.title.3': '亲近',
  'bond.title.4': '挚友',
  'bond.title.5': '家人',
  'bond.status': '💗 亲密度 Lv.{level}「{title}」',
  'bond.pets': '{bond} 次抚摸',
  'bond.achievements': '🏆 成就 {done}/{total}',
  'bond.next': '下一个成就：{name}',
  'bond.allDone': '🏆 成就已经全部收集完了，你真厉害。',
  'ach.firstTouch': '初次相认 · 第一次摸摸头',
  'ach.goodFriend': '好朋友 · 摸头 20 次',
  'ach.inseparable': '形影不离 · 摸头 50 次',
  'ach.patron': '忠实观众 · 看它表演 5 次',
  'ach.chatty': '有话直说 · 语音对话 10 次',
  'ach.chameleon': '百变小宠 · 穿遍 5 套配色',
  'ach.threeFaces': '三副面孔 · 三个形象都用过',
  'ach.obedient': '听话的宠物 · 用一次语音指令',
  'ach.unlocked': '🏆 解锁成就：{name}',
  'ach.unlockedMany': '🏆 一次解锁 {count} 个成就：{names}',
  'action.bond': '亲密度 / 成就',
  'action.clear': '清空活动',
  'action.cancel': '停止当前任务',
  'action.aria': '宠物操作',
  'action.voice': '语音对话',
  'action.stopListening': '结束聆听',
  'action.avatar': '切换形象',
  'action.perform': '才艺表演',
  'action.skin': '换配色',
  'action.pet': '摸摸它',
  'action.type': '键盘输入',
  'action.more': '更多动作',
  'action.less': '收起动作',
  'action.copy': '复制状态',
  'action.stt': '本地语音设置',
  'stt.placeholder': '本地语音服务地址（留空自动检测）',
  'stt.save': '保存',
  'stt.saved': '已保存，下次点麦克风就用它。',
  'stt.recording': '🎙️ 正在录音…说完再点一次麦克风。（语音指令：别说了 / 换个皮肤 / 换个角色 / 停）',
  'stt.empty': '没听清内容，再说一次试试。',
  'stt.noAudio': '录音设备没有返回任何音频数据。麦克风可能没真正打开 —— 这是设备问题。',
  'stt.silentMic': '麦克风全程静音（峰值 {peak}）。这是录音设备的问题，不是识别的问题。',
  'stt.unrecognized': '录到了声音（峰值 {peak}），但没识别出内容。靠近麦克风、说清楚一点再试。',
  'stt.failed': '本地语音服务调用失败：{reason}',
  'stt.none': '没找到本地语音服务。点键盘图标 → ⚙ 填地址，或先启动本地 Whisper 服务。',
  'stt.uploading': '正在转写音频，稍等…',
  'stt.pick': '选择音频文件转写',
  'input.placeholder': '输入要说的话…',
  'input.send': '发送',
  'input.empty': '还没输入内容呢。',
  'music.aria': '本机音乐',
  'music.playing': '正在播放：{track}',
  'music.paused': '已暂停：{track}',
  'music.loading': '正在准备音乐…',
  'music.pause': '暂停',
  'music.play': '播放',
  'music.prev': '上一首',
  'music.next': '下一首',
  'music.loopAll': '列表循环',
  'music.loopOne': '单曲循环',
  'music.loopOff': '播完停止',
  'music.loop': '循环方式',
  'music.close': '关闭播放机',
  'music.open': '打开播放机',
  'music.drag': '按住拖动可移动位置',
  'music.folder': '播放目录',
  'music.rootsUnknown': '还没读到目录',
  'music.rootsScanning': '正在重新扫描目录…',
  'music.folderReplace': '换目录…',
  'music.folderAdd': '添加目录…',
  'music.folderDefault': '恢复默认',
  'music.noPicker': '这个界面没装目录选择器，改不了目录。',
  'music.rootsSame': '这个目录已经在扫了。',
  'music.rootsFailed': '换目录没成功：音乐服务没收下。',
  'music.shuffle': '随机播放',
  'music.none': '还没有选歌。',
  'music.serviceDown': '没找到音乐服务',
  'music.denied': '浏览器不让自动播放，先点一下播放键。',
  'music.decode': '这个文件解不开，换个格式试试。',
  'music.unsupported': '浏览器不支持这个格式：{detail}',
  'music.empty': '曲库是空的：{detail}',
  'music.unknown': '播放出问题了：{detail}',
  'music.videoNote': '含视频，只放声音',
  'cmd.musicPlay': '🎵 好，放点音乐～',
  'cmd.musicPause': '🎵 先暂停一下。',
  'cmd.musicNext': '🎵 换一首，走起。',
  'cmd.musicStop': '🎵 关掉音乐了。',
  'cmd.musicClose': '🎵 播放机收起来了，再移入宠物就能打开。',
  'cmd.musicRoots': '🎵 目录换了，现在有 {count} 首。',
  'cmd.musicDefault': '🎵 回到服务自己配的目录了。',
  'pet.crash': '宠物出错了',
  'pet.retry': '点一下重试（详情在悬停提示和 console 里）',
  'cmd.musicLoud': '🎵 音量调大一点。',
  'cmd.musicQuiet': '🎵 音量调小一点。',
  'cmd.musicLoop': '🎵 循环方式：{mode}',
  'cmd.musicShuffle': '🎵 随机播放：{mode}',
  'perform.whale': '看我的鲸鱼舞！',
  'perform.robot': '机械舞，走起！',
  'perform.silverMoon': '月华一转，琉璃舞！',
  'panel.aria': 'DeepSeek 电子宠物助手',
  'panel.toggle': '收起 / 展开',
  'panel.close': '收起到角落',
  'activity.aria': '最近任务动态',
  'activity.empty': '还没有动态，说句话开始吧。',
  'activity.user': '你',
  'activity.assistant': '助手',
  'activity.tool': '工具',
  'activity.turn': '回合',
  'activity.error': '异常',
}

/** English copy. */
export const en: Record<PetKey, string> = {
  'avatar.whale': 'Whale Girl',
  'avatar.robot': 'Probe-Bot',
  'avatar.silverMoon': 'Silver Moon',
  'avatar.switch': 'Switch form',
  'status.idle': 'On standby',
  'status.running': 'Working',
  'status.error': 'Facing an issue',
  'status.waiting': 'Thinking',
  'status.noSession': 'No session selected',
  'status.connected': 'Workspace connected',
  'tool.running': 'Running tool: {tool}',
  'queue.count': '{count} queued',
  'progress.step': 'Step {step}',
  'emotion.calm': 'Calm',
  'emotion.happy': 'Happy',
  'emotion.satisfied': 'Satisfied',
  'emotion.focused': 'Focused',
  'emotion.busy': 'Busy',
  'emotion.frustrated': 'Frustrated',
  'emotion.concerned': 'Concerned',
  'mood.idle': 'Staying by your side.',
  'mood.happy': 'Feeling great!',
  'mood.excited': 'Done — hurray!',
  'mood.thinking': 'Let me think…',
  'mood.working': 'Busy working~',
  'mood.listen': 'Listening.',
  'mood.confused': 'Hmm, a bit puzzled.',
  'mood.sleepy': 'Running low…',
  'mood.frustrated': 'Ugh, a little annoyed.',
  'mood.cute': 'Praise me~',
  'mood.talk': 'Talking here — listen up~',
  'skin.classic': 'Classic',
  'skin.sakura': 'Sakura',
  'skin.mint': 'Mint',
  'skin.midnight': 'Midnight',
  'skin.gold': 'Gilded',
  'bond.gain': 'Pet +1 · Bond {bond}',
  'bond.levelUp': 'Bond up! Lv.{level}',
  'tool.act.read': 'Digging through files…',
  'tool.act.search': 'Hunting for clues…',
  'tool.act.think': 'Mulling it over…',
  'tool.act.edit': 'Editing files…',
  'tool.act.run': 'Running a command…',
  'tool.act.delegate': 'Sending a helper…',
  'tool.act.other': 'Working…',
  'result.error': 'Something broke — I am watching it.',
  'result.maxTokens': 'Context is full; time to trim…',
  'result.aborted': 'The task was aborted.',
  'result.interrupted': 'Interrupted — waiting for you.',
  'greeting.whale': 'Hi, I am Whale Girl. Hand me the tasks and we will get them done, step by step!',
  'greeting.robot': 'Hello, Probe-Bot on standby. Progress synced — awaiting your next instruction.',
  'greeting.silverMoon': 'Where moonlight reaches, my eyes follow. I shall watch the board and break the deadlock with you.',
  'voice.listen': 'Tap to talk',
  'voice.stop': 'Stop listening',
  'voice.speak': 'Read the last reply aloud',
  'voice.notSupported': 'Speech is not supported here; type instead.',
  'voice.micBlocked': 'The browser is blocking the microphone. Click the icon left of the address bar → Microphone → Allow, then reload and tap again.',
  'voice.micBusy': 'Another app (or an old tab) is holding the microphone. Close it and try again.',
  'voice.insecure': 'Not a secure context (needs https or 127.0.0.1) — the mic stays off.',
  'voice.noDevice': 'No microphone device was found.',
  'voice.cloudBlocked': 'Speech service unreachable (Chrome uses Google cloud, often blocked). Try Edge, or use the keyboard icon to type.',
  'voice.heardNothing': 'No transcript came back. Chrome speech depends on Google cloud (often blocked) — open this page in Edge, or use the keyboard icon.',
  'voice.downloading': 'Downloading the offline Chinese speech pack (one time) — offline recognition follows…',
  'voice.downloadPending': 'The offline speech pack is still downloading — tap the mic again once it lands (or type meanwhile).',
  'voice.offlineStalled': 'The offline pack download is blocked too (same Google servers), so on-device speech cannot install here. Try Edge, or use the keyboard icon.',
  'voice.noSpeech': 'No sound heard — get closer to the mic and retry.',
  'voice.error': "Didn't catch that — try again.",
  'voice.failedSend': "Couldn't send — check the current session.",
  'voice.internal': 'Voice failed at stage "{stage}": {reason}',
  'voice.cannotSpeak': 'No Chinese voice is installed, so the reply could not be read aloud.',
  'voice.speakFailed': 'Reading the reply aloud failed ({reason}).',
  'voice.armed': '🎤 Voice prompt received — the reply will be read aloud.',
  'voice.spoke': '🔊 Reading aloud with "{voice}" ({chars} chars)',
  'voice.noVoice': '🔇 Read-aloud failed: no usable Chinese voice in this browser.',
  'voice.mutedNote': '🔇 The pet is muted, so nothing is read aloud.',
  'voice.nothingToSay': '🔇 This turn produced no speakable text.',
  'voice.spokeNeural': '🔊 Reading aloud with the neural voice ({chars} chars, {sentences} sentences)',
  'voice.neuralFailed': 'Neural voice unavailable: {reason}',
  'voice.aria': 'Pet voice input',
  'cmd.hush': '🤫 All right, I will be quiet.',
  'cmd.mute': '🔇 Muted — say “unmute” and I am back.',
  'cmd.unmute': '🔊 I can talk again.',
  'cmd.skin': '🎨 Recoloured to “{name}”',
  'cmd.avatar': '✨ Changed into “{name}”',
  'cmd.perform': '🎪 Watch this!',
  'cmd.performStop': '🎪 That is the whole show — thanks for watching.',
  'cmd.cancel': '🛑 Stopped the running task.',
  'cmd.cancelIdle': '🛑 Nothing is running, so I will just stop talking.',
  'cmd.pet': '💗 Hehe… again, please.',
  'cmd.home': '📍 Back where I started.',
  'bond.title.1': 'Just met',
  'bond.title.2': 'Familiar',
  'bond.title.3': 'Close',
  'bond.title.4': 'Best friend',
  'bond.title.5': 'Family',
  'bond.status': '💗 Bond Lv.{level} “{title}”',
  'bond.pets': '{bond} pets',
  'bond.achievements': '🏆 {done}/{total} achievements',
  'bond.next': 'Next: {name}',
  'bond.allDone': '🏆 Every achievement collected — impressive.',
  'ach.firstTouch': 'First Touch · your first pat',
  'ach.goodFriend': 'Good Friend · 20 pats',
  'ach.inseparable': 'Inseparable · 50 pats',
  'ach.patron': 'Patron · 5 talent shows',
  'ach.chatty': 'Speak Up · 10 voice prompts',
  'ach.chameleon': 'Chameleon · all 5 colourways',
  'ach.threeFaces': 'Three Faces · all three forms',
  'ach.obedient': 'Well Trained · one voice command',
  'ach.unlocked': '🏆 Achievement unlocked: {name}',
  'ach.unlockedMany': '🏆 {count} achievements unlocked: {names}',
  'action.bond': 'Bond & achievements',
  'action.clear': 'Clear activity',
  'action.cancel': 'Stop the current task',
  'action.aria': 'Pet actions',
  'action.voice': 'Voice chat',
  'action.stopListening': 'Stop listening',
  'action.avatar': 'Switch form',
  'action.perform': 'Talent show',
  'action.skin': 'Recolor',
  'action.pet': 'Pet it',
  'action.type': 'Type instead',
  'action.more': 'More actions',
  'action.less': 'Fewer actions',
  'action.copy': 'Copy status',
  'action.stt': 'Local speech settings',
  'stt.placeholder': 'Local speech endpoint (blank = auto-detect)',
  'stt.save': 'Save',
  'stt.saved': 'Saved — the next mic tap will use it.',
  'stt.recording': '🎙️ Recording… tap the mic again when you finish. (Commands: “be quiet” / “change skin” / “stop”)',
  'stt.empty': "Didn't catch that — try again.",
  'stt.noAudio': 'The recorder received no audio at all — the microphone may not really be open. That is a device problem.',
  'stt.silentMic': 'The microphone was silent the whole time (peak {peak}). That is a capture-device problem, not a recognition problem.',
  'stt.unrecognized': 'Audio was captured (peak {peak}) but no speech was recognized — get closer and speak clearly.',
  'stt.failed': 'Local speech service failed: {reason}',
  'stt.none': 'No local speech service found. Open the keyboard icon → ⚙ to set the URL, or start a local Whisper service first.',
  'stt.uploading': 'Transcribing the audio clip…',
  'stt.pick': 'Transcribe an audio file',
  'input.placeholder': 'Type what you want to say…',
  'input.send': 'Send',
  'input.empty': 'Nothing typed yet.',
  'music.aria': 'Local music',
  'music.playing': 'Now playing: {track}',
  'music.paused': 'Paused: {track}',
  'music.loading': 'Getting the music ready…',
  'music.pause': 'Pause',
  'music.play': 'Play',
  'music.prev': 'Previous track',
  'music.next': 'Next track',
  'music.loopAll': 'Repeat all',
  'music.loopOne': 'Repeat one',
  'music.loopOff': 'Stop at the end',
  'music.loop': 'Loop mode',
  'music.close': 'Close the player',
  'music.open': 'Open the player',
  'music.drag': 'Press and drag to move',
  'music.folder': 'Music folder',
  'music.rootsUnknown': 'No folder read yet',
  'music.rootsScanning': 'Rescanning folders…',
  'music.folderReplace': 'Switch folder…',
  'music.folderAdd': 'Add folder…',
  'music.folderDefault': 'Restore default',
  'music.noPicker': 'This interface has no folder chooser, so the folder cannot be changed.',
  'music.rootsSame': 'That folder is already being scanned.',
  'music.rootsFailed': 'Could not switch folders: the music service refused.',
  'music.shuffle': 'Shuffle',
  'music.none': 'Nothing picked yet.',
  'music.serviceDown': 'No music service found',
  'music.denied': 'The browser blocked autoplay — press play once.',
  'music.decode': 'That file could not be decoded; try another format.',
  'music.unsupported': 'The browser cannot play this format: {detail}',
  'music.empty': 'The library is empty: {detail}',
  'music.unknown': 'Playback failed: {detail}',
  'music.videoNote': 'has video, audio only',
  'cmd.musicPlay': '🎵 Sure, putting some music on.',
  'cmd.musicPause': '🎵 Paused.',
  'cmd.musicNext': '🎵 Next one, coming up.',
  'cmd.musicStop': '🎵 Music off.',
  'cmd.musicClose': '🎵 Player tucked away — hover the pet to bring it back.',
  'cmd.musicRoots': '🎵 Folder switched — {count} tracks now.',
  'cmd.musicDefault': "🎵 Back to the service's own folders.",
  'pet.crash': 'The pet hit an error',
  'pet.retry': 'Click to retry (details in the tooltip and the console)',
  'cmd.musicLoud': '🎵 Turning it up.',
  'cmd.musicQuiet': '🎵 Turning it down.',
  'cmd.musicLoop': '🎵 Loop mode: {mode}',
  'cmd.musicShuffle': '🎵 Shuffle: {mode}',
  'perform.whale': 'Watch my whale dance!',
  'perform.robot': 'Robot dance, go!',
  'perform.silverMoon': 'Moonlight spin, a jade dance!',
  'panel.aria': 'DeepSeek electronic pet assistant',
  'panel.toggle': 'Collapse / expand',
  'panel.close': 'Tuck into the corner',
  'activity.aria': 'Recent task activity',
  'activity.empty': 'No activity yet — say something to begin.',
  'activity.user': 'You',
  'activity.assistant': 'Assistant',
  'activity.tool': 'Tool',
  'activity.turn': 'Turn',
  'activity.error': 'Issue',
}
