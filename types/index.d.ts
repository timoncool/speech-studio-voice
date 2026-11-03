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

/** How Claude's replies are voiced: off, read in full, or summarized first through a model. */
export type SpeakMode = 'off' | 'asis' | 'haiku' | 'sonnet'

declare module 'claude-code' {
  interface PluginState {
    'studio-voice': {
      /** Listening is on: the phrases the studio recognizes (gated by its own voice gate) are submitted as prompts. */
      listen: boolean
      /** How Claude's replies are voiced: off, read in full, or summarized through Haiku/Sonnet. */
      speak: SpeakMode
      /** A reply is being sent to the studio and spoken right now. */
      voicing: boolean
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
