# Onboarding step clips

The short videos that play in the media panel of the PostHog AI onboarding dialog — one per step, except `meet`, which keeps a glyph because it makes a claim about architecture rather than showing anything.

Output lands in `frontend/public/posthog-ai-onboarding/` as `<step>.mp4` plus a `<step>.jpg` poster, and `onboardingSteps.tsx` points each step at its pair.

## Recording

```bash
pnpm storybook                                    # must already be running on :6006
node products/posthog_ai/frontend/components/onboarding/clips/recordClips.mjs            # all of them
node products/posthog_ai/frontend/components/onboarding/clips/recordClips.mjs ask start  # or just these
```

Needs `ffmpeg` on `PATH` and Playwright's Chromium. On a Mac that is `brew install ffmpeg` and `npx playwright install chromium`; this repo's devbox already has both.

Set `STORYBOOK_URL` if Storybook is somewhere other than `http://localhost:6006`.

**Re-recording on a different machine changes the pixels.** Font rasterization is not the same across platforms, so a Mac recording will not be byte-identical to a Linux one and will usually look better. Re-record the whole set rather than a single clip, so the five don't come from two different machines.

## How a clip is made

Nothing is captured from a live agent run. Each clip is a Storybook story that replays a scripted list of wire frames through the real `runStreamLogic`, so the thread, tool cards, plan card, and pull request card are the product's own rendering — only the frames are authored.

That is deliberate, and worth keeping:

- A live run needs gateway credentials and a Docker sandbox, so most people can't reproduce one.
- A live run takes a different path every time, so a re-record is never a re-record.
- These files are committed to a public repo and served to every user. Nothing from a real project can be in them.

**Everything visible in a clip must be invented.** Not anonymized, not adapted from something real — invented from a list of what the frame has to show. Repositories should be PostHog's own public ones.

## Editing a clip

Scripts live in `OnboardingClips.stories.tsx`, one `ClipTimeline` per step:

```ts
const ASK_CLIP = new ClipTimeline()
  .ask('Which countries did our signups come from last week?')
  .hero(sessionUpdate({ sessionUpdate: 'tool_call' /* … */ }))
  .frame(sessionUpdate({ sessionUpdate: 'tool_call_update' /* … */ }))
  .say('ask-2', 'Signups came from 31 countries. …')
```

The timeline accumulates holds, so beats are written in order and no timestamp is computed by hand. `durationMs` comes off the same cursor and is published to the recorder on `window.__phaiClipDurationMs`, so the film length can't drift from the script.

Each story is watchable in Storybook, where it plays on mount. The recorder opens it with `clipAutoplay=0` and starts it by hand, so capture can't catch a run already in progress.

### Pacing

A clip plays in a 306px panel while the viewer is also reading the step's headline and body, and it loops. A clip longer than the few seconds someone spends on a step is never seen whole — it gets cut off and restarted. So the target is **6-8 seconds**, and the budget goes to the one thing the step is selling.

The constants in `clipHarness.tsx` are perception thresholds rather than taste:

| Constant              | Value  | Why                                                                        |
| --------------------- | ------ | -------------------------------------------------------------------------- |
| `BEAT_MIN`            | 500ms  | Below roughly 400ms two changes read as one jump cut instead of two events |
| `SKIM_MS_PER_WORD`    | 120ms  | Enough to register what a line is. Nobody reads a demo word by word        |
| `SKIM_MAX`            | 1400ms | Past this a supporting beat reads as waiting rather than moving            |
| `HERO_HOLD`           | 2600ms | The query, the plan, the payoff — the only beat that gets a full hold      |
| `STREAM_MS_PER_CHUNK` | 60ms   | Per 3-word chunk. Reads as live without costing real time                  |
| `CLIP_TAIL`           | 700ms  | So the last frame lands before the loop cuts                               |

Use `.hero()` for exactly one beat per clip. If two beats both feel essential, the script is trying to say too much for the panel.

## Geometry

The stage is 544×306 — the media panel's own CSS size — doubled with `zoom`, so the film is 1088×612 device pixels of UI laid out at the width it will actually be displayed at.

Filming a full 1440px window instead would put the app in the panel at 38%, where its body text lands around 5px. This is the constraint that decides what a clip can show: one region at close to natural size, never a whole screen.

The thread renders in flow mode with the stage supplying the row gap. `VirtualizedThread.Row` is transparent when `virtualized={false}` and `Root` renders rows as bare siblings, so inter-message spacing is the parent's job — without `gap-1.5` on the stage the messages butt together.
