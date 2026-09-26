# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Read one Python declaration without importing the inspected file."""
import ast
import json
import sys
from pathlib import Path


def declarations(tree):
    found = []

    def walk(node, parents):
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
                kind = 'class' if isinstance(child, ast.ClassDef) else 'function'
                chain = parents + [(kind, child.name)]
                found.append((chain, child))
                walk(child, chain)
            else:
                walk(child, parents)

    walk(tree, [])
    return found


def main():
    path = Path(sys.argv[1])
    target = json.loads(sys.argv[2])
    source = path.read_text(encoding='utf-8-sig')
    try:
        tree = ast.parse(source, filename=str(path))
    except SyntaxError as error:
        return {'status': 'invalid', 'message': f'Syntax error on line {error.lineno}; showing the last valid version.'}
    chain = [(item['kind'], item['name']) for item in target['chain']]
    matches = [node for ancestry, node in declarations(tree) if ancestry == chain]
    if not matches:
        return {'status': 'missing', 'message': 'Declaration is no longer in this file.'}
    node = min(matches, key=lambda item: abs(item.lineno - target['line']))
    start = min([node.lineno] + [item.lineno for item in node.decorator_list])
    lines = source.splitlines()
    return {
        'status': 'found',
        'line': start,
        'endLine': node.end_lineno,
        'source': '\n'.join(lines[start - 1:node.end_lineno]),
    }


if __name__ == '__main__':
    try:
        print(json.dumps(main()))
    except (OSError, UnicodeError, ValueError) as error:
        print(json.dumps({'status': 'error', 'message': str(error)}))
