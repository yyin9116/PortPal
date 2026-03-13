//! 端口扫描模块
//! 
//! 跨平台端口扫描实现：
//! - macOS: 使用 lsof 命令
//! - Windows: 使用 netstat 命令
//! - Linux: 使用 /proc/net/tcp 或 netstat

use std::process::Command;
use tracing::{info, error};

/// 端口条目
#[derive(Debug, Clone)]
pub struct PortEntry {
    pub port: u16,
    pub protocol: String, // TCP/UDP
    pub address: String,
    pub pid: u32,
}

/// 端口扫描器
pub struct PortScanner {
    /// 要扫描的端口范围
    port_ranges: Vec<(u16, u16)>,
}

impl PortScanner {
    pub fn new() -> Self {
        Self {
            port_ranges: Vec::new(),
        }
    }

    /// 设置端口范围
    pub fn with_port_ranges(mut self, ranges: Vec<(u16, u16)>) -> Self {
        self.port_ranges = ranges;
        self
    }
    /// 扫描所有监听端口
    pub fn scan(&self) -> Result<Vec<PortEntry>, anyhow::Error> {
        #[cfg(target_os = "macos")]
        {
            self.scan_macos()
        }
        #[cfg(target_os = "windows")]
        {
            self.scan_windows()
        }
        #[cfg(target_os = "linux")]
        {
            self.scan_linux()
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        {
            anyhow::bail!("Unsupported platform")
        }
    }

    /// macOS: 使用 lsof 扫描
    #[cfg(target_os = "macos")]
    fn scan_macos(&self) -> Result<Vec<PortEntry>, anyhow::Error> {
        info!("Scanning ports on macOS using lsof");
        
        // 使用 lsof 获取监听端口
        // -iTCP: 只查看 TCP
        // -sTCP:LISTEN: 只查看监听状态
        // -P: 显示端口号而非服务名
        // -n: 不解析主机名
        let output = Command::new("/usr/sbin/lsof")
            .args(["-iTCP", "-sTCP:LISTEN", "-P", "-n"])
            .output()?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            error!("lsof command failed: {}", stderr);
            return Err(anyhow::anyhow!("lsof command failed: {}", stderr));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        self.parse_lsof_output(&stdout)
    }

    /// 解析 lsof 输出
    #[cfg(target_os = "macos")]
    fn parse_lsof_output(&self, output: &str) -> Result<Vec<PortEntry>, anyhow::Error> {
        let mut entries = Vec::new();

        for line in output.lines() {
            // 跳过标题行
            if line.starts_with("COMMAND") {
                continue;
            }

            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 9 {
                continue;
            }

            // lsof 输出格式:
            // COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
            // node    123 user 18u IPv4 0x...      0t0  TCP *:3000 (LISTEN)
            
            let _pid_str = parts[1];
            // NAME 字段可能在第 9 列之后，因为前面可能有空格
            let name_field = parts[8..].join(" ");

            // 解析端口信息
            if let Some(mut port_info) = self.parse_lsof_name_field(&name_field) {
                // 解析 PID 并填充
                if let Ok(pid) = _pid_str.parse::<u32>() {
                    port_info.pid = pid;
                }
                // 检查是否在指定端口范围内
                if self.is_in_range(port_info.port) {
                    entries.push(port_info);
                }
            }
        }

        info!("Found {} listening ports", entries.len());
        Ok(entries)
    }

    /// 解析 lsof NAME 字段
    fn parse_lsof_name_field(&self, name_field: &str) -> Option<PortEntry> {
        // 格式：*:3000 (LISTEN) 或 127.0.0.1:3000 (LISTEN)
        if !name_field.contains("(LISTEN)") {
            return None;
        }

        let binding = name_field.replace("(LISTEN)", "");
        let addr_part = binding.trim();
        let parts: Vec<&str> = addr_part.split(':').collect();
        
        if parts.len() != 2 {
            return None;
        }

        let address = parts[0].to_string();
        let port = match parts[1].parse::<u16>() {
            Ok(p) => p,
            Err(_) => return None,
        };

        Some(PortEntry {
            port,
            protocol: "TCP".to_string(),
            address,
            pid: 0, // 会在后面填充
        })
    }

    /// Windows: 使用 netstat 扫描
    #[cfg(target_os = "windows")]
    fn scan_windows(&self) -> Result<Vec<PortEntry>, anyhow::Error> {
        info!("Scanning ports on Windows using netstat");
        
        let output = Command::new("netstat")
            .args(["-ano"])
            .output()?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            error!("netstat command failed: {}", stderr);
            return Err(anyhow::anyhow!("netstat command failed: {}", stderr));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        self.parse_netstat_output(&stdout)
    }

    /// 解析 netstat 输出 (Windows)
    #[cfg(target_os = "windows")]
    fn parse_netstat_output(&self, output: &str) -> Result<Vec<PortEntry>, anyhow::Error> {
        let mut entries = Vec::new();

        for line in output.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            
            // netstat -ano 输出格式:
            // Proto Local Address    Foreign Address  State       PID
            // TCP   0.0.0.0:3000     0.0.0.0:0        LISTENING   1234
            
            if parts.len() < 5 {
                continue;
            }

            let proto = parts[0];
            if proto != "TCP" && proto != "UDP" {
                continue;
            }

            let state = parts[4];
            if state != "LISTENING" && proto != "UDP" {
                continue;
            }

            // 解析本地地址
            let local_addr = parts[1];
            if let Some((address, port)) = self.parse_address_port(local_addr) {
                if self.is_in_range(port) {
                    let pid = parts.last().and_then(|p| p.parse::<u32>().ok()).unwrap_or(0);
                    entries.push(PortEntry {
                        port,
                        protocol: proto.to_string(),
                        address,
                        pid,
                    });
                }
            }
        }

        info!("Found {} listening ports", entries.len());
        Ok(entries)
    }

    /// Linux: 使用 /proc/net/tcp 或 netstat
    #[cfg(target_os = "linux")]
    fn scan_linux(&self) -> Result<Vec<PortEntry>, anyhow::Error> {
        // 优先尝试读取 /proc/net/tcp
        if let Ok(entries) = self.scan_proc_net() {
            return Ok(entries);
        }

        // 回退到 netstat
        self.scan_linux_netstat()
    }

    #[cfg(target_os = "linux")]
    fn scan_proc_net(&self) -> Result<Vec<PortEntry>, anyhow::Error> {
        use std::fs;
        
        let mut entries = Vec::new();
        
        // 读取 TCP 监听端口
        let tcp_path = "/proc/net/tcp";
        if let Ok(content) = fs::read_to_string(tcp_path) {
            for line in content.lines().skip(1) {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() < 12 {
                    continue;
                }

                // 状态 0A = LISTEN
                if parts[3] != "0A" {
                    continue;
                }

                // 解析本地地址 (格式：IP:PORT，十六进制)
                let local_addr = parts[1];
                if let Some((addr, port)) = self.parse_hex_address_port(local_addr) {
                    if self.is_in_range(port) {
                        // 解析 inode 获取 PID
                        let inode = parts[9];
                        let pid = self.find_pid_by_inode(inode).unwrap_or(0);
                        
                        entries.push(PortEntry {
                            port,
                            protocol: "TCP".to_string(),
                            address: addr,
                            pid,
                        });
                    }
                }
            }
        }

        Ok(entries)
    }

    #[cfg(target_os = "linux")]
    fn parse_hex_address_port(&self, hex_addr: &str) -> Option<(String, u16)> {
        let parts: Vec<&str> = hex_addr.split(':').collect();
        if parts.len() != 2 {
            return None;
        }

        // 端口是十六进制
        let port = u16::from_str_radix(parts[1], 16).ok()?;
        
        // IP 地址也是十六进制，需要转换
        let ip_hex = parts[0];
        let ip = if ip_hex == "00000000" {
            "0.0.0.0".to_string()
        } else if ip_hex == "0100007F" {
            "127.0.0.1".to_string()
        } else {
            // 简单处理：返回原始值
            ip_hex.to_string()
        };

        Some((ip, port))
    }

    #[cfg(target_os = "linux")]
    fn find_pid_by_inode(&self, inode: &str) -> Option<u32> {
        use std::fs;
        use std::path::Path;

        // 遍历 /proc/[pid]/fd 查找匹配的 inode
        if let Ok(proc_dir) = fs::read_dir("/proc") {
            for entry in proc_dir.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }

                let pid_str = path.file_name()?.to_str()?;
                if pid_str.parse::<u32>().is_err() {
                    continue;
                }

                let fd_path = path.join("fd");
                if let Ok(fd_dir) = fs::read_dir(fd_path) {
                    for fd_entry in fd_dir.flatten() {
                        if let Ok(link) = fs::read_link(fd_entry.path()) {
                            let link_str = link.to_string_lossy();
                            if link_str.contains(&format!("socket:[{}]", inode)) {
                                return pid_str.parse::<u32>().ok();
                            }
                        }
                    }
                }
            }
        }
        None
    }

    #[cfg(target_os = "linux")]
    fn scan_linux_netstat(&self) -> Result<Vec<PortEntry>, anyhow::Error> {
        let output = Command::new("netstat")
            .args(["-tlnp"])
            .output()?;

        if !output.status.success() {
            return Err(anyhow::anyhow!("netstat command failed"));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut entries = Vec::new();

        for line in stdout.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 6 {
                continue;
            }

            let proto = parts[0];
            let local_addr = parts[3];
            let pid_comm = parts[5];

            if let Some((address, port)) = self.parse_address_port(local_addr) {
                if self.is_in_range(port) {
                    let pid = pid_comm.split('/').next()
                        .and_then(|p| p.parse::<u32>().ok())
                        .unwrap_or(0);

                    entries.push(PortEntry {
                        port,
                        protocol: if proto.contains("6") { "TCP6" } else { "TCP" }.to_string(),
                        address,
                        pid,
                    });
                }
            }
        }

        Ok(entries)
    }

    /// 解析地址：端口
    fn parse_address_port(&self, addr_str: &str) -> Option<(String, u16)> {
        // 处理 IPv6: [::]:3000 或 :::3000
        if addr_str.starts_with('[') {
            let end = addr_str.find(']')?;
            let address = addr_str[1..end].to_string();
            let port = addr_str[end+2..].parse::<u16>().ok()?;
            return Some((address, port));
        }

        // 处理 IPv4: 0.0.0.0:3000 或 *:3000
        let parts: Vec<&str> = addr_str.rsplitn(2, ':').collect();
        if parts.len() != 2 {
            return None;
        }

        let port = parts[0].parse::<u16>().ok()?;
        let address = parts[1].to_string();
        Some((address, port))
    }

    /// 检查端口是否在指定范围内
    fn is_in_range(&self, port: u16) -> bool {
        if self.port_ranges.is_empty() {
            return true;
        }

        self.port_ranges.iter().any(|(start, end)| {
            port >= *start && port <= *end
        })
    }
}

impl Default for PortScanner {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(target_os = "macos")]
    fn test_parse_lsof_name_field() {
        let scanner = PortScanner::new();
        
        let result = scanner.parse_lsof_name_field("*:3000 (LISTEN)");
        assert!(result.is_some());
        let entry = result.unwrap();
        assert_eq!(entry.port, 3000);
        assert_eq!(entry.address, "*");
    }

    #[test]
    fn test_parse_address_port() {
        let scanner = PortScanner::new();
        
        let result = scanner.parse_address_port("0.0.0.0:3000");
        assert!(result.is_some());
        let (addr, port) = result.unwrap();
        assert_eq!(addr, "0.0.0.0");
        assert_eq!(port, 3000);
    }
}
