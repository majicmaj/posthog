import { AlertsTab, getActiveAlertsTab, getAlertsDescription } from './utils'

describe('getActiveAlertsTab', () => {
    it.each([
        {
            name: 'defaults to log alerts for a logs-only user',
            alertId: null,
            requestedTab: undefined,
            canViewInsightAlerts: false,
            canViewLogAlerts: true,
            expected: AlertsTab.LOGS,
        },
        {
            name: 'denies access when neither alert type is available',
            alertId: null,
            requestedTab: undefined,
            canViewInsightAlerts: false,
            canViewLogAlerts: false,
            expected: null,
        },
        {
            name: 'denies an insight alert deep link for a logs-only user',
            alertId: 'alert-id',
            requestedTab: undefined,
            canViewInsightAlerts: false,
            canViewLogAlerts: true,
            expected: null,
        },
        {
            name: 'falls back to insight alerts when log alerts are unavailable',
            alertId: null,
            requestedTab: AlertsTab.LOGS,
            canViewInsightAlerts: true,
            canViewLogAlerts: false,
            expected: AlertsTab.INSIGHTS,
        },
    ])('$name', ({ name: _, expected, ...state }) => {
        expect(getActiveAlertsTab(state)).toBe(expected)
    })
})

describe('getAlertsDescription', () => {
    it.each([
        [AlertsTab.INSIGHTS, 'Monitor insight metrics and get notified when conditions are met.'],
        [AlertsTab.LOGS, 'Monitor matching logs and get notified when they cross a threshold.'],
    ])('returns the correct description for %s', (tab: AlertsTab, expected: string) => {
        expect(getAlertsDescription(tab)).toBe(expected)
    })
})
