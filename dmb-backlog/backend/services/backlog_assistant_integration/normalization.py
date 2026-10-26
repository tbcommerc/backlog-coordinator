"""Conservative Russian inflection expansion for substring search (not semantic ranking)."""
import re
# Long suffixes first; retain >=4 letters and leave IDs/literals untouched.
_SUFFIX=re.compile(r'(иями|ями|ами|ией|ого|ему|ыми|ими|иях|ов|ев|ам|ям|ах|ях|ом|ем|ой|ей|ий|ый|ое|ее|ие|ии|ые|ая|яя|ую|юю|ка|ки|ке|ку|ок|а|я|ы|и|у|ю|е|о|ь)$')

def search_tokens(term):
    parts=term.casefold().split()
    result=[]
    for word in parts:
        stem=_SUFFIX.sub('',word) if len(word)>=7 and re.fullmatch('[а-яё]+',word) else word
        result.append(stem if len(stem)>=4 else word)
    return result


def context_matches(text, label, kind):
    """Match authorized labels conservatively, preserving quarter/year ambiguity."""
    def words(value):
        return [_SUFFIX.sub('', w) if len(w) >= 5 else w
                for w in re.findall(r'[а-яёa-z0-9]+', value.casefold())]
    if kind == 'status' and text.strip().casefold() in {'в работе', 'выполняется', 'in_progress'}:
        return label.casefold() in {'в работе', 'принята в работу'}
    if text.casefold() in label.casefold():
        return True
    if kind == 'period':
        def quarter(value):
            value = value.casefold()
            found = re.search(r'(?:q\s*([1-4])|([1-4])\s*q|([1-4])(?:[-–]?(?:го|й|ый|ой))?\s*(?:квартал|кв))', value)
            return next((int(v) for v in found.groups() if v), None) if found else None
        requested = quarter(text)
        years = re.findall(r'\b20\d{2}\b', text)
        return bool(requested and requested == quarter(label) and all(y in label for y in years))
    requested, available = words(text), words(label)
    return bool(requested) and all(w in available for w in requested)
