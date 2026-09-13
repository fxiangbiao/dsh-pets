---
description: "Electronic pet assistant for the dsh web GUI: a switching-avatar companion that surfaces live task/tool progress, listens and speaks through browser speech, and reacts to your mood; for users and maintainers of the pet experience."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-pet

English | [中文](README.zh.md)

## Summary

This package renders a floating **electronic pet assistant** in the DeepSeek Harness web GUI. It lives in the frame-wide `shell.overlay` slot so it hovers above every column without blocking the app underneath. It follows the current session and publishes, in real time, the running turn, the currently executing tool, the pending queue depth, a rolling activity feed, and an inferred mood. You can switch the pet between three avatars, turn voice on or off, dictate a prompt by voice into the current session, cancel a running turn by voice, have the pet read the latest reply aloud, and play the machine's own music while the pet dances to the beat. Nothing leaves the machine: speech rides the Web Speech API or a loopback service, music is streamed from a loopback file server, and no model, message, or schema is touched.

The pet is a companion for the human, not another agent. It is a read-mostly projection of live session state plus a voice I/O surface; it issues no LLM requests of its own.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin alongside the web client; the pet appears docked in the bottom-right corner as a floating companion. Hover it to bring out the action ring, drag it to move it somewhere else, and click it to pet it (petting is what raises the bond level). There is no panel to open: everything the pet does hangs off the ring.

### Avatars

Three avatars ship with the plugin, each with its own artwork, accent, voice and tone:

- **Whale Girl** (`whale`) — the DeepSeek whale drawn as a chibi whale-girl.
- **Probe-Bot** (`robot`) — the DeepSeek robot, precise and terse.
- **Silver Moon** (`silver-moon`) — 银月 from *A Record of a Mortal's Journey to Immortality*, elegant and enigmatic.

Each avatar is one horizontal strip of poses (12 frames, 8 for the robot) shipped as a base64 PNG inside the bundle — the plugin host serves JavaScript only, so there is no asset directory to put artwork in. On top of that, five colour variants (`classic`, `sakura`, `mint`, `midnight`, `gold`) recolour the character's *own* palette at runtime: pixels inside a named hue window rotate, skin and whites and outlines do not (`skin.ts`). Silver Moon has no recolour recipe — her variants are chroma plus a rim light instead.

The avatar, colour, mute flag, bond level, lifetime counters and earned achievements all persist across reload.

### Voice and the action ring

Hovering the pet brings its actions out on a ring around the artwork. When the window leaves no room for all of them, the ones that do not fit fold into a rail behind a "more" toggle, and the toggle disappears when there is no overflow. Seven actions ship:

- **Listen** — dictate through the machine-local Whisper service; the final transcript is submitted as a queued prompt into the **current** session. When the service cannot be reached the pet says why and falls back to typing rather than failing silently.
- **Type** — the fallback bar, for typing a prompt into the current session when speech is not an option.
- **Growth** — the read-out card: bond level and title, pettings, achievements earned, and the next one to chase. It has a copy button, because asking a human to drag a selection across a floating bubble is a poor way to let them quote it.
- **Talent show** — the pet performs its animation strip and celebrates the bond it earned.
- **Avatar** and **Colour** — step through the three avatars and the five colour variants.
- **Music** — play the machine's own music (see below).

Speech in and out prefer the local service: recognition through `localStt.ts`, synthesis through `localTts.ts` (sentence-chunked, so the first sound starts earlier than one long request would). Both fall back to the browser Web Speech API, feature-detected. Mute is a voice command (`hush` / `mute` / `unmute`) and silences output only — it never blocks the microphone.

### Music

The music action plays what is on **this machine**, which a browser page cannot read by itself: a companion host plugin (`pet-music.mjs`, shipped beside the supervisor in the repository that carries this package) scans the folders it is configured with, lists them, and streams the files with byte ranges. Point the module at it with the `musicUrl` preference, or let it discover the loopback default.

- One click plays or pauses; the music bar shows the track, its position in the library, a progress line, and previous/pause/next plus loop mode, shuffle and close. It appears with the rest of the overlay and stays put while it has a failure to report.
- **The bar can be dragged anywhere and closed.** Its whole body is the grip — a press that starts on a control is that control's — and the position is stored as an offset from its anchor, so moving the pet carries the bar along. The "X" stops the music and puts the bar away, and it *stays* away: hovering again does not bring it back (only a failure that arrives afterwards does), because a button that undoes itself reads as a button that does nothing. The music action is the way back — while the bar is closed it offers to *open the player* rather than to play, and that click shows the bar without starting any sound.
- **The folder it plays from can be changed without leaving the page.** The bar's folder button opens a panel naming the folders the service is really scanning, with *switch*, *add* and *restore the service default* — the host's native directory chooser opens from there. The list is persisted, so a restart re-applies it, and a track that the new folders no longer contain is stopped rather than left to fail mid-song. Without a workspace UI on the host, the panel says the chooser is missing instead of offering a dead button.
- **It never starts by itself.** Browsers reject sound without a user gesture, and a rejected `play()` looks exactly like a broken file, so a reload only restores which track was showing.
- **It ducks under the pet's voice.** One `audioBus` owns the `AudioContext`, a music gain node and an analyser, and `localTts` ducks through it: the music drops to a quarter while a sentence is audible and slides back afterwards. Two independent reasons (speech, an open microphone) hold it down until both are released.
- **The pet dances to it.** The analyser's strongest 40–180 Hz bin drives a beat level that the sprite's own animation frame reads, writing the transform directly instead of through React state — and at a quarter amplitude while a tool is running, because a sprite that jumps around mid-task reads as a bug.
- Voice commands: play, pause, next, stop, louder, quieter, loop mode, shuffle. They deliberately share **no wording** with the "stop talking" commands: `别说了` silences the pet, `别放了` stops the music.
- Formats follow the operating system's decoders (mp3, m4a, mp4, wav, flac in practice). A failure is named — no service, autoplay refused, undecodable, unsupported container, empty library — never a spinner.

### Progress

The monitor reads live state straight from the Session Controller — the current session, whether the agent is running, the queue depth, the tool in flight and its step, and a capped window of recent events. The widget surfaces that as behaviour, not as a list:

- the **mood caption** above the pet, inferred from the recent text (calm, focused, busy, satisfied, happy, concerned, frustrated). It is a heuristic cue tally and makes no claim about the user's actual state;
- a short line naming the **tool in flight** while a turn runs, with the pose following it (thinking, working, excited);
- the **growth card**: bond level and title, pettings, and the achievements the lifetime counters have unlocked (eight: pettings, voice commands, all colours tried, all avatars tried, performances, repeat pettings, voice inputs, and one more long-run pettings rung);
- the latest settled assistant reply, **read aloud** when voice is on and the pet is not muted.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package contributes one **list** entry to the ui-layout-owned `shell.overlay` slot (`id: 'pet'`). It declares a root-scope, persisted preferences store (`createPetPrefsStore`) for the avatar, colour, mute flag, dragged position, bond, lifetime counters, earned achievements and the optional speech endpoint. `PetMonitor` — constructed in the plugin `apply` closure, in the object layer — subscribes to `ctx.sessions.list` to follow the current session, then to that Session's control snapshot (`running`, `queue.length`) and its contiguous `eventSource` window. It folds the durable events into a capped `recent` feed and a capped mood-text buffer, and publishes one frozen `PetState` observable. The widget reads it through the inject `hooks` compartment as `usePet`; the store arrives through `useStore`/`actions`; the two mutation verbs that need `ctx` (`submitVoice`, `cancelTurn`) ride the inject face and call `session.prompt(...)` / `session.cancel()` on the current Session face.

The `shell.overlay` slot is click-through; the pet sets `pointer-events: auto` on itself and floats with the theme's prominent elevation. A render fault in an overlay entry is drawn as nothing at all by the slot renderer, so the pet wraps itself in its own error boundary: a fault leaves a small corner chip with the message in its tooltip and a click to retry, never an empty space and a console line nobody reads. All copy lives in the `pet` locale namespace (`zh`/`en`). Colour comes from `--dsw-alias-*` semantic tokens plus component-local properties: `--pet-accent` per avatar, `--pet-on-accent` for ink on a filled accent surface (the theme's brand token is a *neutral* and flips between near-black and near-white, so a hardcoded dark ink paints a black disc on a black fill in one of the two themes), and `--pet-skin-filter` / `--pet-glow` per colour variant. The ring and rail positions are pure geometry (`ring.ts`, `rail.ts`) measured against a per-avatar contour of the artwork, because the pet docks into a corner and the usable arc is not a circle. `audioBus.ts` is the one seam shared by the pet's voice and its music: it owns a lazily created `AudioContext`, one music gain node (which is what makes ducking a single call) and one analyser for the beat, and `mediaSource(element)` attaches an element to it at most once — a second `createMediaElementSource` throws, and a failed one leaves the element silent, so the bus declines to attach rather than attach halfway.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the pet surface is not enough. They move from the browser widget to the session state and the voice seam.

- [Session Controller](../../api/session-controller/README.md) — the `sessions` service, `SessionBinding`, and the event window the monitor reduces.
- [ui-session](../ui-session/README.md) — the `useSessions`/`useSession` standard hooks the client composition exposes.
- [ui-layout](../ui-layout/README.md) — the `shell.overlay` slot the pet registers into.
- [Web client architecture](../../docs/subsystems/web-client.md) — how browser plugins load, register slots, and expose observable state.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package renders host-computed session state for a human and touches no prompt, message, schema, stream, or tool result. Speech in and out prefer the machine-local service (Whisper for input, a neural voice for output) and fall back to the browser Web Speech API; music is streamed from the local file server next to it. The only Session calls are the ordinary `prompt` and `cancel` verbs a human composer would also invoke.

#### KV Cache effect

None; the package never assembles or sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the current pet. They are current package constraints, not a general comparison or a task backlog.

- **Voice depends on where it runs** — the preferred path is a loopback service on this machine (faster-whisper for recognition, a neural voice for synthesis); the pet tells you when it cannot reach it and falls back to typing. The fallback path, the browser Web Speech API, is not universal: on Chromium, recognition needs an HTTPS or `localhost` origin plus a supported locale. Neither path uses a side channel.
- **Music needs its companion service, and cannot browse** — playback is served by a host-side plugin, so with that plugin absent the music action reports it and nothing else breaks. There is no library browser yet: the bar shows and controls the current track, and picking a specific one means skipping, shuffling, or a voice command. Which folders are scanned *can* be changed at runtime (the bar's folder panel), but only one folder at a time can be removed — the panel offers switch, add and restore-default, not a list editor.
- **Music's CORS is open on loopback by default** — the analyser needs `crossOrigin` plus an `Access-Control-Allow-Origin` header to see the samples, so the service allows any local page to read the library and the audio bytes. Narrow `corsOrigin` to the GUI's origin to close that.
- **A `.mp4` plays its sound only** — an `<audio>` element ignores the video track, which is deliberate; showing the picture would mean a video element that becomes a pointer target and can sit on top of the page.
- **The artwork ships as data** — the sprite strips and sound effects are base64 inside the bundle because the plugin host serves JavaScript only. That is why this package is a couple of megabytes; there is no separate asset to add.
- **The activity feed is a rolling local projection** — it follows only what the monitor's event window observed, is capped, and is not a durable transcript. Reload the page and the pet rebuilds it from the current session window.
- **The mood is a heuristic cue tally** over recent text — intentionally shallow. It is a personality gesture, not a sentiment classifier, and makes no claim about the user's actual state.
- **One tool at a time** — the pet tracks the most recent `tool/call` and clears it on the next `tool/result`. It does not model concurrent tool execution.
- **No invariant companion is published** — this is a pure client surface. It declares a `dsh.client` row and a store seat, owns no cross-plugin mutable state beyond its own monitor, and its single slot registration proves disposal through the HMR-safety spec.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The monitor's subscription and the widget's speech session are deliberately split: subscriptions (sessions list, session control snapshot, event window) live in `PetMonitor` in the object layer; the Web Speech recognition instance is component-private state in `PetWidget` and is aborted on unmount. Keep future live-data additions in the monitor's observable rather than a second subscription in the component, and keep every product-visible string in the `pet` locale namespace.

</details>

**Runtime invariant:** No companion is published. The pet is a read-mostly projection of live session state onto one `shell.overlay` list entry, plus a voice I/O surface. It emits no cordis events, owns no cross-plugin mutable state beyond its own monitor and persisted preferences store, and its single slot registration proves disposal through the HMR-safety spec.
