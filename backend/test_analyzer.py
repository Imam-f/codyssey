# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
import tempfile
import unittest
from pathlib import Path
from analyzer import analyze


class AnalyzerTests(unittest.TestCase):
    def index(self, files):
        with tempfile.TemporaryDirectory() as root:
            for name, source in files.items():
                path = Path(root, name)
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(source, encoding='utf8')
            return analyze(root)

    def test_function_scope_and_shadowing(self):
        repo = self.index({'a.py': 'x = 1\ndef f(x: int):\n    y = x\n    return y + x\ndef g():\n    x = 2\n    return x\n'})
        file = repo['files'][0]
        xs = [s for s in file['symbols'] if s['name'] == 'x']
        self.assertEqual(len(xs), 3)
        parameter = next(s for s in xs if s['scopeName'] == 'f')
        self.assertEqual(parameter['type'], 'int')
        self.assertEqual(parameter['references'], 2)
        self.assertEqual(len({s['id'] for s in xs}), 3)

    def test_nested_closure_global_nonlocal_and_comprehensions(self):
        file = self.index({'a.py': 'x = 0\ndef outer():\n    y = 1\n    def inner():\n        nonlocal y\n        global x\n        y += 1\n        x = y\n    z = [y for y in range(3)]\n    return y\n'})['files'][0]
        ys = [s for s in file['symbols'] if s['name'] == 'y']
        self.assertEqual(len(ys), 2)
        outer_y = next(s for s in ys if s['scopeName'] == 'outer')
        self.assertEqual(outer_y['references'], 4)
        self.assertEqual(len([s for s in file['symbols'] if s['name'] == 'x']), 1)

    def test_alias_history_and_cross_file_inheritance(self):
        repo = self.index({'pkg/base.py': 'class Base: pass\n', 'pkg/child.py': 'from .base import Base as B\nAlias = B\nChain = Alias\nclass Child(Chain): pass\nAlias = 3\ndef use(x: B) -> Chain:\n    return x\n'})
        base, child = repo['files']
        base_id = base['classes'][0]['id']
        self.assertEqual(child['classes'][0]['baseIds'], [base_id])
        chain = next(a for a in child['aliases'] if a['name'] == 'Chain')
        self.assertEqual(chain['chain'], ['Chain', 'Alias', 'B', '.base.Base'])
        self.assertEqual(chain['targetId'], base_id)
        alias = next(a for a in child['aliases'] if a['name'] == 'Alias')
        self.assertEqual(alias['endLine'], 5)
        self.assertEqual(next(s for s in child['symbols'] if s['name'] == 'x')['typeTargets'], [base_id])

    def test_qualified_imports_and_multiple_inheritance(self):
        repo = self.index({'models.py': 'class A: pass\nclass B: pass\n', 'service.py': 'import models as m\nclass C(m.A, m.B): pass\n'})
        self.assertEqual(repo['files'][1]['classes'][0]['baseIds'], [s['id'] for s in repo['files'][0]['classes']])

    def test_errors_exclusions_and_never_executes(self):
        repo = self.index({'valid.py': 'raise RuntimeError("must never execute")\n', 'broken.py': 'def broken(:\n', '.venv/hidden.py': 'x=1\n', 'readme.txt': 'ignored'})
        self.assertEqual(repo['stats']['files'], 2)
        self.assertEqual(len(repo['diagnostics']), 1)
        self.assertEqual(repo['diagnostics'][0]['path'], 'broken.py')

    def test_class_scope_is_not_method_closure(self):
        file = self.index({'a.py': 'x = 1\nclass C:\n    x = 2\n    def f(self):\n        return x\n'})['files'][0]
        ref = next(r for r in file['references'] if r['name'] == 'x' and r['role'] == 'read')
        symbol = next(s for s in file['symbols'] if s['id'] == ref['symbolId'])
        self.assertEqual(symbol['scopeName'], '<module>')

    def test_unicode_positions_and_destructuring(self):
        file = self.index({'a.py': 'def f():\n    café = "☕"; x, y = 1, "ok"\n    return café, x, y\n'})['files'][0]
        self.assertEqual(next(s for s in file['symbols'] if s['name'] == 'x')['type'], 'int')
        self.assertEqual(next(s for s in file['symbols'] if s['name'] == 'y')['type'], 'str')
        ref = next(r for r in file['references'] if r['name'] == 'x' and r['role'] == 'declaration')
        self.assertEqual(ref['column'], 16)

    def test_type_alias_and_forward_annotation(self):
        file = self.index({'a.py': 'class User: pass\ntype Users = list[User]\ndef f(x: "User") -> Users:\n    return [x]\n'})['files'][0]
        user = file['classes'][0]
        self.assertIn(user['id'], next(s for s in file['symbols'] if s['name'] == 'x')['typeTargets'])
        self.assertEqual(next(s for s in file['symbols'] if s['name'] == 'Users')['kind'], 'type')

    def test_import_alias_position_and_snapshot(self):
        file = self.index({'a.py': 'from models import User as U\nA = U\nU = Other\nB = A\n'})['files'][0]
        self.assertEqual(next(s for s in file['symbols'] if s['name'] == 'U')['column'], 27)
        self.assertEqual(next(a for a in file['aliases'] if a['name'] == 'B')['chain'], ['B', 'A', 'U', 'models.User'])


class CallGraphTests(unittest.TestCase):
    index = AnalyzerTests.index
    def graph(self, files):
        return self.index(files)['callGraph']

    def edges(self, graph):
        labels = {n['id']: n['label'] for n in graph['nodes']}
        return {(labels[e['from']], labels[e['to']]) for e in graph['edges'] if e['resolved']}

    def test_direct_recursive_and_repeated_calls(self):
        graph = self.graph({'a.py': 'def target(): pass\ndef caller():\n    target()\n    target()\n    caller()\n'})
        self.assertEqual(self.edges(graph), {('caller', 'target'), ('caller', 'caller')})
        self.assertEqual(sorted(len(e['sites']) for e in graph['edges']), [1, 2])
        self.assertEqual([s['line'] for s in graph['sites']], [3, 4, 5])

    def test_import_aliases_modules_reexports_and_assignment_snapshot(self):
        graph = self.graph({'pkg/target.py': 'def work(): pass\n', 'pkg/api.py': 'from .target import work\n', 'main.py': 'import pkg.target as m\nfrom pkg.api import work as w\ndef run():\n    saved = w\n    w = None\n    saved()\n    m.work()\n'})
        # w is local throughout run, so saved = w cannot resolve the import.
        self.assertEqual(self.edges(graph), {('run', 'work')})
        saved = next(s for s in graph['sites'] if s['expression'] == 'saved')
        self.assertFalse(saved['resolved'])
        graph = self.graph({'target.py':'def work(): pass\n','main.py':'from target import work as w\nalias = w\nw = None\ndef run():\n    alias()\n'})
        self.assertEqual(self.edges(graph), {('run','work')})

    def test_nested_scopes_and_comprehension_attribution(self):
        graph = self.graph({'a.py':'def helper(): pass\ndef outer():\n    def inner():\n        helper()\n    [helper() for x in range(2)]\n    inner()\n'})
        self.assertEqual(self.edges(graph), {('outer.inner','helper'),('outer','helper'),('outer','outer.inner')})

    def test_methods_typed_receivers_fields_and_super(self):
        graph = self.graph({'a.py':'class Repo:\n    def save(self): pass\nclass Base:\n    def __init__(self, repo: Repo):\n        self.repo = repo\n    def run(self):\n        self.repo.save()\nclass Child(Base):\n    def run(self):\n        super().run()\n        self.repo.save()\ndef main(r: Repo):\n    c = Child(r)\n    c.run()\n    r.save()\n'})
        self.assertTrue({('Base.run','Repo.save'),('Child.run','Base.run'),('Child.run','Repo.save'),('main','Child.run'),('main','Repo.save'),('main','Base.__init__')} <= self.edges(graph))

    def test_unknown_receivers_and_callback_parameters_are_not_guessed(self):
        graph = self.graph({'a.py':'def save(): pass\nclass Known:\n    def save(self): pass\ndef run(callback, obj):\n    callback()\n    obj.save()\n    missing()\n    text = "save"\n    text()\n'})
        self.assertEqual(self.edges(graph), set())
        self.assertEqual(len(graph['sites']), 4)
        self.assertTrue(all(not s['resolved'] for s in graph['sites']))

    def test_module_calls_and_defaults_are_not_function_body_calls(self):
        graph = self.graph({'a.py':'def build(): pass\ndef run(x=build()):\n    pass\nrun()\n'})
        self.assertEqual(self.edges(graph), {('a.py · module','build'),('a.py · module','run')})

    def test_class_method_static_method_and_multiple_inheritance_mro(self):
        graph = self.graph({'a.py':'class A:\n    def work(self): pass\nclass B(A): pass\nclass C(A):\n    def work(self): pass\nclass D(B, C):\n    @classmethod\n    def make(cls):\n        cls.work()\n    @staticmethod\n    def static(self):\n        self.work()\n'})
        self.assertIn(('D.make','C.work'),self.edges(graph))
        self.assertFalse(next(s for s in graph['sites'] if s['expression']=='self.work')['resolved'])

    def test_container_annotations_do_not_imply_element_dispatch(self):
        graph = self.graph({'a.py':'class User:\n    def save(self): pass\ndef users() -> list[User]: return []\ndef run(items: list[User]):\n    items.save()\n    users().save()\n'})
        self.assertEqual(self.edges(graph), {('run','users')})

    def test_async_functions_and_same_named_methods_remain_distinct(self):
        graph = self.graph({'a.py':'async def work(): pass\nclass A:\n    async def work(self): pass\nclass B:\n    async def work(self): pass\nasync def run(a: A, b: B):\n    await work()\n    await a.work()\n    await b.work()\n'})
        self.assertEqual(self.edges(graph), {('run','work'),('run','A.work'),('run','B.work')})


if __name__ == '__main__': unittest.main(verbosity=2)
