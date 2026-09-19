"""Conservative static call targets. No imports or execution of indexed code."""
import ast
from collections import defaultdict


class CallResolver:
    def __init__(self, files):
        self.files = {f['path']: f for f in files}
        self.symbols = {s['id']: s for f in files for s in f['symbols']}
        self.scopes = {s['id']: s for f in files for s in f['scopes']}
        self.scope_files = {s['id']: f for f in files for s in f['scopes']}
        self.owners = {s['bodyScopeId']: s for s in self.symbols.values() if s.get('bodyScopeId')}
        self.bindings = defaultdict(dict)
        self.exports = {}
        self.classes = {c['id']: c for f in files for c in f['classes']}
        self.assignments = defaultdict(list)
        self.aliases = defaultdict(list)
        for f in files:
            for s in f['symbols']:
                self.bindings[s['scopeId']][s['name']] = s
                if s['scopeName'] == '<module>':
                    self.exports[f"{f['module']}.{s['name']}"] = s
                    if f['module'].startswith('src.'):
                        self.exports[f"{f['module'][4:]}.{s['name']}"] = s
            for a in f['assignments']:
                self.assignments[(a['scopeId'], a['target'])].append(a)
            for a in f['aliases']:
                self.aliases[(a['scopeId'], a['name'])].append(a)

    def class_owner(self, scope_id):
        scope = self.scopes.get(scope_id)
        while scope:
            if scope['kind'] == 'class': return self.owners.get(scope['id'])
            scope = self.scopes.get(scope['parent'])
        return None

    def mro(self, class_id, trail=()):
        if class_id in trail: return []
        cls = self.classes.get(class_id)
        if not cls: return []
        # Unresolved bases make inherited dispatch uncertain.
        if any(base is None for base in cls['baseIds']): return [class_id]
        bases = cls['baseIds']
        sequences = [self.mro(base, trail + (class_id,))[:] for base in bases] + [bases[:]]
        result = [class_id]
        while any(sequences):
            sequences = [seq for seq in sequences if seq]
            candidate = next((seq[0] for seq in sequences if all(seq[0] not in other[1:] for other in sequences)), None)
            if candidate is None: return [class_id]
            result.append(candidate)
            for seq in sequences:
                if seq[0] == candidate: seq.pop(0)
        return result

    def method(self, class_id, name, skip_self=False):
        for owner_id in self.mro(class_id)[1 if skip_self else 0:]:
            owner = self.symbols[owner_id]
            member = self.bindings[owner.get('bodyScopeId')].get(name)
            if member:
                if 'property' in member.get('decorators', []): return None
                return ('function', member['id']) if member['kind'] == 'function' else None
        return None

    def qualify(self, file, name):
        if not name.startswith('.'): return name
        level = len(name) - len(name.lstrip('.'))
        parts = file['module'].split('.')
        if not file['path'].endswith(('__init__.py', '__init__.pyi')): parts.pop()
        return '.'.join(parts[:max(0, len(parts) - level + 1)] + [name.lstrip('.')])

    def imported(self, name, file, seen):
        qualified = self.qualify(file, name)
        symbol = self.exports.get(qualified)
        if symbol:
            return self.symbol_value(symbol, float('inf'), seen)
        return ('module', qualified)

    def symbol_value(self, symbol, at, seen):
        scope_id, name = symbol['scopeId'], symbol['name']
        key = (symbol['id'], at)
        if key in seen or len(seen) > 40: return None
        seen = seen | {key}
        scope = self.scopes[scope_id]
        writes = [a for a in self.assignments[(scope_id, name)] if a['line'] <= at]
        aliases = [a for a in self.aliases[(scope_id, name)] if a['kind'] == 'import' and a['line'] <= at]
        latest_write = writes[-1] if writes else None
        latest_import = aliases[-1] if aliases else None
        if latest_import and (not latest_write or latest_import['line'] > latest_write['line']):
            return self.imported(latest_import['target'], self.scope_files[scope_id], seen)
        if latest_write:
            # RHS is evaluated before this binding is replaced.
            value = self.expression(latest_write['value'], scope_id, latest_write['line'] - 0.5, seen)
            if value: return value
            annotation = latest_write['annotation']
            if annotation:
                target = self.expression(annotation.strip("'\""), scope_id, at, seen)
                if target and target[0] == 'class': return ('instance', target[1])
            return None
        if symbol['kind'] in ('function', 'class'):
            # Function locals exist throughout the block; module/class bindings
            # must have been defined before an immediately executed call.
            if at < symbol['line'] and scope['kind'] != 'function': return None
            return (symbol['kind'], symbol['id'])
        if symbol['kind'] == 'parameter':
            owner = self.owners.get(scope_id)
            class_owner = self.class_owner(scope_id)
            if name in ('self', 'cls') and owner and class_owner and owner['scopeId'] == class_owner.get('bodyScopeId') and 'staticmethod' not in owner.get('decorators', []):
                return ('class' if name == 'cls' else 'instance', class_owner['id'])
            targets = self.scalar_types(symbol)
            if len(targets) == 1: return ('instance', targets[0])
        return None

    def scalar_types(self, symbol):
        try: annotation = ast.parse(symbol['type'].strip("'\""), mode='eval').body
        except SyntaxError: return []
        # A list[User] annotation describes a container, not a User receiver.
        if not isinstance(annotation, (ast.Name, ast.Attribute)):
            return []
        return [t for t in symbol.get('typeTargets', []) if t in self.classes]

    def lookup(self, name, scope_id, at, seen):
        scope = self.scopes.get(scope_id)
        while scope:
            if name in scope.get('globals', []):
                scope = self.scope_files[scope['id']]['scopes'][0]
            symbol = self.bindings[scope['id']].get(name)
            if symbol and name not in scope.get('nonlocals', []):
                return self.symbol_value(symbol, at, seen)
            parent = self.scopes.get(scope['parent'])
            if parent and parent['kind'] == 'class' and scope['kind'] in ('function', 'comprehension'):
                parent = self.scopes.get(parent['parent'])
            # An enclosing scope's final bindings are a static approximation
            # of values seen when a function is called.
            if scope['kind'] == 'function': at = float('inf')
            scope = parent
        return None

    def expression(self, text, scope_id, at, seen=frozenset()):
        if not text: return None
        try: node = ast.parse(text, mode='eval').body
        except (SyntaxError, RecursionError): return None
        return self.node_value(node, scope_id, at, seen)

    def node_value(self, node, scope_id, at, seen):
        if len(seen) > 40: return None
        if isinstance(node, ast.Name): return self.lookup(node.id, scope_id, at, seen)
        if isinstance(node, ast.Attribute):
            if isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Name) and node.value.func.id == 'super' and not node.value.args:
                owner = self.class_owner(scope_id)
                return self.method(owner['id'], node.attr, skip_self=True) if owner else None
            receiver = self.node_value(node.value, scope_id, at, seen)
            if not receiver: return None
            kind, target = receiver
            if kind == 'module': return self.imported(target + '.' + node.attr, self.scope_files[scope_id], seen)
            if kind in ('instance', 'class'):
                method = self.method(target, node.attr)
                if method: return method
                # Resolve explicitly assigned instance fields in __init__.
                initializer = self.method(target, '__init__')
                if initializer:
                    init_scope = self.symbols[initializer[1]]['bodyScopeId']
                    field_key = ('field', target, node.attr)
                    if field_key in seen: return None
                    writes = self.assignments[(init_scope, 'self.' + node.attr)]
                    if writes:
                        write = writes[-1]
                        value = self.expression(write['value'], init_scope, write['line'], seen | {field_key})
                        if value: return value
                        value = self.expression(write['annotation'], init_scope, write['line'], seen | {field_key})
                        if value and value[0] == 'class': return ('instance', value[1])
            return None
        if isinstance(node, ast.Call):
            target = self.node_value(node.func, scope_id, at, seen)
            if target and target[0] == 'class': return ('instance', target[1])
            # Only use an explicit return annotation, not a factory-name guess.
            if target and target[0] == 'function':
                fn = self.symbols[target[1]]
                types = self.scalar_types(fn)
                if len(types) == 1 and fn['typeSource'] == 'annotation': return ('instance', types[0])
        return None

    def caller(self, scope_id):
        scope = self.scopes[scope_id]
        while scope['kind'] == 'comprehension': scope = self.scopes[scope['parent']]
        owner = self.owners.get(scope['id'])
        if owner and owner['kind'] == 'function': return owner['id']
        return 'context:' + scope['id']

    def build(self):
        nodes = {}
        for symbol in self.symbols.values():
            if symbol['kind'] == 'function':
                names = [symbol['name']]
                scope = self.scopes.get(symbol['scopeId'])
                while scope and scope['kind'] != 'module':
                    names.insert(0, scope['name'])
                    scope = self.scopes.get(scope['parent'])
                nodes[symbol['id']] = {**symbol, 'label': '.'.join(names), 'external': False}
        sites, edges = [], {}
        for file in self.files.values():
            for call in file['calls']:
                caller = self.caller(call['scopeId'])
                if caller not in nodes:
                    scope = self.scopes[caller.removeprefix('context:')]
                    nodes[caller] = {'id': caller, 'name': scope['name'], 'label': scope['name'] if scope['kind'] != 'module' else file['path'] + ' · module', 'kind': 'context', 'path': file['path'], 'line': scope['line'], 'external': False}
                result = self.expression(call['expression'], call['scopeId'], call['line'])
                resolved = result and result[0] in ('function', 'class')
                target_id = result[1] if resolved else f"unresolved:{caller}:{call['expression']}"
                kind = 'call'
                if resolved and result[0] == 'class':
                    initializer = self.method(target_id, '__init__')
                    kind = 'constructor'
                    if initializer: target_id = initializer[1]
                    elif target_id not in nodes:
                        cls = self.symbols[target_id]
                        nodes[target_id] = {**cls, 'label': cls['name'] + '()', 'external': False}
                if not resolved:
                    nodes[target_id] = {'id': target_id, 'name': call['expression'], 'label': call['expression'], 'kind': 'unresolved', 'external': True}
                site = {**call, 'id': f"{call['path']}:{call['line']}:{call['column']}:{len(sites)}", 'callerId': caller, 'targetId': target_id, 'resolved': bool(resolved), 'kind': kind}
                sites.append(site)
                key = (caller, target_id)
                edge = edges.setdefault(key, {'from': caller, 'to': target_id, 'sites': [], 'resolved': bool(resolved)})
                edge['sites'].append(site['id'])
        return {'nodes': list(nodes.values()), 'edges': list(edges.values()), 'sites': sites}


def link_calls(files):
    return CallResolver(files).build()
