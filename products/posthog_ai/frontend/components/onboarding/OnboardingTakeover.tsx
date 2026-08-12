import './OnboardingTakeover.scss'

import { type ReactNode, useCallback } from 'react'

import {
    Button,
    Dialog,
    DialogBody,
    DialogContent,
    DialogFooter,
    DialogTitle,
    Dot,
    Heading,
    Text,
} from '@posthog/quill-primitives'

import { cn } from 'lib/utils/css-classes'

import { OnboardingStepMedia } from './OnboardingStepMedia'
import type { OnboardingStep, OnboardingStepKey } from './onboardingSteps'

// Logic-free onboarding takeover: a full-screen dialog that walks one step at a time. The caller owns the
// step index, what "dismiss" persists, and the interactive blocks for the steps that need live state (the
// GitHub CTA on CONNECT, the starter prompts on START) — this component only presents.

export interface OnboardingTakeoverProps {
    open: boolean
    steps: readonly OnboardingStep[]
    stepIndex: number
    onStepIndexChange: (stepIndex: number) => void
    /** Rendered under the body copy of the matching step. The one seam for steps that read live state. */
    stepActions?: Partial<Record<OnboardingStepKey, ReactNode>>
    /** Fires on the close button, Esc, the backdrop, and the quiet skip link. */
    onDismiss: () => void
    /** Fires when the user advances past the last step. */
    onFinish: () => void
    /** Fires when the user replays a step's clip by hand (only reachable when motion is reduced). */
    onReplayMedia?: (step: OnboardingStep) => void
}

export function OnboardingTakeover({
    open,
    steps,
    stepIndex,
    onStepIndexChange,
    stepActions,
    onDismiss,
    onFinish,
    onReplayMedia,
}: OnboardingTakeoverProps): JSX.Element | null {
    const step = steps[stepIndex]
    const isFirstStep = stepIndex === 0
    const isLastStep = stepIndex === steps.length - 1

    const handleOpenChange = useCallback(
        (nextOpen: boolean): void => {
            if (!nextOpen) {
                onDismiss()
            }
        },
        [onDismiss]
    )

    const handleNext = useCallback((): void => {
        if (isLastStep) {
            onFinish()
        } else {
            onStepIndexChange(stepIndex + 1)
        }
    }, [isLastStep, onFinish, onStepIndexChange, stepIndex])

    if (!step) {
        return null
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent
                className="PhaiOnboardingTakeover"
                data-attr="posthog-ai-onboarding"
                aria-label="What's new in PostHog AI"
            >
                {/* One centered column rather than a header/body split: on a full-screen surface a pinned
                    header leaves the copy stranded at the top above a large void, and a step without its
                    clip yet would look unfinished. */}
                <DialogBody viewportClassName="flex flex-col justify-center">
                    <div className="PhaiOnboardingTakeover__step mx-auto flex w-full flex-col gap-4">
                        <div className="flex flex-col gap-1">
                            <Text
                                render={<span />}
                                size="xs"
                                variant="muted"
                                weight="medium"
                                className="uppercase tracking-wider"
                            >
                                {step.eyebrow}
                            </Text>
                            <DialogTitle render={<Heading size="xl" />}>{step.headline}</DialogTitle>
                        </div>
                        {step.media && (
                            <OnboardingStepMedia
                                media={step.media}
                                active={open}
                                label={step.headline}
                                onReplay={onReplayMedia ? () => onReplayMedia(step) : undefined}
                            />
                        )}
                        <Text variant="muted">{step.body}</Text>
                        {stepActions?.[step.key]}
                    </div>
                </DialogBody>

                {/* Quill's footer stacks below `sm`, which on a narrow viewport puts the step dots above the
                    controls in reverse order. This bar is three small items, so keep it a row throughout. */}
                <DialogFooter className="flex-row items-center justify-between sm:justify-between">
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onStepIndexChange(stepIndex - 1)}
                            disabled={isFirstStep}
                            data-attr="posthog-ai-onboarding-back"
                        >
                            Back
                        </Button>
                        <Button
                            variant="link-muted"
                            size="sm"
                            onClick={onDismiss}
                            data-attr="posthog-ai-onboarding-skip"
                        >
                            {isLastStep ? 'Skip for now' : 'Skip'}
                        </Button>
                    </div>

                    {/* Plain buttons, not a tablist: there are no tab panels here, only a step the whole
                        dialog swaps to, so `aria-current` describes it honestly. */}
                    <div className="flex items-center gap-1.5">
                        {steps.map((indicatorStep, index) => (
                            <button
                                key={indicatorStep.key}
                                type="button"
                                aria-current={index === stepIndex ? 'step' : undefined}
                                aria-label={indicatorStep.eyebrow}
                                className="flex items-center p-1"
                                onClick={() => onStepIndexChange(index)}
                                data-attr={`posthog-ai-onboarding-step-${indicatorStep.key}`}
                            >
                                <Dot
                                    variant={index === stepIndex ? 'info' : 'default'}
                                    className={cn(index !== stepIndex && 'opacity-40')}
                                />
                            </button>
                        ))}
                    </div>

                    {/* The last step's action block carries the call to action, so there's no Next to show. */}
                    {isLastStep ? (
                        <div aria-hidden className="hidden sm:block sm:w-24" />
                    ) : (
                        <Button variant="primary" size="sm" onClick={handleNext} data-attr="posthog-ai-onboarding-next">
                            Next
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
