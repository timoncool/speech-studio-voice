# studio-voice — real-time voice bridge to Speech Studio

A Claude Code mod (function-hook plugin) that turns a session into a real-time spoken
conversation through [Speech Studio](https://github.com/timoncool/speech-studio). It draws an
activation band above the prompt with the studio's live status and three clickable controls,
speaks Claude's replies aloud as they finish, and submits what you say back into the prompt — so
you can talk to the agent with your voice and hear it answer, hands-free.

## What it does

- **Activation band** above the prompt: `Speech Studio · ● на связи · микрофон вкл · окно есть ·
  qwen3-tts · Аня · агент есть` with three buttons — **[мост]** (bridge on/off), **[мьют]** (mute
  the studio's Live mic) and **[Haiku]** (shorten spoken replies). The row adapts to width, dropping
  the least important detail first and never cutting a figure in half. Colours follow your theme.
- **Speaks Claude's replies**: on each finished turn the answer is sent to the studio
  (`POST /speech/say`) and voiced by whichever TTS engine the studio is set to.
- **Hears you**: it polls the studio's Live transcript (`GET /speech/listen/next`) and submits each
  spoken phrase as your own prompt, so a reply you say out loud becomes the next turn.
- **Short spoken replies (optional, Haiku)**: with compression on, each answer is first rewritten by
  `claude-haiku` into a one- or two-sentence spoken line, so you hear a reply, not a longread.

## Install

```
/plugin install studio-voice --marketplace timoncool/speech-studio-voice
```

Needs Claude Code 2.1.287+ in the terminal or 2.1.286+ in the desktop Code tab, and
[Speech Studio](https://github.com/timoncool/speech-studio) running locally (MCP/HTTP on
`http://127.0.0.1:8797`). Open the studio's **Live** panel (or the small talk widget) so it has a
window to play audio on.

## Use

- `/voice` or `/voice on` / `off` — turn the bridge on or off (also the **[мост]** button).
- `/voice сжатие` — toggle Haiku shortening (also the **[Haiku]** button).
- `/voice статус` — report the studio's status.
- The **[мьют]** button mutes / unmutes the studio's Live microphone.

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
to poll status and the Live transcript, `turn.complete` to catch each reply, `$.model.complete` for the
Haiku shortening, `$.prompt.submit` to feed your speech back, and a `ui.render` band with `Button`
controls. No network of its own beyond the local studio. Validated and tested with
`claude plugin validate` / `claude plugin test`.

## License

MIT — see [LICENSE](LICENSE).
