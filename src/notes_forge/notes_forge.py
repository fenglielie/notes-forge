#!/usr/bin/env python3
"""Mini static notes site builder."""

import argparse
import errno as errno_codes
import importlib.resources as importlib_resources
import json
import logging
import os
import socket
import stat
import shutil
import sys
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Iterable
from urllib.parse import unquote, urlsplit

from notes_forge import __version__

logger = logging.getLogger(__name__)

DEFAULT_OUTPUT_DIR = "public"
DEFAULT_PORT = 8080
DEFAULT_HOST = "127.0.0.1"
SUPPORTED_CONTENT_FORMATS = ("md", "pdf", "ipynb")
DEFAULT_HIDE_TREE = False
DEFAULT_HIDE_TOC = False
DEFAULT_ENABLE_SEARCH = False
DEFAULT_ENABLE_DOWNLOAD = False
DEFAULT_FOOTER_TEXT = ""
PORT_FALLBACK_TRIES = 50
PORT_IN_USE_ERRNOS = {
    errno_codes.EADDRINUSE,
    48,  # macOS commonly reports EADDRINUSE as 48
}
PORT_IN_USE_WINERRORS = {
    10048,  # WSAEADDRINUSE
    10013,  # WSAEACCES (often returned by bind for unavailable ports on Windows)
}
PORT_IN_USE_MESSAGE_MARKERS = (
    "address already in use",
    "only one usage of each socket address",
    "normally each socket address",
)
ROOT_EXCLUDED_BUILD_DIRS = {
    "public",
    "pulic",
    "notes_forge_assets",
    "node_modules",
    "__pycache__",
    "venv",
    ".venv",
    "env",
    ".env",
    ".git",
    ".github",
    ".gitlab",
    ".svn",
    ".hg",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".tox",
    ".nox",
    ".idea",
    ".vscode",
    ".cache",
    ".next",
    ".nuxt",
    ".yarn",
    ".pnpm-store",
}


def add_log_level_argument(
    parser: argparse.ArgumentParser, *, default: str | object = "WARNING"
) -> None:
    parser.add_argument(
        "--log-level",
        type=str.upper,
        choices=["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
        default=default,
        help="Set log level (default: WARNING)",
    )


def add_include_argument(
    parser: argparse.ArgumentParser,
    *,
    default: list[str] | object = None,
) -> None:
    parser.add_argument(
        "--include",
        action="append",
        default=[] if default is None else default,
        metavar="FMTS",
        help=(
            "Include content formats, comma-separated or repeatable "
            f"(supported: {', '.join(SUPPORTED_CONTENT_FORMATS)}; default: all supported)."
        ),
    )


def add_ignore_dir_argument(
    parser: argparse.ArgumentParser, *, default: list[str] | object = None
) -> None:
    parser.add_argument(
        "--ignore-dir",
        action="append",
        default=[] if default is None else default,
        metavar="DIR",
        help=(
            "Ignore directory by name (e.g., node_modules) or by path "
            "(e.g., docs/build or C:\\temp\\cache). Repeatable."
        ),
    )


def add_ui_toggle_arguments(
    parser: argparse.ArgumentParser,
    *,
    hide_tree_default: bool | object = DEFAULT_HIDE_TREE,
    hide_toc_default: bool | object = DEFAULT_HIDE_TOC,
) -> None:
    parser.add_argument(
        "--hide-tree",
        action="store_true",
        default=hide_tree_default,
        help="Hide file tree panel and related buttons in frontend.",
    )
    parser.add_argument(
        "--hide-toc",
        action="store_true",
        default=hide_toc_default,
        help="Hide TOC panel and related buttons in frontend.",
    )


def add_footer_argument(
    parser: argparse.ArgumentParser, *, default: str | object = DEFAULT_FOOTER_TEXT
) -> None:
    parser.add_argument(
        "--footer",
        type=str,
        default=default,
        help="Fixed footer text shown at the bottom of the page.",
    )


def add_search_argument(
    parser: argparse.ArgumentParser, *, default: bool | object = DEFAULT_ENABLE_SEARCH
) -> None:
    parser.add_argument(
        "--enable-search",
        action="store_true",
        default=default,
        help="Enable full-text search for supported files (md/pdf/ipynb).",
    )


def add_download_argument(
    parser: argparse.ArgumentParser, *, default: bool | object = DEFAULT_ENABLE_DOWNLOAD
) -> None:
    parser.add_argument(
        "--enable-download",
        action="store_true",
        default=default,
        help="Show a download button in frontend to download the current raw md/pdf/ipynb file.",
    )


def normalize_include_formats(values: list[str] | None) -> set[str]:
    if not values:
        return set(SUPPORTED_CONTENT_FORMATS)
    selected: set[str] = set()
    for raw in values:
        for part in raw.split(","):
            fmt = part.strip().lower()
            if not fmt:
                continue
            if fmt not in SUPPORTED_CONTENT_FORMATS:
                supported = ", ".join(SUPPORTED_CONTENT_FORMATS)
                raise ValueError(
                    f"Unsupported format in --include: {fmt!r}. Supported formats: {supported}"
                )
            selected.add(fmt)
    return selected if selected else set(SUPPORTED_CONTENT_FORMATS)


def log_notice(message: str) -> None:
    print(f"[INFO] {message}")


def configure_logging(log_level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, log_level, logging.WARNING),
        format="[%(levelname)s] %(message)s",
    )


def create_http_access_logger(log_file: Path | None) -> logging.Logger | None:
    if log_file is None:
        return None

    resolved_file = log_file.expanduser().resolve()
    resolved_file.parent.mkdir(parents=True, exist_ok=True)

    http_logger = logging.getLogger("notes_forge.notes_forge.http_access")
    http_logger.setLevel(logging.INFO)
    http_logger.propagate = False

    for handler in list(http_logger.handlers):
        http_logger.removeHandler(handler)
        try:
            handler.close()
        except Exception:
            pass

    file_handler = logging.FileHandler(resolved_file, encoding="utf-8")
    file_handler.setLevel(logging.INFO)
    file_handler.setFormatter(logging.Formatter("%(asctime)s %(message)s"))
    http_logger.addHandler(file_handler)
    return http_logger


def _emit_http_access_log(
    handler: SimpleHTTPRequestHandler,
    format: str,
    args: tuple[object, ...],
    *,
    http_access_logger: logging.Logger | None,
) -> None:
    if http_access_logger is None:
        SimpleHTTPRequestHandler.log_message(handler, format, *args)
        return

    try:
        message = format % args
    except Exception:
        message = f"{format} {' '.join(str(arg) for arg in args)}".strip()
    http_access_logger.info(
        "%s - - [%s] %s",
        handler.address_string(),
        handler.log_date_time_string(),
        message,
    )


def read_asset_text(filename: str) -> str:
    try:
        return (
            importlib_resources.files("notes_forge")
            .joinpath("notes_forge_assets", filename)
            .read_text(encoding="utf-8")
            .rstrip("\n")
        )
    except (FileNotFoundError, ModuleNotFoundError):
        pass

    asset_path = Path(__file__).resolve().with_name("notes_forge_assets") / filename
    if asset_path.is_file():
        return asset_path.read_text(encoding="utf-8").rstrip("\n")

    raise FileNotFoundError(
        f"Missing asset file: {filename}; "
        f"searched package data notes_forge/notes_forge_assets and fallback path {asset_path}"
    )


HEAD_SNIPPET = read_asset_text("head.html")
STYLE_CSS = read_asset_text("style.css")
BODY_HTML = read_asset_text("body.html")
APP_JS = read_asset_text("app.js")


def render_index_html(
    *,
    hide_tree: bool = False,
    hide_toc: bool = False,
    enable_search: bool = False,
    enable_download: bool = False,
    footer_text: str = "",
    serve_mode: bool = False,
) -> str:
    ui_config = {
        "hideTree": hide_tree,
        "hideToc": hide_toc,
        "enableSearch": enable_search,
        "enableDownload": enable_download,
        "footerText": footer_text,
        "serveMode": serve_mode,
    }
    return f"""<!DOCTYPE html>
<html lang="en">

<head>
{HEAD_SNIPPET}
    <style>
{STYLE_CSS}
    </style>
</head>

<body>
{BODY_HTML}
    <script>
window.NOTES_FORGE_CONFIG = {json.dumps(ui_config, ensure_ascii=False)};
    </script>
    <script>
{APP_JS}
    </script>
</body>

</html>
"""


def log_ok(message: str) -> None:
    print(f"[OK] {message}")


def _iter_visible_children(path: Path) -> Iterable[Path]:
    children = [child for child in path.iterdir() if not child.name.startswith(".")]
    return sorted(children, key=lambda p: (p.is_file(), p.name.lower()))


def _should_skip_dir(
    path: Path,
    root_dir: Path,
    excluded_dirs: set[Path],
    excluded_root_names: set[str],
    excluded_anywhere_names: set[str] | None = None,
) -> bool:
    resolved = path.resolve()
    if resolved in excluded_dirs:
        return True
    excluded_anywhere_names = excluded_anywhere_names or set()
    if resolved.name.lower() in excluded_anywhere_names:
        return True
    if (
        resolved.parent == root_dir.resolve()
        and resolved.name.lower() in excluded_root_names
    ):
        return True
    return False


def build_tree(
    root_dir: Path,
    include_formats: set[str] | None = None,
    excluded_dirs: set[Path] | None = None,
    excluded_root_names: set[str] | None = None,
    excluded_anywhere_names: set[str] | None = None,
) -> list[dict]:
    include_formats = (
        set(SUPPORTED_CONTENT_FORMATS)
        if include_formats is None
        else set(include_formats)
    )
    excluded_dirs = {p.resolve() for p in (excluded_dirs or set())}
    excluded_root_names = {name.lower() for name in (excluded_root_names or set())}
    excluded_anywhere_names = {
        name.lower() for name in (excluded_anywhere_names or set())
    }
    root_dir = root_dir.resolve()

    def _walk(path: Path) -> list[dict]:
        items: list[dict] = []
        for item in _iter_visible_children(path):
            if item.is_dir():
                if _should_skip_dir(
                    item,
                    root_dir,
                    excluded_dirs,
                    excluded_root_names,
                    excluded_anywhere_names,
                ):
                    continue
                children = _walk(item)
                if children:
                    items.append(
                        {
                            "type": "folder",
                            "name": item.name,
                            "children": children,
                        }
                    )
            elif item.is_file() and item.suffix.lower() == ".md":
                if "md" in include_formats:
                    items.append(
                        {
                            "type": "file",
                            "name": item.name,
                            "path": item.relative_to(root_dir).as_posix(),
                            "format": "md",
                        }
                    )
            elif item.is_file() and item.suffix.lower() == ".pdf":
                if "pdf" in include_formats:
                    items.append(
                        {
                            "type": "file",
                            "name": item.name,
                            "path": item.relative_to(root_dir).as_posix(),
                            "format": "pdf",
                        }
                    )
            elif item.is_file() and item.suffix.lower() == ".ipynb":
                if "ipynb" in include_formats:
                    items.append(
                        {
                            "type": "file",
                            "name": item.name,
                            "path": item.relative_to(root_dir).as_posix(),
                            "format": "ipynb",
                        }
                    )
        return items

    return _walk(root_dir)


def _tree_stats(nodes: list[dict]) -> tuple[int, int, int, int]:
    folders = 0
    md_files = 0
    pdf_files = 0
    ipynb_files = 0
    for node in nodes:
        if node["type"] == "folder":
            folders += 1
            sub_folders, sub_md_files, sub_pdf_files, sub_ipynb_files = _tree_stats(
                node.get("children", [])
            )
            folders += sub_folders
            md_files += sub_md_files
            pdf_files += sub_pdf_files
            ipynb_files += sub_ipynb_files
        elif node["type"] == "file":
            file_format = node.get("format")
            if file_format == "pdf":
                pdf_files += 1
            elif file_format == "ipynb":
                ipynb_files += 1
            else:
                md_files += 1
    return folders, md_files, pdf_files, ipynb_files


def _count_files(path: Path) -> int:
    if not path.exists():
        return 0
    return sum(1 for p in path.rglob("*") if p.is_file())


def resolve_ignored_dirs(
    root_dir: Path, ignored_args: list[str] | None
) -> tuple[set[Path], set[str]]:
    ignored_paths: set[Path] = set()
    ignored_names: set[str] = set()
    for raw in ignored_args or []:
        for part in raw.split(","):
            value = part.strip()
            if not value:
                continue
            p = Path(value)
            if (
                p.is_absolute()
                or any(sep in value for sep in ("/", "\\"))
                or value.startswith(".")
            ):
                resolved = (p if p.is_absolute() else (root_dir / p)).resolve()
                ignored_paths.add(resolved)
            else:
                ignored_names.add(value.lower())
    return ignored_paths, ignored_names


def copy_site_sources(
    src_root: Path,
    dst_root: Path,
    output_dir: Path,
    ignored_dirs: list[str] | None = None,
) -> int:
    src_root = src_root.resolve()
    dst_root = dst_root.resolve()
    output_dir = output_dir.resolve()
    ignored_paths, ignored_names = resolve_ignored_dirs(src_root, ignored_dirs)
    excluded_dirs = {output_dir, *ignored_paths}
    copied_files = 0

    for dirpath, dirnames, filenames in os.walk(src_root):
        current_dir = Path(dirpath)
        rel_dir = current_dir.relative_to(src_root)

        kept_dirs: list[str] = []
        for dirname in dirnames:
            if dirname.startswith("."):
                continue
            src_child = (current_dir / dirname).resolve()
            if _should_skip_dir(
                src_child,
                src_root,
                excluded_dirs,
                ROOT_EXCLUDED_BUILD_DIRS,
                ignored_names,
            ):
                continue
            kept_dirs.append(dirname)
        dirnames[:] = kept_dirs

        for filename in filenames:
            if filename.startswith("."):
                continue
            src_file = current_dir / filename
            rel_file = rel_dir / filename

            dst_file = dst_root / rel_file
            dst_file.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src_file, dst_file)
            copied_files += 1

    return copied_files


def _on_rm_error(func, path, _exc_info) -> None:
    try:
        os.chmod(path, stat.S_IWRITE)
        func(path)
    except PermissionError:
        # If file is locked by another process, leave cleanup to next run.
        pass


def safe_rmtree(path: Path) -> None:
    if not path.exists():
        return
    try:
        shutil.rmtree(path, onexc=_on_rm_error)
    except TypeError:
        # Python 3.11 does not support onexc; keep backward compatibility.
        shutil.rmtree(path, onerror=_on_rm_error)


def build_site(
    input_dir: Path,
    output_dir: Path,
    include_formats: set[str] | None = None,
    ignored_dirs: list[str] | None = None,
    *,
    hide_tree: bool = False,
    hide_toc: bool = False,
    enable_search: bool = False,
    enable_download: bool = False,
    footer_text: str = "",
) -> None:
    input_dir = input_dir.resolve()
    output_dir = output_dir.resolve()

    if not input_dir.is_dir():
        raise FileNotFoundError(f"Input directory not found: {input_dir}")

    if output_dir.exists():
        safe_rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    ignored_paths, ignored_names = resolve_ignored_dirs(input_dir, ignored_dirs)
    excluded_dirs = {output_dir, *ignored_paths}
    copied_files = copy_site_sources(
        input_dir, output_dir, output_dir, ignored_dirs=ignored_dirs
    )

    tree = build_tree(
        input_dir,
        include_formats=include_formats,
        excluded_dirs=excluded_dirs,
        excluded_root_names=ROOT_EXCLUDED_BUILD_DIRS,
        excluded_anywhere_names=ignored_names,
    )
    (output_dir / "tree.json").write_text(
        json.dumps(tree, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (output_dir / "index.html").write_text(
        render_index_html(
            hide_tree=hide_tree,
            hide_toc=hide_toc,
            enable_search=enable_search,
            enable_download=enable_download,
            footer_text=footer_text,
            serve_mode=False,
        ),
        encoding="utf-8",
    )

    folders, md_files, pdf_files, ipynb_files = _tree_stats(tree)
    content_files = md_files + pdf_files + ipynb_files
    total_files = _count_files(output_dir)
    log_ok("Build finished.")
    log_notice(f"Output directory : {output_dir}")
    formats_text = ", ".join(sorted(include_formats or set(SUPPORTED_CONTENT_FORMATS)))
    log_notice(f"Include formats  : {formats_text}")
    log_notice(f"Markdown files   : {md_files}")
    log_notice(f"PDF files        : {pdf_files}")
    log_notice(f"Notebook files   : {ipynb_files}")
    log_notice(f"Content files    : {content_files}")
    log_notice(f"Content folders  : {folders}")
    log_notice(f"Generated files  : {total_files}")
    log_notice("Entry file       : index.html")
    logger.debug(f"Copied source files: {copied_files}")


def _send_bytes(
    handler: SimpleHTTPRequestHandler, data: bytes, content_type: str
) -> None:
    handler.send_response(200)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


def _send_headers_only(
    handler: SimpleHTTPRequestHandler, data_len: int, content_type: str
) -> None:
    handler.send_response(200)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(data_len))
    handler.end_headers()


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _is_hidden_path(path: Path) -> bool:
    return any(
        part.startswith(".") for part in path.parts if part not in ("", ".", "..")
    )


def _is_excluded_by_name_or_path(
    *,
    target: Path,
    root_dir: Path,
    excluded_dirs: set[Path],
    excluded_root_names: set[str],
    excluded_anywhere_names: set[str],
) -> bool:
    root_dir = root_dir.resolve()
    target = target.resolve()
    if not _is_within(target, root_dir):
        return True
    rel_parts = target.relative_to(root_dir).parts
    for idx, part in enumerate(rel_parts):
        part_lower = part.lower()
        if part_lower in excluded_anywhere_names:
            return True
        if idx == 0 and part_lower in excluded_root_names:
            return True
    for excluded in excluded_dirs:
        if _is_within(target, excluded.resolve()):
            return True
    return False


def make_memory_handler(
    md_root: Path,
    include_formats: set[str],
    ignored_dirs: list[str] | None = None,
    *,
    http_access_logger: logging.Logger | None = None,
    hide_tree: bool = False,
    hide_toc: bool = False,
    enable_search: bool = False,
    enable_download: bool = False,
    footer_text: str = "",
):
    md_root = md_root.resolve()
    ignored_paths, ignored_names = resolve_ignored_dirs(md_root, ignored_dirs)
    ignored_paths = {p.resolve() for p in ignored_paths}

    allowed_ext_map = {
        "md": ".md",
        "pdf": ".pdf",
        "ipynb": ".ipynb",
    }
    allowed_suffixes = {
        suffix for fmt, suffix in allowed_ext_map.items() if fmt in set(include_formats)
    }

    def _resolve_request_file(req_path: str) -> Path | None:
        rel_raw = req_path.lstrip("/")
        if not rel_raw:
            return None
        rel_path = Path(rel_raw)
        if rel_path.is_absolute() or ".." in rel_path.parts:
            return None
        if _is_hidden_path(rel_path):
            return None
        target = (md_root / rel_path).resolve()
        if not _is_within(target, md_root):
            return None
        return target

    def _is_allowed_request_file(path: Path) -> bool:
        if not path.is_file():
            return False
        if path.suffix.lower() not in allowed_suffixes:
            return False
        return not _is_excluded_by_name_or_path(
            target=path,
            root_dir=md_root,
            excluded_dirs=ignored_paths,
            excluded_root_names=ROOT_EXCLUDED_BUILD_DIRS,
            excluded_anywhere_names=ignored_names,
        )

    class MemoryHandler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(md_root), **kwargs)

        def log_message(self, format, *args):
            _emit_http_access_log(
                self,
                format,
                args,
                http_access_logger=http_access_logger,
            )

        def do_GET(self):
            req_path = unquote(urlsplit(self.path).path)
            if req_path in ("/", "/index.html"):
                data = render_index_html(
                    hide_tree=hide_tree,
                    hide_toc=hide_toc,
                    enable_search=enable_search,
                    enable_download=enable_download,
                    footer_text=footer_text,
                    serve_mode=True,
                ).encode("utf-8")
                _send_bytes(self, data, "text/html; charset=utf-8")
                return
            if req_path == "/__healthz":
                data = json.dumps(
                    {"ok": True, "mode": "serve", "status": "alive"},
                    ensure_ascii=False,
                ).encode("utf-8")
                _send_bytes(self, data, "application/json; charset=utf-8")
                return
            if req_path == "/tree.json":
                tree = build_tree(
                    md_root,
                    include_formats=include_formats,
                    excluded_dirs=ignored_paths,
                    excluded_root_names=ROOT_EXCLUDED_BUILD_DIRS,
                    excluded_anywhere_names=ignored_names,
                )
                data = json.dumps(tree, ensure_ascii=False, indent=2).encode("utf-8")
                _send_bytes(self, data, "application/json; charset=utf-8")
                return
            target = _resolve_request_file(req_path)
            if target is None or not _is_allowed_request_file(target):
                self.send_error(404, "Not Found")
                return
            super().do_GET()

        def do_HEAD(self):
            req_path = unquote(urlsplit(self.path).path)
            if req_path in ("/", "/index.html"):
                data_len = len(
                    render_index_html(
                        hide_tree=hide_tree,
                        hide_toc=hide_toc,
                        enable_search=enable_search,
                        enable_download=enable_download,
                        footer_text=footer_text,
                        serve_mode=True,
                    ).encode("utf-8")
                )
                _send_headers_only(self, data_len, "text/html; charset=utf-8")
                return
            if req_path == "/__healthz":
                data_len = len(
                    json.dumps(
                        {"ok": True, "mode": "serve", "status": "alive"},
                        ensure_ascii=False,
                    ).encode("utf-8")
                )
                _send_headers_only(self, data_len, "application/json; charset=utf-8")
                return
            if req_path == "/tree.json":
                tree = build_tree(
                    md_root,
                    include_formats=include_formats,
                    excluded_dirs=ignored_paths,
                    excluded_root_names=ROOT_EXCLUDED_BUILD_DIRS,
                    excluded_anywhere_names=ignored_names,
                )
                data_len = len(
                    json.dumps(tree, ensure_ascii=False, indent=2).encode("utf-8")
                )
                _send_headers_only(self, data_len, "application/json; charset=utf-8")
                return
            target = _resolve_request_file(req_path)
            if target is None or not _is_allowed_request_file(target):
                self.send_error(404, "Not Found")
                return
            super().do_HEAD()

    return MemoryHandler


def _try_open_browser(url: str, port: int) -> None:
    is_linux = sys.platform.startswith("linux")
    has_gui = any(os.environ.get(var) for var in ("DISPLAY", "WAYLAND_DISPLAY"))
    if is_linux and not has_gui:
        log_notice("No GUI browser detected in this Linux environment.")
        log_notice("If this is a remote server, use SSH port forwarding:")
        log_notice(f"  ssh -N -L {port}:127.0.0.1:{port} <user>@<server>")
        log_notice(f"Then open: http://127.0.0.1:{port}")
        return

    result: dict[str, object] = {"opened": False, "error": None}
    done = threading.Event()

    def _open() -> None:
        try:
            result["opened"] = webbrowser.open(url, new=2)
        except Exception as exc:
            result["error"] = exc
        finally:
            done.set()

    threading.Thread(target=_open, daemon=True).start()
    if not done.wait(timeout=1.5):
        logger.debug("Browser auto-open timed out; continuing without waiting.")
        log_notice("Auto-open browser timed out; continuing without waiting.")
        return

    error = result["error"]
    if error is not None:
        logger.debug(f"Failed to auto-open browser: {error}")
    opened = bool(result["opened"])

    if opened:
        log_notice(f"Browser opened: {url}")
        return

    log_notice("Could not auto-open a browser. Open the URL manually.")
    log_notice(f"Open: {url}")


def run_server(
    handler, host: str, port: int, *, auto_open_browser: bool = True
) -> None:
    server, bound_port, fallback_count = _bind_server_with_fallback(
        handler, host, port, max_tries=PORT_FALLBACK_TRIES
    )

    urls = []
    if host == "0.0.0.0":
        urls.append(f"http://127.0.0.1:{bound_port}")
        try:
            local_ip = socket.gethostbyname(socket.gethostname())
            if local_ip and not local_ip.startswith("127."):
                urls.append(f"http://{local_ip}:{bound_port}")
        except OSError:
            pass
    elif host == "::":
        urls.append(f"http://[::1]:{bound_port}")
    else:
        urls.append(_format_http_url(host, bound_port))

    if fallback_count > 0:
        log_notice(
            f"Port {port} is occupied, auto-switched to {bound_port} after {fallback_count} retry(s)."
        )
    log_ok("Server started.")
    for url in urls:
        log_notice(f"Open: {url}")
    if auto_open_browser and urls:
        _try_open_browser(urls[0], bound_port)
    logger.debug(f"Bound address: {host}:{bound_port}")
    log_notice("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print()
        log_notice("Server stopped.")
    finally:
        server.server_close()


def _is_port_in_use_error(exc: OSError) -> bool:
    errno_value = exc.errno
    winerror_value = getattr(exc, "winerror", None)
    if errno_value in PORT_IN_USE_ERRNOS or errno_value in PORT_IN_USE_WINERRORS:
        return True
    if winerror_value in PORT_IN_USE_WINERRORS:
        return True
    message = str(exc).lower()
    return any(marker in message for marker in PORT_IN_USE_MESSAGE_MARKERS)


class NotesForgeThreadingHTTPServer(ThreadingHTTPServer):
    # Keep bind strict so a second process cannot silently share the same port.
    allow_reuse_address = os.name != "nt"

    def server_bind(self) -> None:
        if os.name == "nt" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


class NotesForgeThreadingHTTPServerV6(NotesForgeThreadingHTTPServer):
    address_family = socket.AF_INET6


def _format_http_url(host: str, port: int) -> str:
    if ":" in host and not host.startswith("["):
        return f"http://[{host}]:{port}"
    return f"http://{host}:{port}"


def _select_server_class(host: str) -> type[ThreadingHTTPServer]:
    if ":" in host:
        return NotesForgeThreadingHTTPServerV6
    return NotesForgeThreadingHTTPServer


def _bind_server_with_fallback(
    handler,
    host: str,
    start_port: int,
    *,
    max_tries: int,
) -> tuple[ThreadingHTTPServer, int, int]:
    bound_port = start_port
    server_class = _select_server_class(host)
    fallback_count = 0
    last_err: OSError | None = None
    last_attempted_port = start_port

    for _ in range(max_tries):
        last_attempted_port = bound_port
        try:
            server = server_class((host, bound_port), handler)
            return server, bound_port, fallback_count
        except OSError as exc:
            last_err = exc
            if _is_port_in_use_error(exc) and bound_port < 65535:
                fallback_count += 1
                bound_port += 1
                continue
            raise

    if last_err is not None:
        raise OSError(
            f"Failed to bind server ports {start_port}-{last_attempted_port}: {last_err}"
        ) from last_err
    raise OSError(f"Failed to bind server ports {start_port}-{last_attempted_port}")


def serve_html_dir(
    html_dir: Path,
    host: str,
    port: int,
    *,
    auto_open_browser: bool = True,
    http_access_logger: logging.Logger | None = None,
) -> None:
    html_dir = html_dir.resolve()
    if not html_dir.is_dir():
        raise FileNotFoundError(f"HTML directory not found: {html_dir}")

    class StaticHandler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(html_dir), **kwargs)

        def log_message(self, format, *args):
            _emit_http_access_log(
                self,
                format,
                args,
                http_access_logger=http_access_logger,
            )

    handler = StaticHandler
    run_server(handler, host, port, auto_open_browser=auto_open_browser)


def serve_markdown_dir(
    md_dir: Path,
    host: str,
    port: int,
    include_formats: set[str] | None = None,
    ignored_dirs: list[str] | None = None,
    *,
    auto_open_browser: bool = True,
    http_access_logger: logging.Logger | None = None,
    hide_tree: bool = False,
    hide_toc: bool = False,
    enable_search: bool = False,
    enable_download: bool = False,
    footer_text: str = "",
) -> None:
    md_dir = md_dir.resolve()
    if not md_dir.is_dir():
        raise FileNotFoundError(f"Markdown directory not found: {md_dir}")

    include_formats = (
        set(SUPPORTED_CONTENT_FORMATS)
        if include_formats is None
        else set(include_formats)
    )
    handler = make_memory_handler(
        md_dir,
        include_formats,
        ignored_dirs=ignored_dirs,
        http_access_logger=http_access_logger,
        hide_tree=hide_tree,
        hide_toc=hide_toc,
        enable_search=enable_search,
        enable_download=enable_download,
        footer_text=footer_text,
    )
    run_server(handler, host, port, auto_open_browser=auto_open_browser)


def clean_output(output_dir: Path) -> None:
    output_dir = output_dir.resolve()
    if output_dir.exists():
        before = _count_files(output_dir)
        safe_rmtree(output_dir)
        if output_dir.exists():
            after = _count_files(output_dir)
            logger.warning("Cleanup partially completed (some files may be in use).")
            log_notice(f"Target directory : {output_dir}")
            log_notice(f"Removed files    : {max(before - after, 0)}")
            log_notice(f"Remaining files  : {after}")
        else:
            log_ok("Cleanup finished.")
            log_notice(f"Removed directory: {output_dir}")
            log_notice(f"Removed files    : {before}")
    else:
        log_notice(f"Nothing to clean: {output_dir}")


def args_parse() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build and serve a markdown-based static notes site.",
        epilog=r"""Examples:
  notes-forge --log-level ERROR build . -o public
  notes-forge build . -o public --log-level ERROR
  notes-forge build . -o public --include md,pdf,ipynb
  notes-forge --log-level DEBUG build . -o public
  notes-forge build . -o public
  notes-forge serve -p 8080 --include md,pdf,ipynb
  notes-forge serve --md-from . --http-log-file logs/http-access.log
  notes-forge serve --html-from public -p 8080
  notes-forge serve --md-from . -p 8080
  notes-forge clean -o public""",
        formatter_class=argparse.RawTextHelpFormatter,
    )
    parser.add_argument("-v", "--version", action="version", version=__version__)
    add_log_level_argument(parser)
    add_include_argument(parser)
    add_ignore_dir_argument(parser)
    add_ui_toggle_arguments(parser)
    add_search_argument(parser)
    add_download_argument(parser)
    add_footer_argument(parser)
    subparsers = parser.add_subparsers(dest="command", required=True)

    build_parser = subparsers.add_parser(
        "build",
        help="Generate a fully static site",
        description="Scan markdown folder and generate a self-contained static site.",
    )
    add_log_level_argument(build_parser, default=argparse.SUPPRESS)
    add_include_argument(build_parser, default=argparse.SUPPRESS)
    add_ignore_dir_argument(build_parser, default=argparse.SUPPRESS)
    add_ui_toggle_arguments(
        build_parser,
        hide_tree_default=argparse.SUPPRESS,
        hide_toc_default=argparse.SUPPRESS,
    )
    add_search_argument(build_parser, default=argparse.SUPPRESS)
    add_download_argument(build_parser, default=argparse.SUPPRESS)
    add_footer_argument(build_parser, default=argparse.SUPPRESS)
    build_parser.add_argument(
        "input_dir",
        nargs="?",
        default=".",
        help="Markdown root directory (default: current directory).",
    )
    build_parser.add_argument(
        "-o",
        "--output",
        default=DEFAULT_OUTPUT_DIR,
        help=f"Output directory (default: {DEFAULT_OUTPUT_DIR}).",
    )

    serve_parser = subparsers.add_parser(
        "serve",
        help="Serve html site or markdown source",
        description=(
            "Serve existing static html folder, or serve markdown source directly in memory.\n"
            "If neither --html-from nor --md-from is given, --md-from . is used."
        ),
        formatter_class=argparse.RawTextHelpFormatter,
    )
    add_log_level_argument(serve_parser, default=argparse.SUPPRESS)
    add_include_argument(serve_parser, default=argparse.SUPPRESS)
    add_ignore_dir_argument(serve_parser, default=argparse.SUPPRESS)
    add_ui_toggle_arguments(
        serve_parser,
        hide_tree_default=argparse.SUPPRESS,
        hide_toc_default=argparse.SUPPRESS,
    )
    add_search_argument(serve_parser, default=argparse.SUPPRESS)
    add_download_argument(serve_parser, default=argparse.SUPPRESS)
    add_footer_argument(serve_parser, default=argparse.SUPPRESS)
    serve_parser.add_argument(
        "--html-from",
        dest="html_from",
        help="Serve from existing static html directory (no build).",
    )
    serve_parser.add_argument(
        "--md-from",
        dest="md_from",
        help="Serve markdown source directory directly in memory (no output files).",
    )
    serve_parser.add_argument(
        "--host",
        default=DEFAULT_HOST,
        help=f"Host to bind (default: {DEFAULT_HOST}).",
    )
    serve_parser.add_argument(
        "-p",
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help=f"Port number (default: {DEFAULT_PORT}).",
    )
    serve_parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Do not auto-open a browser after server starts.",
    )
    serve_parser.add_argument(
        "--http-log-file",
        type=str,
        default=None,
        help="Write HTTP access logs to this file (instead of stderr).",
    )

    clean_parser = subparsers.add_parser(
        "clean",
        help="Remove generated output folder",
        description="Remove generated static output directory.",
    )
    add_log_level_argument(clean_parser, default=argparse.SUPPRESS)
    clean_parser.add_argument(
        "-o",
        "--output",
        default=DEFAULT_OUTPUT_DIR,
        help=f"Output directory to remove (default: {DEFAULT_OUTPUT_DIR}).",
    )

    return parser.parse_args()


def main() -> None:
    try:
        args = args_parse()

        configure_logging(args.log_level)

        if args.command == "build":
            if args.enable_search and args.hide_tree:
                raise SystemExit("--enable-search cannot be used with --hide-tree.")
            try:
                include_formats = normalize_include_formats(args.include)
            except ValueError as exc:
                raise SystemExit(str(exc)) from exc
            input_dir = Path(args.input_dir).resolve()
            output_dir = Path(args.output).resolve()
            log_notice("Starting static site build.")
            log_notice(f"Input directory  : {input_dir}")
            log_notice(f"Output directory : {output_dir}")
            log_notice(f"Include formats  : {', '.join(sorted(include_formats))}")
            if args.ignore_dir:
                log_notice(f"Ignore dirs      : {', '.join(args.ignore_dir)}")
            if args.hide_tree:
                log_notice("UI option        : hide file tree")
            if args.hide_toc:
                log_notice("UI option        : hide TOC")
            if args.enable_search:
                log_notice("UI option        : enable search")
            if args.enable_download:
                log_notice("UI option        : enable download button")
            if args.footer:
                log_notice(f"UI footer        : {args.footer}")
            logger.debug(
                f"Root excludes    : {', '.join(sorted(ROOT_EXCLUDED_BUILD_DIRS))}"
            )
            build_site(
                input_dir,
                output_dir,
                include_formats=include_formats,
                ignored_dirs=args.ignore_dir,
                hide_tree=args.hide_tree,
                hide_toc=args.hide_toc,
                enable_search=args.enable_search,
                enable_download=args.enable_download,
                footer_text=args.footer,
            )
            return

        if args.command == "serve":
            if args.enable_search and args.hide_tree:
                raise SystemExit("--enable-search cannot be used with --hide-tree.")
            try:
                include_formats = normalize_include_formats(args.include)
            except ValueError as exc:
                raise SystemExit(str(exc)) from exc
            if args.html_from and args.md_from:
                raise SystemExit("Use either --html-from or --md-from, not both.")
            http_access_logger = create_http_access_logger(
                Path(args.http_log_file) if args.http_log_file else None
            )
            if args.http_log_file:
                log_notice(
                    f"HTTP access log : {Path(args.http_log_file).expanduser().resolve()}"
                )

            if args.html_from:
                html_dir = Path(args.html_from).resolve()
                log_notice("Serve mode       : static html")
                log_notice(f"Source directory : {html_dir}")
                if args.hide_tree or args.hide_toc:
                    logger.warning(
                        "--hide-tree/--hide-toc are ignored in --html-from mode (UI is prebuilt)."
                    )
                if args.enable_search:
                    logger.warning(
                        "--enable-search is ignored in --html-from mode (UI is prebuilt)."
                    )
                if args.enable_download:
                    logger.warning(
                        "--enable-download is ignored in --html-from mode (UI is prebuilt)."
                    )
                if args.footer:
                    logger.warning(
                        "--footer is ignored in --html-from mode (UI is prebuilt)."
                    )
                serve_html_dir(
                    html_dir,
                    args.host,
                    args.port,
                    auto_open_browser=not args.no_browser,
                    http_access_logger=http_access_logger,
                )
                return

            md_from = (
                Path(args.md_from).resolve() if args.md_from else Path(".").resolve()
            )
            log_notice("Serve mode       : in-memory content")
            log_notice(f"Source directory : {md_from}")
            log_notice(f"Include formats  : {', '.join(sorted(include_formats))}")
            if args.ignore_dir:
                log_notice(f"Ignore dirs      : {', '.join(args.ignore_dir)}")
            if args.hide_tree:
                log_notice("UI option        : hide file tree")
            if args.hide_toc:
                log_notice("UI option        : hide TOC")
            if args.enable_search:
                log_notice("UI option        : enable search")
            if args.enable_download:
                log_notice("UI option        : enable download button")
            if args.footer:
                log_notice(f"UI footer        : {args.footer}")
            logger.debug(
                "tree.json        : generated on-the-fly (not written to disk)"
            )
            serve_markdown_dir(
                md_from,
                args.host,
                args.port,
                include_formats=include_formats,
                ignored_dirs=args.ignore_dir,
                auto_open_browser=not args.no_browser,
                http_access_logger=http_access_logger,
                hide_tree=args.hide_tree,
                hide_toc=args.hide_toc,
                enable_search=args.enable_search,
                enable_download=args.enable_download,
                footer_text=args.footer,
            )
            return

        if args.command == "clean":
            output_dir = Path(args.output).resolve()
            log_notice(f"Cleaning directory: {output_dir}")
            clean_output(output_dir)
            return

        raise SystemExit(f"Unknown command: {args.command}")
    except FileNotFoundError as exc:
        logger.error(str(exc))
        raise SystemExit(1)
    except OSError as exc:
        logger.error(f"{exc.__class__.__name__}: {exc}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
