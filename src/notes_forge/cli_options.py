"""CLI option builders and input normalization."""

import argparse

from notes_forge.constants import (
    DEFAULT_ENABLE_DOWNLOAD,
    DEFAULT_ENABLE_SEARCH,
    DEFAULT_FOOTER_TEXT,
    DEFAULT_HIDE_TOC,
    DEFAULT_HIDE_TREE,
    MARKDOWN_ASSET_SUFFIXES,
    SUPPORTED_CONTENT_FORMATS,
)


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
        help="Fixed footer text shown at the bottom of the page. URLs are auto-linked.",
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


def resolve_allowed_copy_suffixes(include_formats: set[str]) -> set[str]:
    allowed_ext_map = {
        "md": ".md",
        "pdf": ".pdf",
        "ipynb": ".ipynb",
    }
    suffixes = {
        suffix for fmt, suffix in allowed_ext_map.items() if fmt in set(include_formats)
    }
    # Markdown commonly references local image assets via relative paths.
    if "md" in include_formats:
        suffixes.update(MARKDOWN_ASSET_SUFFIXES)
    return suffixes
