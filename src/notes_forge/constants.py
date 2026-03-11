"""Shared constants for notes_forge."""

import errno as errno_codes

DEFAULT_OUTPUT_DIR = "public"
DEFAULT_PORT = 8080
DEFAULT_HOST = "127.0.0.1"
SUPPORTED_CONTENT_FORMATS = ("md", "pdf", "ipynb")
MARKDOWN_ASSET_SUFFIXES = (
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".svg",
    ".webp",
    ".bmp",
    ".ico",
    ".avif",
    ".tif",
    ".tiff",
)
DEFAULT_HIDE_TREE = False
DEFAULT_HIDE_TOC = False
DEFAULT_ENABLE_SEARCH = False
DEFAULT_ENABLE_DOWNLOAD = False
DEFAULT_FOOTER_TEXT = "Notes Forge"
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
