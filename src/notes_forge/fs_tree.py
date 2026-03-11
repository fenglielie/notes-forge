"""Directory scanning and filtering helpers."""

from pathlib import Path
from typing import Iterable

from notes_forge.constants import ROOT_EXCLUDED_BUILD_DIRS, SUPPORTED_CONTENT_FORMATS


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


__all__ = [
    "ROOT_EXCLUDED_BUILD_DIRS",
    "_is_excluded_by_name_or_path",
    "_is_hidden_path",
    "_is_within",
    "_iter_visible_children",
    "_should_skip_dir",
    "_tree_stats",
    "build_tree",
    "resolve_ignored_dirs",
]
