import { useActions } from 'kea'
import { match } from 'ts-pattern'

import { Spinner } from '@posthog/lemon-ui'

import { ExceptionAttributes } from 'lib/components/Errors/types'
import { concatValues } from 'lib/components/Errors/utils'

import { ERROR_TRACKING_ISSUE_SCENE_LOGIC_KEY, issueFiltersLogic } from '../IssueFilters/issueFiltersLogic'
import { ExceptionPropertiesTable } from './ExceptionPropertiesTable'

export type ContextDisplayProps = {
    loading: boolean
    exceptionAttributes: ExceptionAttributes | null
    additionalProperties: Record<string, unknown>
}

export function ContextDisplay({
    loading,
    exceptionAttributes,
    additionalProperties,
}: ContextDisplayProps): JSX.Element {
    const { addPropertyFilter } = useActions(issueFiltersLogic({ logicKey: ERROR_TRACKING_ISSUE_SCENE_LOGIC_KEY }))
    const onFilterValue = (key: string, value: string | number | boolean): void => {
        addPropertyFilter(key, value)
    }
    const additionalEntries = Object.entries(additionalProperties)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey, undefined, { sensitivity: 'base' }))
        .map(([key, value]) => ({
            key,
            value,
            filterKey: key,
        }))
    const exceptionEntries = exceptionAttributes
        ? [
              { key: 'Level', value: exceptionAttributes.level, filterKey: '$exception_level' },
              { key: 'Synthetic', value: exceptionAttributes.synthetic },
              {
                  key: 'Library',
                  value: concatValues(exceptionAttributes, 'lib', 'libVersion'),
                  filterKey: '$lib',
                  filterValue: exceptionAttributes.lib,
              },
              { key: 'Handled', value: exceptionAttributes.handled },
              {
                  key: 'Browser',
                  value: concatValues(exceptionAttributes, 'browser', 'browserVersion'),
                  filterKey: '$browser',
                  filterValue: exceptionAttributes.browser,
              },
              {
                  key: 'App',
                  value: concatValues(exceptionAttributes, 'appNamespace', 'appVersion'),
                  filterKey: '$app_namespace',
                  filterValue: exceptionAttributes.appNamespace,
              },
              {
                  key: 'OS',
                  value: concatValues(exceptionAttributes, 'os', 'osVersion'),
                  filterKey: '$os',
                  filterValue: exceptionAttributes.os,
              },
              { key: 'URL', value: exceptionAttributes.url, filterKey: '$current_url' },
          ]
        : []

    return (
        <>
            {match(loading)
                .with(true, () => (
                    <div className="flex justify-center w-full h-32 items-center">
                        <Spinner />
                    </div>
                ))
                .with(false, () => (
                    <ExceptionPropertiesTable
                        sections={[
                            {
                                id: 'built-in-exception-properties',
                                title: 'Built-in properties',
                                entries: exceptionEntries,
                            },
                            {
                                id: 'custom-exception-properties',
                                title: 'Custom properties',
                                entries: additionalEntries,
                            },
                        ]}
                        onFilterValue={onFilterValue}
                    />
                ))
                .exhaustive()}
        </>
    )
}
