import { BindLogic, useActions } from 'kea'
import { type ReactNode, useEffect, useMemo, useRef } from 'react'

import { runStreamLogic } from '../../../logics/runStreamLogic'
import type { StoredLogEntry } from '../../../types/wireTypes'

/**
 * Recording rig for the onboarding step clips.
 *
 * Each clip is a Storybook story filmed by `recordClips.mjs` — see README.md. Rather than capture a live
 * agent run — which needs gateway credentials, takes a different path every time, and would put someone's
 * real project data in a public asset — a clip replays a scripted list of wire frames through the real
 * `runStreamLogic`. The fold, the thread, the tool cards and the plan card are all the product's own; only
 * the frames are authored.
 *
 * The stage is sized to the dialog's media panel (544x306 CSS px) and doubled with `zoom`, so the film is
 * 1088x612 device pixels of UI laid out at the width it will actually be displayed at. Recording a full
 * 1440px window instead would shrink the app to 38% in the panel, where body text lands at ~5px.
 */

export interface ClipBeat {
    /** Milliseconds from the start of the clip. */
    at: number
    frame?: StoredLogEntry
    /**
     * Wire frames default to `replay`, which is what makes a scripted user turn render: the fold leaves a
     * `live` user turn to the composer's echo, which a clip has no composer to produce.
     */
    source?: 'live' | 'replay'
    /** For beats the wire can't express — run artifacts, and the local state of a non-thread clip. */
    run?: (actions: typeof runStreamLogic.actions) => void
}

export function notification(method: string, params: Record<string, unknown>): StoredLogEntry {
    return { type: 'notification', notification: { method, params } }
}

export function sessionUpdate(update: Record<string, unknown>): StoredLogEntry {
    return notification('session/update', { update })
}

export function userPrompt(text: string): StoredLogEntry {
    return sessionUpdate({ sessionUpdate: 'user_message', content: { text } })
}

/*
 * Pacing.
 *
 * A clip plays in the dialog's media panel while the viewer is also reading the step's headline and body,
 * and it loops. So a clip longer than the few seconds someone spends on a step never gets seen whole — it
 * is cut off partway and restarted. The target is 6-8 seconds end to end, which means the schedule spends
 * its budget on the one thing the step is selling and moves briskly through everything else.
 *
 * The numbers below are perception thresholds, not taste:
 */

/** Under ~400ms two changes read as one jump cut rather than as two events. */
const BEAT_MIN = 500
/** Skim rate. Enough to register what a line is; not enough to read it word by word, which no one does. */
const SKIM_MS_PER_WORD = 120
/** Ceiling for a supporting beat — past this the clip reads as waiting rather than as moving. */
const SKIM_MAX = 1400
/** The hero beat: the query, the plan, the thing the step exists to show. */
const HERO_HOLD = 2600
/** Per 3-word chunk. Fast enough to feel live, slow enough that the growth is visible. */
const STREAM_MS_PER_CHUNK = 60
/** Trailing hold before the loop restarts, so the last frame lands before it cuts. */
export const CLIP_TAIL = 700

function skimHold(text: string): number {
    return Math.min(Math.max(BEAT_MIN, text.split(' ').length * SKIM_MS_PER_WORD), SKIM_MAX)
}

/**
 * Builds a clip's schedule by accumulating holds, so a script reads as a sequence of beats and no timestamp
 * has to be recomputed by hand when one of them changes.
 */
export class ClipTimeline {
    private cursor = 0
    private readonly beats: ClipBeat[] = []

    /** A wire frame, held for `hold` (defaults to the perception floor). */
    frame(frame: StoredLogEntry, hold: number = BEAT_MIN, source?: 'live' | 'replay'): this {
        this.beats.push({ at: this.cursor, frame, source })
        this.cursor += hold
        return this
    }

    /** The user's turn. Held long enough to register the question, not to study it. */
    ask(text: string): this {
        return this.frame(userPrompt(text), skimHold(text))
    }

    /** An assistant message, streamed in chunks and then held for a skim. */
    say(messageId: string, text: string): this {
        const words = text.split(' ')
        for (let i = 0; i < words.length; i += 3) {
            const delta = (i === 0 ? '' : ' ') + words.slice(i, i + 3).join(' ')
            this.beats.push({
                at: this.cursor + (i / 3) * STREAM_MS_PER_CHUNK,
                frame: sessionUpdate({ sessionUpdate: 'agent_message_chunk', messageId, content: { text: delta } }),
            })
        }
        this.cursor += Math.ceil(words.length / 3) * STREAM_MS_PER_CHUNK
        this.beats.push({
            at: this.cursor,
            frame: sessionUpdate({ sessionUpdate: 'agent_message', messageId, content: { text } }),
        })
        this.cursor += skimHold(text)
        return this
    }

    /** The beat the step is selling — the only one that gets a full hold. */
    hero(frame: StoredLogEntry): this {
        return this.frame(frame, HERO_HOLD)
    }

    /** Something the wire can't express: a run artifact, or a clip's own local state. */
    act(run: NonNullable<ClipBeat['run']>, hold: number = BEAT_MIN): this {
        this.beats.push({ at: this.cursor, run })
        this.cursor += hold
        return this
    }

    /** An explicit pause, for a beat that needs more room than its kind normally gets. */
    wait(ms: number): this {
        this.cursor += ms
        return this
    }

    /** Milliseconds the clip needs, tail included — what the recorder should film. */
    get durationMs(): number {
        return this.cursor + CLIP_TAIL
    }

    build(): ClipBeat[] {
        return this.beats
    }
}

/**
 * Handle the recorder uses to start a clip on cue. A story mounts several seconds after navigation, so a
 * schedule that began at mount would already be part-run by the time capture starts.
 */
declare global {
    interface Window {
        __phaiClipReplay?: () => void
        /** How long the recorder should film. Read from the schedule so the two can't drift apart. */
        __phaiClipDurationMs?: number
    }
}

function ClipScript({ clip }: { clip: ClipTimeline }): null {
    const beats = clip.build()
    const actions = useActions(runStreamLogic)
    // Every ingested frame re-renders this subtree. Reading the actions through a ref keeps the schedule
    // effect on empty deps, so the timers are laid down once instead of being torn down and restarted by
    // the first frame they deliver.
    const actionsRef = useRef(actions)
    actionsRef.current = actions

    useEffect(() => {
        let timers: number[] = []

        const play = (): void => {
            timers.forEach((timer) => clearTimeout(timer))
            actionsRef.current.reset()
            timers = beats.map((beat) =>
                window.setTimeout(() => {
                    if (beat.frame) {
                        actionsRef.current.ingestAcpFrame(beat.frame, beat.source ?? 'replay')
                    }
                    beat.run?.(actionsRef.current)
                }, beat.at)
            )
        }

        // Plays on its own so the story is watchable in Storybook. The recorder opens the story with
        // `clipAutoplay=0` and starts it by hand, so capture can't catch a run already in progress.
        window.__phaiClipReplay = play
        window.__phaiClipDurationMs = clip.durationMs
        if (new URLSearchParams(window.location.search).get('clipAutoplay') !== '0') {
            play()
        }

        return () => {
            timers.forEach((timer) => clearTimeout(timer))
            delete window.__phaiClipReplay
            delete window.__phaiClipDurationMs
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    return null
}

export interface ClipStageProps {
    /** Distinct per clip so two stories never share folded state. */
    streamKey: string
    clip: ClipTimeline
    children: ReactNode
}

/** The film frame itself — the geometry every clip shares, with no stream logic attached. */
export function ClipFrame({ children }: { children: ReactNode }): JSX.Element {
    return (
        <div className="w-[544px] h-[306px] overflow-hidden bg-primary [zoom:2]">
            <div className="h-full overflow-hidden px-3 py-2">{children}</div>
        </div>
    )
}

export interface ClipStep {
    at: number
    run: () => void
}

/**
 * The schedule for a clip that drives its own local state rather than the run stream — the same start cue
 * and replay handle as `ClipStage`, without the logic binding.
 */
export function useClipTimeline(steps: readonly ClipStep[]): void {
    const stepsRef = useRef(steps)
    stepsRef.current = steps

    useEffect(() => {
        let timers: number[] = []

        const play = (): void => {
            timers.forEach((timer) => clearTimeout(timer))
            timers = stepsRef.current.map((step) => window.setTimeout(step.run, step.at))
        }

        window.__phaiClipReplay = play
        if (new URLSearchParams(window.location.search).get('clipAutoplay') !== '0') {
            play()
        }

        return () => {
            timers.forEach((timer) => clearTimeout(timer))
            delete window.__phaiClipReplay
        }
    }, [])
}

/** The framed, zoomed stage every clip is filmed inside. */
export function ClipStage({ streamKey, clip, children }: ClipStageProps): JSX.Element {
    // Stable identity: an inline object would hand `BindLogic` fresh props on every render, remounting the
    // logic — and clearing the log — with each frame the script delivers.
    const logicProps = useMemo(() => ({ streamKey }), [streamKey])

    return (
        <div className="w-[544px] h-[306px] overflow-hidden bg-primary [zoom:2]">
            <BindLogic logic={runStreamLogic} props={logicProps}>
                <ClipScript clip={clip} />
                {/*
                 * Bottom-anchored, the way a real thread sits: the turn fills the panel from the floor up
                 * instead of stranding the last card above half a frame of empty background.
                 *
                 * `gap-1.5` matches the virtualizer's own 6px row gap. In flow mode `VirtualizedThread.Row`
                 * is transparent and `Root` renders rows as bare siblings, so inter-message spacing is the
                 * parent's job — without this the messages butt together.
                 */}
                <div className="flex h-full flex-col justify-end gap-1.5 overflow-hidden px-3 py-2">{children}</div>
            </BindLogic>
        </div>
    )
}
