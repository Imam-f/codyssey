# /// script
# requires-python = ">=3.12"
# dependencies = ["Cython==3.2.4"]
# ///
"""Read a watched canvas file and map line ranges without executing its code."""
import difflib
import json
import sys
import tokenize
from declaration import declarations
from cython_parser import parse_source


def snapshot(file, previous):
    with tokenize.open(file) as handle:
        source = handle.read()
    try:
        tree, _ = parse_source(source, str(file))
    except SyntaxError as error:
        return {'status': 'stale', 'message': f'Syntax error on line {error.lineno}; showing the last valid version.'}
    symbols = []
    for chain, node in declarations(tree):
        symbols.append({
            'chain': [{'kind': kind, 'name': name} for kind, name in chain],
            'line': min([node.lineno] + [item.lineno for item in node.decorator_list]),
            'endLine': node.end_lineno,
        })
    return {
        'status': 'found', 'source': source, 'declarations': symbols,
        'changes': difflib.SequenceMatcher(None, previous.splitlines(), source.splitlines(), autojunk=False).get_opcodes(),
    }


if __name__ == '__main__':
    try:
        request = json.load(sys.stdin)
        print(json.dumps(snapshot(sys.argv[1], request.get('source', ''))))
    except (OSError, UnicodeError, ValueError) as error:
        print(json.dumps({'status': 'error', 'message': str(error)}))
