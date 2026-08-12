import { memo, useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@posthog/quill-primitives'

import { cn } from 'lib/utils/css-classes'
import { inStorybook, inStorybookTestRunner } from 'lib/utils/dom'

import type { OnboardingStepMediaSpec } from './onboardingSteps'

export interface OnboardingStepMediaProps {
    /** Absent until the step's clip is recorded, in which case `icon` fills the panel instead. */
    media?: OnboardingStepMediaSpec
    /** The step's own glyph, shown when there is no clip. */
    icon: JSX.Element
    /** The clip only plays while its step is the visible one. */
    active: boolean
    /** Alternative text describing what the clip shows. */
    label: string
    onReplay?: () => void
}

// One wrapper for both branches, so a recorded clip drops into the same box the glyph occupied and the
// dialog does not resize when the media lands.
const PANEL = 'PhaiOnboardingTakeover__media relative w-full overflow-hidden rounded-md aspect-video'

function prefersReducedMotion(): boolean {
    return (
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
}

// Hold every clip on its poster frame under Storybook so visual snapshots don't race the decoder.
function shouldAutoplay(): boolean {
    return !prefersReducedMotion() && !inStorybook() && !inStorybookTestRunner()
}

/**
 * A step's looping demo clip. Follows the desktop app's onboarding card (`FeatureBentoCard`): the clip is
 * parked on its poster frame, playback is driven imperatively rather than via `autoplay`/`loop`, and it
 * loops back to `startTime` instead of 0 so the rest position always matches the poster. When motion is
 * reduced the clip holds the still and offers an explicit play control.
 */
export const OnboardingStepMedia = memo(function OnboardingStepMedia({
    media,
    icon,
    active,
    label,
    onReplay,
}: OnboardingStepMediaProps): JSX.Element {
    const videoRef = useRef<HTMLVideoElement>(null)
    const [manuallyPlaying, setManuallyPlaying] = useState(false)
    const startTime = media?.startTime ?? 0

    const play = useCallback((video: HTMLVideoElement): void => {
        try {
            // jsdom stubs `play()` to return undefined rather than a promise, so this can't assume one.
            void video.play()?.catch(() => {
                // play() rejects if the element isn't ready yet; the next effect run retries.
            })
        } catch {
            // No media support at all (jsdom throws outright on some versions).
        }
    }, [])

    const seekToStart = useCallback(
        (video: HTMLVideoElement): void => {
            try {
                video.currentTime = startTime
            } catch {
                // Seeking before metadata is ready is a no-op; `loadedmetadata` retries it.
            }
        },
        [startTime]
    )

    useEffect(() => {
        const video = videoRef.current
        if (!video) {
            return
        }
        if (video.readyState >= 1) {
            seekToStart(video)
            return
        }
        const handler = (): void => seekToStart(video)
        video.addEventListener('loadedmetadata', handler, { once: true })
        return () => video.removeEventListener('loadedmetadata', handler)
    }, [media?.src, seekToStart])

    useEffect(() => {
        const video = videoRef.current
        if (!video) {
            return
        }
        if (active && (shouldAutoplay() || manuallyPlaying)) {
            play(video)
            return
        }
        video.pause()
        seekToStart(video)
        setManuallyPlaying(false)
        // `manuallyPlaying` is deliberately not a dependency: it's reset here, and including it would make
        // this effect cancel the very playback the play button just started.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active, media?.src, play, seekToStart])

    const handleEnded = useCallback((): void => {
        const video = videoRef.current
        if (!video) {
            return
        }
        seekToStart(video)
        if (active && shouldAutoplay()) {
            play(video)
        } else {
            setManuallyPlaying(false)
        }
    }, [active, play, seekToStart])

    const handlePlayClick = useCallback((): void => {
        const video = videoRef.current
        if (!video) {
            return
        }
        setManuallyPlaying(true)
        play(video)
        onReplay?.()
    }, [onReplay, play])

    if (!media) {
        return (
            <div className={cn(PANEL, 'flex items-center justify-center')} aria-hidden>
                {/* Large and low-contrast: a small faint mark in a 306px panel reads as a missing asset,
                    the same mark at this scale reads as the step's own artwork. */}
                <span className="text-[6rem] leading-none text-[var(--foreground)] opacity-15">{icon}</span>
            </div>
        )
    }

    return (
        <div className={PANEL}>
            <video
                ref={videoRef}
                className="block h-full w-full object-cover"
                src={media.src}
                poster={media.poster}
                muted
                playsInline
                preload="metadata"
                aria-label={label}
                onEnded={handleEnded}
            />
            {!shouldAutoplay() && !manuallyPlaying && (
                <Button
                    variant="primary"
                    size="sm"
                    className="absolute bottom-2 end-2"
                    onClick={handlePlayClick}
                    data-attr="posthog-ai-onboarding-play-clip"
                >
                    Play
                </Button>
            )}
        </div>
    )
})
