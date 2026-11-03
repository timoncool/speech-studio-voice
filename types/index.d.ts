export type StudioStatus = {
  /** The studio answered its status endpoint. */
  ok: boolean
  /** An agent is connected to the studio over MCP. */
  agent: boolean
  /** A studio window is open to play audio on; without one the studio cannot speak. */
  window: boolean
  /** The microphone is recording for Live. */
  mic: boolean
  /** The voicing engine now set. */
  engine: string
  /** The voice the studio speaks with, or empty for the engine's default. */
  voice: string
}

declare module 'claude-code' {
  interface PluginState {
    'studio-voice': {
      /** The bridge is on: Claude's replies are spoken and the person's speech is submitted. */
      on: boolean
      /** Shorten each reply through Haiku before it is spoken. */
      compress: boolean
      /** The studio's last polled status, or null before the first poll. */
      status: StudioStatus | null
      /** Bumped on each poll so the band redraws. */
      tick: number
      /** How many live phrases have already been submitted this session. */
      after: number
      /** A model turn is running, so the person's speech is not submitted over it. */
      busy: boolean
      /** The studio's Live microphone is muted (set from the mute button). */
      muted: boolean
      /** The session's toggles have been restored from the store. */
      loaded: boolean
    }
  }
}
