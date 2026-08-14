import { useActions, useValues } from 'kea'

import { LemonSwitch } from '@posthog/lemon-ui'

import { errorPropertiesLogic } from 'lib/components/Errors/errorPropertiesLogic'
import { JSONViewer } from 'lib/components/JSONViewer'
import { TabsPrimitiveContent, TabsPrimitiveContentProps } from 'lib/ui/TabsPrimitive/TabsPrimitive'
import { cn } from 'lib/utils/css-classes'

import { ContextDisplay } from '../../ContextDisplay/ContextDisplay'
import { exceptionCardLogic } from '../exceptionCardLogic'
import { SubHeader } from './SubHeader'

export interface PropertiesTabProps extends TabsPrimitiveContentProps {}

export function PropertiesTab({ className, ...props }: PropertiesTabProps): JSX.Element {
    const { properties, exceptionAttributes, additionalProperties } = useValues(errorPropertiesLogic)
    const { loading, showJSONProperties } = useValues(exceptionCardLogic)
    const { setShowJSONProperties } = useActions(exceptionCardLogic)

    return (
        <TabsPrimitiveContent {...props} className={cn('flex flex-col', className)}>
            <SubHeader className="justify-end shrink-0">
                <LemonSwitch
                    checked={showJSONProperties}
                    onChange={setShowJSONProperties}
                    label="JSON"
                    size="xsmall"
                    data-attr="exception-properties-json-switch"
                />
            </SubHeader>
            <div className="flex-1 min-h-0 overflow-y-auto">
                {showJSONProperties ? (
                    <JSONViewer src={properties} name="event" collapsed={1} collapseStringsAfterLength={80} sortKeys />
                ) : (
                    <ContextDisplay
                        loading={loading}
                        exceptionAttributes={exceptionAttributes}
                        additionalProperties={additionalProperties}
                    />
                )}
            </div>
        </TabsPrimitiveContent>
    )
}
