import pytest

from attachment_scanner import MalwareDetectedError, scan_file


class _Connection:
    def __init__(self, response: bytes):
        self.response = response
        self.sent = bytearray()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def settimeout(self, _timeout):
        pass

    def sendall(self, data):
        self.sent.extend(data)

    def recv(self, _size):
        response, self.response = self.response, b""
        return response


def test_clamav_clean_stream(monkeypatch, tmp_path):
    connection = _Connection(b"stream: OK\0")
    monkeypatch.setattr("attachment_scanner.socket.create_connection", lambda *_args, **_kwargs: connection)
    path = tmp_path / "safe.txt"
    path.write_bytes(b"safe")
    scan_file(path, "clamav", 3310, 1)
    assert connection.sent.startswith(b"zINSTREAM\0")


def test_clamav_rejects_detected_stream(monkeypatch, tmp_path):
    connection = _Connection(b"stream: Eicar-Test-Signature FOUND\0")
    monkeypatch.setattr("attachment_scanner.socket.create_connection", lambda *_args, **_kwargs: connection)
    path = tmp_path / "unsafe.txt"
    path.write_bytes(b"unsafe")
    with pytest.raises(MalwareDetectedError):
        scan_file(path, "clamav", 3310, 1)
