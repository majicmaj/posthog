import type { Meta, StoryObj } from '@storybook/react'
import { useMemo, useState } from 'react'

import { cn } from 'lib/utils/css-classes'

import { Composer } from '../../composer/Composer'
import { ThreadView } from '../../ThreadView'
import { DEFAULT_STARTER_PROMPTS } from '../onboardingSteps'
import { ClipStage, ClipTimeline, sessionUpdate, userPrompt } from './clipHarness'

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

const ASK_CLIP = new ClipTimeline()
    .ask('Which countries did our signups come from last week?')
    // No "let me check that" line first: the card appearing already says the agent is querying, and the
    // step is selling the query, not the preamble.
    .hero(
        sessionUpdate({
            sessionUpdate: 'tool_call',
            toolCallId: 'ask-query',
            serverName: 'posthog',
            toolName: 'exec',
            rawInput: { command: `call execute-sql ${JSON.stringify({ query: ASK_QUERY })}` },
            status: 'in_progress',
        })
    )
    .frame(
        sessionUpdate({
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
        })
    )
    .say('ask-2', 'Signups came from 31 countries. The United States leads with 412, then Germany with 188.')

/** Step 2 — ask in plain language, see the query it ran. */
export const Ask: Story = {
    render: () => (
        <ClipStage streamKey="clip-ask" clip={ASK_CLIP}>
            <ThreadView virtualized={false} />
        </ClipStage>
    ),
}

const DELEGATE_PLAN = `## Audit checkout tracking

1. Map every checkout event the product fires today
2. Compare them against the steps in the checkout funnel
3. Flag steps with no event, and events firing twice
4. Open a pull request with the instrumentation fixes`

const DELEGATE_CLIP = new ClipTimeline()
    .ask('Audit our checkout tracking and fix what is broken.')
    .say('del-1', 'I will map how checkout fires today, then write a plan.')
    .hero(
        sessionUpdate({
            sessionUpdate: 'tool_call',
            toolCallId: 'del-plan',
            serverName: 'posthog',
            toolName: 'ExitPlanMode',
            rawInput: { plan: DELEGATE_PLAN },
            status: 'pending',
            _meta: { claudeCode: { toolName: 'ExitPlanMode' } },
        })
    )
    .frame(
        sessionUpdate({
            sessionUpdate: 'tool_call_update',
            toolCallId: 'del-plan',
            status: 'completed',
            _meta: { claudeCode: { toolName: 'ExitPlanMode' } },
        })
    )
    .frame(
        sessionUpdate({
            sessionUpdate: 'tool_call',
            toolCallId: 'del-work',
            serverName: 'posthog',
            toolName: 'exec',
            rawInput: { command: 'call query-events {"event":"checkout_started"}' },
            status: 'in_progress',
        })
    )

/** Step 3 — hand it real work: it plans, you approve, it keeps going. */
export const Delegate: Story = {
    render: () => (
        <ClipStage streamKey="clip-delegate" clip={DELEGATE_CLIP}>
            <ThreadView virtualized={false} />
        </ClipStage>
    ),
}

const SKILLS_CLIP = new ClipTimeline()
    .ask('Write up this week for the team.')
    .hero(
        sessionUpdate({
            sessionUpdate: 'tool_call',
            toolCallId: 'skills-invoke',
            serverName: 'posthog',
            toolName: 'Skill',
            rawInput: { skill: 'weekly-product-report' },
            status: 'in_progress',
            _meta: { claudeCode: { toolName: 'Skill' } },
        })
    )
    .frame(
        sessionUpdate({
            sessionUpdate: 'tool_call_update',
            toolCallId: 'skills-invoke',
            status: 'completed',
            _meta: { claudeCode: { toolName: 'Skill' } },
        })
    )
    .say('skills-1', 'Following your weekly report skill: activation first, then retention, then open bugs.')

/** Step 4 — skills are instructions it follows every time. */
export const Skills: Story = {
    render: () => (
        <ClipStage streamKey="clip-skills" clip={SKILLS_CLIP}>
            <ThreadView virtualized={false} />
        </ClipStage>
    ),
}

const CONNECT_CLIP = new ClipTimeline()
    .ask('Is our signup form instrumented correctly?')
    .frame(
        sessionUpdate({
            sessionUpdate: 'tool_call',
            toolCallId: 'connect-read',
            serverName: 'posthog',
            toolName: 'Read',
            rawInput: { file_path: 'src/components/SignupForm.tsx' },
            status: 'in_progress',
            _meta: { claudeCode: { toolName: 'Read' } },
        })
    )
    .frame(
        sessionUpdate({
            sessionUpdate: 'tool_call_update',
            toolCallId: 'connect-read',
            status: 'completed',
            _meta: { claudeCode: { toolName: 'Read' } },
        })
    )
    .say('connect-1', 'signup_completed fires twice: on submit and on the redirect. I opened a pull request.')
    // The PR card is a run artifact rather than a wire frame, so it arrives as an action. It is the payoff
    // of connecting, so it holds like a hero beat.
    .act((actions) => actions.mergeRunArtifacts({ prUrl: 'https://github.com/PostHog/posthog/pull/1' }), 2600)

/** Step 5 — connect GitHub, and it can read the code and open the fix. */
export const Connect: Story = {
    render: () => (
        <ClipStage streamKey="clip-connect" clip={CONNECT_CLIP}>
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

/**
 * Types the prompt in a character at a time. 18ms/char reads as brisk human typing — fast enough that the
 * whole prompt lands in about a second, slow enough that it is visibly being typed rather than pasted.
 */
const TYPE_MS_PER_CHAR = 18

function StartClip(): JSX.Element {
    const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
    const [pressed, setPressed] = useState(false)
    const [draft, setDraft] = useState('')
    const [sent, setSent] = useState(false)

    // The step's own action block already lists the starter prompts, so the clip picks up after the pick:
    // the question lands in the composer, gets sent, and the run is under way before the clip ends.
    const clip = useMemo(() => {
        const timeline = new ClipTimeline()
        for (let i = 0; i < PICKED_PROMPT.length; i++) {
            timeline.act(() => setDraft(PICKED_PROMPT.slice(0, i + 1)), TYPE_MS_PER_CHAR)
        }
        return timeline
            .act(() => setPointer({ x: 470, y: 250 }), 750)
            .act(() => setPressed(true), 200)
            .act(() => {
                setPressed(false)
                setPointer(null)
                setSent(true)
            }, 150)
            .frame(userPrompt(PICKED_PROMPT))
            .say('start-1', 'Starting the audit. Listing the events you send today.')
            .frame(
                sessionUpdate({
                    sessionUpdate: 'tool_call',
                    toolCallId: 'start-scan',
                    serverName: 'posthog',
                    toolName: 'exec',
                    rawInput: { command: 'call event-definitions {"limit":200}' },
                    status: 'in_progress',
                })
            )
    }, [])

    return (
        <ClipStage streamKey="clip-start" clip={clip}>
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
