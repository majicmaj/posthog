export enum AlertsTab {
    INSIGHTS = 'insights',
    LOGS = 'logs',
}

export function getAlertsDescription(tab: AlertsTab): string {
    if (tab === AlertsTab.LOGS) {
        return 'Monitor matching logs and get notified when they cross a threshold.'
    }
    return 'Monitor insight metrics and get notified when conditions are met.'
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
