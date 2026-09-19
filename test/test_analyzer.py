# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
import sys
import tempfile
import unittest
from pathlib import Path

# The backend is also run as a standalone script, with sibling module imports.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
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

    def test_class_tracker_added_overridden_inherited_and_dynamic_members(self):
        repo = self.index({'a.py': '''class Base:
    category = "base"
    def save(self): pass
    @property
    def label(self): return self._label
    def prepare(self):
        self.late = True

class Child(Base):
    category = "child"
    enabled: bool
    def __init__(self):
        self.ready = True
    def save(self): pass
    def load(self):
        self.cache = {}
'''})
        base, child = repo['files'][0]['classes']
        tracker = child['memberTracker']
        self.assertEqual({m['name'] for m in tracker['addedMethods']}, {'__init__', 'load'})
        self.assertEqual({m['name'] for m in tracker['overriddenMethods']}, {'save'})
        self.assertEqual({m['name'] for m in tracker['inheritedMethods']}, {'prepare'})
        self.assertEqual({m['name'] for m in tracker['overriddenProperties']}, {'category'})
        self.assertEqual({m['name'] for m in tracker['inheritedProperties']}, {'label', 'late'})
        self.assertEqual({m['name'] for m in tracker['dynamicProperties']}, {'cache'})
        self.assertEqual({m['name'] for m in tracker['addedProperties']}, {'enabled', 'ready', 'cache'})
        cache = tracker['dynamicProperties'][0]
        self.assertEqual((cache['definedIn'], cache['line'], cache['column']), ('load', 16, 13))
        self.assertTrue(next(m for m in base['memberTracker']['dynamicProperties'] if m['name'] == 'late')['dynamic'])

    def test_class_tracker_ignores_static_and_class_method_attributes(self):
        cls = self.index({'a.py': '''class Example:
    @staticmethod
    def static(self):
        self.not_instance = 1
    @classmethod
    def configure(cls):
        cls.class_value = 2
    def initialize(this):
        this.instance_value = 3
'''})['files'][0]['classes'][0]
        self.assertEqual({m['name'] for m in cls['memberTracker']['dynamicProperties']}, {'instance_value'})


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


class DefinitionTests(unittest.TestCase):
    index = AnalyzerTests.index

    def reference(self, repo, path, name, line):
        file = next(f for f in repo['files'] if f['path'] == path)
        return next(r for r in file['references'] if r['name'] == name and r['line'] == line)

    def test_imported_function_class_constant_and_original_alias_token(self):
        repo = self.index({'lib.py': 'LIMIT = 3\ndef run(): pass\nclass Model: pass\n', 'use.py': 'from lib import run as execute, Model, LIMIT\ndef caller():\n    execute()\n    item = Model()\n    return LIMIT\n'})
        for name, line, target_line in [('execute',3,2),('Model',4,3),('LIMIT',5,1),('run',1,2),('execute',1,2)]:
            ref = self.reference(repo,'use.py',name,line)
            self.assertEqual((ref['definition']['path'],ref['definition']['line']),('lib.py',target_line))
            self.assertNotEqual(ref['symbolId'],ref['definition']['id'])

    def test_qualified_access_and_module_navigation(self):
        repo = self.index({'pkg/__init__.py': '', 'pkg/lib.py':'LIMIT = 3\ndef run(): pass\n', 'use.py':'import pkg.lib as m\nimport pkg.lib\nm.run()\nvalue = pkg.lib.LIMIT\n'})
        for name,line,target_path,target_line in [('m',3,'pkg/lib.py',1),('run',3,'pkg/lib.py',2),('LIMIT',4,'pkg/lib.py',1),('lib',4,'pkg/lib.py',1),('lib',1,'pkg/lib.py',1),('pkg',2,'pkg/__init__.py',1)]:
            target=self.reference(repo,'use.py',name,line)['definition']
            self.assertEqual((target['path'],target['line']),(target_path,target_line))

    def test_reexports_src_layout_typed_and_inherited_methods(self):
        repo=self.index({'src/pkg/base.py':'class Base:\n    def save(self): pass\n', 'src/pkg/__init__.py':'from .base import Base as PublicBase\n', 'src/pkg/use.py':'from pkg import PublicBase as B\nclass Child(B): pass\ndef run(obj: B):\n    obj.save()\n    item = Child()\n    item.save()\n'})
        for line in (4,6):
            target=self.reference(repo,'src/pkg/use.py','save',line)['definition']
            self.assertEqual((target['path'],target['line']),('src/pkg/base.py',2))
        file=next(f for f in repo['files'] if f['path']=='src/pkg/use.py')
        self.assertEqual(file['classes'][0]['baseIds'][0],next(f for f in repo['files'] if f['path']=='src/pkg/base.py')['classes'][0]['id'])

    def test_bound_method_reference_and_constructor_field(self):
        repo=self.index({'lib.py':'class Repo:\n    def save(self): pass\nclass Service:\n    def __init__(self, repo: Repo):\n        self.repo = repo\n    def run(self):\n        callback = self.repo.save\n        callback()\n', 'use.py':'from lib import Repo, Service\ndef run():\n    service = Service(Repo())\n    service.run()\n    return service.repo\n'})
        self.assertEqual(self.reference(repo,'lib.py','save',7)['definition']['line'],2)
        self.assertEqual(self.reference(repo,'use.py','run',4)['definition']['line'],6)
        target=self.reference(repo,'use.py','repo',5)['definition']
        self.assertEqual((target['path'],target['line']),('lib.py',5))

    def test_local_shadowing_rebinding_and_unknown_receivers(self):
        repo=self.index({'lib.py':'def work(): pass\n', 'use.py':'from lib import work\ndef run(work, obj):\n    work()\n    obj.work()\nwork = 5\nprint(work)\n'})
        self.assertEqual(self.reference(repo,'use.py','work',3)['definition']['path'],'use.py')
        self.assertIsNone(self.reference(repo,'use.py','work',4)['definition'])
        self.assertEqual(self.reference(repo,'use.py','work',6)['definition']['line'],5)

    def test_cyclic_reexport_and_external_import_are_unresolved(self):
        repo=self.index({'a.py':'from b import missing\n', 'b.py':'from a import missing\n', 'use.py':'from a import missing\nimport external\nmissing()\nexternal.work()\n'})
        self.assertIsNone(self.reference(repo,'use.py','missing',3)['definition'])
        self.assertIsNone(self.reference(repo,'use.py','work',4)['definition'])

    def test_utf16_attribute_position_and_multiline_imports(self):
        repo=self.index({'lib.py':'def café(): pass\n', 'use.py':'from lib import (\n    café as coffee,\n)\nimport lib\ndef run():\n    label = "🌲"; lib.café()\n'})
        original=self.reference(repo,'use.py','café',2)
        self.assertEqual(original['column'],4)
        attribute=self.reference(repo,'use.py','café',6)
        self.assertEqual(attribute['column'],22)
        self.assertEqual(attribute['definition']['path'],'lib.py')


class TypeSystemTests(unittest.TestCase):
    index = AnalyzerTests.index

    def symbols(self, repo, path):
        file = next(f for f in repo['files'] if f['path'] == path)
        return {s['name']: s for s in file['symbols']}

    def errors(self, repo):
        return {(e['line'], e['code']) for e in repo.get('typeErrors', [])}

    def test_sidecar_declarations_override_and_augment_inference(self):
        repo = self.index({
            'app.py': 'class User: pass\ndef fail() -> int:\n    raise RuntimeError("boom")\ndef use():\n    return fail()\n',
            'app.pxd': 'prop fail() -> never\nprop use() -> int\n',
        })
        file = repo['files'][0]
        self.assertEqual(file['declaration']['path'], 'app.pxd')
        symbols = self.symbols(repo, 'app.py')
        self.assertEqual(symbols['fail']['computedType'], '() -> never')
        self.assertEqual(symbols['use']['computedType'], '() -> int')

    def test_block_form_property_declaration_is_a_valid_expression(self):
        repo = self.index({
            'app.py': 'data = {"name": "codyssey"}\n',
            'app.pxd': 'prop data:\n    { name: str }\n',
        })
        symbols = self.symbols(repo, 'app.py')
        self.assertEqual(symbols['data']['computedType'], '{name: str}')

    def test_raise_is_never_and_union_drops_never(self):
        repo = self.index({'app.py': 'def stop():\n    raise ValueError("x")\ndef pick(flag):\n    if flag:\n        return 1\n    raise RuntimeError("no")\n'})
        symbols = self.symbols(repo, 'app.py')
        self.assertEqual(symbols['stop']['computedType'], '() -> never')
        self.assertEqual(symbols['pick']['computedType'], '(flag: ?) -> int')

    def test_never_argument_and_never_parameter_cannot_be_called(self):
        repo = self.index({
            'app.py': 'def fail():\n    raise RuntimeError("boom")\ndef needs(x):\n    return x\ndef run():\n    return needs(fail())\n',
            'app.pxd': 'prop fail() -> never\n',
        })
        errors = self.errors(repo)
        self.assertIn((6, 'never-arg'), errors)
        repo = self.index({
            'app.py': 'def needs(x):\n    return x\ndef run():\n    return needs(1)\n',
            'app.pxd': 'prop needs(x: never) -> never\n',
        })
        errors = self.errors(repo)
        self.assertIn((4, 'never-param'), errors)

    def test_dict_member_and_variant_sum_types(self):
        repo = self.index({
            'app.py': 'def get(d):\n    return d["name"]\ndef pick(flag):\n    if flag:\n        return 1\n    return "x"\n',
            'app.pxd': 'prop get(d: { name: str, count: int }) -> str\nprop pick(flag: bool) -> int | str\n',
        })
        symbols = self.symbols(repo, 'app.py')
        self.assertEqual(symbols['pick']['computedType'], '(flag: bool) -> int | str')
        self.assertEqual(symbols['get']['computedType'], '(d: {name: str, count: int}) -> str')

    def test_closure_capture_analysis(self):
        repo = self.index({'app.py': 'def outer():\n    total = 0\n    def inner():\n        return total + 1\n    return inner\n'})
        symbols = self.symbols(repo, 'app.py')
        self.assertEqual(symbols['outer']['computedType'], '() -> () -> int')
        self.assertEqual(symbols['inner']['closures'], [{'name': 'total', 'type': 'int', 'mutable': False}])

    def test_mutability_status(self):
        repo = self.index({'app.py': 'x = 1\ny = []\n'})
        symbols = self.symbols(repo, 'app.py')
        self.assertFalse(symbols['x']['mutable'])
        self.assertTrue(symbols['y']['mutable'])
        repo = self.index({'app.py': 'data = 1\n', 'app.pxd': 'mut prop data: int\n'})
        self.assertTrue(self.symbols(repo, 'app.py')['data']['mutable'])

    def test_side_effect_tags_and_purity_violation(self):
        repo = self.index({'app.py': '@side_effect\ndef write(row):\n    pass\n@pure\ndef read():\n    write(1)\n    return 0\n'})
        symbols = self.symbols(repo, 'app.py')
        self.assertEqual(symbols['write']['effect'], 'side_effect')
        self.assertEqual(symbols['read']['effect'], 'pure')
        self.assertIn((6, 'purity'), self.errors(repo))

    def test_type_alias_declaration(self):
        repo = self.index({'app.py': 'def get(row):\n    return row\n', 'app.pxd': 'type Row = { id: int }\nprop get(row: Row) -> Row\n'})
        file = repo['files'][0]
        self.assertIn('Row', file['declaration']['aliases'])
        self.assertEqual(file['declaration']['aliases']['Row']['display'], '{id: int}')

    def test_self_is_typed_as_the_enclosing_class(self):
        repo = self.index({'app.py': '''class Base:
    def __init__(self):
        pass
    @classmethod
    def make(cls):
        return cls()
    @staticmethod
    def helper(thing):
        return thing
class Child(Base):
    def run(self):
        return self
'''})
        symbols = self.symbols(repo, 'app.py')
        self.assertEqual(symbols['__init__']['computedType'], '(self: Base) -> None')
        self.assertEqual(symbols['run']['computedType'], '(self: Child) -> Child')
        self.assertEqual(symbols['helper']['computedType'], '(thing: ?) -> ?')
        receivers = {
            s['computedType']
            for s in repo['files'][0]['symbols']
            if s['kind'] == 'parameter' and s['name'] in ('self', 'cls')
        }
        self.assertEqual(receivers, {'Base', 'Child'})

    def test_declaration_keeps_method_receiver(self):
        repo = self.index({'app.py': 'class Repo:\n    def get(self, key: str):\n        return self._items[key]\n', 'app.pxd': 'prop get(key: str) -> str\n'})
        symbols = self.symbols(repo, 'app.py')
        self.assertEqual(symbols['get']['computedType'], '(self: Repo, key: str) -> str')


if __name__ == '__main__': unittest.main(verbosity=2)
