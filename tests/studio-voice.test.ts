import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 160 } } as const

/** Answer the studio's HTTP endpoints the mod polls and speaks through. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function studio(on: any) {
  on('http.fetch', ($: unknown, e: { url: string }) => {
    if (e.url.includes('/mcp/status')) {
      return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ agent_connected: true, window_open: true }) } }
    }
    if (e.url.includes('/mic/state')) {
      return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ on: true }) } }
    }
    if (e.url.includes('/speech/say/voice')) {
      return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ engine: 'qwen3-tts', voice: 'Аня' }) } }
    }
    return { value: { status: 200, ok: true, headers: {}, text: '{}' } }
  })
}

test('idle, the band shows the engine and voice detail', async ($, on) => {
  mock.store(on, {})
  const clock = mock.clock(on, { now: 0 })
  studio(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'voice' } }))
  on('ui.render', ($, e) => $.ui.resolve(e).Box({ children: [] }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.advance(2500) // one status poll

  const ui = await $.ui.mount({ plugin: 'studio-voice', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /на связи/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /qwen3-tts/ })).toBeDefined()
  await ui.unmount()
})

test('with the loop live, the band shows the phase and the two control buttons', async ($, on) => {
  mock.store(on, {})
  const clock = mock.clock(on, { now: 0 })
  studio(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'voice' } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', ($, e) => $.ui.resolve(e).Box({ children: [] }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'voice', args: 'on', ...RUN }) // listening on
  await $.command.run({ command: 'voice', args: 'haiku', ...RUN }) // speak = summarize via Haiku
  await clock.advance(2500) // one status poll

  const ui = await $.ui.mount({ plugin: 'studio-voice', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /эй Клодик/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /🎤/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Haiku/ })).toBeDefined()
  await ui.unmount()
})

test('the band is visible even before the studio answers, showing it offline', async ($, on) => {
  mock.store(on, {})
  mock.clock(on, { now: 0 })
  studio(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'voice' } }))
  on('ui.render', ($, e) => $.ui.resolve(e).Box({ children: [] }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'studio-voice', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /Speech Studio/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /офлайн/ })).toBeDefined()
  await ui.unmount()
})

test('/voice sonnet sets the speaking mode to summarize through Sonnet', async ($, on) => {
  mock.store(on, {})
  mock.clock(on, { now: 0 })
  studio(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'voice' } }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const r = await $.command.run({ command: 'voice', args: 'sonnet', ...RUN })
  expect(r.text).toContain('Sonnet')
  expect(r.text).toContain('выжимку')
})

test('/voice промпт prints the compression prompt', async ($, on) => {
  mock.store(on, {})
  mock.clock(on, { now: 0 })
  studio(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'voice' } }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const r = await $.command.run({ command: 'voice', args: 'промпт', ...RUN })
  expect(r.text).toContain('short spoken digest')
})
