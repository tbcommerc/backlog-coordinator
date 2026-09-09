"""ClamAV INSTREAM client used before an uploaded file becomes visible."""
from __future__ import annotations

import socket
import struct
from pathlib import Path


class MalwareDetectedError(ValueError):
    pass


def scan_file(path: str | Path, host: str, port: int, timeout: float) -> None:
    if not host:
        return
    with socket.create_connection((host, port), timeout=timeout) as connection:
        connection.settimeout(timeout)
        connection.sendall(b"zINSTREAM\0")
        with open(path, "rb") as source:
            while chunk := source.read(1024 * 1024):
                connection.sendall(struct.pack("!I", len(chunk)))
                connection.sendall(chunk)
        connection.sendall(struct.pack("!I", 0))
        response = bytearray()
        while not response.endswith(b"\0") and len(response) < 4096:
            part = connection.recv(4096)
            if not part:
                break
            response.extend(part)
    result = bytes(response).rstrip(b"\0").decode("utf-8", errors="replace")
    if result.endswith(" FOUND"):
        raise MalwareDetectedError(result)
    if not result.endswith(" OK"):
        raise OSError(f"ClamAV scan failed: {result or 'empty response'}")
