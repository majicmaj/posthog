import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'

import { Button } from '@posthog/quill-primitives'

import { DEFAULT_ONBOARDING_STEPS, DEFAULT_STARTER_PROMPTS, type OnboardingStep } from './onboardingSteps'
import { OnboardingTakeover, type OnboardingTakeoverProps } from './OnboardingTakeover'

// Logic-free and controlled — the story owns the step index, exactly as `AiOnboardingImpl` does. The dialog
// portals to the document body and covers the viewport, so these stories have no surrounding layout.
const meta: Meta<OnboardingTakeoverProps> = {
    title: 'Products/PostHog AI/OnboardingTakeover',
    component: OnboardingTakeover,
    tags: ['autodocs'],
    parameters: { layout: 'fullscreen' },
    render: ({ steps, stepIndex: initialStepIndex, stepActions }) => {
        const [stepIndex, setStepIndex] = useState(initialStepIndex)
        return (
            <OnboardingTakeover
                open
                steps={steps}
                stepIndex={stepIndex}
                onStepIndexChange={setStepIndex}
                stepActions={stepActions}
                onDismiss={() => {}}
                onFinish={() => {}}
            />
        )
    },
}
export default meta

type Story = StoryObj<OnboardingTakeoverProps>

const starterPromptsAction = (
    <div className="flex flex-col gap-2">
        {DEFAULT_STARTER_PROMPTS.map((prompt) => (
            <Button key={prompt} variant="outline" className="h-auto justify-start whitespace-normal py-1.5 text-start">
                {prompt}
            </Button>
        ))}
    </div>
)

/** The opening step, which has to reset what a returning user expects of the old assistant. */
export const FirstStep: Story = {
    args: { steps: DEFAULT_ONBOARDING_STEPS, stepIndex: 0 },
}

/** The GitHub step, the one conversion in the flow. Its action block is supplied by the host. */
export const ConnectStep: Story = {
    args: {
        steps: DEFAULT_ONBOARDING_STEPS,
        stepIndex: DEFAULT_ONBOARDING_STEPS.findIndex((step) => step.key === 'connect'),
        stepActions: {
            connect: (
                <div className="flex flex-wrap items-center gap-2">
                    <Button variant="primary">Connect GitHub</Button>
                    <Button variant="link-muted" size="sm">
                        I'll do this later
                    </Button>
                </div>
            ),
        },
    },
}

/** The last step. There is no Next button — the starter prompts are the call to action. */
export const StartStep: Story = {
    args: {
        steps: DEFAULT_ONBOARDING_STEPS,
        stepIndex: DEFAULT_ONBOARDING_STEPS.length - 1,
        stepActions: { start: starterPromptsAction },
    },
}

const STEP_WITH_MEDIA: OnboardingStep = {
    ...DEFAULT_ONBOARDING_STEPS[0],
    media: { src: '/static/posthog-ai-onboarding/meet.mp4', poster: '/static/posthog-ai-onboarding/meet.jpg' },
}

/**
 * A step once its clip has been recorded. The manifest ships without media, so every other story exercises
 * the text-only path this one is contrasted against.
 */
export const WithMedia: Story = {
    args: { steps: [STEP_WITH_MEDIA], stepIndex: 0 },
    // The clip loops indefinitely, so the visual-regression runner would wait forever for it to settle.
    tags: ['test-skip'],
}
