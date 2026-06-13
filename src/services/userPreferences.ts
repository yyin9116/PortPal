export type Locale = 'zh' | 'en'
export type ThemeMode = 'system' | 'light' | 'dark'
export type DismissedPortKey = string

export interface ScanSettingsForm {
  includeRanges: string
  excludePorts: string
  excludeProcesses: string
  allowProcesses: string
}

export const DEFAULT_SCAN_SETTINGS: ScanSettingsForm = {
  includeRanges: '',
  excludePorts: '',
  excludeProcesses: '',
  allowProcesses: '',
}

const SETTINGS_STORAGE_KEY = 'portpal.scan-settings'
const DISMISSED_PORTS_STORAGE_KEY = 'portpal.dismissed-ports'
const REFRESH_INTERVAL_STORAGE_KEY = 'portpal.refresh-interval'
const LOCALE_STORAGE_KEY = 'portpal.locale'
const THEME_MODE_STORAGE_KEY = 'portpal.theme-mode'

export function loadScanSettings(): ScanSettingsForm {
  return parseStoredSettings(localStorage.getItem(SETTINGS_STORAGE_KEY))
}

export function saveScanSettings(settings: ScanSettingsForm) {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
}

export function loadDismissedPorts(): DismissedPortKey[] {
  return parseStoredDismissed(localStorage.getItem(DISMISSED_PORTS_STORAGE_KEY))
}

export function saveDismissedPorts(dismissedPorts: DismissedPortKey[]) {
  localStorage.setItem(DISMISSED_PORTS_STORAGE_KEY, JSON.stringify(dismissedPorts))
}

export function loadRefreshInterval() {
  const stored = Number(localStorage.getItem(REFRESH_INTERVAL_STORAGE_KEY))
  return Number.isFinite(stored) && stored >= 0 ? stored : 5
}

export function saveRefreshInterval(refreshInterval: number) {
  localStorage.setItem(REFRESH_INTERVAL_STORAGE_KEY, String(refreshInterval))
}

export function loadLocale(): Locale {
  const stored = localStorage.getItem(LOCALE_STORAGE_KEY)
  if (stored === 'zh' || stored === 'en') return stored

  const browserLanguage = navigator.language.toLowerCase()
  return browserLanguage.startsWith('zh') ? 'zh' : 'en'
}

export function saveLocale(locale: Locale) {
  localStorage.setItem(LOCALE_STORAGE_KEY, locale)
}

export function loadThemeMode(): ThemeMode {
  const stored = localStorage.getItem(THEME_MODE_STORAGE_KEY)
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
}

export function saveThemeMode(themeMode: ThemeMode) {
  localStorage.setItem(THEME_MODE_STORAGE_KEY, themeMode)
}

function parseStoredSettings(value: string | null): ScanSettingsForm {
  if (!value) {
    return DEFAULT_SCAN_SETTINGS
  }

  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object') return DEFAULT_SCAN_SETTINGS
    const settings = parsed as Partial<Record<keyof ScanSettingsForm, unknown>>
    return {
      includeRanges: typeof settings.includeRanges === 'string' ? settings.includeRanges : '',
      excludePorts: typeof settings.excludePorts === 'string' ? settings.excludePorts : '',
      excludeProcesses: typeof settings.excludeProcesses === 'string' ? settings.excludeProcesses : '',
      allowProcesses: typeof settings.allowProcesses === 'string' ? settings.allowProcesses : '',
    }
  } catch {
    return DEFAULT_SCAN_SETTINGS
  }
}

function parseStoredDismissed(value: string | null): DismissedPortKey[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}
