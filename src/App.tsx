import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  Search,
  Settings,
  RefreshCw,
  Power,
  Copy,
  ExternalLink,
  EyeOff,
  Database,
  Globe,
  Server,
  Network,
  Activity,
  Check,
  X,
  ChevronLeft,
  FolderOpen,
  AlertCircle,
  Languages,
  ChevronDown,
  Monitor,
  Sun,
  Moon,
} from 'lucide-react'
import { PortPalIcon } from './components/PortPalIcon'
import {
  hideCurrentWindow,
  isTauriRuntime,
  killProcess as killNativeProcess,
  onScanRequested,
  openFolder as openNativeFolder,
  openPortInBrowser,
  scanPorts as scanNativePorts,
  startCurrentWindowDrag,
  type KillResult,
  type PortInfo,
  type ScanOptions,
  type ScanResult,
} from './services/portpalTauri'
import {
  DEFAULT_SCAN_SETTINGS,
  loadDismissedPorts,
  loadLocale,
  loadRefreshInterval,
  loadScanSettings,
  loadThemeMode,
  saveDismissedPorts,
  saveLocale,
  saveRefreshInterval,
  saveScanSettings,
  saveThemeMode,
  type DismissedPortKey,
  type Locale,
  type ScanSettingsForm,
  type ThemeMode,
} from './services/userPreferences'

type ServiceType = 'web' | 'api' | 'db' | 'proxy' | 'mq' | 'serve'

const UNKNOWN_VALUES = new Set(['', 'unknown', '未识别来源'])

const translations = {
  zh: {
    appTitle: 'PortPal',
    refresh: '刷新',
    settings: '设置',
    close: '关闭',
    searchPlaceholder: '搜索端口、进程、项目...',
    emptyState: '未发现运行中的服务。',
    copyAddress: '复制地址',
    openInBrowser: '浏览器打开',
    openFolder: '打开目录',
    hideFromList: '从列表隐藏',
    terminateProcess: '终止进程',
    hideWindow: '隐藏',
    activeCount: '运行中',
    hiddenCount: '已隐藏',
    autoRefreshInterval: '自动刷新间隔',
    intervalOff: '关闭',
    intervalSeconds: (value: number) => `${value} 秒`,
    intervalMinute: '1 分钟',
    language: '界面语言',
    languageZh: '中文',
    languageEn: 'English',
    theme: '主题模式',
    themeSystem: '跟随系统',
    themeLight: '浅色',
    themeDark: '深色',
    scanRange: '扫描范围',
    excludePorts: '排除端口',
    excludeProcesses: '排除进程',
    allowProcesses: '白名单进程',
    scanRangePlaceholder: '示例: 80, 3000-3999, 8080',
    excludePortsPlaceholder: '示例: 22, 3306, 5432',
    excludeProcessesPlaceholder: '示例: postgres, Dropbox',
    allowProcessesPlaceholder: '示例: node, bun, python',
    clearRules: '清空规则',
    applyNow: '立即应用',
    lastUpdated: '上次更新',
    noTime: '--:--:--',
    settingsSubtitle: '可手动切换浅色/深色，也可跟随系统',
    quickOptions: '快捷选项',
    scanRules: '扫描规则',
    scanFailedPreview: '扫描失败：当前为浏览器预览，请使用 Tauri 应用运行',
    killFailedPreview: '终止失败：当前为浏览器预览，请使用 Tauri 应用运行',
    openFailedPreview: '打开失败：当前为浏览器预览，请使用 Tauri 应用运行',
    hideFailed: '隐藏窗口失败',
    dragFailed: '窗口拖动失败',
    copyFailed: '复制失败',
    openFailed: '打开失败',
    killFailed: '终止失败',
    scanFailed: '扫描失败',
  },
  en: {
    appTitle: 'PortPal',
    refresh: 'Refresh',
    settings: 'Settings',
    close: 'Close',
    searchPlaceholder: 'Search ports, services, projects...',
    emptyState: 'No running services found.',
    copyAddress: 'Copy URL',
    openInBrowser: 'Open in Browser',
    openFolder: 'Open Folder',
    hideFromList: 'Hide from list',
    terminateProcess: 'Terminate Process',
    hideWindow: 'Hide',
    activeCount: 'Active',
    hiddenCount: 'Hidden',
    autoRefreshInterval: 'Auto-refresh Interval',
    intervalOff: 'Off',
    intervalSeconds: (value: number) => `${value} seconds`,
    intervalMinute: '1 minute',
    language: 'Language',
    languageZh: '中文',
    languageEn: 'English',
    theme: 'Theme',
    themeSystem: 'System',
    themeLight: 'Light',
    themeDark: 'Dark',
    scanRange: 'Scan Range',
    excludePorts: 'Exclude Ports',
    excludeProcesses: 'Exclude Processes',
    allowProcesses: 'Allow Processes',
    scanRangePlaceholder: 'Example: 80, 3000-3999, 8080',
    excludePortsPlaceholder: 'Example: 22, 3306, 5432',
    excludeProcessesPlaceholder: 'Example: postgres, Dropbox',
    allowProcessesPlaceholder: 'Example: node, bun, python',
    clearRules: 'Clear Rules',
    applyNow: 'Apply Now',
    lastUpdated: 'Last Updated',
    noTime: '--:--:--',
    settingsSubtitle: 'Switch manually or follow system theme',
    quickOptions: 'Quick Options',
    scanRules: 'Scan Rules',
    scanFailedPreview: 'Scan failed: running in browser preview, please use the Tauri app',
    killFailedPreview: 'Terminate failed: running in browser preview, please use the Tauri app',
    openFailedPreview: 'Open failed: running in browser preview, please use the Tauri app',
    hideFailed: 'Hide window failed',
    dragFailed: 'Window drag failed',
    copyFailed: 'Copy failed',
    openFailed: 'Open failed',
    killFailed: 'Terminate failed',
    scanFailed: 'Scan failed',
  },
} as const

function normalizeText(value: string) {
  return value.trim()
}

function hasMeaningfulValue(value: string) {
  const normalized = normalizeText(value)
  return normalized.length > 0 && !UNKNOWN_VALUES.has(normalized.toLowerCase())
}

function getBaseName(value: string) {
  const normalized = normalizeText(value)
  if (!normalized) return ''
  const segments = normalized.split(/[\\/]/).filter(Boolean)
  return segments.length > 0 ? segments[segments.length - 1] : ''
}

function shortenPath(path: string) {
  const normalized = normalizeText(path)
  if (!normalized) return ''

  const segments = normalized.split(/[\\/]/).filter(Boolean)
  if (segments.length <= 3) return normalized
  return `.../${segments.slice(-3).join('/')}`
}

function compactCommand(command: string) {
  const normalized = normalizeText(command)
  if (!normalized) return ''

  const tokens = normalized.split(/\s+/)
  const preview = tokens.slice(0, 3).join(' ')
  return tokens.length > 3 ? `${preview} ...` : preview
}

function getProjectLabel(port: PortInfo) {
  if (hasMeaningfulValue(port.project_name)) return port.project_name

  const workdirName = getBaseName(port.work_dir)
  if (workdirName) return workdirName

  if (hasMeaningfulValue(port.process_name)) return port.process_name
  return `Port ${port.port}`
}

function getProcessLabel(port: PortInfo) {
  if (hasMeaningfulValue(port.process_name)) return port.process_name

  const commandBase = getBaseName(port.command.split(/\s+/)[0] ?? '')
  if (commandBase) return commandBase
  return 'unknown-process'
}

function getSourceSummary(port: PortInfo) {
  if (hasMeaningfulValue(port.work_dir)) {
    return `cwd ${shortenPath(port.work_dir)}`
  }

  const commandPreview = compactCommand(port.command)
  if (commandPreview) {
    return `cmd ${commandPreview}`
  }

  return 'source unavailable'
}

function getPortType(port: PortInfo): ServiceType {
  const haystack = `${port.process_name} ${port.command} ${port.project_name}`.toLowerCase()

  if (
    ['postgres', 'mysql', 'mariadb', 'redis', 'mongo', 'mongodb', 'memcached', 'clickhouse'].some((keyword) =>
      haystack.includes(keyword),
    ) ||
    [3306, 5432, 6379, 27017, 11211, 8123].includes(port.port)
  ) {
    return 'db'
  }

  if (['nginx', 'caddy', 'traefik', 'haproxy', 'gateway', 'proxy'].some((keyword) => haystack.includes(keyword))) {
    return 'proxy'
  }

  if (
    ['rabbitmq', 'kafka', 'nats', 'queue', 'mq'].some((keyword) => haystack.includes(keyword)) ||
    [5672, 9092, 4222].includes(port.port)
  ) {
    return 'mq'
  }

  if (
    ['grpc', 'graphql', 'express', 'nestjs', 'fastify', 'koa', 'hono', 'actix', 'axum', 'api', 'server'].some(
      (keyword) => haystack.includes(keyword),
    )
  ) {
    return 'api'
  }

  if (
    ['vite', 'next', 'nuxt', 'react', 'vue', 'svelte', 'astro', 'frontend', 'web'].some((keyword) =>
      haystack.includes(keyword),
    ) ||
    [3000, 4173, 5173, 8000, 8080].includes(port.port)
  ) {
    return 'web'
  }

  return 'serve'
}

function parseIntegerList(value: string) {
  return value
    .split(/[\n,，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item >= 0 && item <= 65535)
}

function parseKeywordList(value: string) {
  return value
    .split(/[\n,，]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseRanges(value: string) {
  return value
    .split(/[\n,，]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .flatMap((item) => {
      if (item.includes('-')) {
        const [startText, endText] = item.split('-', 2).map((part) => part.trim())
        const start = Number(startText)
        const end = Number(endText)
        if (
          Number.isInteger(start) &&
          Number.isInteger(end) &&
          start >= 0 &&
          end >= 0 &&
          start <= 65535 &&
          end <= 65535
        ) {
          return [{ start: Math.min(start, end), end: Math.max(start, end) }]
        }
        return []
      }

      const port = Number(item)
      if (Number.isInteger(port) && port >= 0 && port <= 65535) {
        return [{ start: port, end: port }]
      }
      return []
    })
}

function getPortKey(port: PortInfo): DismissedPortKey {
  return `${port.pid}:${port.port}:${normalizeText(port.address) || 'localhost'}`
}

function getBrowserUrl(port: PortInfo) {
  return `http://localhost:${port.port}`
}

function useSystemDarkMode() {
  const [isDark, setIsDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (event: MediaQueryListEvent) => setIsDark(event.matches)
    media.addEventListener('change', handler)
    setIsDark(media.matches)
    return () => media.removeEventListener('change', handler)
  }, [])

  return isDark
}

function TypeIcon({ type }: { type: ServiceType }) {
  switch (type) {
    case 'web':
      return <Globe className="h-3 w-3" />
    case 'api':
      return <Server className="h-3 w-3" />
    case 'db':
      return <Database className="h-3 w-3" />
    case 'proxy':
      return <Network className="h-3 w-3" />
    case 'mq':
      return <Activity className="h-3 w-3" />
    default:
      return <Server className="h-3 w-3" />
  }
}

function typeColor(type: ServiceType, isDark: boolean) {
  if (!isDark) {
    switch (type) {
      case 'web':
        return 'text-cyan-700 bg-cyan-100 border-cyan-200'
      case 'api':
        return 'text-emerald-700 bg-emerald-100 border-emerald-200'
      case 'db':
        return 'text-amber-700 bg-amber-100 border-amber-200'
      case 'proxy':
        return 'text-orange-700 bg-orange-100 border-orange-200'
      case 'mq':
        return 'text-rose-700 bg-rose-100 border-rose-200'
      default:
        return 'text-slate-700 bg-slate-100 border-slate-200'
    }
  }

  switch (type) {
    case 'web':
      return 'text-cyan-300 bg-cyan-400/10 border-cyan-400/20'
    case 'api':
      return 'text-emerald-300 bg-emerald-400/10 border-emerald-400/20'
    case 'db':
      return 'text-amber-300 bg-amber-400/10 border-amber-400/20'
    case 'proxy':
      return 'text-orange-300 bg-orange-400/10 border-orange-400/20'
    case 'mq':
      return 'text-rose-300 bg-rose-400/10 border-rose-400/20'
    default:
      return 'text-slate-300 bg-slate-400/10 border-slate-400/20'
  }
}

interface ServiceItemProps {
  port: PortInfo
  copied: boolean
  isDark: boolean
  locale: Locale
  onCopy: () => void
  onOpen: () => void
  onOpenFolder: () => void
  onHide: () => void
  onTerminate: () => void
}

function ServiceItem({
  port,
  copied,
  isDark,
  locale,
  onCopy,
  onOpen,
  onOpenFolder,
  onHide,
  onTerminate,
}: ServiceItemProps) {
  const t = translations[locale]
  const type = getPortType(port)
  const processLabel = getProcessLabel(port)
  const sourceSummary = getSourceSummary(port)
  const isWebLike = type === 'web' || type === 'api' || type === 'proxy'

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
      className={`group flex cursor-default items-center justify-between rounded-md px-2 py-1.5 transition-colors ${
        isDark ? 'hover:bg-white/10' : 'hover:bg-slate-900/6'
      }`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden">
        <div className="flex w-[4.5rem] shrink-0 items-center gap-2">
          <div className={`h-1.5 w-1.5 rounded-full shadow-[0_0_8px_rgba(52,211,153,0.4)] ${isDark ? 'bg-emerald-400' : 'bg-emerald-500'}`} />
          <span className={`font-mono text-xs font-medium ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>:{port.port}</span>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className={`truncate text-xs ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{processLabel}</span>
          <div className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-medium ${typeColor(type, isDark)} flex items-center gap-1`}>
            <TypeIcon type={type} />
            <span className="uppercase tracking-wider">{type}</span>
          </div>
        </div>
      </div>

      <div className="ml-2 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={onCopy}
          className={`rounded p-1 transition-colors ${isDark ? 'text-slate-400 hover:bg-white/10 hover:text-white' : 'text-slate-500 hover:bg-slate-900/10 hover:text-slate-900'}`}
          title={t.copyAddress}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
        {isWebLike && (
          <button
            onClick={onOpen}
            className={`flex rounded p-1 transition-colors ${isDark ? 'text-slate-400 hover:bg-white/10 hover:text-white' : 'text-slate-500 hover:bg-slate-900/10 hover:text-slate-900'}`}
            title={t.openInBrowser}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          onClick={onOpenFolder}
          className={`rounded p-1 transition-colors ${isDark ? 'text-slate-400 hover:bg-white/10 hover:text-white' : 'text-slate-500 hover:bg-slate-900/10 hover:text-slate-900'}`}
          title={`${t.openFolder} · ${sourceSummary}`}
          disabled={!hasMeaningfulValue(port.work_dir)}
        >
          <FolderOpen className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onHide}
          className={`rounded p-1 transition-colors ${isDark ? 'text-slate-400 hover:bg-white/10 hover:text-white' : 'text-slate-500 hover:bg-slate-900/10 hover:text-slate-900'}`}
          title={t.hideFromList}
        >
          <EyeOff className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onTerminate}
          className={`rounded p-1 transition-colors ${isDark ? 'text-slate-400 hover:bg-red-500/20 hover:text-red-400' : 'text-slate-500 hover:bg-red-500/10 hover:text-red-600'}`}
          title={t.terminateProcess}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </motion.div>
  )
}

interface StyledSelectOption {
  value: string | number
  label: string
}

interface StyledSelectProps {
  value: string | number
  options: StyledSelectOption[]
  onChange: (value: string) => void
  isDark: boolean
}

function StyledSelect({ value, options, onChange, isDark }: StyledSelectProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const selected = options.find((option) => `${option.value}` === `${value}`) ?? options[0]

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', handleClickOutside)
    return () => window.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`w-full rounded-lg border px-2.5 py-1.5 pr-8 text-xs shadow-sm transition-colors focus:outline-none ${
          isDark
            ? 'border-white/16 bg-[#1b2028] text-slate-100 hover:bg-[#202733] focus:border-emerald-500/70'
            : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50 focus:border-emerald-500/70'
        }`}
      >
        <span className="block truncate text-left">{selected.label}</span>
      </button>
      <ChevronDown
        className={`pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 transition-transform ${
          open ? 'rotate-180' : 'rotate-0'
        } ${
          isDark ? 'text-slate-400' : 'text-slate-500'
        }`}
      />

      {open && (
        <div
          className={`absolute z-40 mt-1 w-full overflow-hidden rounded-lg border shadow-xl ${
            isDark ? 'border-white/16 bg-[#242932]' : 'border-slate-300 bg-white'
          }`}
        >
          {options.map((option) => {
            const active = `${option.value}` === `${value}`
            return (
              <button
                type="button"
                key={`${option.value}`}
                onClick={() => {
                  onChange(`${option.value}`)
                  setOpen(false)
                }}
                className={`block w-full px-2.5 py-1.5 text-left text-xs transition-colors ${
                  active
                    ? isDark
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-emerald-100 text-emerald-700'
                    : isDark
                      ? 'text-slate-200 hover:bg-white/10'
                      : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface StyledButtonProps {
  kind: 'primary' | 'secondary'
  isDark: boolean
  onClick: () => void
  children: ReactNode
}

function StyledButton({ kind, isDark, onClick, children }: StyledButtonProps) {
  if (kind === 'primary') {
    return (
      <button
        onClick={onClick}
        className={`rounded-md px-2.5 py-1.5 text-xs font-semibold tracking-wide text-white transition-colors ${
          isDark ? 'bg-emerald-500 hover:bg-emerald-400' : 'bg-emerald-600 hover:bg-emerald-500'
        }`}
      >
        {children}
      </button>
    )
  }

  return (
    <button
      onClick={onClick}
      className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
        isDark
          ? 'border-white/16 bg-black/30 text-slate-200 hover:bg-white/10'
          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  )
}

export default function App() {
  const [ports, setPorts] = useState<PortInfo[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [dismissedPorts, setDismissedPorts] = useState<DismissedPortKey[]>(loadDismissedPorts)
  const [error, setError] = useState<string | null>(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [locale, setLocale] = useState<Locale>(loadLocale)
  const systemDark = useSystemDarkMode()
  const [themeMode, setThemeMode] = useState<ThemeMode>(loadThemeMode)
  const isDark = themeMode === 'system' ? systemDark : themeMode === 'dark'

  const t = translations[locale]
  const textAreaClass = isDark
    ? 'mt-1 w-full resize-none rounded-md border border-white/16 bg-black/35 px-2 py-1.5 text-xs text-slate-100 transition-colors placeholder:text-slate-500 focus:border-emerald-500/70 focus:outline-none'
    : 'mt-1 w-full resize-none rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 transition-colors placeholder:text-slate-400 focus:border-emerald-500/70 focus:outline-none'

  const [refreshInterval, setRefreshInterval] = useState<number>(loadRefreshInterval)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastRefreshed, setLastRefreshed] = useState<number | null>(null)
  const [settings, setSettings] = useState<ScanSettingsForm>(loadScanSettings)

  const scanOptions = useMemo<ScanOptions>(
    () => ({
      include_ranges: parseRanges(settings.includeRanges),
      exclude_ports: parseIntegerList(settings.excludePorts),
      exclude_processes: parseKeywordList(settings.excludeProcesses),
      allow_processes: parseKeywordList(settings.allowProcesses),
    }),
    [settings],
  )

  const visiblePorts = useMemo(
    () => ports.filter((port) => !dismissedPorts.includes(getPortKey(port))),
    [dismissedPorts, ports],
  )

  const filteredServices = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return visiblePorts
    return visiblePorts.filter((port) => {
      return (
        getProjectLabel(port).toLowerCase().includes(query) ||
        getProcessLabel(port).toLowerCase().includes(query) ||
        getSourceSummary(port).toLowerCase().includes(query) ||
        String(port.port).includes(query)
      )
    })
  }, [searchQuery, visiblePorts])

  const groupedServices = useMemo(() => {
    const groups = new Map<string, PortInfo[]>()
    filteredServices.forEach((port) => {
      const project = getProjectLabel(port)
      const existing = groups.get(project) ?? []
      existing.push(port)
      groups.set(project, existing)
    })

    return [...groups.entries()]
      .map(([project, items]) => [project, [...items].sort((a, b) => a.port - b.port)] as const)
      .sort((a, b) => a[0].localeCompare(b[0], 'zh-CN'))
  }, [filteredServices])

  const scanPorts = useCallback(async () => {
    if (!isTauriRuntime) {
      setError(t.scanFailedPreview)
      return
    }

    setIsRefreshing(true)
    setError(null)
    try {
      const result: ScanResult = await scanNativePorts(scanOptions)
      setPorts(result.ports)
      setLastRefreshed(result.timestamp)
    } catch (e) {
      setError(`${t.scanFailed}: ${e}`)
    } finally {
      setIsRefreshing(false)
    }
  }, [scanOptions, t.scanFailed, t.scanFailedPreview])

  const killProcess = useCallback(
    async (pid: number) => {
      if (!isTauriRuntime) {
        setError(t.killFailedPreview)
        return
      }
      try {
        const result: KillResult = await killNativeProcess(pid)
        if (result.success) {
          await scanPorts()
        } else {
          setError(`${t.killFailed}: ${result.message}`)
        }
      } catch (e) {
        setError(`${t.killFailed}: ${e}`)
      }
    },
    [scanPorts, t.killFailed, t.killFailedPreview],
  )

  const openInBrowser = useCallback(
    async (port: number) => {
      if (!isTauriRuntime) {
        window.open(`http://localhost:${port}`, '_blank')
        return
      }
      try {
        await openPortInBrowser(port)
      } catch (e) {
        setError(`${t.openFailed}: ${e}`)
      }
    },
    [t.openFailed],
  )

  const openFolder = useCallback(
    async (path: string) => {
      if (!isTauriRuntime) {
        setError(t.openFailedPreview)
        return
      }
      if (!hasMeaningfulValue(path)) return
      try {
        await openNativeFolder(path)
      } catch (e) {
        setError(`${t.openFailed}: ${e}`)
      }
    },
    [t.openFailed, t.openFailedPreview],
  )

  const hideWindow = useCallback(async () => {
    if (!isTauriRuntime) return
    try {
      await hideCurrentWindow()
    } catch (e) {
      setError(`${t.hideFailed}: ${e}`)
    }
  }, [t.hideFailed])

  const startDragging = useCallback(async () => {
    if (!isTauriRuntime) return
    try {
      await startCurrentWindowDrag()
    } catch (e) {
      setError(`${t.dragFailed}: ${e}`)
    }
  }, [t.dragFailed])

  const handleCopy = useCallback(
    async (port: PortInfo) => {
      try {
        await navigator.clipboard.writeText(getBrowserUrl(port))
        const key = getPortKey(port)
        setCopiedKey(key)
        setTimeout(() => {
          setCopiedKey((current) => (current === key ? null : current))
        }, 2000)
      } catch (e) {
        setError(`${t.copyFailed}: ${e}`)
      }
    },
    [t.copyFailed],
  )

  const handleHide = useCallback((port: PortInfo) => {
    const key = getPortKey(port)
    setDismissedPorts((current) => (current.includes(key) ? current : [...current, key]))
  }, [])

  useEffect(() => {
    saveScanSettings(settings)
  }, [settings])

  useEffect(() => {
    saveDismissedPorts(dismissedPorts)
  }, [dismissedPorts])

  useEffect(() => {
    saveRefreshInterval(refreshInterval)
  }, [refreshInterval])

  useEffect(() => {
    saveLocale(locale)
  }, [locale])

  useEffect(() => {
    saveThemeMode(themeMode)
  }, [themeMode])

  useEffect(() => {
    if (!isTauriRuntime) return
    void scanPorts()
    const unlistenPromise = onScanRequested(() => {
      void scanPorts()
    })
    return () => {
      void unlistenPromise.then((unlisten) => unlisten())
    }
  }, [scanPorts])

  useEffect(() => {
    if (!isTauriRuntime || refreshInterval <= 0) return
    const id = window.setInterval(() => {
      void scanPorts()
    }, refreshInterval * 1000)
    return () => window.clearInterval(id)
  }, [refreshInterval, scanPorts])

  useEffect(() => {
    if (!isTauriRuntime) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        void hideWindow()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [hideWindow])

  const intervalOptions = useMemo(
    () => [
      { value: 0, label: t.intervalOff },
      { value: 5, label: t.intervalSeconds(5) },
      { value: 10, label: t.intervalSeconds(10) },
      { value: 30, label: t.intervalSeconds(30) },
      { value: 60, label: t.intervalMinute },
    ],
    [t],
  )

  const localeOptions = useMemo(
    () => [
      { value: 'zh', label: t.languageZh },
      { value: 'en', label: t.languageEn },
    ],
    [t.languageEn, t.languageZh],
  )

  const themeOptions = useMemo(
    () => [
      { value: 'system', label: t.themeSystem },
      { value: 'light', label: t.themeLight },
      { value: 'dark', label: t.themeDark },
    ],
    [t.themeDark, t.themeLight, t.themeSystem],
  )

  return (
    <div className="h-screen w-screen overflow-hidden rounded-2xl">
      <div
        className={`flex h-full w-full flex-col overflow-hidden border shadow-2xl ${
          isDark
            ? 'border-white/10 bg-[#181b20] text-slate-200'
            : 'border-slate-200 bg-white text-slate-800'
        }`}
      >
        <div
          data-tauri-drag-region
          onMouseDown={(event) => {
            if (event.button === 0) {
              void startDragging()
            }
          }}
          className={`h-7 shrink-0 cursor-grab active:cursor-grabbing ${isDark ? 'bg-white/6' : 'bg-slate-100/90'}`}
        >
          <div className={`mx-auto mt-2 h-1 w-14 rounded-full ${isDark ? 'bg-white/20' : 'bg-slate-300/80'}`} />
        </div>
        <div
          className={`flex items-center justify-between border-b px-3 py-2.5 ${
            isDark ? 'border-white/10 bg-white/5' : 'border-slate-200/80 bg-slate-50/85'
          }`}
        >
          <div className="flex items-center gap-2">
            <div className="flex h-5 w-5 items-center justify-center rounded-md bg-emerald-500">
              <PortPalIcon className="h-3.5 w-3.5 text-white" />
            </div>
            <span className={`text-sm font-semibold tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>{t.appTitle}</span>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => void scanPorts()}
              className={`rounded-md p-1 transition-colors ${
                isDark ? 'text-slate-400 hover:bg-white/10 hover:text-white' : 'text-slate-500 hover:bg-slate-900/10 hover:text-slate-900'
              }`}
              title={t.refresh}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin text-emerald-500' : ''}`} />
            </button>
            <button
              onClick={() => setIsSettingsOpen((value) => !value)}
              className={`rounded-md p-1 transition-colors ${
                isSettingsOpen
                  ? isDark
                    ? 'bg-white/10 text-white'
                    : 'bg-slate-900/10 text-slate-900'
                  : isDark
                    ? 'text-slate-400 hover:bg-white/10 hover:text-white'
                    : 'text-slate-500 hover:bg-slate-900/10 hover:text-slate-900'
              }`}
              title={t.settings}
            >
              <Settings className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {error && (
          <div
            className={`flex items-center justify-between gap-2 border-b px-3 py-2 text-[11px] ${
              isDark
                ? 'border-red-400/20 bg-red-500/10 text-red-200'
                : 'border-red-200 bg-red-50 text-red-700'
            }`}
          >
            <div className="flex min-w-0 items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{error}</span>
            </div>
            <button
              onClick={() => setError(null)}
              className={`rounded p-1 transition-colors ${
                isDark ? 'hover:bg-red-500/20 hover:text-white' : 'hover:bg-red-100 hover:text-red-800'
              }`}
              title={t.close}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {isSettingsOpen ? (
          <div className={`flex-1 overflow-y-auto p-4 ${isDark ? 'bg-black/10' : 'bg-slate-50/70'}`}>
            <div className="mb-3 flex items-center gap-2">
              <button
                onClick={() => setIsSettingsOpen(false)}
                className={`-ml-1 rounded p-1 transition-colors ${
                  isDark ? 'text-slate-400 hover:bg-white/10 hover:text-white' : 'text-slate-500 hover:bg-slate-900/10 hover:text-slate-900'
                }`}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <h3 className={`text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                {t.settings}
              </h3>
            </div>

            <p className={`mb-4 text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{t.settingsSubtitle}</p>

            <div
              className={`mb-3 rounded-lg border p-3 ${
                isDark ? 'border-white/10 bg-black/20' : 'border-slate-200 bg-white/80'
              }`}
            >
              <div className={`mb-2 text-[11px] font-semibold uppercase tracking-wider ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                {t.quickOptions}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <label className={`text-[11px] ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                  <span className="mb-1 inline-flex items-center gap-1">
                    <RefreshCw className="h-3 w-3" />
                    {t.autoRefreshInterval}
                  </span>
                  <StyledSelect
                    value={refreshInterval}
                    options={intervalOptions}
                    isDark={isDark}
                    onChange={(value) => setRefreshInterval(Number(value))}
                  />
                </label>

                <label className={`text-[11px] ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                  <span className="mb-1 inline-flex items-center gap-1">
                    <Monitor className="h-3 w-3" />
                    {t.theme}
                  </span>
                  <StyledSelect
                    value={themeMode}
                    options={themeOptions}
                    isDark={isDark}
                    onChange={(value) => setThemeMode(value as ThemeMode)}
                  />
                </label>

                <label className={`text-[11px] ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                  <span className="mb-1 inline-flex items-center gap-1">
                    <Languages className="h-3 w-3" />
                    {t.language}
                  </span>
                  <StyledSelect
                    value={locale}
                    options={localeOptions}
                    isDark={isDark}
                    onChange={(value) => setLocale(value as Locale)}
                  />
                </label>
              </div>
              <div className={`mt-2 inline-flex items-center gap-2 text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                {themeMode === 'system' ? (
                  <Monitor className="h-3 w-3" />
                ) : themeMode === 'light' ? (
                  <Sun className="h-3 w-3" />
                ) : (
                  <Moon className="h-3 w-3" />
                )}
                <span>
                  {themeMode === 'system'
                    ? t.themeSystem
                    : themeMode === 'light'
                      ? t.themeLight
                      : t.themeDark}
                </span>
              </div>
            </div>

            <div
              className={`rounded-lg border p-3 ${
                isDark ? 'border-white/10 bg-black/20' : 'border-slate-200 bg-white/80'
              }`}
            >
              <div className={`mb-2 text-[11px] font-semibold uppercase tracking-wider ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                {t.scanRules}
              </div>
              <div className="space-y-2">
                <label className={`block text-[11px] ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                  {t.scanRange}
                  <textarea
                    value={settings.includeRanges}
                    onChange={(e) => setSettings((current) => ({ ...current, includeRanges: e.target.value }))}
                    placeholder={t.scanRangePlaceholder}
                    rows={2}
                    className={textAreaClass}
                  />
                </label>

                <label className={`block text-[11px] ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                  {t.excludePorts}
                  <textarea
                    value={settings.excludePorts}
                    onChange={(e) => setSettings((current) => ({ ...current, excludePorts: e.target.value }))}
                    placeholder={t.excludePortsPlaceholder}
                    rows={2}
                    className={textAreaClass}
                  />
                </label>

                <label className={`block text-[11px] ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                  {t.excludeProcesses}
                  <textarea
                    value={settings.excludeProcesses}
                    onChange={(e) => setSettings((current) => ({ ...current, excludeProcesses: e.target.value }))}
                    placeholder={t.excludeProcessesPlaceholder}
                    rows={2}
                    className={textAreaClass}
                  />
                </label>

                <label className={`block text-[11px] ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                  {t.allowProcesses}
                  <textarea
                    value={settings.allowProcesses}
                    onChange={(e) => setSettings((current) => ({ ...current, allowProcesses: e.target.value }))}
                    placeholder={t.allowProcessesPlaceholder}
                    rows={2}
                    className={textAreaClass}
                  />
                </label>
              </div>
            </div>

            <div className={`mt-3 flex items-center justify-between text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              <span>{t.lastUpdated}</span>
              <span>{lastRefreshed ? new Date(lastRefreshed).toLocaleTimeString() : t.noTime}</span>
            </div>

            <div className="mt-3 flex items-center justify-between gap-2">
              <StyledButton
                kind="secondary"
                isDark={isDark}
                onClick={() => setSettings(DEFAULT_SCAN_SETTINGS)}
              >
                {t.clearRules}
              </StyledButton>
              <StyledButton
                kind="primary"
                isDark={isDark}
                onClick={() => {
                  void scanPorts()
                  setIsSettingsOpen(false)
                }}
              >
                {t.applyNow}
              </StyledButton>
            </div>
          </div>
        ) : (
          <>
            <div className={`border-b p-2 ${isDark ? 'border-white/8 bg-black/10' : 'border-slate-200/80 bg-slate-50/60'}`}>
              <div className="relative">
                <Search
                  className={`absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 ${
                    isDark ? 'text-slate-400' : 'text-slate-400'
                  }`}
                />
                <input
                  type="text"
                  placeholder={t.searchPlaceholder}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={`w-full rounded-md border py-1.5 pl-8 pr-3 text-xs transition-all focus:outline-none focus:ring-1 ${
                    isDark
                      ? 'border-white/10 bg-black/20 text-white placeholder:text-slate-500 focus:border-emerald-500/50 focus:ring-emerald-500/50'
                      : 'border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:border-emerald-500/60 focus:ring-emerald-500/40'
                  }`}
                />
              </div>
            </div>

            <div className="max-h-[420px] flex-1 space-y-3 overflow-y-auto p-1.5">
              {groupedServices.length === 0 ? (
                <div className={`py-8 text-center text-xs ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>{t.emptyState}</div>
              ) : (
                groupedServices.map(([project, projectPorts]) => (
                  <div key={project} className="space-y-0.5">
                    <div className="flex items-center gap-2 px-2 py-1">
                      <span className={`text-[10px] font-semibold uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{project}</span>
                      <div className={`h-px flex-1 ${isDark ? 'bg-white/8' : 'bg-slate-200'}`} />
                    </div>
                    <div className="space-y-0.5">
                      <AnimatePresence>
                        {projectPorts.map((port) => {
                          const key = getPortKey(port)
                          return (
                            <ServiceItem
                              key={key}
                              port={port}
                              copied={copiedKey === key}
                              isDark={isDark}
                              locale={locale}
                              onCopy={() => void handleCopy(port)}
                              onOpen={() => void openInBrowser(port.port)}
                              onOpenFolder={() => void openFolder(port.work_dir)}
                              onHide={() => handleHide(port)}
                              onTerminate={() => void killProcess(port.pid)}
                            />
                          )
                        })}
                      </AnimatePresence>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}

        <div className={`flex items-center justify-between border-t px-3 py-2 text-[10px] ${
          isDark ? 'border-white/10 bg-black/20 text-slate-400' : 'border-slate-200/80 bg-slate-50/80 text-slate-500'
        }`}>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full shadow-[0_0_4px_rgba(16,185,129,0.55)] ${isDark ? 'bg-emerald-400' : 'bg-emerald-500'}`} />
              {visiblePorts.length} {t.activeCount}
            </span>
            {dismissedPorts.length > 0 && (
              <span className="flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${isDark ? 'bg-slate-500' : 'bg-slate-400'}`} />
                {dismissedPorts.length} {t.hiddenCount}
              </span>
            )}
          </div>
          <button
            onClick={() => void hideWindow()}
            className={`flex items-center gap-1 font-medium transition-colors ${
              isDark ? 'hover:text-slate-200' : 'hover:text-slate-800'
            }`}
          >
            <Power className="h-3 w-3" />
            {t.hideWindow}
          </button>
        </div>
      </div>
    </div>
  )
}
