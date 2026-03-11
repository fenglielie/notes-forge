"""Build and cleanup operations."""

import logging
import os
import shutil
import stat
import json
from pathlib import Path

from notes_forge.cli_options import resolve_allowed_copy_suffixes
from notes_forge.constants import ROOT_EXCLUDED_BUILD_DIRS, SUPPORTED_CONTENT_FORMATS
from notes_forge.fs_tree import (
    _is_within,
    _should_skip_dir,
    _tree_stats,
    build_tree,
    resolve_ignored_dirs,
)
from notes_forge.runtime_logging import log_notice, log_ok
from notes_forge.ui_assets import read_asset_bytes, render_index_html

logger = logging.getLogger(__name__)


def _count_files(path: Path) -> int:
    if not path.exists():
        return 0
    return sum(1 for p in path.rglob("*") if p.is_file())


def copy_site_sources(
    src_root: Path,
    dst_root: Path,
    output_dir: Path,
    include_formats: set[str] | None = None,
    copy_all_files: bool = False,
    ignored_dirs: list[str] | None = None,
) -> int:
    src_root = src_root.resolve()
    dst_root = dst_root.resolve()
    output_dir = output_dir.resolve()
    ignored_paths, ignored_names = resolve_ignored_dirs(src_root, ignored_dirs)
    excluded_dirs = {output_dir, *ignored_paths}
    include_formats = (
        set(SUPPORTED_CONTENT_FORMATS)
        if include_formats is None
        else set(include_formats)
    )
    allowed_suffixes = resolve_allowed_copy_suffixes(include_formats)
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
            if not copy_all_files and src_file.suffix.lower() not in allowed_suffixes:
                continue

            resolved_src = src_file.resolve()
            if not _is_within(resolved_src, src_root):
                logger.warning(
                    f"Skipped file outside source root via symlink: {src_file}"
                )
                continue

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
    copy_all_files: bool = False,
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
        input_dir,
        output_dir,
        output_dir,
        include_formats=include_formats,
        copy_all_files=copy_all_files,
        ignored_dirs=ignored_dirs,
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
    (output_dir / "favicon.ico").write_bytes(read_asset_bytes("favicon.ico"))

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
