"""Contracts for empty dictionary editing. AST extraction: no app import or database."""
import ast
import unittest
from pathlib import Path
from types import SimpleNamespace as NS
from datetime import datetime, timezone, timedelta

class HTTPError(Exception):
    def __init__(self, status_code, detail): self.status_code, self.detail = status_code, detail
class Column:
    def __eq__(self, other): return self
    def __and__(self, other): return self
class Item:
    is_active = sort_order = name = dict_type = Column()
    def __init__(self, **values): self.__dict__.update(values); self.id = 1
class Query:
    def __init__(self, db): self.db = db
    def filter(self, *args): return self
    def order_by(self, *args): return self
    def all(self): return self.db.items
class DB:
    def __init__(self, items=()): self.items=list(items); self.statements=[]; self.commits=0
    def get_bind(self): return NS(dialect=NS(name='postgresql'))
    def execute(self, stmt): self.statements.append(stmt)
    def query(self, model): return Query(self)
    def add(self, item): self.items.append(item)
    def flush(self): pass
    def commit(self): self.commits+=1
    def rollback(self): pass

def functions():
    tree=ast.parse((Path(__file__).parents[1]/'routers/admin_router.py').read_text(encoding='utf-8'))
    wanted={'_acquire_dict_lock','save_dictionary_batch'}
    nodes=[node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name in wanted]
    for node in nodes:
        node.decorator_list=[]; node.returns=None; node.args.defaults=[]
        for arg in node.args.args: arg.annotation=None
    scope=dict(HTTPException=HTTPError, DictLockResponse=lambda **kw:NS(**kw), datetime=datetime, timezone=timezone, timedelta=timedelta, DICT_LOCK_MINUTES=15, _dict_items_for_lock=lambda typ,db:db.items, _is_dict_lock_active=lambda item:bool(item.lock_owner_id), User=Item, Tag=Item, Department=Item, DictionaryItem=Item, text=lambda value:value)
    exec(compile(ast.Module(body=nodes,type_ignores=[]),'admin_contracts','exec'),scope)
    return scope

class EmptyDictionaryTests(unittest.TestCase):
    def setUp(self): self.scope=functions(); self.user=NS(id=7,name='Synthetic')
    def test_empty_open_does_not_write(self):
        db=DB(); result=self.scope['_acquire_dict_lock']('tag',self.user,db)
        self.assertFalse(result.locked); self.assertEqual(result.version,0); self.assertEqual(db.commits,0); self.assertEqual(db.items,[])
    def test_first_save_serializes_and_assigns_version(self):
        db=DB(); payload=NS(version=0,items=[NS(id=None,name='Synthetic',code='S',color='#123456',sort_order=0)])
        result=self.scope['save_dictionary_batch']('tag',payload,db,self.user)
        self.assertEqual(result['version'],1); self.assertEqual(result['added'],1)
        self.assertEqual(db.statements,['LOCK TABLE tags IN SHARE ROW EXCLUSIVE MODE'])
        self.assertIsNotNone(db.items[0].lock_until)
    def test_existing_dictionary_requires_own_lock(self):
        db=DB([NS(lock_owner_id=9,version=2)])
        with self.assertRaises(HTTPError) as raised:self.scope['save_dictionary_batch']('tag',NS(version=0,items=[]),db,self.user)
        self.assertEqual(raised.exception.status_code,423); self.assertEqual(db.commits,0)
    def test_stale_empty_version_is_rejected(self):
        db=DB()
        with self.assertRaises(HTTPError) as raised:self.scope['save_dictionary_batch']('tag',NS(version=3,items=[]),db,self.user)
        self.assertEqual(raised.exception.status_code,409)

if __name__=='__main__':unittest.main()
