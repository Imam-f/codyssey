"""Adapt Cython's syntax tree for the Python indexer; never run compilation passes.

Only parsing is performed: cimports and includes are recorded, not loaded.
The compiler dependency is pinned in the entry scripts because its AST is internal.
"""
import ast
import io
import re
import tokenize
from contextlib import redirect_stderr
from types import SimpleNamespace

CYTHON_SUFFIXES = ('.pyx', '.pxd', '.pxi')
SOURCE_SUFFIXES = ('.py', '.pyi', *CYTHON_SUFFIXES)


class Group(ast.AST):
    _fields = ('body',)

    def __init__(self, body):
        self.body = body


class CythonType(ast.AST):
    _fields = ('body',)

    def __init__(self, name, body, scoped=True):
        self.name, self.body, self.scoped = name, body, scoped


class Adapter:
    def __init__(self, source):
        self.lines = source.splitlines()
        self.warnings = []

    def loc(self, result, node, name=None):
        _, line, column = node.pos
        text = self.lines[line - 1] if line <= len(self.lines) else ''
        if name:
            match = re.search(r'\b' + re.escape(name) + r'\b', text[column:])
            if match:
                column += match.start()
        result.lineno = line
        result.col_offset = len(text[:column].encode('utf-8'))
        result.end_lineno = max([line] + [getattr(n, 'end_lineno', None) or line for n in ast.walk(result)])
        end_text = self.lines[result.end_lineno - 1] if result.end_lineno <= len(self.lines) else ''
        result.end_col_offset = len(end_text.encode('utf-8'))
        if isinstance(result, ast.Name):
            result.end_col_offset = result.col_offset + len(result.id.encode('utf-8'))
        if isinstance(result, ast.Attribute):
            # AttributeNode.pos points at the dot, not at its receiver.
            result.lineno = result.value.lineno
            result.col_offset = result.value.col_offset
            result.end_lineno = line
            result.end_col_offset = len(text[:column + 1 + len(result.attr)].encode('utf-8'))
        return result

    def children(self, node):
        for key in node.child_attrs:
            value = getattr(node, key, None)
            for child in value if isinstance(value, list) else [value]:
                if child is not None:
                    yield child

    def body(self, node):
        if node is None:
            return []
        if type(node).__name__ == 'StatListNode':
            result = []
            for child in node.stats:
                converted = self.convert(child)
                result.extend(converted.body if type(child).__name__ in ('CVarDefNode', 'StatListNode') else [converted])
            return result
        converted = self.convert(node)
        return converted.body if type(node).__name__ == 'CVarDefNode' else [converted]

    def declarator(self, node):
        while hasattr(node, 'base'):
            node = node.base
        return node

    def type_text(self, node):
        if node is None:
            return None
        line, col = node.pos[1:]
        # Cython keeps the complete type spelling between the base type and
        # declarator, including memoryviews, qualifiers and pointer markers.
        return getattr(node, 'name', None) or self.lines[line - 1][col:].split(' ', 1)[0]

    def annotation(self, base, declarator=None):
        start = base
        while type(start).__name__ in ('MemoryViewSliceTypeNode', 'CComplexBaseTypeNode'):
            start = min(self.children(start), key=lambda child: child.pos[1:])
        if declarator is not None and start.pos[1] == declarator.pos[1]:
            text = self.lines[start.pos[1] - 1][start.pos[2]:declarator.pos[2]].strip()
        else:
            text = self.type_text(start)
        if not text or text == 'object':
            return None
        result = self.loc(ast.Name(id=text, ctx=ast.Load()) if text.isidentifier() else ast.Constant(value=text), start)
        result.cython_type = text
        return result

    def function(self, node, declaration=False):
        cfunc = type(node).__name__ != 'DefNode'
        func = node.declarator if cfunc else node
        name_node = self.declarator(func.base) if cfunc else node
        name = name_node.name if cfunc else node.name
        arguments, defaults, kwonlyargs, kw_defaults = [], [], [], []
        for arg in func.args:
            dec = self.declarator(arg.declarator)
            arg_name = dec.name or self.type_text(arg.base_type)
            annotation = self.convert(getattr(arg, 'annotation', None)) or (self.annotation(arg.base_type, dec) if dec.name else None)
            parameter = self.loc(ast.arg(arg=arg_name, annotation=annotation), dec if dec.name else arg.base_type)
            default = getattr(arg, 'default', None)
            if getattr(arg, 'kw_only', False):
                kwonlyargs.append(parameter)
                kw_defaults.append(self.convert(default))
            else:
                arguments.append(parameter)
                if default is not None:
                    defaults.append(self.convert(default))
        posonly_count = getattr(node, 'num_posonly_args', 0)
        args = ast.arguments(posonlyargs=arguments[:posonly_count], args=arguments[posonly_count:], vararg=None, kwonlyargs=kwonlyargs, kw_defaults=kw_defaults, kwarg=None, defaults=defaults)
        for key, target in (('star_arg', 'vararg'), ('starstar_arg', 'kwarg')):
            arg = getattr(node, key, None)
            if arg is not None:
                setattr(args, target, self.loc(ast.arg(arg=arg.name, annotation=None), arg))
        body = [] if declaration else self.body(getattr(node, 'body', None))
        decorators = [self.convert(getattr(d, 'decorator', d)) for d in (getattr(node, 'decorators', None) or [])]
        returns = self.annotation(node.base_type, name_node) if cfunc else self.convert(getattr(node, 'return_type_annotation', None))
        cls = ast.AsyncFunctionDef if getattr(node, 'is_async_def', False) else ast.FunctionDef
        result = cls(name=name, args=args, body=body, decorator_list=decorators, returns=returns, type_params=[])
        self.loc(result, node)
        # Indexer.location locates the declaration name in the original header.
        if body:
            result.end_lineno = max(result.end_lineno, self.block_end(node.pos[1], node.pos[2]))
        return result

    def block_end(self, line, column):
        last = line
        for row in range(line, len(self.lines)):
            text = self.lines[row]
            if not text.strip() or text.lstrip().startswith('#'):
                continue
            indent = len(text) - len(text.lstrip())
            if indent <= column:
                break
            last = row + 1
        return last

    def convert(self, node):
        if node is None:
            return None
        kind = type(node).__name__
        result = None
        if kind in ('ModuleNode', 'StatListNode'):
            return self.loc(Group(self.body(node.body) if kind == 'ModuleNode' else self.body(node)), node)
        if kind in ('DefNode', 'CFuncDefNode'):
            return self.function(node)
        if kind in ('PyClassDefNode', 'CClassDefNode', 'CppClassNode'):
            name = getattr(node, 'class_name', None) or node.name
            bases = getattr(node, 'bases', None)
            base_nodes = getattr(bases, 'args', bases if isinstance(bases, list) else [])
            result = ast.ClassDef(name=name, bases=[self.convert(b) for b in base_nodes], keywords=[], body=self.body(node.body), decorator_list=[], type_params=[])
            self.loc(result, node)
            result.end_lineno = self.block_end(node.pos[1], node.pos[2])
            return result
        if kind == 'CVarDefNode':
            declarations = []
            first = self.declarator(node.declarators[0]) if node.declarators else None
            common = self.annotation(node.base_type, first) if first else None
            for item in node.declarators:
                if type(item).__name__ == 'CFuncDeclaratorNode':
                    fn = SimpleNamespace(declarator=item, base_type=node.base_type, pos=node.pos, decorators=[])
                    declarations.append(self.function(fn, declaration=True))
                    continue
                dec = self.declarator(item)
                target = self.loc(ast.Name(id=dec.name, ctx=ast.Store()), dec)
                annotation = common
                if common is not None:
                    base_text = annotation_text(common).rstrip('*& ')
                    suffix = ''
                    wrapper = item
                    while wrapper is not dec:
                        wrapper_kind = type(wrapper).__name__
                        if wrapper_kind == 'CPtrDeclaratorNode': suffix += '*'
                        elif wrapper_kind == 'CReferenceDeclaratorNode': suffix += '&'
                        elif wrapper_kind == 'CArrayDeclaratorNode': suffix += '[]'
                        wrapper = wrapper.base
                    text = base_text + suffix
                    annotation = self.loc(ast.Name(id=text, ctx=ast.Load()) if text.isidentifier() else ast.Constant(value=text), node.base_type)
                    annotation.cython_type = text
                declarations.append(self.loc(ast.AnnAssign(target=target, annotation=annotation or ast.Name(id='object', ctx=ast.Load()), value=self.convert(getattr(dec, 'default', None)), simple=1), dec))
            result = Group(declarations)
        elif kind == 'CImportStatNode':
            alias = self.loc(ast.alias(name=node.module_name, asname=node.as_name), node, node.module_name.split('.')[0])
            result = ast.Import(names=[alias])
        elif kind in ('FromCImportStatNode', 'FromImportStatNode'):
            aliases = []
            if kind == 'FromCImportStatNode':
                module, level = node.module_name, node.relative_level
                for pos, name, asname, *_ in node.imported_names:
                    aliases.append(self.loc(ast.alias(name=name, asname=asname), SimpleNamespace(pos=pos)))
            else:
                module = node.module.module_name.value
                level = getattr(node.module, 'level', 0)
                for name, target in node.items:
                    # FromImportStatNode retains the local name's position.
                    text = self.lines[target.pos[1] - 1]
                    start = text.find(name, text.find('import') + 6)
                    original = SimpleNamespace(pos=(target.pos[0], target.pos[1], start if start >= 0 else target.pos[2]))
                    aliases.append(self.loc(ast.alias(name=name, asname=target.name if target.name != name else None), original))
            result = ast.ImportFrom(module=module, level=level, names=aliases)
        elif kind == 'ImportNode':
            module = node.module_name.value
            return self.loc(ast.Import(names=[self.loc(ast.alias(name=module, asname=None), node, module.split('.')[0])]), node)
        elif kind == 'NameNode':
            result = ast.Name(id=node.name, ctx=ast.Load())
        elif kind == 'AttributeNode':
            result = ast.Attribute(value=self.convert(node.obj), attr=node.attribute, ctx=ast.Load())
        elif kind in ('IntNode', 'FloatNode', 'ImagNode', 'BoolNode', 'NoneNode', 'UnicodeNode', 'StringNode', 'BytesNode'):
            value = getattr(node, 'value', None)
            if kind == 'IntNode': value = int(value, 0) if str(value).lower().startswith(('0x', '0o', '0b')) else int(value)
            elif kind == 'FloatNode': value = float(value)
            elif kind == 'ImagNode': value = complex(value)
            elif kind == 'BoolNode': value = bool(value)
            elif kind in ('UnicodeNode', 'StringNode'): value = str(value)
            elif kind == 'BytesNode': value = bytes(value)
            result = ast.Constant(value=value)
        elif kind in ('SimpleCallNode', 'GeneralCallNode'):
            args = [self.convert(a) for a in node.args] if kind == 'SimpleCallNode' else [self.convert(a) for a in getattr(node.positional_args, 'args', [])]
            keywords = []
            for item in getattr(getattr(node, 'keyword_args', None), 'key_value_pairs', []):
                keywords.append(ast.keyword(arg=str(item.key.value), value=self.convert(item.value)))
            result = ast.Call(func=self.convert(node.function), args=args, keywords=keywords)
        elif kind in ('SingleAssignmentNode', 'CascadedAssignmentNode'):
            targets = [node.lhs] if kind == 'SingleAssignmentNode' else node.lhs_list
            converted = [self.convert(t) for t in targets]
            for target in converted:
                for child in ast.walk(target):
                    if hasattr(child, 'ctx'): child.ctx = ast.Store()
            result = ast.Assign(targets=converted, value=self.convert(node.rhs))
            # Cython represents `import mod as alias` as an assignment.
            if type(node.rhs).__name__ == 'ImportNode':
                module = node.rhs.module_name.value
                alias = self.loc(ast.alias(name=module, asname=targets[0].name if targets[0].name != module.split('.')[0] else None), node.rhs, module.split('.')[0])
                result = ast.Import(names=[alias])
        elif kind == 'InPlaceAssignmentNode':
            result = ast.AugAssign(target=self.convert(node.lhs), op=self.operator(node.operator), value=self.convert(node.rhs))
        elif kind == 'ReturnStatNode':
            result = ast.Return(value=self.convert(node.value))
        elif kind == 'ExprStatNode':
            result = ast.Expr(value=self.convert(node.expr))
        elif kind in ('ListNode', 'TupleNode', 'SetNode'):
            cls = {'ListNode': ast.List, 'TupleNode': ast.Tuple, 'SetNode': ast.Set}[kind]
            result = cls(elts=[self.convert(n) for n in node.args], **({} if kind == 'SetNode' else {'ctx': ast.Load()}))
        elif kind == 'DictNode':
            result = ast.Dict(keys=[self.convert(p.key) for p in node.key_value_pairs], values=[self.convert(p.value) for p in node.key_value_pairs])
        elif kind == 'IndexNode':
            result = ast.Subscript(value=self.convert(node.base), slice=self.convert(node.index), ctx=ast.Load())
        elif kind == 'SliceIndexNode':
            result = ast.Subscript(value=self.convert(node.base), slice=ast.Slice(lower=self.convert(node.start), upper=self.convert(node.stop), step=None), ctx=ast.Load())
        elif kind in ('TypecastNode', 'CoerceToPyTypeNode', 'CoerceFromPyTypeNode'):
            return self.convert(node.operand if hasattr(node, 'operand') else node.arg)
        elif hasattr(node, 'operator') and hasattr(node, 'operand1') and hasattr(node, 'operand2'):
            op = node.operator
            left, right = self.convert(node.operand1), self.convert(node.operand2)
            if op in ('and', 'or'):
                result = ast.BoolOp(op=ast.And() if op == 'and' else ast.Or(), values=[left, right])
            elif op in ('==', '!=', '<', '<=', '>', '>=', 'in', 'not_in', 'is', 'is_not'):
                result = ast.Compare(left=left, ops=[self.operator(op)], comparators=[right])
            else:
                result = ast.BinOp(left=left, op=self.operator(op), right=right)
        elif hasattr(node, 'operator') and hasattr(node, 'operand'):
            result = ast.UnaryOp(op={'-': ast.USub, '+': ast.UAdd, '~': ast.Invert, 'not': ast.Not}.get(node.operator, ast.UAdd)(), operand=self.convert(node.operand))
        elif kind == 'ForInStatNode':
            target = self.convert(node.target)
            for child in ast.walk(target):
                if hasattr(child, 'ctx'): child.ctx = ast.Store()
            result = ast.For(target=target, iter=self.convert(node.iterator.sequence), body=self.body(node.body), orelse=self.body(node.else_clause))
        elif kind in ('GlobalNode', 'NonlocalNode'):
            result = (ast.Global if kind == 'GlobalNode' else ast.Nonlocal)(names=node.names)
        elif kind == 'CTypeDefNode':
            dec = self.declarator(node.declarator)
            target = self.loc(ast.Name(id=dec.name, ctx=ast.Store()), dec)
            result = ast.AnnAssign(target=target, annotation=ast.Name(id='TypeAlias', ctx=ast.Load()), value=self.annotation(node.base_type, dec), simple=1)
        elif kind in ('CStructOrUnionDefNode', 'CEnumDefNode'):
            body = [self.convert(child) for child in (node.items if kind == 'CEnumDefNode' else node.attributes or [])]
            if node.name:
                result = CythonType(node.name, body, scoped=kind != 'CEnumDefNode' or node.scoped)
                return self.loc(result, node, node.name)
            result = Group(body)
        elif kind == 'CEnumDefItemNode':
            target = self.loc(ast.Name(id=node.name, ctx=ast.Store()), node, node.name)
            result = ast.Assign(targets=[target], value=self.convert(node.value) or ast.Constant(value=0))
        elif kind == 'IncludeStatNode':
            self.warnings.append((node.pos[1], 'Include recorded as source only; included files are indexed separately.'))
            result = ast.Pass()
        else:
            # Preserve explicit names and calls in control-flow wrappers. No
            # compiler transformations or semantic/import analysis are invoked.
            result = Group([self.convert(child) for child in self.children(node)])
            if kind in ('PropertyNode', 'ForFromStatNode', 'ComprehensionNode', 'LambdaNode', 'ExceptClauseNode', 'WithStatNode'):
                self.warnings.append((node.pos[1], f'{kind.removesuffix("Node")}: partial static analysis.'))
        return self.loc(result, node)

    @staticmethod
    def operator(operator):
        return {'+': ast.Add, '-': ast.Sub, '*': ast.Mult, '/': ast.Div, '//': ast.FloorDiv, '%': ast.Mod, '**': ast.Pow, '&': ast.BitAnd, '|': ast.BitOr, '^': ast.BitXor, '<<': ast.LShift, '>>': ast.RShift, '==': ast.Eq, '!=': ast.NotEq, '<': ast.Lt, '<=': ast.LtE, '>': ast.Gt, '>=': ast.GtE, 'in': ast.In, 'not_in': ast.NotIn, 'is': ast.Is, 'is_not': ast.IsNot}.get(operator, ast.Add)()


def parse_source(source, filename):
    if not filename.endswith(CYTHON_SUFFIXES):
        return ast.parse(source, filename=filename), []
    # Python-compatible Cython needs no adaptation and retains full Python
    # scope semantics, including comprehensions and exception bindings.
    try:
        return ast.parse(source, filename=filename), []
    except SyntaxError:
        pass
    from Cython.Compiler import Errors, Parsing
    from Cython.Compiler.Scanning import PyrexScanner, StringSourceDescriptor
    from Cython.Compiler.TreeFragment import StringParseContext
    context = StringParseContext('codyssey_source')
    Errors.init_thread()
    descriptor = StringSourceDescriptor(filename, source)
    scope = context.find_module('codyssey_source', pos=(descriptor, 1, 0), need_pxd=False)
    scanner = PyrexScanner(io.StringIO(source), descriptor, source_encoding='UTF-8', scope=scope, context=context)
    # The parser normally evaluates DEF/IF and reads include files itself.
    # Disable both: this tool must never evaluate inspected expressions or
    # attach nodes from another file to the current file's source coordinates.
    scanner.compile_time_eval = False
    warnings = []
    lines = source.splitlines()
    try:
        for token in tokenize.generate_tokens(io.StringIO(source).readline):
            if token.type != tokenize.NAME or lines[token.start[0] - 1][:token.start[1]].strip():
                continue
            if token.string == 'include':
                warnings.append((token.start[0], 'Includes are not expanded; .pxi files are indexed separately.'))
            elif token.string in ('DEF', 'IF'):
                warnings.append((token.start[0], 'Compile-time directives are not evaluated; conditional declarations are skipped.'))
    except (tokenize.TokenError, IndentationError):
        pass  # Cython reports the actual syntax error below.
    messages = io.StringIO()
    try:
        with redirect_stderr(messages):
            tree = Parsing.p_module(scanner, filename.endswith('.pxd'), 'codyssey_source')
    except Errors.CompileError as error:
        line = error.position[1] if error.position else 1
        raise SyntaxError(str(error).strip().splitlines()[-1], (filename, line, 1, '')) from None
    adapter = Adapter(source)
    try:
        converted = adapter.convert(tree)
    except (AttributeError, TypeError, NotImplementedError) as error:
        raise SyntaxError(f'Unsupported Cython syntax: {error}', (filename, 1, 1, '')) from None
    return converted, warnings + adapter.warnings


def annotation_text(node):
    return getattr(node, 'cython_type', None) or ast.unparse(node)
