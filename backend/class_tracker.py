"""Track class members and their inheritance relationships."""
import ast
from collections import defaultdict

from callgraph import CallResolver


def _is_property(symbol):
    for decorator in symbol.get('decorators', []):
        name = decorator.rsplit('.', 1)[-1]
        if name in ('property', 'cached_property', 'setter', 'deleter', 'getter'):
            return True
    return False


def _member(cls, name, kind, path, line, column, symbol_id=None, defined_in='class body', initializers=None):
    return {
        'name': name,
        'kind': kind,
        'ownerId': cls['id'],
        'ownerName': cls['name'],
        'path': path,
        'line': line,
        'column': column,
        'symbolId': symbol_id,
        'definedIn': defined_in,
        'initializers': initializers or [],
        'dynamic': False,
    }


def _field_symbol(cls, name, write, scope_id, field_type='unknown', type_source='unknown'):
    """Create the indexed symbol used by instance-field references.

    Instance attributes do not have a standalone AST binding, but they are
    still members with a stable declaration location. Giving them a symbol id
    lets definition resolution and the source inspector treat them like class
    properties, including when the member is inherited.
    """
    symbol_id = f"{cls['id']}:property:{name}"
    return {
        'id': symbol_id,
        'name': name,
        'kind': 'property',
        'path': write['path'],
        'scopeId': scope_id,
        'scopeName': cls['name'],
        'type': field_type,
        'typeSource': type_source,
        'line': write['line'],
        'column': write['column'],
        'endLine': write.get('endLine', write['line']),
        'references': 0,
        'typeTargets': [],
    }


def track_classes(files):
    """Attach direct, overridden, inherited, and dynamic members to classes."""
    resolver = CallResolver(files)
    symbols = resolver.symbols
    symbols_by_scope = defaultdict(list)
    for symbol in symbols.values():
        symbols_by_scope[symbol['scopeId']].append(symbol)
    assignments = defaultdict(list)
    for file in files:
        for assignment in file['assignments']:
            assignments[assignment['scopeId']].append((file['path'], assignment))

    local = {}
    for cls in resolver.classes.values():
        class_symbol = symbols[cls['id']]
        class_scope = class_symbol.get('bodyScopeId')
        members = {}
        methods = [symbol for symbol in symbols_by_scope[class_scope] if symbol['kind'] == 'function']
        for symbol in methods:
            kind = 'property' if _is_property(symbol) else 'method'
            members[symbol['name']] = _member(
                cls, symbol['name'], kind, symbol['path'], symbol['line'],
                symbol['column'], symbol['id'], '@property' if kind == 'property' else 'class body'
            )

        for path, assignment in assignments[class_scope]:
            try:
                target = ast.parse(assignment['target'], mode='eval').body
            except (SyntaxError, RecursionError):
                continue
            if not isinstance(target, ast.Name):
                continue
            symbol = resolver.bindings[class_scope].get(target.id)
            members[target.id] = _member(
                cls, target.id, 'property', path, assignment['line'],
                assignment['column'], symbol['id'] if symbol else None
            )

        property_writes = defaultdict(list)
        for method in methods:
            if any(decorator.rsplit('.', 1)[-1] in ('staticmethod', 'classmethod') for decorator in method.get('decorators', [])):
                continue
            parameters = sorted(
                (symbol for symbol in symbols_by_scope[method.get('bodyScopeId')]
                 if symbol['kind'] == 'parameter'),
                key=lambda symbol: (symbol['line'], symbol['column']),
            )
            if not parameters:
                continue
            receiver = parameters[0]['name']
            for path, assignment in assignments[method.get('bodyScopeId')]:
                try:
                    target = ast.parse(assignment['target'], mode='eval').body
                except (SyntaxError, RecursionError):
                    continue
                if not (isinstance(target, ast.Attribute) and isinstance(target.value, ast.Name) and target.value.id == receiver):
                    continue
                property_writes[target.attr].append({
                    'method': method['name'],
                    'methodId': method['id'],
                    'path': path,
                    'line': assignment['line'],
                    'column': assignment['column'] + len(receiver) + 1,
                    'value': assignment.get('value'),
                    'annotation': assignment.get('annotation'),
                })

        for name, writes in property_writes.items():
            stable = next((write for write in writes if write['method'] == '__init__'), None)
            existing = members.get(name)
            if existing:
                existing['initializers'].extend(writes)
                continue
            first = stable or writes[0]
            field_symbol_id = f"{cls['id']}:property:{name}"
            field_type = first.get('annotation') or 'unknown'
            field_type_source = 'annotation' if first.get('annotation') else 'unknown'
            if not first.get('annotation'):
                method_scope = symbols[first['methodId']].get('bodyScopeId')
                parameters = {
                    symbol['name']: symbol
                    for symbol in symbols_by_scope[method_scope]
                    if symbol['kind'] == 'parameter'
                }
                value_symbol = parameters.get(first.get('value'))
                if value_symbol:
                    field_type = value_symbol.get('type', 'unknown')
                    field_type_source = value_symbol.get('typeSource', 'unknown')
            file = resolver.files[first['path']]
            if not any(symbol['id'] == field_symbol_id for symbol in file['symbols']):
                file['symbols'].append(
                    _field_symbol(cls, name, first, class_scope, field_type, field_type_source)
                )
            member = _member(
                cls, name, 'property', first['path'], first['line'], first['column'],
                symbol_id=field_symbol_id, defined_in=first['method'], initializers=writes
            )
            member['dynamic'] = stable is None
            members[name] = member
        local[cls['id']] = members

    for cls in resolver.classes.values():
        own = local[cls['id']]
        inherited = {}
        ancestors = resolver.mro(cls['id'])[1:]
        for ancestor_id in ancestors:
            for name, member in local.get(ancestor_id, {}).items():
                if name not in own and name not in inherited:
                    inherited[name] = {
                        **member,
                        'relationship': 'inherited',
                        'inheritedFrom': member['ownerName'],
                    }

        ancestor_names = {name for ancestor_id in ancestors for name in local.get(ancestor_id, {})}
        direct = []
        for member in own.values():
            direct.append({
                **member,
                'relationship': 'overridden' if member['name'] in ancestor_names else 'added',
            })
        all_members = direct + list(inherited.values())
        cls['memberTracker'] = {
            'members': all_members,
            'addedMethods': [m for m in direct if m['kind'] == 'method' and m['relationship'] == 'added'],
            'overriddenMethods': [m for m in direct if m['kind'] == 'method' and m['relationship'] == 'overridden'],
            'inheritedMethods': [m for m in inherited.values() if m['kind'] == 'method'],
            'addedProperties': [m for m in direct if m['kind'] == 'property' and m['relationship'] == 'added'],
            'overriddenProperties': [m for m in direct if m['kind'] == 'property' and m['relationship'] == 'overridden'],
            'inheritedProperties': [m for m in inherited.values() if m['kind'] == 'property'],
            'dynamicProperties': [m for m in direct if m['kind'] == 'property' and m['dynamic']],
        }
