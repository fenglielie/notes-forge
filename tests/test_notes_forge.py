import unittest
from contextlib import contextmanager
from pathlib import Path
import shutil
import sys
from unittest.mock import MagicMock, patch
from uuid import uuid4

from notes_forge import (
    build_ops,
    cli_app,
    cli_options,
    constants,
    fs_tree,
    runtime_logging,
    server_ops,
    ui_assets,
)


TEST_TMP_ROOT = Path(__file__).resolve().parent / ".tmp"
TEST_TMP_ROOT.mkdir(exist_ok=True)


@contextmanager
def workspace_tempdir():
    tmp = TEST_TMP_ROOT / f"tmp-{uuid4().hex}"
    tmp.mkdir(parents=True, exist_ok=False)
    try:
        yield str(tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


class TestNotesForgePortFallback(unittest.TestCase):
    @patch.object(
        sys,
        "argv",
        [
            "notes-forge",
            "serve",
            "--hide-tree",
            "--hide-toc",
            "--enable-search",
            "--enable-download",
            "--footer",
            "hello",
        ],
    )
    def test_parse_args_ui_toggles(self):
        args = cli_app.args_parse()
        self.assertTrue(args.hide_tree)
        self.assertTrue(args.hide_toc)
        self.assertTrue(args.enable_search)
        self.assertTrue(args.enable_download)
        self.assertEqual(args.footer, "hello")

    @patch.object(
        sys,
        "argv",
        [
            "notes-forge",
            "serve",
            "--source-from",
            ".",
            "--http-log-file",
            "logs/http-access.log",
        ],
    )
    def test_parse_args_http_log_file(self):
        args = cli_app.args_parse()
        self.assertEqual(args.http_log_file, "logs/http-access.log")

    @patch.object(sys, "argv", ["notes-forge", "serve", "--http-log"])
    def test_parse_args_http_log(self):
        args = cli_app.args_parse()
        self.assertTrue(args.http_log)

    def test_create_http_access_logger_disabled_by_default(self):
        logger = runtime_logging.create_http_access_logger(
            log_to_stderr=False,
            log_file=None,
        )
        self.assertIsNone(logger)

    def test_render_index_html_injects_ui_config(self):
        html = ui_assets.render_index_html(
            hide_tree=True,
            hide_toc=True,
            enable_search=True,
            enable_download=True,
            footer_text="footer line",
        )
        self.assertIn('"hideTree": true', html)
        self.assertIn('"hideToc": true', html)
        self.assertIn('"enableSearch": true', html)
        self.assertIn('"enableDownload": true', html)
        self.assertIn('"footerText": "footer line"', html)

    def test_render_index_html_uses_default_footer_text(self):
        html = ui_assets.render_index_html(
            footer_text=constants.DEFAULT_FOOTER_TEXT,
        )
        self.assertIn(f'"footerText": "{constants.DEFAULT_FOOTER_TEXT}"', html)

    def test_is_port_in_use_error_by_errno(self):
        exc = OSError(98, "Address already in use")
        self.assertTrue(server_ops._is_port_in_use_error(exc))

    def test_bind_server_with_fallback_port_occupied_then_success(self):
        busy = OSError(98, "Address already in use")
        fake_server = MagicMock()

        with patch(
            "notes_forge.server_ops.NotesForgeThreadingHTTPServer",
            side_effect=[busy, fake_server],
        ) as mocked:
            server, port, fallback_count = server_ops._bind_server_with_fallback(
                handler=object(),
                host="127.0.0.1",
                start_port=8080,
                max_tries=5,
            )

        self.assertIs(server, fake_server)
        self.assertEqual(port, 8081)
        self.assertEqual(fallback_count, 1)
        self.assertEqual(mocked.call_count, 2)

    def test_bind_server_with_fallback_non_port_error_passthrough(self):
        denied = OSError(13, "Permission denied")
        with patch(
            "notes_forge.server_ops.NotesForgeThreadingHTTPServer", side_effect=denied
        ):
            with self.assertRaises(OSError) as ctx:
                server_ops._bind_server_with_fallback(
                    handler=object(),
                    host="127.0.0.1",
                    start_port=8080,
                    max_tries=3,
                )
        self.assertEqual(ctx.exception.errno, 13)

    def test_bind_server_with_fallback_retries_exhausted(self):
        busy = OSError(98, "Address already in use")
        with patch(
            "notes_forge.server_ops.NotesForgeThreadingHTTPServer",
            side_effect=[busy, busy, busy],
        ):
            with self.assertRaises(OSError) as ctx:
                server_ops._bind_server_with_fallback(
                    handler=object(),
                    host="127.0.0.1",
                    start_port=8080,
                    max_tries=3,
                )

        self.assertIn("Failed to bind server ports 8080-8082", str(ctx.exception))

    def test_run_server_logs_auto_switch_and_closes_server(self):
        fake_server = MagicMock()
        fake_server.serve_forever.side_effect = KeyboardInterrupt

        with (
            patch(
                "notes_forge.server_ops._bind_server_with_fallback",
                return_value=(fake_server, 8081, 1),
            ),
            patch("notes_forge.server_ops.log_notice") as mock_notice,
            patch("notes_forge.server_ops.log_ok"),
            patch(
                "notes_forge.server_ops.socket.gethostbyname", return_value="127.0.0.1"
            ),
            patch("notes_forge.server_ops.webbrowser.open", return_value=False),
        ):
            server_ops.run_server(handler=object(), host="0.0.0.0", port=8080)

        self.assertTrue(
            any(
                "auto-switched to 8081" in str(call.args[0])
                for call in mock_notice.call_args_list
                if call.args
            )
        )
        fake_server.server_close.assert_called_once()

    def test_run_server_formats_ipv6_loopback_url(self):
        fake_server = MagicMock()
        fake_server.serve_forever.side_effect = KeyboardInterrupt

        with (
            patch(
                "notes_forge.server_ops._bind_server_with_fallback",
                return_value=(fake_server, 9090, 0),
            ),
            patch("notes_forge.server_ops.log_notice") as mock_notice,
            patch("notes_forge.server_ops.log_ok"),
            patch("notes_forge.server_ops.webbrowser.open", return_value=False),
        ):
            server_ops.run_server(handler=object(), host="::", port=9090)

        self.assertTrue(
            any(
                "http://[::1]:9090" in str(call.args[0])
                for call in mock_notice.call_args_list
                if call.args
            )
        )
        fake_server.server_close.assert_called_once()

    def test_select_server_class_for_ipv6(self):
        self.assertIs(
            server_ops._select_server_class("::"),
            server_ops.NotesForgeThreadingHTTPServerV6,
        )
        self.assertIs(
            server_ops._select_server_class("127.0.0.1"),
            server_ops.NotesForgeThreadingHTTPServer,
        )

    def test_safe_rmtree_fallbacks_to_onerror_for_py311(self):
        test_path = Path(".")

        def fake_rmtree(path, **kwargs):
            if "onexc" in kwargs:
                raise TypeError("unexpected keyword argument 'onexc'")
            return None

        with patch(
            "notes_forge.build_ops.shutil.rmtree", side_effect=fake_rmtree
        ) as mock_rm:
            build_ops.safe_rmtree(test_path)

        self.assertEqual(mock_rm.call_count, 2)

    def test_run_server_tries_to_open_browser_by_default(self):
        fake_server = MagicMock()
        fake_server.serve_forever.side_effect = KeyboardInterrupt

        with (
            patch(
                "notes_forge.server_ops._bind_server_with_fallback",
                return_value=(fake_server, 8080, 0),
            ),
            patch("notes_forge.server_ops.log_notice"),
            patch("notes_forge.server_ops.log_ok"),
            patch(
                "notes_forge.server_ops.socket.gethostbyname", return_value="127.0.0.1"
            ),
            patch(
                "notes_forge.server_ops.webbrowser.open", return_value=True
            ) as mock_open,
        ):
            server_ops.run_server(handler=object(), host="0.0.0.0", port=8080)

        mock_open.assert_called_once()

    def test_run_server_no_browser_option_skips_open(self):
        fake_server = MagicMock()
        fake_server.serve_forever.side_effect = KeyboardInterrupt

        with (
            patch(
                "notes_forge.server_ops._bind_server_with_fallback",
                return_value=(fake_server, 8080, 0),
            ),
            patch("notes_forge.server_ops.log_notice"),
            patch("notes_forge.server_ops.log_ok"),
            patch(
                "notes_forge.server_ops.webbrowser.open", return_value=True
            ) as mock_open,
        ):
            server_ops.run_server(
                handler=object(),
                host="127.0.0.1",
                port=8080,
                auto_open_browser=False,
            )

        mock_open.assert_not_called()

    def test_try_open_browser_linux_no_gui_shows_ssh_hint(self):
        with (
            patch(
                "notes_forge.server_ops.webbrowser.open", return_value=False
            ) as mock_open,
            patch("notes_forge.server_ops.log_notice") as mock_notice,
            patch("notes_forge.server_ops.sys.platform", "linux"),
            patch.dict("notes_forge.server_ops.os.environ", {}, clear=True),
        ):
            server_ops._try_open_browser("http://127.0.0.1:8080", 8080)

        messages = [
            str(call.args[0]) for call in mock_notice.call_args_list if call.args
        ]
        self.assertTrue(any("SSH port forwarding" in msg for msg in messages))
        self.assertTrue(any("8080:127.0.0.1:8080" in msg for msg in messages))
        mock_open.assert_not_called()

    def test_normalize_include_formats_default_all(self):
        formats = cli_options.normalize_include_formats([])
        self.assertIn("md", formats)
        self.assertIn("pdf", formats)
        self.assertIn("ipynb", formats)

    def test_build_tree_includes_ipynb(self):
        with workspace_tempdir() as tmp:
            root = Path(tmp)
            (root / "a.md").write_text("# A", encoding="utf-8")
            (root / "b.pdf").write_bytes(b"%PDF-1.4")
            (root / "n.ipynb").write_text("{}", encoding="utf-8")
            tree = fs_tree.build_tree(root, include_formats={"ipynb"})
            names = [n["name"] for n in tree if n.get("type") == "file"]
            self.assertEqual(names, ["n.ipynb"])

    @patch.object(sys, "argv", ["notes-forge", "serve"])
    def test_serve_default_host_is_loopback(self):
        args = cli_app.args_parse()
        self.assertEqual(args.host, "127.0.0.1")

    def test_memory_handler_rejects_non_content_file(self):
        with workspace_tempdir() as tmp:
            root = Path(tmp)
            (root / "note.md").write_text("# note", encoding="utf-8")
            (root / "secret.txt").write_text("secret", encoding="utf-8")
            handler_cls = server_ops.make_memory_handler(root, {"md"})
            handler = handler_cls.__new__(handler_cls)
            handler.path = "/secret.txt"
            handler.send_error = MagicMock()

            with patch("http.server.SimpleHTTPRequestHandler.do_GET") as mock_super_get:
                handler.do_GET()

            handler.send_error.assert_called_once()
            mock_super_get.assert_not_called()

    def test_build_site_copies_only_selected_include_formats_by_default(self):
        with workspace_tempdir() as src_tmp, workspace_tempdir() as out_tmp:
            src = Path(src_tmp)
            out = Path(out_tmp) / "public"
            (src / "a.md").write_text("# A", encoding="utf-8")
            (src / "img.png").write_bytes(b"\x89PNG\r\n\x1a\n")
            (src / "b.pdf").write_bytes(b"%PDF-1.4")
            (src / "n.ipynb").write_text("{}", encoding="utf-8")
            (src / "secret.py").write_text("print('x')", encoding="utf-8")

            build_ops.build_site(
                src,
                out,
                include_formats={"md"},
            )

            self.assertTrue((out / "a.md").exists())
            self.assertTrue((out / "img.png").exists())
            self.assertFalse((out / "b.pdf").exists())
            self.assertFalse((out / "n.ipynb").exists())
            self.assertFalse((out / "secret.py").exists())
            self.assertTrue((out / "index.html").exists())
            self.assertTrue((out / "tree.json").exists())

    def test_build_site_copy_all_files_option_keeps_non_hidden_files(self):
        with workspace_tempdir() as src_tmp, workspace_tempdir() as out_tmp:
            src = Path(src_tmp)
            out = Path(out_tmp) / "public"
            (src / "a.md").write_text("# A", encoding="utf-8")
            (src / "secret.py").write_text("print('x')", encoding="utf-8")

            build_ops.build_site(
                src,
                out,
                include_formats={"md"},
                copy_all_files=True,
            )

            self.assertTrue((out / "a.md").exists())
            self.assertTrue((out / "secret.py").exists())

    def test_copy_site_sources_skips_symlink_target_outside_root(self):
        with (
            workspace_tempdir() as src_tmp,
            workspace_tempdir() as out_tmp,
            workspace_tempdir() as ext_tmp,
        ):
            src = Path(src_tmp)
            out = Path(out_tmp)
            outside = Path(ext_tmp) / "outside.md"
            outside.write_text("# outside", encoding="utf-8")

            link = src / "outside-link.md"
            try:
                link.symlink_to(outside)
            except (OSError, NotImplementedError):
                self.skipTest("Symlink creation is not available in this environment.")

            copied = build_ops.copy_site_sources(
                src,
                out,
                out / "public",
                include_formats={"md"},
                copy_all_files=False,
            )

            self.assertEqual(copied, 0)
            self.assertFalse((out / "outside-link.md").exists())

    def test_memory_handler_allows_markdown_local_image_assets(self):
        with workspace_tempdir() as tmp:
            root = Path(tmp)
            (root / "note.md").write_text("# note", encoding="utf-8")
            (root / "img.png").write_bytes(b"\x89PNG\r\n\x1a\n")
            handler_cls = server_ops.make_memory_handler(root, {"md"})
            handler = handler_cls.__new__(handler_cls)
            handler.path = "/img.png"
            handler.send_error = MagicMock()

            with patch("http.server.SimpleHTTPRequestHandler.do_GET") as mock_super_get:
                handler.do_GET()

            handler.send_error.assert_not_called()
            mock_super_get.assert_called_once()


if __name__ == "__main__":
    unittest.main()
