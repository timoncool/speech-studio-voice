import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { StudioStatus } from '../types'

const STUDIO = 'http://127.0.0.1:8797'
const JSON_HEADERS = { 'content-type': 'application/json' }

const on = atom({ plugin: 'studio-voice', key: 'on' } as const, false)
const compress = atom({ plugin: 'studio-voice', key: 'compress' } as const, false)
const status = atom({ plugin: 'studio-voice', key: 'status' } as const, null as StudioStatus | null)
const tick = atom({ plugin: 'studio-voice', key: 'tick' } as const, 0)
const after = atom({ plugin: 'studio-voice', key: 'after' } as const, 0)
const busy = atom({ plugin: 'studio-voice', key: 'busy' } as const, false)
const muted = atom({ plugin: 'studio-voice', key: 'muted' } as const, false)
const loaded = atom({ plugin: 'studio-voice', key: 'loaded' } as const, false)

const DOWN: StudioStatus = { ok: false, agent: false, window: false, mic: false, engine: '', voice: '' }

/** Restore the toggles kept across sessions. */
async function restore($: EngineInterface): Promise<void> {
  const savedOn = (await $.store.get('studio-voice:on').catch(() => undefined)) as boolean | undefined
  const savedCompress = (await $.store.get('studio-voice:compress').catch(() => undefined)) as boolean | undefined
  await update($, on, () => savedOn ?? false)
  await update($, compress, () => savedCompress ?? false)
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

/** Shorten a reply to a short spoken line through Haiku; the original stands if the model does not answer. */
async function shorten($: EngineInterface, text: string): Promise<string> {
  try {
    const r = await $.model.complete({
      model: 'haiku',
      effort: 'low',
      maxTokens: 400,
      system: 'Rewrite the assistant message as a short spoken reply: one or two sentences, the same language, no code, no lists, no markdown. Say only what a person would say aloud. Output only the rewritten line.',
      prompt: text,
    })
    if (r.isAnswered && r.text.trim()) return r.text.trim()
  } catch {
    // fall through to the original
  }
  return text
}

/** Speak a reply through the studio: open a session, then send the text and close it. */
async function speak($: EngineInterface, raw: string): Promise<void> {
  let text = raw.trim()
  if (!text) return
  if (await read($, compress)) text = await shorten($, text)
  const opened = await $.http.fetch(`${STUDIO}/speech/say`, { method: 'POST', headers: JSON_HEADERS, body: '{}' }).catch(() => null)
  if (!opened || !opened.ok) {
    if (opened && opened.status === 409) await update($, status, s => (s ? { ...s, window: false } : s))
    return
  }
  const sid = (JSON.parse(opened.text) as { session?: string }).session
  if (!sid) return
  await $.http.fetch(`${STUDIO}/speech/say/${sid}`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ text, end: true }) }).catch(() => {})
}

/** Pull the person's spoken phrases from Live and submit each as their own prompt, while no turn is running. */
async function voiceIn($: EngineInterface): Promise<void> {
  if (!(await read($, on)) || (await read($, busy))) return
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

/** Turn the studio's Live microphone on so the bridge has something to hear. */
async function startListening($: EngineInterface): Promise<void> {
  await $.http.fetch(`${STUDIO}/speech/listen`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ lang: 'auto' }) }).catch(() => {})
}

/** The [мост] button: turn the bridge on or off; on, it starts the studio listening. */
async function toggleBridge($: EngineInterface): Promise<void> {
  const nv = await update($, on, v => !v)
  await $.store.set('studio-voice:on', nv).catch(() => {})
  if (nv) await startListening($)
}

/** The [Haiku] button: shorten spoken replies or not. */
async function toggleCompress($: EngineInterface): Promise<void> {
  const nv = await update($, compress, v => !v)
  await $.store.set('studio-voice:compress', nv).catch(() => {})
}

/** The [мьют] button: mute or unmute the studio's Live microphone. */
async function toggleMute($: EngineInterface): Promise<void> {
  const r = await $.http.fetch(`${STUDIO}/speech/listen/mute`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ toggle: true }) }).catch(() => null)
  if (r && r.ok) {
    const m = (JSON.parse(r.text) as { muted?: boolean }).muted === true
    await update($, muted, () => m)
  }
}

/** One dim detail run in the band and how important it is to keep when the row is narrow. */
type Seg = { text: string; prio: number }

export const register: Register = on_ => {
  on_('session.start', async ($, e, next) => {
    const r = await next(e)
    await restore($)
    $.clock.every(2500, () => void poll($).catch(() => {}))
    $.clock.every(1400, () => void voiceIn($).catch(() => {}))
    await $.command
      .register({ name: 'voice', description: 'Голосовой мост Speech Studio: on | off | сжатие | статус', argumentHint: 'on | off | compress | status', immediate: true })
      .catch(() => {})
    if (await read($, on)) await startListening($)
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
    if (await read($, on)) {
      const said = r.text
      $.clock.after(0, () => void speak($, said).catch(() => {}))
    }
    return r
  })

  on_('command.run', { command: 'voice' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'compress' || arg === 'сжатие') {
      const now = await update($, compress, v => !v)
      await $.store.set('studio-voice:compress', now).catch(() => {})
      return { text: `Сжатие речи через Haiku ${now ? 'включено' : 'выключено'}.` }
    }
    if (arg === 'status' || arg === 'статус') {
      const s = await read($, status)
      if (!s || !s.ok) return { text: 'Speech Studio не отвечает на 127.0.0.1:8797. Запусти студию.' }
      return { text: `Студия на связи. Агент ${s.agent ? 'подключён' : 'не подключён'}, микрофон ${s.mic ? 'включён' : 'выключен'}, окно ${s.window ? 'открыто' : 'закрыто'}${s.engine ? `, движок ${s.engine}` : ''}${s.voice ? `, голос ${s.voice}` : ''}.` }
    }
    const want = arg === '' ? !(await read($, on)) : arg === 'on'
    const nowOn = await update($, on, () => want)
    await $.store.set('studio-voice:on', nowOn).catch(() => {})
    if (nowOn) await startListening($)
    return { text: `Голосовой мост Speech Studio ${nowOn ? 'включён — реплики озвучиваются, твоя речь уходит в промпт' : 'выключен'}.` }
  }).catch(($, e, next) => (next.called ? next(e) : { text: 'Голосовой мост: ошибка, команда не выполнена.' }))

  on_('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const isOn = await read($, on)
    const s = await read($, status)
    const useCompress = await read($, compress)
    const isMuted = await read($, muted)
    await read($, tick)
    if (e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const below = await next(e)
    const up = s?.ok === true

    // Width-adaptive: the name and the connection dot are always shown; the detail segments after them are dropped by
    // priority, lowest first, until the row fits — never a figure cut in half. The three buttons keep their own room.
    const detail: Seg[] = []
    if (up && s) {
      detail.push({ text: `микрофон ${s.mic ? 'вкл' : 'выкл'}`, prio: 70 })
      detail.push({ text: `окно ${s.window ? 'есть' : 'нет'}`, prio: 65 })
      if (s.engine) detail.push({ text: `${s.engine}${s.voice ? ` · ${s.voice}` : ''}`, prio: 60 })
      detail.push({ text: `агент ${s.agent ? 'есть' : 'нет'}`, prio: 40 })
    }
    const conn = up ? 'на связи' : 'офлайн'
    const hint = isOn && up && s && !s.window ? 'открой Live, чтобы озвучивать' : ''
    const BUTTONS_WIDTH = 32 // ● мост · мьют · Haiku, with their gaps
    const fixed = '▎ Speech Studio'.length + 3 + conn.length + (hint ? 3 + hint.length : 0) + BUTTONS_WIDTH
    let room = Math.max(0, e.props.bodyColumns - fixed)
    const keep: Seg[] = []
    for (const seg of [...detail].sort((a, b) => b.prio - a.prio)) {
      const cost = seg.text.length + 3 // the ' · ' before it
      if (cost <= room) {
        room -= cost
        keep.push(seg)
      }
    }
    const shown = detail.filter(d => keep.includes(d)) // back in display order

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={2}>
          <Box flexGrow={1}>
            <Text wrap="truncate-end">
              <Text color="#4cc2ff" bold>▎ Speech Studio</Text>
              <Text color="inactive"> · </Text>
              <Text color={up ? 'success' : 'inactive'}>{conn}</Text>
              {shown.map((seg, i) => (
                <Text key={`seg-${i}`}>
                  <Text color="inactive"> · </Text>
                  <Text color="subtle">{seg.text}</Text>
                </Text>
              ))}
              {hint ? (
                <Text>
                  <Text color="inactive"> · </Text>
                  <Text color="warning">{hint}</Text>
                </Text>
              ) : null}
            </Text>
          </Box>
          <Button key="bridge" plain onPress={() => void toggleBridge($).catch(() => {})}>
            <Text color={isOn ? '#4cc2ff' : 'inactive'}>{isOn ? 'мост вкл' : 'мост выкл'}</Text>
          </Button>
          <Button key="mute" plain label={isMuted ? 'размьют' : 'мьют'} onPress={() => void toggleMute($).catch(() => {})} />
          <Button key="haiku" plain label={useCompress ? 'Haiku ✓' : 'Haiku'} onPress={() => void toggleCompress($).catch(() => {})} />
        </Box>
        {below}
      </Box>
    )
  })
}
