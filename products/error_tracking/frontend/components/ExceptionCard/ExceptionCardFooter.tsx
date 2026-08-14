import { IconCopy } from '@posthog/icons'
import { LemonButton } from '@posthog/lemon-ui'

import { TZLabel } from 'lib/components/TZLabel'
import { copyToClipboard } from 'lib/utils/copyToClipboard'
import { midEllipsis } from 'lib/utils/strings'

export interface ExceptionCardFooterProps {
    eventId?: string
    label?: JSX.Element
    timestamp?: string
}

export function ExceptionCardFooter({ eventId, label, timestamp }: ExceptionCardFooterProps): JSX.Element | null {
    if (!eventId && !label && !timestamp) {
        return null
    }

    return (
        <footer className="sticky bottom-0 z-10 flex min-h-9 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t bg-surface-primary px-2 py-1 text-xs">
            {eventId ? (
                <div className="flex min-w-0 items-center gap-1">
                    <span className="shrink-0 text-secondary">Exception ID</span>
                    <code className="truncate font-mono" title={eventId}>
                        {midEllipsis(eventId, 18)}
                    </code>
                    <LemonButton
                        icon={<IconCopy />}
                        size="xsmall"
                        noPadding
                        tooltip="Copy exception ID"
                        aria-label="Copy exception ID"
                        data-attr="exception-card-copy-id"
                        onClick={() => void copyToClipboard(eventId, 'exception ID')}
                    />
                </div>
            ) : null}
            <div className="ml-auto flex shrink-0 items-center gap-2">
                {label}
                {timestamp ? <TZLabel className="text-muted text-xs" time={timestamp} /> : null}
            </div>
        </footer>
    )
}
