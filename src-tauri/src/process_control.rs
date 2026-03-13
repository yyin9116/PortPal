//! 进程控制模块
//! 
//! 提供进程终止功能：
//! - 优雅终止 (SIGTERM)
//! - 强制终止 (SIGKILL)
//! - 跨平台支持

use std::process::{Command, Stdio};
use serde::{Serialize, Deserialize};
use tracing::{info, warn, error};

/// 进程控制器
pub struct ProcessController;

/// 终止结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KillResult {
    pub pid: u32,
    pub success: bool,
    pub message: String,
}

impl ProcessController {
    pub fn new() -> Self {
        Self
    }

    /// 终止进程
    pub fn kill(&self, pid: u32) -> KillResult {
        #[cfg(unix)]
        {
            self.kill_unix(pid)
        }
        #[cfg(windows)]
        {
            self.kill_windows(pid)
        }
    }

    /// Unix 系统终止进程 (macOS, Linux)
    #[cfg(unix)]
    fn kill_unix(&self, pid: u32) -> KillResult {
        info!("Attempting to kill process {} on Unix", pid);
        
        // 首先尝试优雅终止 (SIGTERM)
        let result = Command::new("kill")
            .arg("-15") // SIGTERM
            .arg(pid.to_string())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .output();

        match result {
            Ok(output) => {
                if output.status.success() {
                    info!("Successfully sent SIGTERM to process {}", pid);
                    KillResult {
                        pid,
                        success: true,
                        message: format!("Process {} terminated gracefully", pid),
                    }
                } else {
                    // SIGTERM 失败，尝试强制终止 (SIGKILL)
                    warn!("SIGTERM failed for {}, trying SIGKILL", pid);
                    self.kill_unix_force(pid)
                }
            }
            Err(e) => {
                error!("Failed to kill process {}: {}", pid, e);
                KillResult {
                    pid,
                    success: false,
                    message: format!("Failed to kill process {}: {}", pid, e),
                }
            }
        }
    }

    /// Unix 强制终止 (SIGKILL)
    #[cfg(unix)]
    fn kill_unix_force(&self, pid: u32) -> KillResult {
        info!("Force killing process {} with SIGKILL", pid);
        
        let result = Command::new("kill")
            .arg("-9") // SIGKILL
            .arg(pid.to_string())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .output();

        match result {
            Ok(output) => {
                if output.status.success() {
                    info!("Successfully killed process {} with SIGKILL", pid);
                    KillResult {
                        pid,
                        success: true,
                        message: format!("Process {} forcefully terminated", pid),
                    }
                } else {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    error!("SIGKILL failed for {}: {}", pid, stderr);
                    KillResult {
                        pid,
                        success: false,
                        message: format!("Failed to kill process {}: {}", pid, stderr),
                    }
                }
            }
            Err(e) => {
                error!("Failed to execute kill command for {}: {}", pid, e);
                KillResult {
                    pid,
                    success: false,
                    message: format!("Failed to kill process {}: {}", pid, e),
                }
            }
        }
    }

    /// Windows 终止进程
    #[cfg(windows)]
    fn kill_windows(&self, pid: u32) -> KillResult {
        info!("Attempting to kill process {} on Windows", pid);
        
        // 使用 taskkill 命令
        let result = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"]) // /F 强制终止
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .output();

        match result {
            Ok(output) => {
                if output.status.success() {
                    info!("Successfully killed process {} on Windows", pid);
                    KillResult {
                        pid,
                        success: true,
                        message: format!("Process {} terminated", pid),
                    }
                } else {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    error!("taskkill failed for {}: {}", pid, stderr);
                    KillResult {
                        pid,
                        success: false,
                        message: format!("Failed to kill process {}: {}", pid, stderr),
                    }
                }
            }
            Err(e) => {
                error!("Failed to execute taskkill for {}: {}", pid, e);
                KillResult {
                    pid,
                    success: false,
                    message: format!("Failed to kill process {}: {}", pid, e),
                }
            }
        }
    }

    /// 检查进程是否存在
    pub fn process_exists(&self, pid: u32) -> bool {
        #[cfg(unix)]
        {
            // Unix: 发送信号 0 检查进程是否存在
            Command::new("kill")
                .arg("-0")
                .arg(pid.to_string())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
        }
        #[cfg(windows)]
        {
            // Windows: 使用 tasklist 检查
            Command::new("tasklist")
                .arg("/FI")
                .arg(format!("PID eq {}", pid))
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .output()
                .and_then(|o| {
                    let stdout = String::from_utf8_lossy(&o.stdout);
                    Ok(stdout.contains(&pid.to_string()))
                })
                .unwrap_or(false)
        }
    }
}

impl Default for ProcessController {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_controller_creation() {
        let controller = ProcessController::new();
        // 基本测试，确保可以创建
        assert!(true);
    }

    #[test]
    #[ignore] // 需要实际进程 PID，手动测试
    fn test_kill_process() {
        let controller = ProcessController::new();
        // 这里应该测试实际的杀进程功能
        // 但需要创建一个测试进程
    }
}
