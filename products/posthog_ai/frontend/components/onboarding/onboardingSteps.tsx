// Default, overridable content for the PostHog AI onboarding takeover. Six steps, in order: reset the
// user's prediction of the old assistant, then one step per capability, ending on a real prompt. Pass your
// own array to override.

export type OnboardingStepKey = 'meet' | 'ask' | 'delegate' | 'connect' | 'skills' | 'start'

export interface OnboardingStepMediaSpec {
    /** Served from `frontend/public/`, referenced as a `/static/…` path so the clip stays out of the bundle. */
    src: string
    /** Still frame the clip rests on before and after playback. */
    poster?: string
    /** Seconds into the clip that `poster` was taken from; playback starts and loops here. */
    startTime?: number
}

export interface OnboardingStep {
    key: OnboardingStepKey
    eyebrow: string
    headline: string
    body: string
    /**
     * Absent until the clip is recorded, in which case the step renders as text only rather than showing a
     * placeholder. Add `{ src: '/static/posthog-ai-onboarding/<key>.mp4', poster: '…jpg' }` once each clip
     * lands in `frontend/public/posthog-ai-onboarding/`.
     */
    media?: OnboardingStepMediaSpec
}

export const DEFAULT_ONBOARDING_STEPS: readonly OnboardingStep[] = [
    {
        key: 'meet',
        eyebrow: 'Meet the new PostHog AI',
        headline: 'PostHog AI is a different product now',
        body: 'It is a coding agent running in its own sandbox, the same agent behind PostHog Code and our Slack app. It plans before it acts, shows the query behind every answer, and keeps working after you close the tab.',
    },
    {
        key: 'ask',
        eyebrow: 'Ask',
        headline: 'Ask in plain language and see the query it ran',
        body: 'Ask about signups, conversion, retention, or anything else in your data, and get the insight back with the query it ran in the open. It covers every PostHog product now, up from 7 in the previous version.',
    },
    {
        key: 'delegate',
        eyebrow: 'Delegate',
        headline: 'Hand it real work',
        body: 'Give it a job with more than one step, like auditing your event tracking or fixing the bug behind an error spike. It writes a plan, you approve it, and it works in the background while results land in your inbox.',
    },
    {
        key: 'connect',
        eyebrow: 'Connect',
        headline: 'Connect GitHub, so it can read how your events actually fire',
        body: 'With GitHub connected it grounds answers in what your product really does, reviews and fixes your PostHog instrumentation, and opens any change it recommends as a pull request. If you already use PostHog Code, you are most likely set up.',
    },
    {
        key: 'skills',
        eyebrow: 'Skills',
        headline: 'Teach it how your team works',
        body: 'Skills are reusable instructions the agent follows every time: your metric definitions, naming conventions, the weekly report format. Create them in PostHog, or keep them in your repo so they stay versioned and reviewable.',
    },
    {
        key: 'start',
        eyebrow: 'Start',
        headline: 'Start with something real',
        body: 'The same agent is in this chat, in Slack, in PostHog Code, and behind the MCP. Pick a question below and it will start right away.',
    },
]

/** One starter prompt per Job from the onboarding research: decide, build the practice, fix the bug. */
export const DEFAULT_STARTER_PROMPTS: readonly string[] = [
    'What changed in my product this week that I should know about?',
    'Audit my event tracking and tell me what is missing or misconfigured.',
    'Find the top user-facing error from the last 7 days and propose a fix.',
]

/**
 * Shown instead when the project has no events yet. The default prompts all read the project's data, so on a
 * brand-new org every one of them would dead-end on an empty result.
 */
export const EMPTY_PROJECT_STARTER_PROMPTS: readonly string[] = [
    'Set up PostHog tracking in my codebase.',
    'What events should I track for a product like mine?',
    'Add error tracking and show me the first issues.',
]
