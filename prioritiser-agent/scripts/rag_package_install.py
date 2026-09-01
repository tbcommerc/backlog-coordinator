#!/usr/bin/env python3
"""Установка зашифрованного пакета знаний K3.

Пакет — age-зашифрованный tar, собранный в strategy-decomposer. Внутри: корпус
из девяти источников, предсобранный FAISS-индекс, метаданные и набор запросов
для проверки качества выдачи.

Схема повторяет `tools/rag_package.py` референса и её главное правило:
**расшифрованный корпус никогда не попадает в git.** В репозитории лежит только
шифротекст, публичный манифест и список получателей; распаковка происходит
локально в `data/knowledge/k3/`, который закрыт `.gitignore`.

    python3 scripts/rag_package_install.py install
    python3 scripts/rag_package_install.py status
    python3 scripts/rag_package_install.py remove

Расшифровать пакет может только владелец приватного ключа, соответствующего
одному из получателей в `recipients.txt`. По умолчанию берётся `~/.ssh/id_ed25519`.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path, PurePosixPath

REPO_ROOT = Path(__file__).resolve().parent.parent
PACKAGE_DIR = REPO_ROOT / "data" / "rag-package"
TARGET_DIR = REPO_ROOT / "data" / "knowledge" / "k3"
POINTER = TARGET_DIR / "current.json"

LFS_POINTER_PREFIX = b"version https://git-lfs.github.com/spec/v1"
DEFAULT_IDENTITY = Path.home() / ".ssh" / "id_ed25519"


class PackageError(RuntimeError):
    pass


def _emit(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest().upper()


def _safe_member_path(name: str) -> PurePosixPath:
    """Защита от path traversal при распаковке чужого архива."""
    candidate = PurePosixPath(name)
    if candidate.is_absolute() or any(part == ".." for part in candidate.parts):
        raise PackageError(f"небезопасный путь в архиве: {name!r}")
    return candidate


def _extract_safely(tar_path: Path, destination: Path) -> list[str]:
    extracted: list[str] = []
    with tarfile.open(tar_path, "r:*") as archive:
        for member in archive.getmembers():
            if member.issym() or member.islnk():
                raise PackageError(f"ссылки в пакете запрещены: {member.name}")
            if not (member.isfile() or member.isdir()):
                continue
            relative = _safe_member_path(member.name)
            target = destination / relative
            target.resolve().relative_to(destination.resolve())
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            source = archive.extractfile(member)
            if source is None:
                continue
            with target.open("wb") as handle:
                shutil.copyfileobj(source, handle)
            extracted.append(str(relative))
    return extracted


def _resolve_encrypted() -> Path:
    """Ищет шифротекст: сначала в репозитории, потом в клоне strategy-decomposer."""
    local = PACKAGE_DIR / "k3-rag-current.age"
    if local.exists() and local.stat().st_size > len(LFS_POINTER_PREFIX) + 64:
        return local

    sd_root = os.getenv("SD_REPO_ROOT", "").strip()
    if sd_root:
        candidate = Path(sd_root).expanduser() / "RAG" / "package" / "k3-rag-current.age"
        if candidate.exists():
            return candidate

    if local.exists():
        raise PackageError(
            f"{local} — указатель Git LFS, а не сам пакет. Выполните `git lfs pull` "
            "или задайте SD_REPO_ROOT на клон strategy-decomposer."
        )
    raise PackageError(
        f"шифротекст не найден: ни {local}, ни SD_REPO_ROOT/RAG/package/k3-rag-current.age"
    )


def _read_public_manifest() -> dict:
    path = PACKAGE_DIR / "manifest.public.json"
    if not path.exists():
        raise PackageError(f"нет публичного манифеста: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def install(args: argparse.Namespace) -> int:
    if shutil.which("age") is None:
        _emit({"ok": False, "error": "не найден исполняемый файл age (brew install age)"})
        return 3

    identity = Path(args.identity).expanduser() if args.identity else DEFAULT_IDENTITY
    if not identity.exists():
        _emit({"ok": False, "error": f"нет приватного ключа {identity}"})
        return 3

    try:
        encrypted = _resolve_encrypted()
        manifest = _read_public_manifest()
    except PackageError as exc:
        _emit({"ok": False, "error": str(exc)})
        return 3

    head = encrypted.open("rb").read(len(LFS_POINTER_PREFIX))
    if head == LFS_POINTER_PREFIX:
        _emit({"ok": False, "error": f"{encrypted} — указатель Git LFS, выполните git lfs pull"})
        return 3

    # Целостность шифротекста проверяется до расшифровки: манифест публичный и
    # лежит рядом, так что подмена пакета обнаруживается без приватного ключа.
    actual = sha256_file(encrypted)
    expected = str(manifest.get("encrypted_sha256", "")).upper()
    if expected and actual != expected:
        _emit(
            {
                "ok": False,
                "error": "sha256 шифротекста не совпал с манифестом",
                "expected": expected,
                "actual": actual,
            }
        )
        return 4

    with tempfile.TemporaryDirectory() as tmp:
        tar_path = Path(tmp) / "package.tar"
        result = subprocess.run(
            ["age", "-d", "-i", str(identity), "-o", str(tar_path), str(encrypted)],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0 or not tar_path.exists() or tar_path.stat().st_size == 0:
            _emit(
                {
                    "ok": False,
                    "error": "расшифровка не удалась — ключ не входит в список получателей?",
                    "detail": (result.stderr or "").strip()[:400],
                }
            )
            return 5

        staging = Path(tmp) / "extracted"
        staging.mkdir()
        try:
            files = _extract_safely(tar_path, staging)
        except PackageError as exc:
            _emit({"ok": False, "error": str(exc)})
            return 6

        # Замена каталога целиком: полураспакованный корпус хуже отсутствующего.
        if TARGET_DIR.exists():
            shutil.rmtree(TARGET_DIR)
        TARGET_DIR.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(staging), str(TARGET_DIR))

    private_manifest = TARGET_DIR / "manifest.private.json"
    private = json.loads(private_manifest.read_text(encoding="utf-8")) if private_manifest.exists() else {}

    pointer = {
        "package_version": private.get("package_version") or manifest.get("package_version"),
        "corpus_id": private.get("corpus_id") or manifest.get("corpus_id"),
        "classification": private.get("classification") or manifest.get("classification"),
        "source_count": private.get("source_count") or manifest.get("source_count"),
        "chunk_count": private.get("chunk_count") or manifest.get("minimum_chunk_count"),
        "chunking_version": private.get("chunking_version"),
        "embedding_family": private.get("embedding_family"),
        "installed_from": str(encrypted),
        "encrypted_sha256": actual,
        "files": len(files),
    }
    POINTER.write_text(json.dumps(pointer, ensure_ascii=False, indent=2), encoding="utf-8")

    _emit({"ok": True, "installed_to": str(TARGET_DIR.relative_to(REPO_ROOT)), **pointer})
    return 0


def status(_args: argparse.Namespace) -> int:
    if not POINTER.exists():
        _emit({"ok": True, "installed": False, "hint": "python3 scripts/rag_package_install.py install"})
        return 0
    pointer = json.loads(POINTER.read_text(encoding="utf-8"))
    corpus = sorted((TARGET_DIR / "corpus").glob("*.md"))
    _emit(
        {
            "ok": True,
            "installed": True,
            "corpus_files": len(corpus),
            "vector_index": (TARGET_DIR / "vector" / "index.faiss").exists(),
            "quality_set": (TARGET_DIR / "quality" / "k3-queries.json").exists(),
            **pointer,
        }
    )
    return 0


def remove(_args: argparse.Namespace) -> int:
    if TARGET_DIR.exists():
        shutil.rmtree(TARGET_DIR)
    _emit({"ok": True, "removed": str(TARGET_DIR.relative_to(REPO_ROOT))})
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Установка зашифрованного пакета знаний K3")
    sub = parser.add_subparsers(dest="command", required=True)

    p_install = sub.add_parser("install", help="расшифровать и распаковать пакет локально")
    p_install.add_argument("--identity", help=f"приватный age/ssh-ключ (по умолчанию {DEFAULT_IDENTITY})")
    p_install.set_defaults(func=install)

    sub.add_parser("status", help="что установлено сейчас").set_defaults(func=status)
    sub.add_parser("remove", help="удалить распакованный корпус").set_defaults(func=remove)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
