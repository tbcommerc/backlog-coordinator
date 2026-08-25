"""Domain ontology - formalized model of the platform's subject area.

Entities: investment products, platform modules, business processes, user
roles. Each entity carries aliases for keyword matching. The ontology feeds
the input harness (domain vocabulary) and the dialogue extractor.
"""
import re
from dataclasses import dataclass, field


@dataclass
class Entity:
    kind: str          # product | module | process | role
    name: str
    aliases: list = field(default_factory=list)

    def tokens(self) -> list:
        return [self.name] + self.aliases


def _parse_header(title: str):
    """Parse '## Акции' or '## Расчёты (Settlement)' -> (name, aliases)."""
    m = re.match(r"^\s*(.+?)\s*(?:\((.*?)\))?\s*$", title)
    name = m.group(1).strip().lower()
    aliases = []
    if m.group(2):
        for part in re.split(r"[,\/]", m.group(2)):
            part = part.strip().lower()
            if part:
                aliases.append(part)
    return name, aliases


_SUFFIXES = ["иями", "ями", "ами", "иях", "ах", "ях", "ов", "ев", "ей", "ии", "ия",
             "ем", "ом", "ый", "ий", "ой", "ы", "и", "а", "я", "у", "ю", "е", "о", "ь"]


def _stem(word: str) -> str:
    """Light Russian stemmer for ontology matching (handles word forms)."""
    word = word.replace("ё", "е").lower()
    for suf in _SUFFIXES:
        if len(word) - len(suf) >= 4 and word.endswith(suf):
            return word[:-len(suf)]
    return word


def _stems_of(text: str) -> set:
    return {_stem(w) for w in re.findall(r"[а-яёa-z]{3,}", text.lower())}


def stem(word: str) -> str:
    """Public stemmer used for vocabulary enrichment."""
    return _stem(word)


class Ontology:
    def __init__(self):
        self.products: list[Entity] = []
        self.modules: list[Entity] = []
        self.processes: list[Entity] = []
        self.roles: list[Entity] = []
        self._from_kb()

    def _from_kb(self):
        from .loader import kb
        for doc_id in ("products", "modules", "processes", "roles"):
            doc = kb.documents.get(doc_id)
            if not doc:
                continue
            target = {"products": self.products, "modules": self.modules,
                      "processes": self.processes, "roles": self.roles}[doc_id]
            for chunk in doc.chunks:
                if not chunk.section:
                    continue
                name, aliases = _parse_header(chunk.section)
                target.append(Entity(kind=doc_id[:-1], name=name, aliases=aliases))

    def all_names(self) -> list[str]:
        out = []
        for group in (self.products, self.modules, self.processes, self.roles):
            for e in group:
                out.extend(e.tokens())
        return out

    def strong_domain_terms(self) -> list[str]:
        """Specific product/module/process/role names -> strong domain signals."""
        return [t for t in self.all_names() if len(t) >= 3]

    def weak_domain_terms(self) -> list[str]:
        return ["платформа", "требовани", "задача", "доработк", "инвестиц", "сделка"]

    def find(self, kind: str, text: str):
        """Return entities of a kind mentioned in text (case-insensitive substring)."""
        low = text.lower()
        matches = []
        for e in getattr(self, kind):
            for token in e.tokens():
                if token and token in low:
                    matches.append(e)
                    break
        return matches

    def match_role(self, text: str) -> str | None:
        text_stems = _stems_of(text)
        for e in self.roles:
            if text_stems & _stems_of(" ".join(e.tokens())):
                return e.name
        return None

    def match_product(self, text: str) -> str | None:
        text_stems = _stems_of(text)
        for e in self.products:
            if text_stems & _stems_of(" ".join(e.tokens())):
                return e.name
        return None

    def match_module(self, text: str) -> str | None:
        text_stems = _stems_of(text)
        for e in self.modules:
            if text_stems & _stems_of(" ".join(e.tokens())):
                return e.name
        return None

    def match_process(self, text: str) -> str | None:
        text_stems = _stems_of(text)
        for e in self.processes:
            if text_stems & _stems_of(" ".join(e.tokens())):
                return e.name
        return None


ontology = Ontology()
