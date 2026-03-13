# PortPal

PortPal 是一个常驻桌面托盘的本地端口管理工具，用来解决这些高频问题：

- 不知道哪个进程占用了某个端口
- 本地服务起不来，报 `EADDRINUSE`
- 想快速打开服务、定位项目目录或结束占用进程
- 需要从菜单栏随手查看当前机器正在监听的端口

当前实现基于 `Tauri + Rust + React`：

- `Rust` 负责端口扫描、进程识别、托盘和原生窗口行为
- `React + TypeScript` 负责主界面和交互

## 面向用户的能力

- 扫描本机监听端口
- 显示端口对应的进程、地址、命令和来源目录
- 一键在浏览器打开本地服务
- 一键打开项目目录或在 VSCode 中打开
- 一键结束占用端口的进程
- 从菜单栏图标快速唤起主窗口

## 当前范围

当前版本重点解决“发现端口占用并快速处理”的核心流程。

已完成：

- 托盘应用基础框架
- 端口扫描与进程信息展示
- 进程结束、浏览器打开、目录打开、VSCode 打开
- 更紧凑的端口列表界面
- 默认全端口扫描

计划中的增强：

- 扫描范围设置
- 排除端口 / 排除进程 / 白名单进程
- 更稳定的菜单栏弹出和窗口定位
- 更完整的设置页

## 项目结构

```text
PortPal/
├── src/                 # React 界面
├── src-tauri/           # Rust / Tauri 后端
├── public/              # 静态资源
├── index.html
├── package.json
├── vite.config.ts
└── README.md
```

其中：

- `src-tauri/src/scanner.rs`：端口扫描
- `src-tauri/src/process_info.rs`：进程信息识别
- `src-tauri/src/process_control.rs`：结束进程
- `src-tauri/src/lib.rs`：Tauri 命令、托盘、窗口行为
- `src/App.tsx`：主界面

## 本地开发

前置依赖：

- Node.js 20+
- Rust stable
- macOS 下需要 Tauri 构建依赖

安装依赖：

```bash
npm ci
```

启动开发环境：

```bash
npm run tauri dev
```

前端构建：

```bash
npm run build
```

Rust 检查：

```bash
cd src-tauri
cargo check
```

## CI

仓库已配置 GitHub Actions 做基础检查：

- Node 依赖安装
- 前端构建
- Rust `cargo check`

当前没有配置自动发布和打包产物上传，也不会自动触发正式版本构建。

## 仓库

GitHub: [yyin9116/PortPal](https://github.com/yyin9116/PortPal)
