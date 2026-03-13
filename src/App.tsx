import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  AlertCircle,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  CircleX,
  Copy,
  FolderOpen,
  LoaderCircle,
  Monitor,
  Moon,
  Pin,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sun,
  SquareTerminal,
  Trash2,
  Wifi,
  X,
} from 'lucide-react'
import './App.css'

interface PortInfo {
  port: number
  protocol: string
  address: string
  pid: number
  process_name: string
  command: string
  work_dir: string
  project_name: string
}

interface ScanResult {
  timestamp: number
  ports: PortInfo[]
  errors: string[]
}

interface KillResult {
  pid: number
  success: boolean
  message: string
}

interface ScanRange {
  start: number
  end: number
}

interface ScanOptions {
  include_ranges: ScanRange[]
  exclude_ports: number[]
  exclude_processes: string[]
  allow_processes: string[]
}

interface ScanSettingsForm {
  includeRanges: string
  excludePorts: string
  excludeProcesses: string
  allowProcesses: string
  themeMode: ThemeMode
}

type ThemeMode = 'system' | 'light' | 'dark'
type DismissedPortKey = string

interface PendingKillTarget {
  pid: number
  port: number
  label: string
}

const UNKNOWN_VALUES = new Set(['', 'unknown', '未识别来源'])
const SETTINGS_STORAGE_KEY = 'portpal.scan-settings'
const GROUP_PREFERENCES_STORAGE_KEY = 'portpal.group-preferences'
const DISMISSED_PORTS_STORAGE_KEY = 'portpal.dismissed-ports'

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
  if (segments.length <= 3) {
    return normalized
  }

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
  if (hasMeaningfulValue(port.project_name)) {
    return port.project_name
  }

  const workdirName = getBaseName(port.work_dir)
  if (workdirName) {
    return workdirName
  }

  if (hasMeaningfulValue(port.process_name)) {
    return port.process_name
  }

  return `端口 ${port.port}`
}

function getProcessLabel(port: PortInfo) {
  if (hasMeaningfulValue(port.process_name)) {
    return port.process_name
  }

  const commandBase = getBaseName(port.command.split(/\s+/)[0] ?? '')
  if (commandBase) {
    return commandBase
  }

  return '未识别进程'
}

function getSourceSummary(port: PortInfo) {
  if (hasMeaningfulValue(port.work_dir)) {
    return `目录 ${shortenPath(port.work_dir)}`
  }

  const commandPreview = compactCommand(port.command)
  if (commandPreview) {
    return `命令 ${commandPreview}`
  }

  return '未能识别启动目录或命令来源'
}

function getGroupLabel(port: PortInfo) {
  const project = getProjectLabel(port)
  return project === `端口 ${port.port}` ? '未归类来源' : project
}

function getPortTitle(port: PortInfo) {
  const project = getProjectLabel(port)
  if (project === `端口 ${port.port}`) {
    return `端口 ${port.port}`
  }
  return project
}

function getAddressLabel(port: PortInfo) {
  const normalizedAddress = normalizeText(port.address) || '127.0.0.1'
  return `${normalizedAddress}:${port.port}`
}

function getPortType(port: PortInfo) {
  const haystack = `${port.process_name} ${port.command} ${port.project_name}`.toLowerCase()

  if (
    ['postgres', 'mysql', 'mariadb', 'redis', 'mongo', 'mongodb', 'memcached', 'clickhouse'].some((keyword) =>
      haystack.includes(keyword),
    ) ||
    [3306, 5432, 6379, 27017, 11211, 8123].includes(port.port)
  ) {
    return 'db'
  }

  if (
    ['nginx', 'caddy', 'traefik', 'haproxy', 'gateway', 'proxy'].some((keyword) => haystack.includes(keyword))
  ) {
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

function parseStoredSettings(value: string | null): ScanSettingsForm {
  if (!value) {
    return {
      includeRanges: '',
      excludePorts: '',
      excludeProcesses: '',
      allowProcesses: '',
      themeMode: 'system',
    }
  }

  const parsed = JSON.parse(value) as Partial<ScanSettingsForm>
  return {
    includeRanges: parsed.includeRanges ?? '',
    excludePorts: parsed.excludePorts ?? '',
    excludeProcesses: parsed.excludeProcesses ?? '',
    allowProcesses: parsed.allowProcesses ?? '',
    themeMode: parsed.themeMode ?? 'system',
  }
}

function parseStoredGroupPreferences(value: string | null) {
  if (!value) {
    return {
      collapsed: [] as string[],
      pinned: [] as string[],
    }
  }

  const parsed = JSON.parse(value) as Partial<{ collapsed: string[]; pinned: string[] }>
  return {
    collapsed: Array.isArray(parsed.collapsed) ? parsed.collapsed : [],
    pinned: Array.isArray(parsed.pinned) ? parsed.pinned : [],
  }
}

function getPortKey(port: PortInfo): DismissedPortKey {
  return `${port.pid}:${port.port}:${normalizeText(port.address) || 'localhost'}`
}

function App() {
  const [ports, setPorts] = useState<PortInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [settings, setSettings] = useState<ScanSettingsForm>(() => {
    try {
      return parseStoredSettings(localStorage.getItem(SETTINGS_STORAGE_KEY))
    } catch {
      return parseStoredSettings(null)
    }
  })
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>(() => {
    try {
      return parseStoredGroupPreferences(localStorage.getItem(GROUP_PREFERENCES_STORAGE_KEY)).collapsed
    } catch {
      return []
    }
  })
  const [pinnedGroups, setPinnedGroups] = useState<string[]>(() => {
    try {
      return parseStoredGroupPreferences(localStorage.getItem(GROUP_PREFERENCES_STORAGE_KEY)).pinned
    } catch {
      return []
    }
  })
  const [dismissedPorts, setDismissedPorts] = useState<DismissedPortKey[]>(() => {
    try {
      const stored = localStorage.getItem(DISMISSED_PORTS_STORAGE_KEY)
      if (!stored) return []
      const parsed = JSON.parse(stored)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })
  const [pendingKill, setPendingKill] = useState<PendingKillTarget | null>(null)

  const scanOptions = useMemo<ScanOptions>(() => ({
    include_ranges: parseRanges(settings.includeRanges),
    exclude_ports: parseIntegerList(settings.excludePorts),
    exclude_processes: parseKeywordList(settings.excludeProcesses),
    allow_processes: parseKeywordList(settings.allowProcesses),
  }), [settings])

  const visiblePorts = useMemo(
    () => ports.filter((port) => !dismissedPorts.includes(getPortKey(port))),
    [dismissedPorts, ports],
  )

  const groupedPorts = useMemo(() => {
    const groups = new Map<string, PortInfo[]>()

    visiblePorts.forEach((port) => {
      const key = getGroupLabel(port)
      const current = groups.get(key) ?? []
      current.push(port)
      groups.set(key, current)
    })

    return [...groups.entries()]
      .map(([groupName, groupPorts]) => [
        groupName,
        [...groupPorts].sort((a, b) => a.port - b.port),
      ] as const)
      .sort((a, b) => {
        const aPinned = pinnedGroups.includes(a[0])
        const bPinned = pinnedGroups.includes(b[0])
        if (aPinned !== bPinned) return aPinned ? -1 : 1
        if (a[0] === '未归类来源') return 1
        if (b[0] === '未归类来源') return -1
        if (b[1].length !== a[1].length) return b[1].length - a[1].length
        return a[0].localeCompare(b[0], 'zh-CN')
      })
  }, [pinnedGroups, visiblePorts])

  const totalPorts = visiblePorts.length

  const scanPorts = async () => {
    setLoading(true)
    setError(null)
    try {
      const result: ScanResult = await invoke('scan_ports', {
        scanOptions,
      })
      setPorts(result.ports)
      setLastUpdated(result.timestamp)
    } catch (e) {
      setError(`扫描失败：${e}`)
    } finally {
      setLoading(false)
    }
  }

  const killProcess = async (pid: number) => {
    try {
      const result: KillResult = await invoke('kill_process', { pid })
      if (result.success) {
        await scanPorts()
      } else {
        setError(`终止失败：${result.message}`)
      }
    } catch (e) {
      setError(`终止失败：${e}`)
    }
  }

  const dismissPort = (port: PortInfo) => {
    const portKey = getPortKey(port)
    setDismissedPorts((current) => (current.includes(portKey) ? current : [...current, portKey]))
  }

  const openInBrowser = async (port: number) => {
    try {
      await invoke('open_in_browser', { port })
    } catch (e) {
      setError(`打开失败：${e}`)
    }
  }

  const copyAddress = async (port: PortInfo) => {
    try {
      await navigator.clipboard.writeText(`http://${getAddressLabel(port)}`)
    } catch (e) {
      setError(`复制失败：${e}`)
    }
  }

  const openFolder = async (path: string) => {
    try {
      await invoke('open_folder', { path })
    } catch (e) {
      setError(`打开失败：${e}`)
    }
  }

  const openInVscode = async (path: string) => {
    try {
      await invoke('open_in_vscode', { path })
    } catch (e) {
      setError(`打开失败：${e}`)
    }
  }

  const hideWindow = async () => {
    try {
      await getCurrentWindow().hide()
    } catch (e) {
      setError(`隐藏窗口失败：${e}`)
    }
  }

  const startDragging = async () => {
    try {
      await getCurrentWindow().startDragging()
    } catch (e) {
      setError(`拖动窗口失败：${e}`)
    }
  }

  useEffect(() => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    localStorage.setItem(
      GROUP_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        collapsed: collapsedGroups,
        pinned: pinnedGroups,
      }),
    )
  }, [collapsedGroups, pinnedGroups])

  useEffect(() => {
    localStorage.setItem(DISMISSED_PORTS_STORAGE_KEY, JSON.stringify(dismissedPorts))
  }, [dismissedPorts])

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = settings.themeMode
  }, [settings.themeMode])

  useEffect(() => {
    setCollapsedGroups((current) => current.filter((groupName) => groupedPorts.some(([name]) => name === groupName)))
    setPinnedGroups((current) => current.filter((groupName) => groupedPorts.some(([name]) => name === groupName)))
  }, [groupedPorts])

  useEffect(() => {
    scanPorts()

    const unlisten = listen('portpal-scan', () => {
      scanPorts()
    })

    return () => {
      unlisten.then((f) => f())
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        void getCurrentWindow().hide()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  const toggleGroupCollapsed = (groupName: string) => {
    setCollapsedGroups((current) =>
      current.includes(groupName)
        ? current.filter((item) => item !== groupName)
        : [...current, groupName],
    )
  }

  const toggleGroupPinned = (groupName: string) => {
    setPinnedGroups((current) =>
      current.includes(groupName)
        ? current.filter((item) => item !== groupName)
        : [groupName, ...current],
    )
  }

  return (
    <div className="app-shell">
      <div className="app-container">
        {pendingKill && (
          <div className="confirm-overlay" onClick={() => setPendingKill(null)}>
            <div
              className="confirm-dialog"
              onClick={(event) => event.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="kill-confirm-title"
            >
              <div className="confirm-copy">
                <strong id="kill-confirm-title">终止服务并释放端口</strong>
                <p>
                  即将终止 <span>{pendingKill.label}</span>，并释放 <span>{pendingKill.port}</span> 端口。
                </p>
              </div>
              <div className="confirm-actions">
                <button type="button" className="action-link" onClick={() => setPendingKill(null)}>
                  取消
                </button>
                <button
                  type="button"
                  className="action-link danger"
                  onClick={async () => {
                    const target = pendingKill
                    setPendingKill(null)
                    await killProcess(target.pid)
                  }}
                >
                  确认终止
                </button>
              </div>
            </div>
          </div>
        )}

        <header className="header">
          <div
            className="window-bar"
            data-tauri-drag-region
            onMouseDown={(event) => {
              if (event.button === 0) {
                void startDragging()
              }
            }}
          >
            <div className="window-bar-spacer" />
            <div className="drag-indicator" data-tauri-drag-region>
              <span />
            </div>
            <div className="window-bar-spacer" />
          </div>

          <div className="title-group">
            <div className="title-row compact">
              <div className="brand-mark" aria-hidden="true">
                <Wifi size={18} strokeWidth={1.8} />
              </div>
              <div className="title-copy">
                <h1 className="title">PortPal</h1>
                <p className="subtitle">
                  来源分组视图
                </p>
              </div>
              <span className="summary-pill muted">
                <Search size={16} strokeWidth={1.8} />
                {scanOptions.include_ranges.length > 0 ? `${scanOptions.include_ranges.length} 段范围` : '全端口'}
              </span>
            </div>
            <div className="header-meta">
              <span>{loading ? '正在扫描本地端口' : `当前发现 ${totalPorts} 个监听端口`}</span>
              <span className="separator">·</span>
              <span>{groupedPorts.length} 个来源分组</span>
            </div>
          </div>
        </header>

        {showSettings && (
          <section className="settings-panel">
            <div className="settings-header">
              <div className="settings-title">
                <strong>扫描设置</strong>
                <span>留空表示不限制</span>
              </div>
              <button
                type="button"
                className="icon-only-btn subtle"
                onClick={() => setShowSettings(false)}
                aria-label="关闭扫描设置"
              >
                <X size={16} strokeWidth={1.8} />
              </button>
            </div>
            <div className="settings-grid">
              <label className="settings-field">
                <span>界面主题</span>
                <div className="theme-switcher" role="radiogroup" aria-label="界面主题">
                  {([
                    ['system', '跟随系统', Monitor],
                    ['light', '浅色', Sun],
                    ['dark', '深色', Moon],
                  ] as const).map(([mode, label, Icon]) => (
                    <button
                      key={mode}
                      type="button"
                      className={`theme-option${settings.themeMode === mode ? ' active' : ''}`}
                      onClick={() =>
                        setSettings((current) => ({
                          ...current,
                          themeMode: mode,
                        }))
                      }
                      aria-pressed={settings.themeMode === mode}
                    >
                      <Icon size={16} strokeWidth={1.8} />
                      {label}
                    </button>
                  ))}
                </div>
              </label>
              <label className="settings-field">
                <span>扫描范围</span>
                <textarea
                  value={settings.includeRanges}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      includeRanges: event.target.value,
                    }))
                  }
                  placeholder={'示例: 80, 3000-3999, 8080'}
                  rows={2}
                />
              </label>
              <label className="settings-field">
                <span>排除端口</span>
                <textarea
                  value={settings.excludePorts}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      excludePorts: event.target.value,
                    }))
                  }
                  placeholder={'示例: 22, 3306, 5432'}
                  rows={2}
                />
              </label>
              <label className="settings-field">
                <span>排除进程</span>
                <textarea
                  value={settings.excludeProcesses}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      excludeProcesses: event.target.value,
                    }))
                  }
                  placeholder={'示例: postgres, Dropbox, ControlCenter'}
                  rows={2}
                />
              </label>
              <label className="settings-field">
                <span>白名单进程</span>
                <textarea
                  value={settings.allowProcesses}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      allowProcesses: event.target.value,
                    }))
                  }
                  placeholder={'示例: node, bun, python, java'}
                  rows={2}
                />
              </label>
            </div>
            <div className="settings-actions">
              <button
                type="button"
                className="action-link"
                onClick={() => {
                  setSettings({
                    includeRanges: '',
                    excludePorts: '',
                    excludeProcesses: '',
                    allowProcesses: '',
                    themeMode: settings.themeMode,
                  })
                }}
              >
                清空规则
              </button>
              <button
                type="button"
                className="action-link primary"
                onClick={() => {
                  void scanPorts()
                  setShowSettings(false)
                }}
              >
                立即应用
              </button>
            </div>
          </section>
        )}

        {error && (
          <div className="error-banner">
            <div className="error-content">
              <AlertCircle size={16} strokeWidth={1.8} />
              <span>{error}</span>
            </div>
            <button
              className="icon-only-btn"
              onClick={() => setError(null)}
              aria-label="关闭错误提示"
            >
              <X size={16} strokeWidth={1.8} />
            </button>
          </div>
        )}

        <div className="port-list">
          {totalPorts === 0 ? (
            <div className="empty-state">
              <div className="empty-icon" aria-hidden="true">
                <Search size={20} strokeWidth={1.8} />
              </div>
              <p>未发现监听的开发端口</p>
              <p className="hint">如果本地服务已启动，可点击右上角重新扫描</p>
            </div>
          ) : (
            groupedPorts.map(([groupName, groupPorts]) => (
              <section key={groupName} className="port-group">
                <div className="group-header">
                  <button
                    type="button"
                    className="group-toggle"
                    onClick={() => toggleGroupCollapsed(groupName)}
                    aria-expanded={!collapsedGroups.includes(groupName)}
                    aria-label={`${collapsedGroups.includes(groupName) ? '展开' : '折叠'} ${groupName}`}
                  >
                    {collapsedGroups.includes(groupName) ? (
                      <ChevronRight size={16} strokeWidth={1.8} />
                    ) : (
                      <ChevronDown size={16} strokeWidth={1.8} />
                    )}
                    <span className="group-title">{groupName}</span>
                  </button>
                  <div className="group-meta">
                    <span className="group-count">{groupPorts.length} 个端口</span>
                    <button
                      type="button"
                      className={`icon-only-btn subtle group-pin${pinnedGroups.includes(groupName) ? ' active' : ''}`}
                      onClick={() => toggleGroupPinned(groupName)}
                      aria-label={`${pinnedGroups.includes(groupName) ? '取消置顶' : '置顶'} ${groupName}`}
                      title={pinnedGroups.includes(groupName) ? '取消置顶' : '置顶'}
                    >
                      <Pin size={16} strokeWidth={1.8} />
                    </button>
                  </div>
                </div>

                {!collapsedGroups.includes(groupName) && (
                  <div className="group-list">
                    {groupPorts.map((port, index) => {
                      const hasWorkDir = hasMeaningfulValue(port.work_dir)
                      const groupScopedTitle = getPortTitle(port) === groupName ? null : getPortTitle(port)
                      const addressLabel = getAddressLabel(port)
                      const portType = getPortType(port)

                      return (
                        <div key={`${port.pid}-${port.port}-${index}`} className="port-card">
                          <div className="port-row">
                            <div className="port-leading">
                              <div className="port-content">
                                <div className="port-line">
                                  <span className="port-number">{port.port}</span>
                                  {groupScopedTitle ? <span className="project-name">{groupScopedTitle}</span> : null}
                                  <span className="type-chip">{portType}</span>
                                  <span className="protocol-chip">{port.protocol}</span>
                                  <button
                                    type="button"
                                    className="address-link"
                                    onClick={() => openInBrowser(port.port)}
                                    title={`打开 http://${addressLabel}`}
                                  >
                                    {addressLabel}
                                  </button>
                                </div>
                                <div className="port-subline">
                                  <span>{getProcessLabel(port)}</span>
                                  <span className="separator">·</span>
                                  <span>{getSourceSummary(port)}</span>
                                  <span className="separator">·</span>
                                  <span>PID {port.pid}</span>
                                </div>
                                <div className="port-actions inline">
                                  <button
                                    className="action-link"
                                    onClick={() => openInBrowser(port.port)}
                                    title="在浏览器中打开"
                                  >
                                    <ArrowUpRight size={16} strokeWidth={1.8} />
                                    打开
                                  </button>
                                  <button
                                    className="action-link"
                                    onClick={() => copyAddress(port)}
                                    title="复制本地地址"
                                  >
                                    <Copy size={16} strokeWidth={1.8} />
                                    复制地址
                                  </button>
                                  <button
                                    className="action-link"
                                    onClick={() => openFolder(port.work_dir)}
                                    title="打开项目目录"
                                    disabled={!hasWorkDir}
                                  >
                                    <FolderOpen size={16} strokeWidth={1.8} />
                                    目录
                                  </button>
                                  <button
                                    className="action-link"
                                    onClick={() => openInVscode(port.work_dir)}
                                    title="在 VSCode 中打开"
                                    disabled={!hasWorkDir}
                                  >
                                    <SquareTerminal size={16} strokeWidth={1.8} />
                                    VSCode
                                  </button>
                                </div>
                              </div>
                            </div>

                            <div className="card-actions">
                              <button
                                className="action-icon-btn dismiss"
                                onClick={() => dismissPort(port)}
                                title="删除条目"
                                aria-label={`删除端口 ${port.port} 的条目`}
                              >
                                <Trash2 size={16} strokeWidth={1.8} />
                              </button>
                              <button
                                className="action-icon-btn terminate"
                                onClick={() =>
                                  setPendingKill({
                                    pid: port.pid,
                                    port: port.port,
                                    label: groupScopedTitle ?? groupName,
                                  })
                                }
                                title="终止服务并释放端口"
                                aria-label={`终止端口 ${port.port} 的服务并释放端口`}
                              >
                                <CircleX size={16} strokeWidth={1.8} />
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            ))
          )}
        </div>

        <footer className="footer">
          <div className="footer-meta">
            <span>{totalPorts} 个端口</span>
            <span className="timestamp">
              {lastUpdated
                ? `更新于 ${new Date(lastUpdated).toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}`
                : ''}
            </span>
          </div>
          <div className="window-actions footer-actions">
            <button
              type="button"
              className="icon-only-btn subtle"
              onClick={() => setShowSettings((value) => !value)}
              aria-label="打开扫描设置"
            >
              <SlidersHorizontal size={16} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              className="icon-only-btn subtle"
              onClick={scanPorts}
              disabled={loading}
              aria-label="刷新端口列表"
            >
              {loading ? (
                <LoaderCircle className="spin" size={16} strokeWidth={1.8} />
              ) : (
                <RefreshCw size={16} strokeWidth={1.8} />
              )}
            </button>
            <button
              type="button"
              className="icon-only-btn subtle"
              onClick={hideWindow}
              aria-label="隐藏窗口"
            >
              <X size={16} strokeWidth={1.8} />
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

export default App
