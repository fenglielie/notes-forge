# notes-forge

[English](./README.md) | 简体中文

`notes-forge` 是一个零配置、开箱即用的笔记静态站点工具。
目标是让你在本地目录里直接运行命令，就能浏览和分享 Markdown/PDF/Jupyter Notebook 内容，也可以部署到静态托管。

## 适用场景

- 你有一堆分散在目录中的 `.md` / `.pdf` / `.ipynb` 文件，想快速统一浏览。
- 你不想维护复杂配置文件、主题系统或构建链路。
- 你希望支持两种模式：
  - 直接内存服务（不生成输出目录）
  - 生成可部署目录（可部署到任意静态托管）

## 核心特性

- 零配置默认可用：默认当前目录、默认端口、默认包含全部支持格式。
- 双模式：
  - `serve --md-from .`：内存模式，启动快，不落地站点文件。
  - `build . -o public`：生成静态站点，可部署。
- 内容树自动扫描：按目录结构生成树。
- 支持格式过滤：`--include md,pdf,ipynb`。
- 当 `--include` 包含 `md` 时，会自动保留 Markdown 常见本地图片资源（如 `png/jpg/svg/webp`）。
- Markdown 内相对链接到 `.md/.pdf/.ipynb` 时，会在应用内跳转并加载对应文档（不走浏览器默认下载）。
- 支持目录忽略：`--ignore-dir`（可重复或逗号分隔）。
- UI 开关：
  - `--hide-tree`
  - `--hide-toc`
  - `--enable-search`
  - `--enable-download`
  - `--footer "..."`。
- 服务增强：
  - 默认仅绑定本机回环地址 `127.0.0.1`
  - 端口占用自动递增回退
  - 可选 HTTP 访问日志输出。

## 安装

独立发布后，命令名为 `notes-forge`。

```bash
uv tool install git+https://github.com/fenglielie/notes-forge.git@main
```

或安装到当前 Python 环境：

```bash
pip install git+https://github.com/fenglielie/notes-forge.git@main
```

安装后执行：

```bash
notes-forge --version
```

## 快速开始

在你的笔记目录中：

```bash
# 1) 直接预览（内存模式，不生成 public）
notes-forge serve --md-from .

# 2) 构建静态站点
notes-forge build . -o public

# 3) 预览已构建站点
notes-forge serve --html-from public -p 8080
```

## 命令说明

### 1) build

生成可部署目录（不是逐篇预渲染 HTML）。

```bash
notes-forge build [input_dir] -o [output_dir]
```

常用参数：

- `--include md,pdf,ipynb`
- `--copy-all-files`（显式复制全部非隐藏文件；默认仅复制 `--include` 相关内容与 Markdown 图片资源）
- `--ignore-dir node_modules,.git,build`
- `--hide-tree`
- `--hide-toc`
- `--enable-search`
- `--enable-download`
- `--footer "你的页脚文案"`

### 2) serve

服务模式二选一：

- `--md-from <dir>`：直接服务源目录（推荐日常使用）
- `--html-from <dir>`：服务已构建静态目录

```bash
notes-forge serve --md-from . --port 8080
notes-forge serve --html-from public --port 8080
```

常用参数：

- `--host 127.0.0.1`
- `-p, --port 8080`
- `--no-browser`
- `--http-log-file logs/http-access.log`

### 3) clean

清理构建输出目录：

```bash
notes-forge clean -o public
```

## 常见示例

```bash
# 仅展示 Markdown
notes-forge serve --md-from . --include md

# 构建时显式复制所有非隐藏文件（兼容旧行为）
notes-forge build . -o public --copy-all-files

# 忽略多个目录
notes-forge build . -o public --ignore-dir .git --ignore-dir node_modules,dist

# 启用搜索和下载按钮
notes-forge serve --md-from . --enable-search --enable-download

# 添加固定页脚
notes-forge serve --md-from . --footer "© 2026 Your Name"
```

## 关于“可部署”的准确说明

- `notes-forge build` 不会把每个 `.md/.pdf/.ipynb` 预先转换成独立 HTML 页面。
- `public` 的结构本质上是：
  - 一个统一的前端入口 `index.html`
  - 内容索引 `tree.json`
  - 从源目录复制过去的原始内容文件：
    - 默认：按 `--include` 选择的内容类型（`md/pdf/ipynb`）以及 Markdown 本地图片资源
    - 可选：使用 `--copy-all-files` 复制全部非隐藏文件
- 页面渲染发生在浏览器端：前端按 `tree.json` 找到并加载原始文件进行展示。
- 因此部署方式很简单：把 `public` 整个目录原样上传到任意静态文件服务器即可。

## 注意事项

- `--enable-search` 与 `--hide-tree` 不能同时使用。
- 默认 `host=127.0.0.1`，如果要局域网访问请显式指定 `--host 0.0.0.0`。
- 在 `serve --md-from` 模式下，服务端会限制可访问内容文件类型；当 `--include` 包含 `md` 时，也允许访问 Markdown 引用的常见本地图片资源。
- Markdown 中的相对文档链接（`.md/.pdf/.ipynb`）会由前端拦截并在应用内加载；外部链接（`http/https/mailto`）保持默认行为。
