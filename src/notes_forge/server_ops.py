"""HTTP serving operations."""

import json
import logging
import os
import socket
import sys
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

from notes_forge.cli_options import resolve_allowed_copy_suffixes
from notes_forge.constants import (
    PORT_FALLBACK_TRIES,
    PORT_IN_USE_ERRNOS,
    PORT_IN_USE_MESSAGE_MARKERS,
    PORT_IN_USE_WINERRORS,
    ROOT_EXCLUDED_BUILD_DIRS,
    SUPPORTED_CONTENT_FORMATS,
)
from notes_forge.fs_tree import (
    _is_excluded_by_name_or_path,
    _is_hidden_path,
    _is_within,
    build_tree,
    resolve_ignored_dirs,
)
from notes_forge.runtime_logging import _emit_http_access_log, log_notice, log_ok
from notes_forge.ui_assets import FRONTEND_ASSET_DIR, read_asset_bytes, render_index_html

logger = logging.getLogger(__name__)


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


def _frontend_asset_response(req_path: str) -> tuple[bytes, str] | None:
    prefix = f"/{FRONTEND_ASSET_DIR}/"
    if not req_path.startswith(prefix):
        return None
    asset_name = req_path[len(prefix) :]
    if not asset_name or "/" in asset_name or "\\" in asset_name:
        return None
    try:
        data = read_asset_bytes(asset_name)
    except FileNotFoundError:
        return None
    suffix = Path(asset_name).suffix.lower()
    if suffix == ".css":
        content_type = "text/css; charset=utf-8"
    elif suffix == ".js":
        content_type = "application/javascript; charset=utf-8"
    else:
        content_type = "application/octet-stream"
    return data, content_type


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
    enable_theme: bool = False,
    footer_text: str = "",
):
    md_root = md_root.resolve()
    ignored_paths, ignored_names = resolve_ignored_dirs(md_root, ignored_dirs)
    ignored_paths = {p.resolve() for p in ignored_paths}

    allowed_suffixes = resolve_allowed_copy_suffixes(set(include_formats))

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
                    enable_theme=enable_theme,
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
            if req_path == "/favicon.ico":
                data = read_asset_bytes("favicon.ico")
                _send_bytes(self, data, "image/x-icon")
                return
            frontend_asset = _frontend_asset_response(req_path)
            if frontend_asset is not None:
                data, content_type = frontend_asset
                _send_bytes(self, data, content_type)
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
                        enable_theme=enable_theme,
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
            if req_path == "/favicon.ico":
                data_len = len(read_asset_bytes("favicon.ico"))
                _send_headers_only(self, data_len, "image/x-icon")
                return
            frontend_asset = _frontend_asset_response(req_path)
            if frontend_asset is not None:
                data, content_type = frontend_asset
                _send_headers_only(self, len(data), content_type)
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
    enable_theme: bool = False,
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
        enable_theme=enable_theme,
        footer_text=footer_text,
    )
    run_server(handler, host, port, auto_open_browser=auto_open_browser)
