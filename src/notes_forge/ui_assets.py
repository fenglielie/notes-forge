"""Frontend asset loading and index rendering."""

import importlib.resources as importlib_resources
import json
from pathlib import Path


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


def read_asset_bytes(filename: str) -> bytes:
    try:
        return (
            importlib_resources.files("notes_forge")
            .joinpath("notes_forge_assets", filename)
            .read_bytes()
        )
    except (FileNotFoundError, ModuleNotFoundError):
        pass

    asset_path = Path(__file__).resolve().with_name("notes_forge_assets") / filename
    if asset_path.is_file():
        return asset_path.read_bytes()

    raise FileNotFoundError(
        f"Missing asset file: {filename}; "
        f"searched package data notes_forge/notes_forge_assets and fallback path {asset_path}"
    )


HEAD_SNIPPET = read_asset_text("head.html")
BODY_HTML = read_asset_text("body.html")
FRONTEND_ASSET_DIR = "assets/notes-forge"
FRONTEND_CSS_FILES = ["style-base.css", "style-dark.css"]
FRONTEND_JS_FILES = ["app-part1.js", "app-part2.js", "app-part3.js"]
FRONTEND_ASSET_FILES = [*FRONTEND_CSS_FILES, *FRONTEND_JS_FILES]


def render_index_html(
    *,
    hide_tree: bool = False,
    hide_toc: bool = False,
    enable_search: bool = False,
    enable_download: bool = False,
    enable_theme: bool = False,
    footer_text: str = "",
    serve_mode: bool = False,
) -> str:
    ui_config = {
        "hideTree": hide_tree,
        "hideToc": hide_toc,
        "enableSearch": enable_search,
        "enableDownload": enable_download,
        "enableTheme": enable_theme,
        "footerText": footer_text,
        "serveMode": serve_mode,
    }
    css_links = "\n".join(
        f'    <link rel="stylesheet" href="{FRONTEND_ASSET_DIR}/{filename}">'
        for filename in FRONTEND_CSS_FILES
    )
    js_scripts = "\n".join(
        f'    <script src="{FRONTEND_ASSET_DIR}/{filename}" defer></script>'
        for filename in FRONTEND_JS_FILES
    )
    return f"""<!DOCTYPE html>
<html lang="en">

<head>
{HEAD_SNIPPET}
{css_links}
</head>

<body>
{BODY_HTML}
    <script>
window.NOTES_FORGE_CONFIG = {json.dumps(ui_config, ensure_ascii=False)};
    </script>
{js_scripts}
</body>

</html>
"""
