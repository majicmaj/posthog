import { useActions, useValues } from 'kea'
import { useMemo } from 'react'

import { LemonButton, LemonSelect } from '@posthog/lemon-ui'

import { LemonField } from 'lib/lemon-ui/LemonField'

import { modelCatalogueLogic } from 'products/posthog_ai/frontend/logics/modelCatalogueLogic'
import {
    filterEffortForModel,
    getEffortLabel,
    getEffortsForModel,
    getModelLabel,
    getRuntimeAdapterLabel,
    listRuntimeAdapters,
    modelsForRuntimeAdapter,
} from 'products/posthog_ai/frontend/utils/composerModels'

import { type AIRunPreferenceDraft, draftFromStored, taskAgentDefaultsLogic } from './taskAgentDefaultsLogic'

function PreferenceEditor({
    draft,
    saved,
    saving,
    inheritLabel,
    helpText,
    onChange,
    onSave,
}: {
    draft: AIRunPreferenceDraft
    /** What's currently stored, so Save can tell whether there's anything to send. */
    saved: AIRunPreferenceDraft
    saving: boolean
    inheritLabel: string
    helpText: string
    onChange: (draft: Partial<AIRunPreferenceDraft>) => void
    onSave: () => void
}): JSX.Element {
    const { catalogue } = useValues(modelCatalogueLogic)

    // Grouped by harness off the same catalogue the composer renders, so a model you can pick for a
    // run is always settable as a default and vice versa — including the Codex models that only
    // Slack and PostHog Code drive today.
    const modelOptions = useMemo(
        () =>
            listRuntimeAdapters(catalogue).map((adapter) => ({
                title: getRuntimeAdapterLabel(adapter),
                options: modelsForRuntimeAdapter(catalogue, adapter).map((choice) => ({
                    value: choice.model,
                    label: choice.display_name,
                })),
            })),
        [catalogue]
    )
    const effortOptions = useMemo(() => getEffortsForModel(catalogue, draft.model), [catalogue, draft.model])

    // Nothing to save until the draft differs from what's stored — a Save that always looks clickable
    // gives no signal about whether the change landed.
    const dirty = draft.model !== saved.model || draft.reasoning_effort !== saved.reasoning_effort

    return (
        <div className="flex flex-col gap-2 max-w-160">
            <div className="flex flex-wrap items-end gap-2">
                <LemonField.Pure label="Model" className="min-w-60">
                    <LemonSelect
                        fullWidth
                        value={draft.model}
                        onChange={(model) =>
                            onChange({
                                model,
                                // A model switch may invalidate the picked effort; drop it rather than store one
                                // the model can't run, and let the server-side default apply instead.
                                reasoning_effort:
                                    draft.reasoning_effort && model
                                        ? filterEffortForModel(catalogue, draft.reasoning_effort, model)
                                        : null,
                            })
                        }
                        options={[
                            { options: [{ value: null as string | null, label: inheritLabel }] },
                            ...modelOptions,
                        ]}
                        placeholder={inheritLabel}
                        data-attr="task-agent-default-model"
                    />
                </LemonField.Pure>
                <LemonField.Pure label="Reasoning effort" className="min-w-48">
                    <LemonSelect
                        fullWidth
                        value={draft.reasoning_effort}
                        onChange={(reasoning_effort) => onChange({ reasoning_effort })}
                        options={[
                            { value: null as string | null, label: 'Default effort' },
                            ...effortOptions.map(({ value, label }) => ({ value: value as string, label })),
                        ]}
                        disabledReason={draft.model ? undefined : 'Pick a model first'}
                        data-attr="task-agent-default-effort"
                    />
                </LemonField.Pure>
                <LemonButton
                    type="primary"
                    onClick={onSave}
                    loading={saving}
                    disabledReason={dirty ? undefined : 'No changes to save'}
                >
                    Save
                </LemonButton>
            </div>
            <p className="text-secondary text-xs mb-0">{helpText}</p>
        </div>
    )
}

export function TaskAgentProjectDefaultSettings(): JSX.Element {
    const { teamDraft, teamPreferences, teamPreferencesLoading } = useValues(taskAgentDefaultsLogic)
    const { setTeamDraft, submitTeamDraft } = useActions(taskAgentDefaultsLogic)

    return (
        <PreferenceEditor
            draft={teamDraft}
            saved={draftFromStored(teamPreferences)}
            saving={teamPreferencesLoading}
            inheritLabel="No project default"
            helpText="Everyone on this project inherits this unless they set their own preference below. Leave it unset to let PostHog choose."
            onChange={setTeamDraft}
            onSave={submitTeamDraft}
        />
    )
}

export function TaskAgentMyPreferenceSettings(): JSX.Element {
    const { myDraft, myPreferences, myPreferencesLoading, resolvedDefaults } = useValues(taskAgentDefaultsLogic)
    const { catalogue } = useValues(modelCatalogueLogic)
    const { setMyDraft, submitMyDraft } = useActions(taskAgentDefaultsLogic)

    return (
        <div className="flex flex-col gap-2">
            <PreferenceEditor
                draft={myDraft}
                saved={draftFromStored(myPreferences?.ai_run_preferences)}
                saving={myPreferencesLoading}
                inheritLabel="Use project default"
                helpText="Applies to runs you start from anywhere in PostHog — the task composer, Slack, and PostHog Code."
                onChange={setMyDraft}
                onSave={submitMyDraft}
            />
            <p className="text-secondary mb-0">
                {resolvedDefaults?.model ? (
                    <>
                        Runs you start without picking a model will use{' '}
                        <strong>{getModelLabel(catalogue, resolvedDefaults.model)}</strong>
                        {resolvedDefaults.reasoning_effort ? (
                            <> ({getEffortLabel(resolvedDefaults.reasoning_effort)} effort)</>
                        ) : null}{' '}
                        from the {resolvedDefaults.source === 'user' ? 'preference above' : 'project default'}.
                    </>
                ) : (
                    <>No default is set — runs use each surface's built-in model.</>
                )}
            </p>
        </div>
    )
}
