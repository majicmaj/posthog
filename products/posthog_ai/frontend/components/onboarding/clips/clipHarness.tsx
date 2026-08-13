import { BindLogic, useActions } from 'kea'
import { type ReactNode, useEffect, useMemo, useRef } from 'react'

import { runStreamLogic } from '../../../logics/runStreamLogic'
import type { StoredLogEntry } from '../../../types/wireTypes'

/**
 * Recording rig for the onboarding step clips.
 *
 * Each clip is a Storybook story filmed by `bin/record-onboarding-clips.mjs`. Rather than capture a live
 * agent run — which needs gateway credentials, takes a different path every time, and would put someone's
 * real project data in a public asset — a clip replays a scripted list of wire frames through the real
 * `runStreamLogic`. The fold, the thread, the tool cards and the plan card are all the product's own; only
 * the frames are authored.
 *
 * The stage is sized to the dialog's media panel (544x306 CSS px) and doubled with `zoom`, so the film is
 * 1088x612 device pixels of UI laid out at the width it will actually be displayed at. Recording a full
 * 1440px window instead would shrink the app to 38% in the panel, where body text lands at ~5px.
 */

/** The media panel's CSS size, from `.PhaiOnboardingTakeover__media` at the 36rem dialog width. */
export const CLIP_WIDTH = 544
export const CLIP_HEIGHT = 306
/** Films at 2x so the clip is crisp on a retina display. */
export const CLIP_SCALE = 2

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

/** Splits text into chunk frames so the clip shows it typing rather than appearing whole. */
export function streamedMessage(messageId: string, text: string, startAt: number, msPerChunk: number): ClipBeat[] {
    const words = text.split(' ')
    const chunkSize = 3
    const beats: ClipBeat[] = []
    for (let i = 0; i < words.length; i += chunkSize) {
        const delta = (i === 0 ? '' : ' ') + words.slice(i, i + chunkSize).join(' ')
        beats.push({
            at: startAt + (i / chunkSize) * msPerChunk,
            frame: sessionUpdate({ sessionUpdate: 'agent_message_chunk', messageId, content: { text: delta } }),
        })
    }
    beats.push({
        at: startAt + Math.ceil(words.length / chunkSize) * msPerChunk,
        frame: sessionUpdate({ sessionUpdate: 'agent_message', messageId, content: { text } }),
    })
    return beats
}

/**
 * Handle the recorder uses to start a clip on cue. A story mounts several seconds after navigation, so a
 * schedule that began at mount would already be part-run by the time capture starts.
 */
declare global {
    interface Window {
        __phaiClipReplay?: () => void
    }
}

function ClipScript({ beats }: { beats: readonly ClipBeat[] }): null {
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
        if (new URLSearchParams(window.location.search).get('clipAutoplay') !== '0') {
            play()
        }

        return () => {
            timers.forEach((timer) => clearTimeout(timer))
            delete window.__phaiClipReplay
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    return null
}

export interface ClipStageProps {
    /** Distinct per clip so two stories never share folded state. */
    streamKey: string
    beats: readonly ClipBeat[]
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
export function ClipStage({ streamKey, beats, children }: ClipStageProps): JSX.Element {
    // Stable identity: an inline object would hand `BindLogic` fresh props on every render, remounting the
    // logic — and clearing the log — with each frame the script delivers.
    const logicProps = useMemo(() => ({ streamKey }), [streamKey])

    return (
        <div className="w-[544px] h-[306px] overflow-hidden bg-primary [zoom:2]">
            <BindLogic logic={runStreamLogic} props={logicProps}>
                <ClipScript beats={beats} />
                {/* Bottom-anchored, the way a real thread sits: the turn fills the panel from the floor up
                    instead of stranding the last card above half a frame of empty background. */}
                <div className="flex h-full flex-col justify-end overflow-hidden px-3 py-2">{children}</div>
            </BindLogic>
        </div>
    )
}
