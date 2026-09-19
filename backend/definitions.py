"""Link source identifiers to indexed definitions without executing imports."""
import ast
from callgraph import CallResolver


class DefinitionResolver(CallResolver):
    def __init__(self, files):
        super().__init__(files)
        self.modules = {}
        for file in files:
            for name in (file['module'], file['module'].removeprefix('src.')):
                # Prefer source over a stub when both are indexed.
                if name not in self.modules or file['path'].endswith('.py'):
                    self.modules[name] = file

    @staticmethod
    def destination(symbol):
        return {k: symbol[k] for k in ('id', 'name', 'kind', 'path', 'line', 'column')}

    def imported_definition(self, name, file, seen=frozenset()):
        qualified = self.qualify(file, name)
        key = ('import', qualified)
        if key in seen or len(seen) > 60: return None
        seen = seen | {key}
        symbol = self.exports.get(qualified)
        if symbol:
            return self.symbol_definition(symbol, float('inf'), seen)
        module = self.modules.get(qualified)
        if module:
            return {'id': None, 'name': qualified, 'kind': 'module', 'path': module['path'], 'line': 1, 'column': 0}
        # A package may re-export a module or class used in a dotted access.
        parts = qualified.split('.')
        for length in range(len(parts) - 1, 0, -1):
            exported = self.exports.get('.'.join(parts[:length]))
            if not exported: continue
            target = self.symbol_definition(exported, float('inf'), seen)
            if not target: return None
            tail = parts[length:]
            if target['kind'] == 'module':
                return self.imported_definition(target['name'] + '.' + '.'.join(tail), file, seen)
            for member_name in tail:
                target = self.member_definition(target['id'], member_name, seen)
                if not target: return None
            return target
        return None

    def symbol_definition(self, symbol, at, seen=frozenset()):
        key = ('symbol', symbol['id'], at)
        if key in seen or len(seen) > 60: return None
        seen = seen | {key}
        imports = [a for a in self.aliases[(symbol['scopeId'], symbol['name'])] if a['kind'] == 'import' and a['line'] <= at]
        writes = [a for a in self.assignments[(symbol['scopeId'], symbol['name'])] if a['line'] <= at]
        if imports and (not writes or imports[-1]['line'] > writes[-1]['line']):
            return self.imported_definition(imports[-1]['target'], self.files[symbol['path']], seen)
        if writes and symbol['kind'] == 'import':
            # A reassigned import is now a local binding, not the original export.
            write = writes[-1]
            return {**self.destination(symbol), 'line': write['line'], 'column': write['column'], 'kind': 'variable'}
        if symbol['kind'] == 'import': return None
        return self.destination(symbol)

    def member_definition(self, class_id, name, seen):
        if class_id not in self.classes: return None
        for owner_id in self.mro(class_id):
            owner = self.symbols[owner_id]
            member = self.bindings[owner.get('bodyScopeId')].get(name)
            if member: return self.symbol_definition(member, float('inf'), seen)
        # Instance fields retain an exact assignment location even without a
        # standalone symbol. Do not mistake the field's type for its definition.
        initializer = self.method(class_id, '__init__')
        if initializer:
            method = self.symbols[initializer[1]]
            writes = self.assignments[(method['bodyScopeId'], 'self.' + name)]
            if writes:
                write = writes[0]
                return {'id': None, 'name': name, 'kind': 'attribute', 'path': method['path'], 'line': write['line'], 'column': write['column']}
        return None

    def expression_definition(self, expression, scope_id, at, seen=frozenset()):
        try: node = ast.parse(expression, mode='eval').body
        except (SyntaxError, RecursionError): return None
        if isinstance(node, ast.Name):
            scope = self.scopes.get(scope_id)
            while scope:
                if node.id in scope.get('globals', []): scope = self.scope_files[scope['id']]['scopes'][0]
                symbol = self.bindings[scope['id']].get(node.id)
                if symbol and node.id not in scope.get('nonlocals', []):
                    return self.symbol_definition(symbol, at, seen)
                parent = self.scopes.get(scope['parent'])
                if parent and parent['kind'] == 'class' and scope['kind'] in ('function', 'comprehension'):
                    parent = self.scopes.get(parent['parent'])
                if scope['kind'] == 'function': at = float('inf')
                scope = parent
            return None
        if isinstance(node, ast.Attribute):
            if isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Name) and node.value.func.id == 'super' and not node.value.args:
                value = self.node_value(node, scope_id, at, frozenset())
                return self.destination(self.symbols[value[1]]) if value and value[1] in self.symbols else None
            receiver = self.node_value(node.value, scope_id, at, frozenset())
            if receiver:
                kind, target = receiver
                if kind == 'module':
                    return self.imported_definition(target + '.' + node.attr, self.scope_files[scope_id], seen)
                if kind in ('class', 'instance'):
                    return self.member_definition(target, node.attr, seen)
            # Re-exported classes/type aliases may lack a runtime value hint.
            target = self.expression_definition(ast.unparse(node.value), scope_id, at, seen)
            if target and target['kind'] == 'class':
                return self.member_definition(target['id'], node.attr, seen)
        return None

    def link(self):
        # Repair type and inheritance links through package re-exports and src/.
        for file in self.files.values():
            for cls in file['classes']:
                for i, base in enumerate(cls['bases']):
                    target = self.expression_definition(base.split('[')[0], cls['scopeId'], cls['line'])
                    if target and target['kind'] == 'class': cls['baseIds'][i] = target['id']
            for symbol in file['symbols']:
                symbol['definition'] = self.symbol_definition(symbol, symbol['line'])
                try: annotation = ast.parse(symbol['type'].strip("'\""), mode='eval').body
                except SyntaxError: continue
                targets = []
                for node in ast.walk(annotation):
                    if isinstance(node, (ast.Name, ast.Attribute)):
                        target = self.expression_definition(ast.unparse(node), symbol['scopeId'], float('inf'))
                        if target and target['kind'] in ('class', 'type'): targets.append(target['id'])
                if targets: symbol['typeTargets'] = list(dict.fromkeys(targets))
        for file in self.files.values():
            for ref in file['references']:
                if ref.get('importTarget'):
                    target = self.imported_definition(ref['importTarget'], file)
                elif ref.get('expression'):
                    target = self.expression_definition(ref['expression'], ref['scopeId'], ref['line'])
                elif ref['symbolId']:
                    symbol = self.symbols[ref['symbolId']]
                    if ref['role'] in ('declaration', 'write', 'delete'):
                        target = self.symbol_definition(symbol, ref['line']) if symbol['kind'] == 'import' else self.destination(symbol)
                    else:
                        target = self.expression_definition(ref['name'], ref['scopeId'], ref['line'])
                else: target = None
                ref['definition'] = target
                if ref.get('expression') and target: ref['symbolId'] = target['id']


def link_definitions(files):
    DefinitionResolver(files).link()
