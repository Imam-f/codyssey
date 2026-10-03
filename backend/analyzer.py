# /// script
# requires-python = ">=3.12"
# dependencies = ["Cython==3.2.4"]
# ///
"""Static Python repository index. Never imports or executes analyzed code."""
from __future__ import annotations
import argparse
import ast
import io
import json
import os
import re
from collections import Counter
from pathlib import Path
import sys
import tokenize
from callgraph import link_calls
from class_tracker import track_classes
from definitions import link_definitions
from cython_parser import SOURCE_SUFFIXES, annotation_text, parse_source
from stub_paths import STUB_SUFFIXES, stub_roots, stub_module, index_priority

EXCLUDED = {'.git', '.venv', 'venv', 'env', '__pycache__', 'node_modules', 'dist', 'build', '.mypy_cache', '.pytest_cache', '.ruff_cache', 'site-packages'}
MAX_FILE = 2_000_000
MAX_FILES = 5000


class Indexer(ast.NodeVisitor):
    def __init__(self, path, source):
        self.path, self.source = path, source
        self.lines = source.splitlines()
        self.symbols, self.references, self.aliases, self.classes = [], [], [], []
        self.scopes = [{'id': f'{path}:module', 'name': '<module>', 'kind': 'module', 'parent': None, 'line': 1, 'endLine': len(self.lines), 'bindings': {}, 'globals': set(), 'nonlocals': set()}]
        self.scope = self.scopes[0]
        self.pending = []
        self.imports = []
        self.calls = []
        self.assignments = []
        self.annotation_depth = 0

    def location(self, node, name=None):
        line = getattr(node, 'lineno', 1)
        col = getattr(node, 'col_offset', 0)
        text = self.lines[line - 1] if line <= len(self.lines) else ''
        prefix = text.encode('utf-8')[:col].decode('utf-8', errors='ignore')
        column = len(prefix.encode('utf-16-le')) // 2
        if name and isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            start = text.find(name, len(prefix) + (6 if isinstance(node, ast.ClassDef) else 4))
            column = len(text[:start].encode('utf-16-le')) // 2 if start >= 0 else column
        elif name and isinstance(node, ast.alias) and node.asname:
            match = re.search(r'\bas\s+(' + re.escape(name) + r')\b', text[len(prefix):])
            if match:
                column = len(text[:len(prefix) + match.start(1)].encode('utf-16-le')) // 2
        return {'line': line, 'column': column, 'endLine': getattr(node, 'end_lineno', line)}

    def binding_scope(self, name):
        if name in self.scope['globals']:
            return self.scopes[0]
        if name in self.scope['nonlocals']:
            parent = self.scope['parent']
            while parent:
                candidate = next(s for s in self.scopes if s['id'] == parent)
                if candidate['kind'] != 'class' and name in candidate['bindings']:
                    return candidate
                parent = candidate['parent']
        return self.scope

    def bind(self, name, node, kind='variable', annotation=None, inferred=None):
        scope = self.binding_scope(name)
        existing = scope['bindings'].get(name)
        if existing:
            symbol = next(s for s in self.symbols if s['id'] == existing)
            self.reference(name, node, 'write', existing)
            if annotation:
                symbol['type'] = annotation
                symbol['typeSource'] = 'annotation'
            return symbol
        loc = self.location(node, name)
        symbol = {'id': f"{self.path}:{scope['id']}:{name}", 'name': name, 'kind': kind, 'path': self.path, 'scopeId': scope['id'], 'scopeName': scope['name'], 'type': annotation or inferred or 'unknown', 'typeSource': 'annotation' if annotation else 'inferred' if inferred else 'unknown', **loc}
        self.symbols.append(symbol)
        scope['bindings'][name] = symbol['id']
        self.reference(name, node, 'declaration', symbol['id'], loc)
        return symbol

    def reference(self, name, node, role='read', target=None, loc=None):
        ref = {'name': name, 'path': self.path, 'scopeId': self.scope['id'], 'role': role, 'symbolId': target, **(loc or self.location(node))}
        self.references.append(ref)
        if not target:
            self.pending.append(ref)
        return ref

    def resolve(self, name, scope):
        if name in scope['globals']:
            return self.scopes[0]['bindings'].get(name)
        current = scope
        while current:
            if name in current['bindings'] and not (current == scope and name in scope['nonlocals']):
                return current['bindings'][name]
            parent = next((s for s in self.scopes if s['id'] == current['parent']), None)
            # Python methods and comprehensions do not close over class bindings.
            if parent and parent['kind'] == 'class' and current['kind'] in ('function', 'comprehension'):
                parent = next((s for s in self.scopes if s['id'] == parent['parent']), None)
            current = parent
        return None

    def enter(self, node, name, kind):
        parent = self.scope
        scope = {'id': f'{self.path}:{node.lineno}:{node.col_offset}:{name}', 'name': name, 'kind': kind, 'parent': parent['id'], 'line': node.lineno, 'endLine': node.end_lineno, 'bindings': {}, 'globals': set(), 'nonlocals': set()}
        # global/nonlocal declarations apply throughout their block.
        def declarations(n):
            if isinstance(n, ast.Global): scope['globals'].update(n.names)
            elif isinstance(n, ast.Nonlocal): scope['nonlocals'].update(n.names)
            elif not isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)):
                for child in ast.iter_child_nodes(n): declarations(child)
        for statement in getattr(node, 'body', []) if isinstance(getattr(node, 'body', []), list) else []:
            declarations(statement)
        self.scopes.append(scope)
        self.scope = scope
        return parent

    def visit_FunctionDef(self, node):
        symbol = self.bind(node.name, node, 'function', annotation_text(node.returns) if node.returns else None)
        symbol['signature'] = f'{node.name}({ast.unparse(node.args)})'
        symbol['decorators'] = [ast.unparse(d) for d in node.decorator_list]
        for deco in node.decorator_list: self.visit(deco)
        for default in node.args.defaults + [d for d in node.args.kw_defaults if d]: self.visit(default)
        args = node.args.posonlyargs + node.args.args + node.args.kwonlyargs + ([node.args.vararg] if node.args.vararg else []) + ([node.args.kwarg] if node.args.kwarg else [])
        for arg in args:
            if arg.annotation: self.visit_type(arg.annotation)
        if node.returns: self.visit_type(node.returns)
        parent = self.enter(node, node.name, 'function')
        symbol['bodyScopeId'] = self.scope['id']
        for arg in args: self.bind(arg.arg, arg, 'parameter', annotation_text(arg.annotation) if arg.annotation else None)
        for statement in node.body: self.visit(statement)
        self.scope = parent

    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_CythonType(self, node):
        symbol = self.bind(node.name, node, 'type', node.name)
        parent = self.enter(node, node.name, 'class') if node.scoped else None
        if node.scoped: symbol['bodyScopeId'] = self.scope['id']
        for statement in node.body: self.visit(statement)
        if parent: self.scope = parent

    def visit_Lambda(self, node):
        for default in node.args.defaults + [d for d in node.args.kw_defaults if d]: self.visit(default)
        parent = self.enter(node, '<lambda>', 'function')
        for arg in node.args.posonlyargs + node.args.args + node.args.kwonlyargs + ([node.args.vararg] if node.args.vararg else []) + ([node.args.kwarg] if node.args.kwarg else []): self.bind(arg.arg, arg, 'parameter')
        self.visit(node.body)
        self.scope = parent

    def visit_ClassDef(self, node):
        symbol = self.bind(node.name, node, 'class', node.name)
        bases = [ast.unparse(base) for base in node.bases]
        self.classes.append({**symbol, 'bases': bases, 'baseIds': [], 'methods': [s.name for s in node.body if isinstance(s, (ast.FunctionDef, ast.AsyncFunctionDef))]})
        for item in node.bases + node.decorator_list: self.visit(item)
        for keyword in node.keywords: self.visit(keyword.value)
        parent = self.enter(node, node.name, 'class')
        symbol['bodyScopeId'] = self.scope['id']
        for statement in node.body: self.visit(statement)
        self.scope = parent

    def visit_type(self, node):
        before = len(self.references)
        self.annotation_depth += 1
        self.visit(node)
        self.annotation_depth -= 1
        for ref in self.references[before:]: ref['role'] = 'type'

    def visit_Name(self, node):
        if isinstance(node.ctx, ast.Store): self.bind(node.id, node)
        else: self.reference(node.id, node, 'delete' if isinstance(node.ctx, ast.Del) else 'read')

    def visit_Attribute(self, node):
        self.visit(node.value)
        # AST columns are UTF-8 byte offsets; the renderer uses UTF-16 columns.
        marker = ast.Name(id=node.attr, lineno=node.end_lineno, col_offset=node.end_col_offset - len(node.attr.encode('utf-8')), end_lineno=node.end_lineno)
        self.references.append({'name': node.attr, 'expression': ast.unparse(node), 'path': self.path, 'scopeId': self.scope['id'], 'role': 'write' if isinstance(node.ctx, ast.Store) else 'read', 'symbolId': None, **self.location(marker)})

    def visit_Call(self, node):
        if not self.annotation_depth:
            self.calls.append({'expression': ast.unparse(node.func), 'scopeId': self.scope['id'], 'path': self.path, **self.location(node.func)})
        if isinstance(node.func, ast.Name): self.reference(node.func.id, node.func, 'call')
        else:
            self.visit(node.func)
            if isinstance(node.func, ast.Attribute): self.references[-1]['role'] = 'call'
        for arg in node.args: self.visit(arg)
        for keyword in node.keywords: self.visit(keyword.value)

    def infer(self, value):
        if isinstance(value, ast.Constant): return type(value.value).__name__
        if isinstance(value, (ast.List, ast.ListComp)): return 'list'
        if isinstance(value, (ast.Dict, ast.DictComp)): return 'dict'
        if isinstance(value, (ast.Set, ast.SetComp)): return 'set'
        if isinstance(value, ast.Tuple): return 'tuple'
        # A call could be a factory; only annotate constructor-like names as a hint.
        if isinstance(value, ast.Call) and isinstance(value.func, ast.Name) and value.func.id[:1].isupper(): return value.func.id
        return None

    def assign(self, target, value=None, annotation=None):
        if isinstance(target, (ast.Name, ast.Attribute)):
            self.assignments.append({'target': ast.unparse(target), 'value': ast.unparse(value) if value else None, 'annotation': annotation_text(annotation) if annotation else None, 'scopeId': self.scope['id'], **self.location(target)})
        if isinstance(target, ast.Name):
            symbol = self.bind(target.id, target, annotation=annotation_text(annotation) if annotation else None, inferred=self.infer(value))
            for alias in self.aliases:
                if alias['name'] == target.id and alias['scopeId'] == self.scope['id'] and alias['endLine'] is None: alias['endLine'] = target.lineno
            if isinstance(value, (ast.Name, ast.Attribute)):
                self.aliases.append({'name': target.id, 'target': ast.unparse(value), 'symbolId': symbol['id'], 'scopeId': self.scope['id'], 'scopeName': self.scope['name'], 'path': self.path, 'line': target.lineno, 'endLine': None, 'kind': 'assignment'})
        elif isinstance(target, (ast.Tuple, ast.List)):
            values = value.elts if isinstance(value, (ast.Tuple, ast.List)) and len(value.elts) == len(target.elts) else [None] * len(target.elts)
            for item, val in zip(target.elts, values): self.assign(item, val)
        else: self.visit(target)

    def visit_Assign(self, node):
        self.visit(node.value)
        for target in node.targets: self.assign(target, node.value)

    def visit_AnnAssign(self, node):
        self.visit_type(node.annotation)
        if node.value: self.visit(node.value)
        self.assign(node.target, node.value, node.annotation)
        if isinstance(node.target, ast.Name) and ast.unparse(node.annotation) in ('TypeAlias', 'typing.TypeAlias'):
            symbol = next(s for s in self.symbols if s['id'] == self.binding_scope(node.target.id)['bindings'][node.target.id])
            symbol['kind'] = 'type'
            symbol['type'] = annotation_text(node.value) if node.value else 'unknown'

    def visit_AugAssign(self, node):
        if isinstance(node.target, ast.Name): self.reference(node.target.id, node.target)
        self.visit(node.value)
        self.assign(node.target)

    def visit_NamedExpr(self, node):
        self.visit(node.value)
        parent = self.scope
        while self.scope['kind'] == 'comprehension':
            self.scope = next(s for s in self.scopes if s['id'] == self.scope['parent'])
        self.assign(node.target, node.value)
        self.scope = parent

    def visit_Import(self, node):
        for alias in node.names:
            name = alias.asname or alias.name.split('.')[0]
            symbol = self.bind(name, alias, 'import', alias.name)
            self.add_import(name, alias.name if alias.asname else name, symbol, alias)
            self.import_tokens(alias, symbol)

    def visit_ImportFrom(self, node):
        for alias in node.names:
            if alias.name == '*': continue
            name = alias.asname or alias.name
            target = '.' * node.level + (node.module + '.' if node.module else '') + alias.name
            symbol = self.bind(name, alias, 'import', target)
            self.add_import(name, target, symbol, alias)
            if alias.asname:
                self.reference(alias.name, alias, 'import', symbol['id'])['importTarget'] = target

    def import_tokens(self, alias, symbol):
        offset = 0
        parts = alias.name.split('.')
        for i, name in enumerate(parts):
            if alias.asname or i:
                loc = self.location(alias)
                loc['column'] += offset
                self.reference(name, alias, 'import', symbol['id'], loc)['importTarget'] = '.'.join(parts[:i + 1])
            offset += len(name.encode('utf-16-le')) // 2 + 1

    def add_import(self, name, target, symbol, node):
        self.imports.append({'name': name, 'target': target, 'scopeId': self.scope['id'], 'symbolId': symbol['id']})
        for alias in self.aliases:
            if alias['name'] == name and alias['scopeId'] == self.scope['id'] and alias['endLine'] is None: alias['endLine'] = node.lineno
        self.aliases.append({'name': name, 'target': target, 'symbolId': symbol['id'], 'scopeId': self.scope['id'], 'scopeName': self.scope['name'], 'path': self.path, 'line': node.lineno, 'endLine': None, 'kind': 'import'})

    def visit_ExceptHandler(self, node):
        if node.type: self.visit(node.type)
        if node.name: self.bind(node.name, node)
        for statement in node.body: self.visit(statement)

    def visit_MatchAs(self, node):
        if node.pattern: self.visit(node.pattern)
        if node.name: self.bind(node.name, node)

    def visit_MatchStar(self, node):
        if node.name: self.bind(node.name, node)

    def visit_MatchMapping(self, node):
        for item in node.keys + node.patterns: self.visit(item)
        if node.rest: self.bind(node.rest, node)

    def visit_TypeAlias(self, node):
        self.bind(node.name.id, node.name, 'type', ast.unparse(node.value))
        self.visit_type(node.value)

    def comprehension(self, node):
        self.visit(node.generators[0].iter)
        parent = self.enter(node, '<comprehension>', 'comprehension')
        for i, generator in enumerate(node.generators):
            if i: self.visit(generator.iter)
            self.visit(generator.target)
            for cond in generator.ifs: self.visit(cond)
        for field in ('elt', 'key', 'value'):
            if hasattr(node, field): self.visit(getattr(node, field))
        self.scope = parent

    visit_ListComp = comprehension
    visit_SetComp = comprehension
    visit_DictComp = comprehension
    visit_GeneratorExp = comprehension

    def finish(self):
        for ref in self.pending:
            scope = next(s for s in self.scopes if s['id'] == ref['scopeId'])
            ref['symbolId'] = self.resolve(ref['name'], scope)
        counts = Counter(r['symbolId'] for r in self.references if r['role'] != 'declaration')
        for symbol in self.symbols:
            symbol['references'] = counts[symbol['id']]
        for alias in self.aliases:
            scope = next(s for s in self.scopes if s['id'] == alias['scopeId'])
            chain, current, seen = [alias['name']], alias['target'], {alias['name']}
            at_line = alias['line']
            while current not in seen:
                chain.append(current)
                seen.add(current)
                prior = [a for a in self.aliases if a['name'] == current and a['scopeId'] == alias['scopeId'] and a['line'] < at_line and (a['endLine'] is None or a['endLine'] >= at_line)]
                if not prior: break
                current = prior[-1]['target']
                at_line = prior[-1]['line']
            alias['chain'] = chain
            alias['resolved'] = chain[-1]
            alias['targetId'] = self.resolve(alias['target'].split('.')[0], scope)
        for scope in self.scopes:
            scope['globals'] = sorted(scope['globals'])
            scope['nonlocals'] = sorted(scope['nonlocals'])


def analyze(root, stub_paths=(), use_venv=False):
    root = Path(root).resolve()
    if not root.is_dir(): raise ValueError('Repository folder does not exist')
    missing = []
    roots = stub_roots(root, stub_paths, use_venv, missing)
    files, diagnostics, indexed = [], [], set()
    diagnostics.extend({'path': '@stubs', 'line': 1, 'severity': 'warning', 'message': f'Stub folder is unavailable: {directory}'} for directory in missing)
    def scan(scan_root, external=False, number=0):
        for directory, dirs, names in os.walk(scan_root, followlinks=False):
            dirs[:] = sorted(d for d in dirs if d not in EXCLUDED and not Path(directory, d).is_symlink() and (external or Path(directory, d).resolve() not in roots))
            for name in sorted(names):
                if not name.endswith(STUB_SUFFIXES if external else SOURCE_SUFFIXES): continue
                path = Path(directory, name)
                local = path.relative_to(scan_root)
                module = stub_module(scan_root, local) if external else None
                if external and not module: continue
                relative = f'@stubs/{number}-{scan_root.name}/{local.as_posix()}' if external else local.as_posix()
                if external and path.resolve() in indexed: continue
                if path.is_symlink(): continue
                if len(files) >= MAX_FILES:
                    diagnostics.append({'path': relative, 'line': 1, 'severity': 'warning', 'message': f'Index limited to {MAX_FILES} source files.'})
                    break
                try:
                    if path.stat().st_size > MAX_FILE:
                        diagnostics.append({'path': relative, 'line': 1, 'severity': 'warning', 'message': 'Skipped file larger than 2 MB.'})
                        continue
                    with tokenize.open(path) as handle: source = handle.read()
                    index = Indexer(relative, source)
                    try:
                        tree, warnings = parse_source(source, relative)
                        diagnostics.extend({'path': relative, 'line': line, 'severity': 'warning', 'message': message} for line, message in warnings)
                        index.visit(tree)
                        index.finish()
                    except SyntaxError as exc:
                        diagnostics.append({'path': relative, 'line': exc.lineno or 1, 'severity': 'error', 'message': exc.msg})
                    indexed.add(path.resolve())
                    files.append({'path': relative, **({'external': True, 'module': module, 'absolutePath': str(path.resolve()), 'sourceRoot': str(scan_root)} if external else {}), 'language': 'cython' if relative.endswith(('.pyx', '.pxd', '.pxi')) else 'python', 'source': source, 'lines': len(source.splitlines()), 'symbols': index.symbols, 'references': index.references, 'aliases': index.aliases, 'classes': index.classes, 'scopes': [{k: sorted(v) if isinstance(v, set) else v for k, v in s.items() if k != 'bindings'} for s in index.scopes], 'imports': index.imports, 'calls': index.calls, 'assignments': index.assignments})
                except (OSError, UnicodeError, RecursionError, ValueError) as exc:
                    diagnostics.append({'path': relative, 'line': 1, 'severity': 'error', 'message': str(exc)})
            if len(files) >= MAX_FILES: break
    scan(root)
    for number, stub_root in enumerate(roots, 1):
        scan(stub_root, external=True, number=number)
    link_repository(files)
    link_definitions(files)
    track_classes(files)
    call_graph = link_calls(files)
    return {'name': root.name, 'root': str(root), 'stubOptions': {'paths': list(stub_paths), 'useVenv': use_venv}, 'stubRoots': [str(p) for p in roots], 'files': files, 'diagnostics': diagnostics, 'callGraph': call_graph, 'stats': {'files': len(files), 'lines': sum(f['lines'] for f in files), 'symbols': sum(len(f['symbols']) for f in files), 'classes': sum(len(f['classes']) for f in files), 'calls': len(call_graph['sites'])}}


def link_repository(files):
    exports = {}
    by_file = {f['path']: f for f in files}
    by_id = {s['id']: s for f in files for s in f['symbols']}
    for file in files:
        module = file.get('module') or file['path'].rsplit('.', 1)[0].replace('/', '.')
        if module.endswith('.__init__'): module = module[:-9]
        file['module'] = module
        for symbol in file['symbols']:
            if symbol['scopeName'] == '<module>':
                for import_module in dict.fromkeys((module, module.removeprefix('src.'))):
                    key = f"{import_module}.{symbol['name']}"
                    if key not in exports or index_priority(file) > index_priority(by_file[by_id[exports[key]]['path']]): exports[key] = symbol['id']

    def qualified(file, target):
        if not target.startswith('.'): return target
        count = len(target) - len(target.lstrip('.'))
        parts = file['module'].split('.')
        if Path(file['path']).stem != '__init__': parts = parts[:-1]
        return '.'.join(parts[:max(0, len(parts) - count + 1)] + [target.lstrip('.')])

    def resolve(file, name, scope_id, line, seen=None):
        seen = set() if seen is None else seen
        if name in seen: return None
        seen.add(name)
        head, _, tail = name.partition('.')
        scope = next((s for s in file['scopes'] if s['id'] == scope_id), None)
        while scope:
            aliases = [a for a in file['aliases'] if a['name'] == head and a['scopeId'] == scope['id'] and a['line'] <= line and (a['endLine'] is None or a['endLine'] > line)]
            if aliases:
                alias = aliases[-1]
                target = alias['resolved'] + ('.' + tail if tail else '')
                alias_key = (scope['id'], head, alias['line'])
                if alias_key in seen: return None
                seen.add(alias_key)
                hit = exports.get(qualified(file, target))
                if hit: return hit
                return resolve(file, target, scope['id'], alias['line'] - (1 if alias['kind'] == 'assignment' else 0), seen)
            symbols = [s for s in file['symbols'] if s['name'] == name and s['scopeId'] == scope['id'] and s['kind'] in ('class', 'type')]
            if symbols: return symbols[0]['id']
            scope = next((s for s in file['scopes'] if s['id'] == scope['parent']), None)
        return exports.get(qualified(file, name))

    for file in files:
        for cls in file['classes']:
            cls['baseIds'] = [resolve(file, base.split('[')[0], cls['scopeId'], cls['line']) for base in cls['bases']]
        for symbol in file['symbols']:
            annotation = symbol['type'].strip("'\"")
            try:
                expression = ast.parse(annotation, mode='eval').body
                names = [ast.unparse(n) for n in ast.walk(expression) if isinstance(n, (ast.Name, ast.Attribute))]
            except SyntaxError: names = [annotation]
            symbol['typeTargets'] = list(dict.fromkeys(target for name in names if (target := resolve(file, name, symbol['scopeId'], symbol['line']))))
        for alias in file['aliases']:
            target = resolve(file, alias['resolved'], alias['scopeId'], alias['line'])
            if target: alias['targetId'] = target


if __name__ == '__main__':
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
        parser = argparse.ArgumentParser(description=__doc__)
        parser.add_argument('repository')
        parser.add_argument('--stub-path', action='append', default=[])
        parser.add_argument('--use-venv', action='store_true')
        args = parser.parse_args()
        print(json.dumps(analyze(args.repository, args.stub_path, args.use_venv), ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({'error': str(exc)}))
        sys.exit(1)
