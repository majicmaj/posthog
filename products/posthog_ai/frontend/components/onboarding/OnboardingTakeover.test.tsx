import '@testing-library/jest-dom'

import { cleanup, render, screen } from '@testing-library/react'

import { DEFAULT_ONBOARDING_STEPS, type OnboardingStep } from './onboardingSteps'
import { OnboardingTakeover } from './OnboardingTakeover'

describe('OnboardingTakeover', () => {
    afterEach(cleanup)

    function renderTakeover(props: Partial<Parameters<typeof OnboardingTakeover>[0]> = {}): void {
        render(
            <OnboardingTakeover
                open
                steps={DEFAULT_ONBOARDING_STEPS}
                stepIndex={0}
                onStepIndexChange={() => {}}
                onDismiss={() => {}}
                onFinish={() => {}}
                {...props}
            />
        )
    }

    // The last step's call to action is the starter prompts, not a Next button. A stale `isLastStep` check
    // would leave a Next button that advances past the end and strands the user on an empty step.
    it('replaces Next with the step action on the last step', () => {
        renderTakeover({
            stepIndex: DEFAULT_ONBOARDING_STEPS.length - 1,
            stepActions: { start: <button type="button">What changed this week?</button> },
        })

        expect(screen.queryByText('Next')).not.toBeInTheDocument()
        expect(screen.getByText('What changed this week?')).toBeInTheDocument()
    })

    // The manifest ships with no media so the dialog can merge before the clips are recorded. A <video> with
    // an undefined src would show alpha users a broken player, and dropping the panel entirely would resize
    // the dialog the day a clip lands.
    it('holds the media panel with the step glyph until a clip is recorded', () => {
        render(
            <OnboardingTakeover
                open
                steps={DEFAULT_ONBOARDING_STEPS}
                stepIndex={0}
                onStepIndexChange={() => {}}
                onDismiss={() => {}}
                onFinish={() => {}}
            />
        )

        expect(document.querySelector('video')).toBeNull()
        expect(document.querySelector('.aspect-video')).not.toBeNull()

        cleanup()

        const withMedia: OnboardingStep = {
            ...DEFAULT_ONBOARDING_STEPS[0],
            media: { src: '/static/posthog-ai-onboarding/meet.mp4' },
        }
        renderTakeover({ steps: [withMedia] })

        expect(document.querySelector('video')).toHaveAttribute('src', '/static/posthog-ai-onboarding/meet.mp4')
    })
})
