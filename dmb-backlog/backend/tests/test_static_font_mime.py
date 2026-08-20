import mimetypes

import main  # noqa: F401 — регистрирует MIME-типы static assets


def test_local_font_mime_types_are_browser_compatible():
    assert mimetypes.guess_type("InterVariable.woff2")[0] == "font/woff2"
    assert mimetypes.guess_type("Unbounded-Variable.ttf")[0] == "font/ttf"
