"""Runtime logging helpers."""

import logging
from http.server import SimpleHTTPRequestHandler
from pathlib import Path


def log_notice(message: str) -> None:
    print(f"[INFO] {message}")


def log_ok(message: str) -> None:
    print(f"[OK] {message}")


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
