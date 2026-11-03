# studio-voice — two-way voice bridge to Speech Studio

A Claude Code mod (function-hook plugin) that connects a Claude Code dialog to a locally running
[Speech Studio](https://github.com/timoncool/speech-studio) so you can hold a hands-free spoken
conversation with the agent on your own machine — like a voice assistant, but local.

The split of work is the point: **Speech Studio** does the hearing — it activates on your voice and
your wake phrase (its built-in voice gate, set up in the studio), recognizes what you say and streams
it over its local HTTP API. **This mod** is the thin bridge: it pulls that recognized speech into the
current dialog as your prompt, and sends Claude's reply back to the studio to be spoken. You say
“эй Клодик …”, it lands in the chat, Claude works, and you hear the answer.

## What it does

- **Activation band** above the prompt: `▎ Speech Studio · на связи · <live phase>` with two
  icon buttons — **🎤 Слушание** (pull your recognized speech into this dialog, on/off) and
  **🔊 Озвучка** (how replies are voiced). The middle shows the live phase of the loop —
  *слушаю — скажи «эй Клодик …»* → *Клодик думает…* → *озвучиваю ответ* — so you always see what is
  happening hands-free. Idle, it shows the studio's engine and voice. Colours follow your theme
  (brand azure accent).
- **Hears you**: with 🎤 on it polls the studio's recognized phrases (`GET /speech/listen/next`,
  already gated by the studio's own voice gate) and submits each as your own prompt into this dialog.
- **Speaks Claude's replies**: on each finished turn the answer is sent to the studio
  (`POST /speech/say`) and voiced by whichever TTS engine/voice the studio is set to.
- **🔊 Озвучка cycles** off → **целиком** (read the whole reply) → **Haiku** → **Sonnet** (summarize
  the reply through that model into a short spoken digest first, so you hear the gist, not 20 lines).
  The model is shown right on the button; click to change it.

The wake phrase (“эй Клодик”) and the owner-voice gate are **configured in Speech Studio itself**
(Live → activation), not in this mod — the mod only consumes the speech the studio already recognized.

## Install

```
/plugin install studio-voice --marketplace timoncool/speech-studio-voice
```

Needs Claude Code 2.1.287+ in the terminal or 2.1.286+ in the desktop Code tab, and
[Speech Studio](https://github.com/timoncool/speech-studio) running locally (MCP/HTTP on
`http://127.0.0.1:8797`) — put it in autostart for a truly hands-free setup. Open the studio's
**Live** panel (or the small talk widget) so it has a window to play audio on, and set up the wake
phrase / owner voice there.

## Use

- `/voice` or `/voice on` / `off` — start or stop listening (also the **🎤 Слушание** button).
- `/voice озвучка` — cycle the speaking mode, or set it directly: `/voice как есть`, `/voice haiku`,
  `/voice sonnet`, `/voice тихо` (also the **🔊 Озвучка** button).
- `/voice статус` — report the studio's status and the current listening/speaking modes.
- `/voice промпт` — print the exact prompt used to summarize replies.
- `/voice мьют` — mute / unmute the studio's Live microphone without stopping listening.

The toggles are remembered across sessions.

## Usage scenarios

The bridge is just plumbing — the character of the conversation is up to the agent, so pair it with a
skill or a system prompt for a particular voice experience. Ideas:

- **Language tutor** — practise English (or any language) out loud; the agent corrects and replies,
  everything spoken through the studio.
- **Rhetoric / public-speaking coach** — rehearse an argument aloud and get spoken feedback.
- **Memory training** — spaced-recall drills driven entirely by voice.
- **Hands-free coding companion** — ask questions and hear short answers while you work.

These are agent-level skills on top of the bridge, not part of the mod itself.

## How it is built

A single hooks module (`hooks/register.tsx`) using `$.http.fetch` to reach the studio, `$.clock.every`
to poll status and the recognized-speech stream, `turn.complete` to catch each reply, `$.model.complete`
for the Haiku/Sonnet summary, `$.prompt.submit` to feed your speech back, and a `ui.render` band with
`Button` controls. No network of its own beyond the local studio. Validated and tested with
`claude plugin validate` / `claude plugin test`.

## License

MIT — see [LICENSE](LICENSE).
