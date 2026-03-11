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
