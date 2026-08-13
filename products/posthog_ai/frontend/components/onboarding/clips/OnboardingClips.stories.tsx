import type { Meta, StoryObj } from '@storybook/react'
import { useMemo, useState } from 'react'

import { cn } from 'lib/utils/css-classes'

import { Composer } from '../../composer/Composer'
import { ThreadView } from '../../ThreadView'
import { DEFAULT_STARTER_PROMPTS } from '../onboardingSteps'
import { type ClipBeat, ClipStage, sessionUpdate, streamedMessage, userPrompt } from './clipHarness'

/**
 * Source for the onboarding step clips. One story per step that gets a recording; see `clipHarness.tsx`
 * for why these are scripted rather than captured from a live run, and `recordClips.mjs` for how they are
 * filmed.
 *
 * Everything shown is invented for the clip. These become public assets in `frontend/public/`, so no frame
 * may carry data, names, or repositories from a real project.
 */
const meta: Meta = {
    title: 'Products/PostHog AI/Onboarding clips',
    // Timed and animated: a visual snapshot would catch a different frame every run.
    tags: ['test-skip'],
    // No decorator padding: the stage is the film, and 16px of inset would crop its right edge.
    parameters: { layout: 'fullscreen' },
}
export default meta

type Story = StoryObj

// One line on purpose: the tool card renders `rawInput` as JSON, so a multi-line query would show its
// newlines escaped rather than broken.
const ASK_QUERY =
    'select properties.$geoip_country_name as country, count(distinct person_id) as signups ' +
    "from events where event = 'signed_up' and timestamp > now() - interval 7 day " +
    'group by country order by signups desc'

const ASK_BEATS: readonly ClipBeat[] = [
    { at: 0, frame: userPrompt('Which countries did our signups come from last week?') },
    ...streamedMessage('ask-1', 'Checking the signup events for the last seven days.', 600, 90),
    {
        at: 2200,
        frame: sessionUpdate({
            sessionUpdate: 'tool_call',
            toolCallId: 'ask-query',
            serverName: 'posthog',
            toolName: 'exec',
            rawInput: { command: `call execute-sql ${JSON.stringify({ query: ASK_QUERY })}` },
            status: 'in_progress',
        }),
    },
    // The query sits open for four seconds: the card auto-expands while the tool runs and collapses once it
    // completes, and the query being visible is the whole point of this step.
    {
        at: 6400,
        frame: sessionUpdate({
            sessionUpdate: 'tool_call_update',
            toolCallId: 'ask-query',
            status: 'completed',
            rawOutput: {
                columns: ['country', 'signups'],
                rows: [
                    ['United States', 412],
                    ['Germany', 188],
                    ['Brazil', 143],
                    ['India', 129],
                    ['United Kingdom', 96],
                ],
            },
        }),
    },
    ...streamedMessage(
        'ask-2',
        'Signups came from 31 countries. The United States leads with 412, then Germany with 188 and Brazil with 143.',
        7000,
        90
    ),
]

/** Step 2 — ask in plain language, see the query it ran. */
export const Ask: Story = {
    render: () => (
        <ClipStage streamKey="clip-ask" beats={ASK_BEATS}>
            <ThreadView virtualized={false} />
        </ClipStage>
    ),
}

const DELEGATE_PLAN = `## Audit checkout tracking

1. Map every checkout event the product fires today
2. Compare them against the steps in the checkout funnel
3. Flag steps with no event, and events firing twice
4. Open a pull request with the instrumentation fixes`

const DELEGATE_BEATS: readonly ClipBeat[] = [
    { at: 0, frame: userPrompt('Audit our checkout tracking and fix what is broken.') },
    ...streamedMessage('del-1', 'I will map how checkout fires today, then write a plan.', 600, 90),
    {
        at: 2600,
        frame: sessionUpdate({
            sessionUpdate: 'tool_call',
            toolCallId: 'del-plan',
            serverName: 'posthog',
            toolName: 'ExitPlanMode',
            rawInput: { plan: DELEGATE_PLAN },
            status: 'pending',
            _meta: { claudeCode: { toolName: 'ExitPlanMode' } },
        }),
    },
    // Long hold: reading the plan is the beat this step is selling.
    {
        at: 9000,
        frame: sessionUpdate({
            sessionUpdate: 'tool_call_update',
            toolCallId: 'del-plan',
            status: 'completed',
            _meta: { claudeCode: { toolName: 'ExitPlanMode' } },
        }),
    },
    {
        at: 9800,
        frame: sessionUpdate({
            sessionUpdate: 'tool_call',
            toolCallId: 'del-work',
            serverName: 'posthog',
            toolName: 'exec',
            rawInput: { command: 'call query-events {"event":"checkout_started"}' },
            status: 'in_progress',
        }),
    },
]

/** Step 3 — hand it real work: it plans, you approve, it keeps going. */
export const Delegate: Story = {
    render: () => (
        <ClipStage streamKey="clip-delegate" beats={DELEGATE_BEATS}>
            <ThreadView virtualized={false} />
        </ClipStage>
    ),
}

const SKILLS_BEATS: readonly ClipBeat[] = [
    { at: 0, frame: userPrompt('Write up this week for the team.') },
    {
        at: 700,
        frame: sessionUpdate({
            sessionUpdate: 'tool_call',
            toolCallId: 'skills-invoke',
            serverName: 'posthog',
            toolName: 'Skill',
            rawInput: { skill: 'weekly-product-report' },
            status: 'in_progress',
            _meta: { claudeCode: { toolName: 'Skill' } },
        }),
    },
    {
        at: 3200,
        frame: sessionUpdate({
            sessionUpdate: 'tool_call_update',
            toolCallId: 'skills-invoke',
            status: 'completed',
            _meta: { claudeCode: { toolName: 'Skill' } },
        }),
    },
    ...streamedMessage(
        'skills-1',
        'Following your weekly report skill: activation first, then retention, then the open bugs. Activation rose to 34% this week.',
        3800,
        90
    ),
]

/** Step 4 — skills are instructions it follows every time. */
export const Skills: Story = {
    render: () => (
        <ClipStage streamKey="clip-skills" beats={SKILLS_BEATS}>
            <ThreadView virtualized={false} />
        </ClipStage>
    ),
}

const CONNECT_BEATS: readonly ClipBeat[] = [
    { at: 0, frame: userPrompt('Is our signup form instrumented correctly?') },
    {
        at: 700,
        frame: sessionUpdate({
            sessionUpdate: 'tool_call',
            toolCallId: 'connect-read',
            serverName: 'posthog',
            toolName: 'Read',
            rawInput: { file_path: 'src/components/SignupForm.tsx' },
            status: 'in_progress',
            _meta: { claudeCode: { toolName: 'Read' } },
        }),
    },
    {
        at: 2600,
        frame: sessionUpdate({
            sessionUpdate: 'tool_call_update',
            toolCallId: 'connect-read',
            status: 'completed',
            _meta: { claudeCode: { toolName: 'Read' } },
        }),
    },
    ...streamedMessage(
        'connect-1',
        'signup_completed fires twice: once on submit and once on the redirect. I opened a pull request that removes the duplicate.',
        3200,
        90
    ),
    // The PR card is a run artifact rather than a wire frame, so it arrives as an action.
    { at: 6600, run: (actions) => actions.mergeRunArtifacts({ prUrl: 'https://github.com/PostHog/posthog/pull/1' }) },
]

/** Step 5 — connect GitHub, and it can read the code and open the fix. */
export const Connect: Story = {
    render: () => (
        <ClipStage streamKey="clip-connect" beats={CONNECT_BEATS}>
            <ThreadView virtualized={false} />
        </ClipStage>
    ),
}

const PICKED_PROMPT = DEFAULT_STARTER_PROMPTS[1]

/** Drawn rather than imported: the icon set has no cursor, and a clip needs one to read as a click. */
function PointerGlyph({ x, y, pressed }: { x: number; y: number; pressed: boolean }): JSX.Element {
    return (
        <svg
            viewBox="0 0 12 18"
            width="14"
            height="21"
            aria-hidden
            className={cn(
                'pointer-events-none absolute left-0 top-0 z-10 transition-transform duration-700 ease-in-out',
                pressed && 'scale-75'
            )}
            style={{ transform: `translate(${x}px, ${y}px)` }}
        >
            <path
                d="M1 1l10 8.5-4.6.6 2.6 5.4-2.2 1-2.6-5.4L1 14z"
                className="fill-white stroke-black"
                strokeWidth="1.2"
                strokeLinejoin="round"
            />
        </svg>
    )
}

/** Types the prompt in a character at a time, so the composer fills the way a person would fill it. */
function typingSteps(text: string, startAt: number, msPerChar: number, set: (value: string) => void): ClipBeat[] {
    return Array.from({ length: text.length }, (_, i) => ({
        at: startAt + i * msPerChar,
        run: () => set(text.slice(0, i + 1)),
    }))
}

const SEND_AT = 3400

function StartClip(): JSX.Element {
    const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
    const [pressed, setPressed] = useState(false)
    const [draft, setDraft] = useState('')
    const [sent, setSent] = useState(false)

    // The step's own action block already lists the starter prompts, so the clip picks up after the pick:
    // the question lands in the composer, gets sent, and the run is under way before the clip ends.
    const beats = useMemo<ClipBeat[]>(
        () => [
            ...typingSteps(PICKED_PROMPT, 500, 26, setDraft),
            { at: SEND_AT - 900, run: () => setPointer({ x: 470, y: 250 }) },
            { at: SEND_AT - 150, run: () => setPressed(true) },
            {
                at: SEND_AT,
                run: () => {
                    setPressed(false)
                    setPointer(null)
                    setSent(true)
                },
            },
            { at: SEND_AT + 150, frame: userPrompt(PICKED_PROMPT) },
            ...streamedMessage('start-1', 'Starting the audit. Listing the events you send today.', SEND_AT + 700, 90),
            {
                at: SEND_AT + 3200,
                frame: sessionUpdate({
                    sessionUpdate: 'tool_call',
                    toolCallId: 'start-scan',
                    serverName: 'posthog',
                    toolName: 'exec',
                    rawInput: { command: 'call event-definitions {"limit":200}' },
                    status: 'in_progress',
                }),
            },
        ],
        []
    )

    return (
        <ClipStage streamKey="clip-start" beats={beats}>
            {sent ? (
                <ThreadView virtualized={false} />
            ) : (
                // Full height so the cursor's coordinates are the stage's, not the composer's.
                <div className="relative flex h-full flex-col justify-end">
                    <Composer.Root value={draft} onChange={setDraft} onSubmit={() => setSent(true)}>
                        <Composer.Frame>
                            <Composer.Field>
                                <Composer.Placeholder>Ask anything, or describe a task…</Composer.Placeholder>
                                <Composer.Textarea />
                            </Composer.Field>
                        </Composer.Frame>
                        <Composer.Submit />
                    </Composer.Root>

                    {/* A stand-in cursor: without one, the send reads as the UI acting on its own. */}
                    {pointer && <PointerGlyph x={pointer.x} y={pointer.y} pressed={pressed} />}
                </div>
            )}
        </ClipStage>
    )
}

/** Step 6 — pick a question and it starts right away. */
export const Start: Story = {
    render: () => <StartClip />,
}
