"""CLI entrypoint and command orchestration."""

import argparse
import logging
from pathlib import Path

from notes_forge import __version__
from notes_forge.build_ops import build_site, clean_output
from notes_forge.cli_options import (
    add_download_argument,
    add_footer_argument,
    add_ignore_dir_argument,
    add_include_argument,
    add_log_level_argument,
    add_search_argument,
    add_theme_argument,
    add_ui_toggle_arguments,
    normalize_include_formats,
)
from notes_forge.constants import (
    DEFAULT_FOOTER_TEXT,
    DEFAULT_HOST,
    DEFAULT_OUTPUT_DIR,
    DEFAULT_PORT,
    ROOT_EXCLUDED_BUILD_DIRS,
)
from notes_forge.runtime_logging import (
    configure_logging,
    create_http_access_logger,
    log_notice,
)
from notes_forge.server_ops import serve_html_dir, serve_markdown_dir

logger = logging.getLogger(__name__)


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
  notes-forge serve --source-from . --http-log
  notes-forge serve --source-from . --http-log-file logs/http-access.log
  notes-forge serve --html-from public -p 8080
  notes-forge serve --source-from . -p 8080
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
    add_theme_argument(parser)
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
    add_theme_argument(build_parser, default=argparse.SUPPRESS)
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
    build_parser.add_argument(
        "--copy-all-files",
        action="store_true",
        help=(
            "Copy all non-hidden files into output directory. "
            "By default, build only copies files selected by --include."
        ),
    )

    serve_parser = subparsers.add_parser(
        "serve",
        help="Serve html site or source content",
        description=(
            "Serve existing static html folder, or serve source content directly in memory.\n"
            "If neither --html-from nor --source-from is given, --source-from . is used."
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
    add_theme_argument(serve_parser, default=argparse.SUPPRESS)
    add_footer_argument(serve_parser, default=argparse.SUPPRESS)
    serve_parser.add_argument(
        "--html-from",
        dest="html_from",
        help="Serve from existing static html directory (no build).",
    )
    serve_parser.add_argument(
        "--source-from",
        dest="source_from",
        help="Serve source directory directly in memory (no output files).",
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
        "--http-log",
        action="store_true",
        help="Print HTTP access logs to stderr.",
    )
    serve_parser.add_argument(
        "--http-log-file",
        type=str,
        default=None,
        help="Write HTTP access logs to this file.",
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
            if args.copy_all_files:
                log_notice("Copy mode        : copy all non-hidden files")
            else:
                log_notice("Copy mode        : copy files selected by --include only")
            if args.hide_tree:
                log_notice("UI option        : hide file tree")
            if args.hide_toc:
                log_notice("UI option        : hide TOC")
            if args.enable_search:
                log_notice("UI option        : enable search")
            if args.enable_download:
                log_notice("UI option        : enable download button")
            if args.enable_theme:
                log_notice("UI option        : enable theme button")
            if args.footer != DEFAULT_FOOTER_TEXT:
                log_notice(f"UI footer        : {args.footer}")
            logger.debug(
                f"Root excludes    : {', '.join(sorted(ROOT_EXCLUDED_BUILD_DIRS))}"
            )
            build_site(
                input_dir,
                output_dir,
                include_formats=include_formats,
                ignored_dirs=args.ignore_dir,
                copy_all_files=args.copy_all_files,
                hide_tree=args.hide_tree,
                hide_toc=args.hide_toc,
                enable_search=args.enable_search,
                enable_download=args.enable_download,
                enable_theme=args.enable_theme,
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
            if args.html_from and args.source_from:
                raise SystemExit("Use either --html-from or --source-from, not both.")
            http_log_file = Path(args.http_log_file) if args.http_log_file else None
            http_access_logger = create_http_access_logger(
                log_to_stderr=args.http_log,
                log_file=http_log_file,
            )
            if args.http_log:
                log_notice("HTTP access log : stderr")
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
                if args.enable_theme:
                    logger.warning(
                        "--enable-theme is ignored in --html-from mode (UI is prebuilt)."
                    )
                if args.footer != DEFAULT_FOOTER_TEXT:
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

            source_from = (
                Path(args.source_from).resolve()
                if args.source_from
                else Path(".").resolve()
            )
            log_notice("Serve mode       : in-memory content")
            log_notice(f"Source directory : {source_from}")
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
            if args.enable_theme:
                log_notice("UI option        : enable theme button")
            if args.footer != DEFAULT_FOOTER_TEXT:
                log_notice(f"UI footer        : {args.footer}")
            logger.debug(
                "tree.json        : generated on-the-fly (not written to disk)"
            )
            serve_markdown_dir(
                source_from,
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
                enable_theme=args.enable_theme,
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
