//! 进程信息模块
//! 
//! 根据 PID 获取进程的详细信息：
//! - 进程名称
//! - 启动命令
//! - 工作目录 (CWD)
//! - 项目名称 (从路径提取)

use std::path::Path;
use sysinfo::System;

/// 进程详细信息
#[derive(Debug, Clone)]
pub struct ProcessDetails {
    /// 进程 ID
    pub pid: u32,
    /// 进程名称
    pub name: String,
    /// 启动命令
    pub command: String,
    /// 工作目录
    pub cwd: String,
    /// 项目名称 (从工作目录提取的最后一部分)
    pub project_name: String,
}

/// 进程信息获取器
pub struct ProcessInfo {
    system: System,
}

impl ProcessInfo {
    pub fn new() -> Self {
        let mut system = System::new();
        system.refresh_all();
        Self { system }
    }

    /// 刷新系统信息
    pub fn refresh(&mut self) {
        self.system.refresh_all();
    }

    /// 根据 PID 获取进程详情
    pub fn get_process_details(&mut self, pid: u32) -> Option<ProcessDetails> {
        self.refresh();

        let process = self.system.process(sysinfo::Pid::from(pid as usize))?;
        
        let name = process.name().to_string();
        
        // 获取启动命令
        let command = process.cmd()
            .iter()
            .map(|s| s.to_string())
            .collect::<Vec<_>>()
            .join(" ");

        // 获取工作目录
        let cwd = process.cwd()
            .map(|p| p.display().to_string())
            .or_else(|| {
                process.exe()
                    .and_then(|p| p.parent())
                    .map(|p| p.display().to_string())
            })
            .unwrap_or_default();

        // 提取项目名称
        let project_name = Self::extract_project_name(&cwd, &command, &name);

        Some(ProcessDetails {
            pid,
            name,
            command,
            cwd,
            project_name,
        })
    }

    /// 从工作目录提取项目名称
    fn extract_project_name(cwd: &str, command: &str, process_name: &str) -> String {
        if let Some(name) = Self::basename(cwd) {
            return name;
        }

        if let Some(name) = command
            .split_whitespace()
            .find_map(Self::basename)
            .filter(|name| !Self::is_generic_name(name))
        {
            return name;
        }

        if !process_name.is_empty() && !Self::is_generic_name(process_name) {
            return process_name.to_string();
        }

        String::from("未识别来源")
    }

    fn basename(input: &str) -> Option<String> {
        if input.is_empty() {
            return None;
        }

        Path::new(input)
            .file_name()
            .and_then(|n| n.to_str())
            .map(|name| name.to_string())
            .filter(|name| !name.is_empty())
    }

    fn is_generic_name(name: &str) -> bool {
        matches!(
            name.to_ascii_lowercase().as_str(),
            "unknown" | "node" | "npm" | "pnpm" | "yarn" | "bun" | "python" | "python3" | "java"
        )
    }

    /// 批量获取进程详情
    pub fn get_processes_details(&mut self, pids: &[u32]) -> Vec<ProcessDetails> {
        self.refresh();
        
        pids.iter()
            .filter_map(|&pid| self.get_process_details(pid))
            .collect()
    }

    /// 获取所有进程列表
    pub fn list_all_processes(&self) -> Vec<(u32, String)> {
        self.system.processes()
            .iter()
            .map(|(pid, process)| {
                (pid.as_u32(), process.name().to_string())
            })
            .collect()
    }
}

impl Default for ProcessInfo {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_project_name() {
        assert_eq!(
            ProcessInfo::extract_project_name("/Users/dev/projects/my-app", "", ""),
            "my-app"
        );
        
        assert_eq!(
            ProcessInfo::extract_project_name("/home/user/code/vue-project", "", ""),
            "vue-project"
        );
        
        assert_eq!(
            ProcessInfo::extract_project_name("", "", ""),
            "未识别来源"
        );
    }

    #[test]
    fn test_get_current_process() {
        let mut info = ProcessInfo::new();
        let current_pid = std::process::id();
        
        let details = info.get_process_details(current_pid);
        assert!(details.is_some());
        
        let details = details.unwrap();
        assert_eq!(details.pid, current_pid);
        assert!(!details.name.is_empty());
    }
}
