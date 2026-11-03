import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SpeakMode, StudioStatus } from '../types'

const STUDIO = 'http://127.0.0.1:8797'
const JSON_HEADERS = { 'content-type': 'application/json' }

/** The system prompt that boils a written reply down to a short spoken digest; shown by `/voice промпт`. */
const SHORTEN_SYSTEM =
  'Summarize the assistant message as a short spoken digest: the gist in one to three sentences, ' +
  'in the same language, no code, no lists, no markdown, no file paths. Say only what a person would say aloud. ' +
  'Output only the spoken line.'

const listen = atom({ plugin: 'studio-voice', key: 'listen' } as const, false)
const speak = atom({ plugin: 'studio-voice', key: 'speak' } as const, 'off' as SpeakMode)
const voicing = atom({ plugin: 'studio-voice', key: 'voicing' } as const, false)
const status = atom({ plugin: 'studio-voice', key: 'status' } as const, null as StudioStatus | null)
const tick = atom({ plugin: 'studio-voice', key: 'tick' } as const, 0)
const after = atom({ plugin: 'studio-voice', key: 'after' } as const, 0)
const busy = atom({ plugin: 'studio-voice', key: 'busy' } as const, false)
const muted = atom({ plugin: 'studio-voice', key: 'muted' } as const, false)
const loaded = atom({ plugin: 'studio-voice', key: 'loaded' } as const, false)

const DOWN: StudioStatus = { ok: false, agent: false, window: false, mic: false, engine: '', voice: '' }

const SPEAK_ORDER: SpeakMode[] = ['off', 'asis', 'haiku', 'sonnet']

/** A line describing a speaking mode, for the toast and `/voice статус`. */
function speakWhat(mode: SpeakMode): string {
  if (mode === 'off') return 'Озвучка выключена.'
  if (mode === 'asis') return 'Читаю ответ целиком, как написан.'
  if (mode === 'haiku') return 'Читаю выжимку — суммаризирую ответ через Haiku, потом озвучиваю.'
  return 'Читаю выжимку — суммаризирую ответ через Sonnet, потом озвучиваю.'
}

/** Restore the toggles kept across sessions. */
async function restore($: EngineInterface): Promise<void> {
  const savedListen = (await $.store.get('studio-voice:listen').catch(() => undefined)) as boolean | undefined
  const savedSpeak = (await $.store.get('studio-voice:speak').catch(() => undefined)) as SpeakMode | undefined
  await update($, listen, () => savedListen ?? false)
  await update($, speak, () => (SPEAK_ORDER.includes(savedSpeak as SpeakMode) ? (savedSpeak as SpeakMode) : 'off'))
  await update($, loaded, () => true)
}

/** Poll the studio: is it up, an agent on, a window to play on, the mic recording, the voicing engine and voice. */
async function poll($: EngineInterface): Promise<void> {
  try {
    const r = await $.http.fetch(`${STUDIO}/mcp/status`, {})
    if (!r.ok) {
      await update($, status, () => DOWN)
      await update($, tick, n => n + 1)
      return
    }
    const s = JSON.parse(r.text) as Record<string, unknown>
    const mic: Record<string, unknown> = await $.http.fetch(`${STUDIO}/mic/state`, {}).then(x => (x.ok ? (JSON.parse(x.text) as Record<string, unknown>) : {})).catch(() => ({}))
    const v: Record<string, unknown> = await $.http.fetch(`${STUDIO}/speech/say/voice`, {}).then(x => (x.ok ? (JSON.parse(x.text) as Record<string, unknown>) : {})).catch(() => ({}))
    await update($, status, () => ({
      ok: true,
      agent: s['agent_connected'] === true,
      window: s['window_open'] === true,
      mic: mic['on'] === true,
      engine: String(v['engine'] ?? ''),
      voice: v['voice'] ? String(v['voice']) : '',
    }))
  } catch {
    await update($, status, () => DOWN)
  }
  await update($, tick, n => n + 1)
}

/** Boil a reply down to a short spoken digest through the chosen model; the original stands if it does not answer. */
async function shorten($: EngineInterface, text: string, model: 'haiku' | 'sonnet'): Promise<string> {
  try {
    const r = await $.model.complete({ model, effort: 'low', maxTokens: 400, system: SHORTEN_SYSTEM, prompt: text })
    if (r.isAnswered && r.text.trim()) return r.text.trim()
  } catch {
    // fall through to the original
  }
  return text
}

/** Speak a reply through the studio: summarize first if the mode asks, then open a session and send the text. */
async function sayReply($: EngineInterface, raw: string): Promise<void> {
  let text = raw.trim()
  if (!text) return
  const mode = await read($, speak)
  if (mode === 'off') return
  await update($, voicing, () => true)
  try {
    if (mode === 'haiku' || mode === 'sonnet') text = await shorten($, text, mode)
    const opened = await $.http.fetch(`${STUDIO}/speech/say`, { method: 'POST', headers: JSON_HEADERS, body: '{}' }).catch(() => null)
    if (!opened || !opened.ok) {
      if (opened && opened.status === 409) await update($, status, s => (s ? { ...s, window: false } : s))
      return
    }
    const sid = (JSON.parse(opened.text) as { session?: string }).session
    if (!sid) return
    await $.http.fetch(`${STUDIO}/speech/say/${sid}`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ text, end: true }) }).catch(() => {})
  } finally {
    await update($, voicing, () => false)
  }
}

/** Pull the phrases the studio recognized (gated by its own voice gate) and submit each as the person's prompt. */
async function voiceIn($: EngineInterface): Promise<void> {
  if (!(await read($, listen)) || (await read($, busy))) return
  try {
    const seen = await read($, after)
    const r = await $.http.fetch(`${STUDIO}/speech/listen/next?after=${seen}&seconds=1`, {})
    if (!r.ok) return
    const body = JSON.parse(r.text) as { lines?: { text?: string }[]; heard?: number }
    for (const l of body.lines ?? []) {
      const said = (l.text ?? '').trim()
      if (said) await $.prompt.submit({ text: said, asUser: true })
    }
    if (typeof body.heard === 'number') await update($, after, () => body.heard as number)
  } catch {
    // the studio may not be listening yet; the next tick tries again
  }
}

/** Turn the studio's Live microphone on so listening has something to hear. */
async function startListening($: EngineInterface): Promise<void> {
  await $.http.fetch(`${STUDIO}/speech/listen`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ lang: 'auto' }) }).catch(() => {})
}

/** The 🎤 button: start or stop pulling the studio's recognized speech into this dialog. */
async function toggleListen($: EngineInterface): Promise<void> {
  const nv = await update($, listen, v => !v)
  await $.store.set('studio-voice:listen', nv).catch(() => {})
  if (nv) await startListening($)
  $.ui.toast(nv ? 'Слушаю студию — скажи «эй Клодик …», распознанное уйдёт в этот диалог.' : 'Слушание выключено.')
}

/** The 🔊 button: step the speaking mode off → целиком → Haiku → Sonnet → off, and say what it now does. */
async function cycleSpeak($: EngineInterface): Promise<void> {
  const nv = await update($, speak, m => SPEAK_ORDER[(SPEAK_ORDER.indexOf(m) + 1) % SPEAK_ORDER.length] ?? 'off')
  await $.store.set('studio-voice:speak', nv).catch(() => {})
  $.ui.toast(speakWhat(nv))
}

/** Mute or unmute the studio's Live microphone without changing listening (from `/voice мьют`). */
async function toggleMute($: EngineInterface): Promise<void> {
  const r = await $.http.fetch(`${STUDIO}/speech/listen/mute`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ toggle: true }) }).catch(() => null)
  if (r && r.ok) {
    const m = (JSON.parse(r.text) as { muted?: boolean }).muted === true
    await update($, muted, () => m)
  }
}

/** The 🔊 button face: glyph, mode word, whether it is lit. */
function speakFace(mode: SpeakMode): { glyph: string; word: string; lit: boolean } {
  if (mode === 'off') return { glyph: '🔇', word: 'выкл', lit: false }
  if (mode === 'asis') return { glyph: '🔊', word: 'целиком', lit: true }
  if (mode === 'haiku') return { glyph: '🔊', word: 'Haiku', lit: true }
  return { glyph: '🔊', word: 'Sonnet', lit: true }
}

/** The live phase of the voice loop and its colour, or null to show the dim idle details instead. */
function phaseOf(args: { up: boolean; mic: boolean; listening: boolean; speakOn: boolean; busy: boolean; voicing: boolean }): { text: string; color: string } | null {
  if (!args.listening && !args.speakOn) return null
  if (!args.up) return { text: 'студия офлайн', color: 'warning' }
  if (args.busy) return { text: 'Клодик думает…', color: 'warning' }
  if (args.voicing) return { text: 'озвучиваю ответ', color: '#4cc2ff' }
  if (args.listening && args.mic) return { text: 'слушаю — скажи «эй Клодик …»', color: 'success' }
  if (args.listening && !args.mic) return { text: 'жду микрофон студии', color: 'warning' }
  return { text: 'готов озвучивать', color: 'subtle' }
}

export const register: Register = on_ => {
  on_('session.start', async ($, e, next) => {
    const r = await next(e)
    await restore($)
    $.clock.every(2500, () => void poll($).catch(() => {}))
    $.clock.every(1400, () => void voiceIn($).catch(() => {}))
    await $.command
      .register({ name: 'voice', description: 'Speech Studio: слышит мою речь и озвучивает ответы Клода', argumentHint: 'слушать | озвучка | как есть | haiku | sonnet | мьют | статус | промпт', immediate: true })
      .catch(() => {})
    if (await read($, listen)) await startListening($)
    return r
  })

  on_('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await restore($)
    return next(e)
  }).catch(($, e, next) => (next.called ? next(e) : next(e)))

  on_('turn.start', async ($, e, next) => {
    if (!(await read($, loaded))) await restore($)
    if (e.agentId === undefined) await update($, busy, () => true)
    return next(e)
  })

  on_('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined) return r
    await update($, busy, () => false)
    if ((await read($, speak)) !== 'off') {
      const said = r.text
      $.clock.after(0, () => void sayReply($, said).catch(() => {}))
    }
    return r
  })

  on_('command.run', { command: 'voice' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'промпт' || arg === 'prompt') {
      return { text: `Промпт суммаризации (Haiku/Sonnet, прогоняется в моде перед озвучкой):\n\n${SHORTEN_SYSTEM}` }
    }
    if (arg === 'мьют' || arg === 'mute') {
      await toggleMute($)
      return { text: `Микрофон Live ${(await read($, muted)) ? 'приглушён' : 'снова слышит'}.` }
    }
    if (arg === 'озвучка' || arg === 'speak') {
      await cycleSpeak($)
      return { text: speakWhat(await read($, speak)) }
    }
    if (arg === 'как есть' || arg === 'целиком' || arg === 'asis' || arg === 'haiku' || arg === 'sonnet' || arg === 'тихо') {
      const mode: SpeakMode = arg === 'haiku' ? 'haiku' : arg === 'sonnet' ? 'sonnet' : arg === 'тихо' ? 'off' : 'asis'
      await update($, speak, () => mode)
      await $.store.set('studio-voice:speak', mode).catch(() => {})
      return { text: speakWhat(mode) }
    }
    if (arg === 'статус' || arg === 'status') {
      const s = await read($, status)
      const hear = (await read($, listen)) ? 'слушаю твою речь из студии' : 'не слушаю'
      const sm = await read($, speak)
      const now = `Сейчас: ${hear}; ${speakWhat(sm).toLowerCase()}`
      if (!s || !s.ok) return { text: `Speech Studio не отвечает на 127.0.0.1:8797. Запусти студию (или добавь в автозагрузку).\n${now}` }
      return { text: `Студия на связи. Агент ${s.agent ? 'подключён' : 'не подключён'}, окно ${s.window ? 'открыто' : 'закрыто'}${s.engine ? `, движок ${s.engine}` : ''}${s.voice ? `, голос ${s.voice}` : ''}.\n${now}\nФраза-активатор и голос владельца настраиваются в самой студии (Live → активация).` }
    }
    // no arg, or on/off: the listening toggle is the main switch
    const want = arg === '' ? !(await read($, listen)) : !(arg === 'off' || arg === 'выкл')
    await update($, listen, () => want)
    await $.store.set('studio-voice:listen', want).catch(() => {})
    if (want) await startListening($)
    return { text: want ? 'Слушаю студию — скажи «эй Клодик …», распознанное уйдёт в этот диалог. Озвучку ответов включи кнопкой 🔊 или «/voice озвучка».' : 'Слушание выключено.' }
  }).catch(($, e, next) => (next.called ? next(e) : { text: 'Голосовой мост: ошибка, команда не выполнена.' }))

  on_('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const isListening = await read($, listen)
    const sm = await read($, speak)
    const isBusy = await read($, busy)
    const isVoicing = await read($, voicing)
    const s = await read($, status)
    await read($, tick)
    if (e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const below = await next(e)
    const up = s?.ok === true
    const sf = speakFace(sm)
    const phase = phaseOf({ up, mic: s?.mic === true, listening: isListening, speakOn: sm !== 'off', busy: isBusy, voicing: isVoicing })

    const conn = up ? 'на связи' : 'офлайн'
    const BUTTONS_WIDTH = 26 // 🎤 выкл · 🔊 Sonnet, with their gaps
    const fixed = '▎ Speech Studio'.length + 3 + conn.length + BUTTONS_WIDTH
    const room = Math.max(0, e.props.bodyColumns - fixed)

    // When the loop is live, the middle shows its phase; idle, it shows the engine · voice detail if it fits.
    const idle = up && s && s.engine ? `${s.engine}${s.voice ? ` · ${s.voice}` : ''}` : ''
    const mid = phase ?? (idle && idle.length + 3 <= room ? { text: idle, color: 'subtle' } : null)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={2}>
          <Box flexGrow={1}>
            <Text wrap="truncate-end">
              <Text color="#4cc2ff" bold>▎ Speech Studio</Text>
              <Text color="inactive"> · </Text>
              <Text color={up ? 'success' : 'inactive'}>{conn}</Text>
              {mid ? (
                <Text>
                  <Text color="inactive"> · </Text>
                  <Text color={mid.color}>{mid.text}</Text>
                </Text>
              ) : null}
            </Text>
          </Box>
          <Button key="listen" plain onPress={() => void toggleListen($).catch(() => {})}>
            <Text>🎤 <Text color={isListening ? 'success' : 'inactive'}>{isListening ? 'вкл' : 'выкл'}</Text></Text>
          </Button>
          <Button key="speak" plain onPress={() => void cycleSpeak($).catch(() => {})}>
            <Text>{sf.glyph} <Text color={sf.lit ? '#4cc2ff' : 'inactive'}>{sf.word}</Text></Text>
          </Button>
        </Box>
        {below}
      </Box>
    )
  })
}
