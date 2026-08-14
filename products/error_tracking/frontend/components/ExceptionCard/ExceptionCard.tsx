import { BindLogic, useActions, useValues } from 'kea'
import { useEffect, useMemo } from 'react'

import { IconLogomark } from '@posthog/icons'
import { LemonCard } from '@posthog/lemon-ui'

import { ErrorPropertiesLogicProps, errorPropertiesLogic } from 'lib/components/Errors/errorPropertiesLogic'
import { ErrorEventType } from 'lib/components/Errors/types'
import { TabsPrimitive, TabsPrimitiveList, TabsPrimitiveTrigger } from 'lib/ui/TabsPrimitive/TabsPrimitive'

import { ExceptionCardFooter } from './ExceptionCardFooter'
import { exceptionCardLogic } from './exceptionCardLogic'
import { PropertiesTab } from './Tabs/PropertiesTab'
import { SessionTab } from './Tabs/SessionTab'
import { StackTraceTab } from './Tabs/StackTraceTab'

interface ExceptionCardContentProps {
    eventId?: string
    timestamp?: string
    label?: JSX.Element

    renderStackTraceActions?: () => JSX.Element | null
}

export interface ExceptionCardProps extends ExceptionCardContentProps {
    issueId: string
    issueName: string | null
    event?: ErrorEventType
    loading: boolean
}

export function ExceptionCard({
    issueId,
    issueName,
    event,
    loading,
    ...contentProps
}: ExceptionCardProps): JSX.Element {
    const cardLogicProps = useMemo(() => ({ issueId }), [issueId])
    const { setLoading } = useActions(exceptionCardLogic(cardLogicProps))

    useEffect(() => {
        setLoading(loading)
    }, [setLoading, loading])

    const eventProps = useMemo(
        () =>
            ({
                properties: event?.properties,
                id: event?.uuid ?? issueId ?? 'error',
                timestamp: event?.timestamp,
            }) as ErrorPropertiesLogicProps,
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [event?.uuid ?? issueId]
    )

    return (
        <BindLogic logic={exceptionCardLogic} props={cardLogicProps}>
            <BindLogic logic={errorPropertiesLogic} props={eventProps}>
                <ExceptionCardContent eventId={event?.uuid} timestamp={event?.timestamp} {...contentProps} />
            </BindLogic>
        </BindLogic>
    )
}

function ExceptionCardContent({
    eventId,
    timestamp,
    renderStackTraceActions,
    label,
}: ExceptionCardContentProps): JSX.Element {
    const { currentTab } = useValues(exceptionCardLogic)
    const { setCurrentTab } = useActions(exceptionCardLogic)

    return (
        <LemonCard hoverEffect={false} className="p-0 relative w-full h-full border-0 rounded-none flex flex-col">
            <TabsPrimitive value={currentTab} onValueChange={setCurrentTab} className="flex flex-col flex-1 min-h-0">
                <div className="flex justify-between h-[2rem] items-center w-full px-2 border-b shrink-0">
                    <TabsPrimitiveList className="flex justify-between w-full h-full items-center">
                        <div className="w-full h-full">
                            <div className="flex items-center gap-1 text-lg h-full">
                                <IconLogomark />
                                <span className="text-sm">Exception</span>
                            </div>
                        </div>
                        <div className="flex gap-2 w-full justify-center h-full">
                            <TabsPrimitiveTrigger className="px-2 whitespace-nowrap" value="stack_trace">
                                Stack Trace
                            </TabsPrimitiveTrigger>
                            <TabsPrimitiveTrigger className="px-2 whitespace-nowrap" value="properties">
                                Properties
                            </TabsPrimitiveTrigger>
                            <TabsPrimitiveTrigger className="px-2 whitespace-nowrap" value="session">
                                Session
                            </TabsPrimitiveTrigger>
                        </div>
                        <div className="w-full" />
                    </TabsPrimitiveList>
                </div>
                <StackTraceTab value="stack_trace" renderActions={renderStackTraceActions} className="flex-1 min-h-0" />
                <PropertiesTab value="properties" className="flex-1 min-h-0" />
                <SessionTab value="session" timestamp={timestamp} className="flex-1 min-h-0" />
                <ExceptionCardFooter eventId={eventId} label={label} timestamp={timestamp} />
            </TabsPrimitive>
        </LemonCard>
    )
}
