import { dayjs } from 'lib/dayjs'

export enum AlertsTab {
    INSIGHTS = 'insights',
    LOGS = 'logs',
}

export function resolveSnoozeUntil(value: string): string {
    const relativeValue = value.match(/^\+(\d+)([mhdwMy])$/)
    if (!relativeValue) {
        return dayjs(value).endOf('day').toISOString()
    }

    const amount = Number(relativeValue[1])
    const unit = relativeValue[2]
    if (unit === 'm') {
        return dayjs().add(amount, 'minute').toISOString()
    }
    if (unit === 'h') {
        return dayjs().add(amount, 'hour').toISOString()
    }
    if (unit === 'd') {
        return dayjs().add(amount, 'day').toISOString()
    }
    if (unit === 'w') {
        return dayjs().add(amount, 'week').toISOString()
    }
    if (unit === 'M') {
        return dayjs().add(amount, 'month').toISOString()
    }
    return dayjs().add(amount, 'year').toISOString()
}

interface AlertsAccessState {
    alertId: string | null
    requestedTab: string | undefined
    canViewInsightAlerts: boolean
    canViewLogAlerts: boolean
}

interface AlertsTabsState {
    canViewInsightAlerts: boolean
    canViewLogAlerts: boolean
}

export function getActiveAlertsTab({
    alertId,
    requestedTab,
    canViewInsightAlerts,
    canViewLogAlerts,
}: AlertsAccessState): AlertsTab | null {
    if (alertId !== null) {
        return canViewInsightAlerts ? AlertsTab.INSIGHTS : null
    }
    if (requestedTab === AlertsTab.LOGS && canViewLogAlerts) {
        return AlertsTab.LOGS
    }
    if (canViewInsightAlerts) {
        return AlertsTab.INSIGHTS
    }
    if (canViewLogAlerts) {
        return AlertsTab.LOGS
    }
    return null
}

export function getAlertsTabs({
    canViewInsightAlerts,
    canViewLogAlerts,
}: AlertsTabsState): { key: AlertsTab; label: string }[] {
    const tabs: { key: AlertsTab; label: string }[] = []
    if (canViewInsightAlerts) {
        tabs.push({ key: AlertsTab.INSIGHTS, label: 'Insight alerts' })
    }
    if (canViewLogAlerts) {
        tabs.push({ key: AlertsTab.LOGS, label: 'Log alerts' })
    }
    return tabs
}
