import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  AlertCircle,
  ArrowUpRight,
  FolderOpen,
  LoaderCircle,
  RefreshCw,
  Search,
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

const UNKNOWN_VALUES = new Set(['', 'unknown', '未识别来源'])

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

function App() {
  const [ports, setPorts] = useState<PortInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)

  const sortedPorts = useMemo(
    () => [...ports].sort((a, b) => a.port - b.port),
    [ports],
  )

  const groupedPorts = useMemo(() => {
    const groups = new Map<string, PortInfo[]>()

    sortedPorts.forEach((port) => {
      const key = getGroupLabel(port)
      const current = groups.get(key) ?? []
      current.push(port)
      groups.set(key, current)
    })

    return [...groups.entries()].sort((a, b) => {
      if (a[0] === '未归类来源') return 1
      if (b[0] === '未归类来源') return -1
      return a[0].localeCompare(b[0], 'zh-CN')
    })
  }, [sortedPorts])

  const scanPorts = async () => {
    setLoading(true)
    setError(null)
    try {
      const result: ScanResult = await invoke('scan_ports')
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

  const openInBrowser = async (port: number) => {
    try {
      await invoke('open_in_browser', { port })
    } catch (e) {
      setError(`打开失败：${e}`)
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

  return (
    <div className="app-shell">
      <div className="app-container">
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
            <div className="drag-indicator" data-tauri-drag-region>
              <span />
            </div>
            <div className="window-actions">
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
          </div>

          <div className="title-group">
            <div className="title-row compact">
              <div className="brand-mark" aria-hidden="true">
                <Wifi size={18} strokeWidth={1.8} />
              </div>
              <div className="title-copy">
                <h1 className="title">PortPal</h1>
                <p className="subtitle">
                  {loading ? '正在扫描本地端口' : `当前发现 ${sortedPorts.length} 个监听端口`}
                </p>
              </div>
              <span className="summary-pill muted">
                <Search size={16} strokeWidth={1.8} />
                全端口
              </span>
            </div>
          </div>
        </header>

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
          {sortedPorts.length === 0 ? (
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
                  <span className="group-title">{groupName}</span>
                  <span className="group-count">{groupPorts.length} 个端口</span>
                </div>

                <div className="group-list">
                  {groupPorts.map((port, index) => {
                    const hasWorkDir = hasMeaningfulValue(port.work_dir)

                    return (
                      <div key={`${port.pid}-${port.port}-${index}`} className="port-card">
                        <div className="port-row">
                          <div className="port-leading">
                            <div className="port-content">
                              <div className="port-line">
                                <span className="port-number">{port.port}</span>
                                <span className="project-name">{getPortTitle(port)}</span>
                                <span className="protocol-chip">{port.protocol}</span>
                                <span className="address-text">{port.address}</span>
                              </div>
                              <div className="port-subline">
                                <span>{getProcessLabel(port)}</span>
                                <span className="separator">·</span>
                                <span>{getSourceSummary(port)}</span>
                                <span className="separator">·</span>
                                <span>PID {port.pid}</span>
                              </div>
                            </div>
                          </div>

                          <button
                            className="action-icon-btn kill"
                            onClick={() => killProcess(port.pid)}
                            title="终止进程"
                            aria-label={`终止端口 ${port.port} 的进程`}
                          >
                            <Trash2 size={16} strokeWidth={1.8} />
                          </button>
                        </div>

                        <div className="port-row secondary">
                          <div className="port-actions">
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
                    )
                  })}
                </div>
              </section>
            ))
          )}
        </div>

        <footer className="footer">
          <span>{sortedPorts.length} 个端口</span>
          <span className="timestamp">
            {lastUpdated
              ? `更新于 ${new Date(lastUpdated).toLocaleTimeString('zh-CN', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}`
              : ''}
          </span>
        </footer>
      </div>
    </div>
  )
}

export default App
