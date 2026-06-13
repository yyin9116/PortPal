import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'

export const isTauriRuntime = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export interface PortInfo {
  port: number
  protocol: string
  address: string
  pid: number
  process_name: string
  command: string
  work_dir: string
  project_name: string
}

export interface ScanResult {
  timestamp: number
  ports: PortInfo[]
  errors: string[]
}

export interface KillResult {
  pid: number
  success: boolean
  message: string
}

export interface ScanRange {
  start: number
  end: number
}

export interface ScanOptions {
  include_ranges: ScanRange[]
  exclude_ports: number[]
  exclude_processes: string[]
  allow_processes: string[]
}

function assertTauriRuntime() {
  if (!isTauriRuntime) {
    throw new Error('PortPal native commands are only available in the Tauri desktop app.')
  }
}

export async function scanPorts(scanOptions: ScanOptions) {
  assertTauriRuntime()
  return invoke<ScanResult>('scan_ports', { scanOptions })
}

export async function killProcess(pid: number) {
  assertTauriRuntime()
  return invoke<KillResult>('kill_process', { pid })
}

export async function openPortInBrowser(port: number) {
  assertTauriRuntime()
  await invoke('open_in_browser', { port })
}

export async function openFolder(path: string) {
  assertTauriRuntime()
  await invoke('open_folder', { path })
}

export async function hideCurrentWindow() {
  assertTauriRuntime()
  await getCurrentWindow().hide()
}

export async function startCurrentWindowDrag() {
  assertTauriRuntime()
  await getCurrentWindow().startDragging()
}

export function onScanRequested(callback: () => void): Promise<UnlistenFn> {
  assertTauriRuntime()
  return listen('portpal-scan', callback)
}
