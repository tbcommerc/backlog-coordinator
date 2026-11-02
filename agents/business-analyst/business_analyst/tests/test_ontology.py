from business_analyst.kb.ontology import ontology


def test_product_matching_handles_russian_case_endings():
    assert ontology.match_product("реестр облигаций") == "облигации"
    assert ontology.match_product("операции с облигациями") == "облигации"

