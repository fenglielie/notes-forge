#!/usr/bin/env python3
"""Public compatibility facade and CLI entrypoint."""

from notes_forge.build_ops import (
    _count_files,
    _on_rm_error,
    build_site,
    clean_output,
    copy_site_sources,
    safe_rmtree,
)
from notes_forge.cli_app import args_parse, main
from notes_forge.cli_options import (
    add_download_argument,
    add_footer_argument,
    add_ignore_dir_argument,
    add_include_argument,
    add_log_level_argument,
    add_search_argument,
    add_ui_toggle_arguments,
    normalize_include_formats,
    resolve_allowed_copy_suffixes,
)
from notes_forge.constants import (
    DEFAULT_ENABLE_DOWNLOAD,
    DEFAULT_ENABLE_SEARCH,
    DEFAULT_FOOTER_TEXT,
    DEFAULT_HIDE_TOC,
    DEFAULT_HIDE_TREE,
    DEFAULT_HOST,
    DEFAULT_OUTPUT_DIR,
    DEFAULT_PORT,
    MARKDOWN_ASSET_SUFFIXES,
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
    _iter_visible_children,
    _should_skip_dir,
    _tree_stats,
    build_tree,
    resolve_ignored_dirs,
)
from notes_forge.runtime_logging import (
    _emit_http_access_log,
    configure_logging,
    create_http_access_logger,
    log_notice,
    log_ok,
)
from notes_forge.server_ops import (
    NotesForgeThreadingHTTPServer,
    NotesForgeThreadingHTTPServerV6,
    _bind_server_with_fallback,
    _format_http_url,
    _is_port_in_use_error,
    _select_server_class,
    _send_bytes,
    _send_headers_only,
    _try_open_browser,
    make_memory_handler,
    run_server,
    serve_html_dir,
    serve_markdown_dir,
)
from notes_forge.ui_assets import (
    APP_JS,
    BODY_HTML,
    HEAD_SNIPPET,
    STYLE_CSS,
    read_asset_text,
    render_index_html,
)


if __name__ == "__main__":
    main()
