"""Закрытый слой знаний K3: изоляция, метаданные и качество выдачи.

Тесты пропускаются, если пакет не установлен: расшифровать его может только
владелец приватного ключа из списка получателей, и на чужой машине эти проверки
выполнить нечем.
"""

from __future__ import annotations

import json
import subprocess
import sys

import pytest

from value_priority_assessor.config import REPO_ROOT
from value_priority_assessor.rag.corpus import K3_DIR, k3_installed, k3_manifest, k3_source_map
from value_priority_assessor.rag.search import _diversify, index_status, search_corpus

pytestmark = pytest.mark.skipif(
    not k3_installed(), reason="пакет знаний K3 не установлен"
)


class TestPackage:
    def test_manifest_declares_expected_corpus(self):
        manifest = k3_manifest()
        assert manifest["corpus_id"] == "k3-dmb-c2"
        assert manifest["classification"] == "K3"
        assert manifest["source_count"] == 9

    def test_source_map_resolves_logical_names(self):
        mapping = k3_source_map()
        assert len(mapping) == 9
        assert all(entry.get("source") for entry in mapping.values())

    def test_canonical_source_is_marked(self):
        """form-4441 — канонический источник, на который ссылается набор качества."""
        canonical = [
            name for name, entry in k3_source_map().items() if entry.get("canonical_id")
        ]
        assert canonical, "канонический источник не размечен"


class TestIsolation:
    def test_decrypted_corpus_is_not_tracked_by_git(self):
        """Главное правило пакета: расшифрованный корпус не попадает в git."""
        result = subprocess.run(
            ["git", "ls-files", "--", "data/knowledge/k3"],
            capture_output=True,
            text=True,
            cwd=REPO_ROOT,
        )
        assert result.stdout.strip() == "", "расшифрованный корпус K3 отслеживается git"

    def test_ciphertext_is_tracked(self):
        """А шифротекст, наоборот, лежит в репозитории — иначе клон не развернуть."""
        result = subprocess.run(
            ["git", "ls-files", "--", "data/rag-package/k3-rag-current.age"],
            capture_output=True,
            text=True,
            cwd=REPO_ROOT,
        )
        assert result.stdout.strip(), "шифротекст пакета не добавлен в репозиторий"

    def test_layer_can_be_switched_off(self, monkeypatch):
        """Выключатель нужен для показов, где K3 демонстрировать нельзя."""
        from value_priority_assessor.config import get_settings
        from value_priority_assessor.rag import corpus as corpus_module

        monkeypatch.setenv("PRIORITISER_RAG_ALLOW_K3", "0")
        get_settings.cache_clear()
        try:
            assert corpus_module._k3_chunks() == []
        finally:
            get_settings.cache_clear()


class TestRetrieval:
    def test_k3_layer_is_indexed(self):
        status = index_status()
        assert status["layers"].get("k3", 0) > 500

    def test_results_carry_source_provenance(self):
        result = search_corpus("акционерные продукты", top_k=5, layer="k3")
        assert result["results"]
        for item in result["results"]:
            meta = item["metadata"]
            assert meta["classification"] == "K3"
            assert meta["logical_source"], "фрагмент без имени источника"

    def test_layer_filter_keeps_k3_out_of_other_layers(self):
        result = search_corpus("акционерные продукты", top_k=5, layer="methodology")
        assert all(r["layer"] == "methodology" for r in result["results"])


class TestDiversification:
    def test_single_source_cannot_take_every_slot(self):
        """Регрессия: перекошенный корпус вытеснял малые документы из выдачи."""

        class FakeChunk:
            def __init__(self, source):
                self.metadata = {"logical_source": source}
                self.source = source

        chunks = [FakeChunk("big") for _ in range(10)] + [FakeChunk("small")]
        ordered = [(i, 1.0 / (i + 1)) for i in range(11)]

        selected = _diversify(ordered, chunks, top_k=6)
        sources = [chunks[i].metadata["logical_source"] for i, _ in selected]

        assert len(selected) == 6
        assert "small" in sources, "малый источник обязан попасть в выдачу"

    def test_falls_back_when_cap_leaves_gaps(self):
        """Если разнообразия не хватает, добираем остаток, а не отдаём меньше."""

        class FakeChunk:
            def __init__(self, source):
                self.metadata = {"logical_source": source}
                self.source = source

        chunks = [FakeChunk("only") for _ in range(10)]
        ordered = [(i, 1.0) for i in range(10)]
        assert len(_diversify(ordered, chunks, top_k=5)) == 5


class TestQualityGate:
    def test_meets_package_quality_targets(self):
        """Прогон 25 размеченных запросов из пакета.

        Требования взяты из README пакета: обязательный источник и точность на
        no-answer запросах должны быть равны единице. Без этой проверки
        «работоспособность» RAG остаётся вопросом веры: он всегда что-то
        возвращает, и выдача всегда выглядит правдоподобно.
        """
        script = REPO_ROOT / "scripts" / "rag_quality.py"
        result = subprocess.run(
            [sys.executable, str(script), "--top-k", "8", "--json"],
            capture_output=True,
            text=True,
            cwd=REPO_ROOT,
        )
        assert result.returncode == 0, result.stderr[-500:]
        report = json.loads(result.stdout)
        metrics = report["metrics"]

        assert metrics["required_source_hit"] == 1.0
        assert metrics["no_answer_precision"] == 1.0
        assert metrics["hit_at_k"] >= 0.95
