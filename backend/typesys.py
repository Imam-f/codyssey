"""Static type layer for Codyssey.

A small, dependency-free type system layered on top of the existing indexer.
It reads sidecar ``.pxd`` declaration files (the Cython convention) and runs a
flow-based checker over each ``.py`` file to:

  * annotate symbols with computed types (overriding/augmenting inference),
  * support custom types, sum/variant types (``A | B``), dict member records,
    the ``never`` type, closure capture, mutability, and side-effect tags,
  * report type errors (unreachable ``never`` calls, incompatible arguments,
    purity violations, and declaration mismatches).

Types are JSON-serialisable so they ride along with the existing analysis
result. Nothing here imports or executes the analysed repository.
"""
from __future__ import annotations

import ast
from dataclasses import dataclass, field
from typing import Iterable

# --- Type model -------------------------------------------------------------

PRIMITIVES = {
    "int", "str", "bool", "float", "bytes", "complex", "None", "NoneType",
    "object", "type", "list", "dict", "set", "tuple",
}
NEVER_NAMES = {"never", "Never", "NeverType", "NoReturn", "Nothing"}
UNKNOWN_NAMES = {"Any", "any", "Unknown", "unknown"}


class Type:
    """Base class. Subclasses are frozen so they hash and compare by value."""


@dataclass(frozen=True)
class Never(Type):
    """Bottom type: a value that can never be produced (``raise``, ``-> never``)."""


@dataclass(frozen=True)
class Unknown(Type):
    """Top type: nothing is known (the ``Any`` / unknown fallback)."""


@dataclass(frozen=True)
class Primitive(Type):
    name: str


@dataclass(frozen=True)
class Named(Type):
    """A custom / class / alias type."""
    name: str
    symbol_id: str | None = None


@dataclass(frozen=True)
class Union(Type):
    """Sum / variant type (``A | B``)."""
    members: tuple


@dataclass(frozen=True)
class Container(Type):
    """A homogeneous container (``list[T]``, ``dict[K, V]``, …)."""
    shape: str
    element: Type
    key: Type | None = None


@dataclass(frozen=True)
class Record(Type):
    """A dict with known member types, plus a fallback for unknown keys."""
    fields: tuple  # tuple of (name, Type)
    rest: Type


@dataclass(frozen=True)
class Callable(Type):
    params: tuple  # tuple of (name, Type)
    ret: Type
    effect: str = "unknown"
    # Built-in methods are synthesized from the receiver instead of being
    # declared in every project.  The metadata stays internal to the checker;
    # it is not part of the public serialized type shape.
    builtin: str | None = None
    receiver: Type | None = None


def make_union(members: Iterable[Type]) -> Type:
    flat: list[Type] = []
    for member in members:
        if isinstance(member, Never):
            continue  # Never is the identity element for unions.
        if isinstance(member, Union):
            flat.extend(member.members)
        else:
            flat.append(member)
    unique: list[Type] = []
    for member in flat:
        if member not in unique:
            unique.append(member)
    if not unique:
        return Never()
    if len(unique) == 1:
        return unique[0]
    return Union(tuple(unique))


def is_mutable_type(t: Type) -> bool:
    """Whether a type denotes a value that can be mutated in place."""
    if isinstance(t, (Container, Record, Named)):
        return True
    if isinstance(t, Union):
        return any(is_mutable_type(m) for m in t.members)
    return False


def join(left: Type, right: Type) -> Type:
    """Least-upper-bound of two types (used for branches and returns)."""
    if left == right:
        return left
    if isinstance(left, Unknown) or isinstance(right, Unknown):
        return Unknown()
    return make_union((left, right))


def serialize(t: Type):
    if isinstance(t, Never):
        return {"kind": "never"}
    if isinstance(t, Unknown):
        return {"kind": "unknown"}
    if isinstance(t, Primitive):
        return {"kind": "primitive", "name": t.name}
    if isinstance(t, Named):
        return {"kind": "named", "name": t.name, "symbolId": t.symbol_id}
    if isinstance(t, Union):
        return {"kind": "union", "members": [serialize(m) for m in t.members]}
    if isinstance(t, Container):
        result = {"kind": "container", "shape": t.shape, "element": serialize(t.element)}
        if t.key is not None:
            result["key"] = serialize(t.key)
        return result
    if isinstance(t, Record):
        return {
            "kind": "record",
            "fields": [{"name": name, "type": serialize(ft)} for name, ft in t.fields],
            "rest": serialize(t.rest),
        }
    if isinstance(t, Callable):
        return {
            "kind": "callable",
            "params": [{"name": name, "type": serialize(pt)} for name, pt in t.params],
            "ret": serialize(t.ret),
            "effect": t.effect,
        }
    return {"kind": "unknown"}


def display(t: Type) -> str:
    if isinstance(t, Never):
        return "never"
    if isinstance(t, Unknown):
        return "?"
    if isinstance(t, Primitive):
        return t.name
    if isinstance(t, Named):
        return t.name
    if isinstance(t, Union):
        return " | ".join(display(m) for m in t.members)
    if isinstance(t, Container):
        if t.shape == "dict":
            return f"dict[{display(t.key)}, {display(t.element)}]"
        return f"{t.shape}[{display(t.element)}]"
    if isinstance(t, Record):
        fields = ", ".join(f"{name}: {display(ft)}" for name, ft in t.fields)
        return "{" + fields + "}"
    if isinstance(t, Callable):
        params = ", ".join(f"{name}: {display(pt)}" for name, pt in t.params)
        return f"({params}) -> {display(t.ret)}"
    return "?"


# --- Implicit built-in members ---------------------------------------------

def _mapping_parts(receiver: Type):
    """Return ``(key, value)`` for dict-like values, if known.

    Dict literals are represented as ``Record`` so that named keys can be
    inspected.  They still have the normal dict methods, hence the explicit
    support here alongside generic ``dict[K, V]`` containers.
    """
    if isinstance(receiver, Record):
        value = receiver.rest if not isinstance(receiver.rest, Never) else Unknown()
        return Primitive("str"), value
    if isinstance(receiver, Container) and receiver.shape == "dict":
        return receiver.key or Unknown(), receiver.element
    return None


def _mapping_value(receiver: Type, key_node=None) -> Type:
    """Resolve a dict value, using an exact string key for records when able."""
    if isinstance(receiver, Record):
        if isinstance(key_node, ast.Constant) and isinstance(key_node.value, str):
            for name, field_type in receiver.fields:
                if name == key_node.value:
                    return field_type
        return receiver.rest if not isinstance(receiver.rest, Never) else Unknown()
    parts = _mapping_parts(receiver)
    return parts[1] if parts else Unknown()


def _builtin_member(receiver: Type, attr: str) -> Type | None:
    """Synthesize common Python collection and scalar methods.

    The checker intentionally models dict views as lists because the type
    layer has no separate view type.  Method parameters are mainly useful to
    document the inferred member; call result specialization is handled in
    ``TypeChecker._builtin_call_result`` for methods such as ``dict.get``.
    """
    mapping = _mapping_parts(receiver)
    if mapping:
        key, value = mapping
        pair = Container("tuple", make_union((key, value)))
        if attr == "keys":
            ret = Container("list", key)
            return Callable((), ret, builtin="dict.keys", receiver=receiver)
        if attr == "values":
            ret = Container("list", value)
            return Callable((), ret, builtin="dict.values", receiver=receiver)
        if attr == "items":
            ret = Container("list", pair)
            return Callable((), ret, builtin="dict.items", receiver=receiver)
        if attr == "get":
            return Callable((("key", key), ("default", Unknown())), join(value, Primitive("None")), builtin="dict.get", receiver=receiver)
        if attr == "setdefault":
            return Callable((("key", key), ("default", value)), value, "side_effect", "dict.setdefault", receiver)
        if attr == "pop":
            return Callable((("key", key), ("default", Unknown())), value, "side_effect", "dict.pop", receiver)
        if attr == "popitem":
            return Callable((), pair, "side_effect", "dict.popitem", receiver)
        if attr == "copy":
            return Callable((), receiver, builtin="dict.copy", receiver=receiver)
        if attr in ("clear", "update"):
            return Callable((), Primitive("None"), "side_effect", f"dict.{attr}", receiver)

    if isinstance(receiver, Container):
        shape = receiver.shape
        element = receiver.element
        if shape == "list":
            if attr in ("append", "extend", "insert", "remove"):
                return Callable((("value", element),), Primitive("None"), "side_effect", f"list.{attr}", receiver)
            if attr in ("clear", "reverse", "sort"):
                return Callable((), Primitive("None"), "side_effect", f"list.{attr}", receiver)
            if attr == "pop":
                return Callable((), element, "side_effect", "list.pop", receiver)
            if attr == "copy":
                return Callable((), receiver, builtin="list.copy", receiver=receiver)
            if attr in ("count", "index"):
                return Callable((("value", element),), Primitive("int"), builtin=f"list.{attr}", receiver=receiver)
        if shape in ("tuple", "sequence") and attr in ("count", "index"):
            return Callable((("value", element),), Primitive("int"), builtin=f"tuple.{attr}", receiver=receiver)
        if shape in ("set", "frozenset"):
            if attr in ("copy", "difference", "intersection", "symmetric_difference", "union"):
                return Callable((), receiver, builtin=f"set.{attr}", receiver=receiver)
            if attr in ("isdisjoint", "issubset", "issuperset"):
                return Callable((), Primitive("bool"), builtin=f"set.{attr}", receiver=receiver)
            if attr == "pop":
                return Callable((), element, "side_effect", "set.pop", receiver)
            if attr in ("add", "discard", "remove", "update", "intersection_update", "difference_update", "symmetric_difference_update", "clear"):
                return Callable((("value", element),), Primitive("None"), "side_effect", f"set.{attr}", receiver)

    if isinstance(receiver, Primitive) and receiver.name == "str":
        if attr in {
            "capitalize", "casefold", "center", "expandtabs", "format", "format_map",
            "join", "lower", "lstrip", "removeprefix", "removesuffix", "replace",
            "rstrip", "strip", "swapcase", "title", "translate", "upper", "zfill",
        }:
            return Callable((), receiver, builtin=f"str.{attr}", receiver=receiver)
        if attr in {"count", "find", "index", "rfind", "rindex"}:
            return Callable((), Primitive("int"), builtin=f"str.{attr}", receiver=receiver)
        if attr in {
            "isalnum", "isalpha", "isascii", "isdecimal", "isdigit", "isidentifier",
            "islower", "isnumeric", "isprintable", "isspace", "istitle", "isupper",
            "startswith", "endswith",
        }:
            return Callable((), Primitive("bool"), builtin=f"str.{attr}", receiver=receiver)
        if attr == "encode":
            return Callable((), Primitive("bytes"), builtin="str.encode", receiver=receiver)
        if attr in ("split", "rsplit", "splitlines"):
            return Callable((), Container("list", Primitive("str")), builtin=f"str.{attr}", receiver=receiver)
        if attr in ("partition", "rpartition"):
            return Callable((), Container("tuple", Primitive("str")), builtin=f"str.{attr}", receiver=receiver)

    if isinstance(receiver, Primitive) and receiver.name == "bytes":
        if attr in ("decode",):
            return Callable((), Primitive("str"), builtin="bytes.decode", receiver=receiver)
        if attr in ("hex",):
            return Callable((), Primitive("str"), builtin="bytes.hex", receiver=receiver)
        if attr in ("split", "rsplit", "splitlines"):
            return Callable((), Container("list", Primitive("bytes")), builtin=f"bytes.{attr}", receiver=receiver)
        if attr in ("count", "find", "index", "rfind", "rindex"):
            return Callable((), Primitive("int"), builtin=f"bytes.{attr}", receiver=receiver)

    return None


# --- Type expression parsing -------------------------------------------------

def type_from_node(node, resolver=None) -> Type:
    if isinstance(node, ast.Constant):
        if node.value is None:
            return Primitive("None")
        if isinstance(node.value, str):
            return Named(node.value)
        return Primitive(type(node.value).__name__)
    if isinstance(node, ast.Name):
        if node.id in NEVER_NAMES:
            return Never()
        if node.id in UNKNOWN_NAMES:
            return Unknown()
        if node.id in PRIMITIVES:
            return Primitive(node.id)
        if resolver is not None:
            resolved = resolver(node.id)
            if resolved is not None:
                return resolved
        return Named(node.id)
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):
        return make_union(
            (type_from_node(node.left, resolver), type_from_node(node.right, resolver))
        )
    if isinstance(node, ast.Subscript):
        shape = node.value.id if isinstance(node.value, ast.Name) else ""
        if shape in ("list", "List", "set", "Set", "frozenset", "tuple", "Tuple", "Sequence", "Iterable", "Collection"):
            return Container(shape.lower().split("_")[0], type_from_node(node.slice, resolver))
        if shape in ("dict", "Dict", "Mapping", "MutableMapping"):
            if isinstance(node.slice, ast.Tuple) and len(node.slice.elts) == 2:
                key = type_from_node(node.slice.elts[0], resolver)
                value = type_from_node(node.slice.elts[1], resolver)
            else:
                key, value = Unknown(), Unknown()
            return Container("dict", value, key=key)
        return Named(ast.unparse(node))
    if isinstance(node, ast.Dict):
        fields = []
        for key_node, value_node in zip(node.keys, node.values):
            if isinstance(key_node, ast.Constant) and isinstance(key_node.value, str):
                fields.append((key_node.value, type_from_node(value_node, resolver)))
            elif isinstance(key_node, ast.Name):
                fields.append((key_node.id, type_from_node(value_node, resolver)))
        return Record(tuple(fields), Unknown())
    if isinstance(node, ast.Attribute):
        return Named(ast.unparse(node))
    if isinstance(node, ast.Tuple):
        return Container("tuple", make_union(type_from_node(e, resolver) for e in node.elts))
    return Named(ast.unparse(node))


def parse_type(text: str, resolver=None) -> Type:
    if not text:
        return Unknown()
    try:
        node = ast.parse(text, mode="eval").body
    except (SyntaxError, RecursionError):
        return Unknown()
    return type_from_node(node, resolver)


# --- Declaration DSL --------------------------------------------------------

@dataclass
class Decl:
    name: str
    type: Type
    mutable: bool = False
    effect: str = "unknown"
    params: tuple = ()
    is_callable: bool = False
    line: int = 1


@dataclass
class Declarations:
    source: str = ""
    props: dict = field(default_factory=dict)     # name -> Decl
    aliases: dict = field(default_factory=dict)   # name -> Type


def _read_block(lines: list[str], index: int) -> tuple[str, int]:
    """Collect the indented block following ``lines[index - 1]``."""
    if index >= len(lines):
        return "", index
    indent = len(lines[index]) - len(lines[index].lstrip())
    block = []
    i = index
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            block.append("")
            i += 1
            continue
        current = len(line) - len(line.lstrip())
        if current < indent:
            break
        block.append(line.strip())
        i += 1
    return " ".join(block), i


def _split_top(text: str, sep: str = ",") -> list[str]:
    """Split ``text`` on ``sep`` only at bracket depth zero."""
    parts, depth, start = [], 0, 0
    pairs = {"(": ")", "[": "]", "{": "}"}
    openers, closers = set(pairs), set(pairs.values())
    for i, ch in enumerate(text):
        if ch in openers:
            depth += 1
        elif ch in closers:
            depth -= 1
        elif ch == sep and depth == 0:
            parts.append(text[start:i].strip())
            start = i + 1
    parts.append(text[start:].strip())
    return parts


def parse_declarations(text: str, path: str = "") -> Declarations:
    """Parse a ``.pxd``-style declaration file into a Declarations object.

    Supported statements (one per line, with an optional indented block body)::

        type Name = <type expression>
        prop name: <type expression>
        mut prop name: <type expression>
        prop name(a: int, b: str) -> <type expression>
        prop name():
            <type expression>          # block form, like the .pxd idiom
        @pure / @side_effect           # decorator on the following prop

    The declaration type is always a valid Python expression (a class name, a
    ``|`` union, a container, a dict literal, ``never``, …).
    """
    declarations = Declarations(source=text)
    lines = text.splitlines()
    pending_effect = "unknown"
    i = 0
    while i < len(lines):
        raw = lines[i]
        stripped = raw.strip()
        i += 1
        if not stripped or stripped.startswith("#"):
            continue
        if stripped.startswith("@"):
            tag = stripped[1:].strip()
            if tag in ("pure", "side_effect"):
                pending_effect = tag
            continue
        if stripped.startswith("type "):
            head, _, expr = stripped[5:].partition("=")
            name = head.strip()
            if name:
                declarations.aliases[name] = parse_type(expr.strip())
            pending_effect = "unknown"
            continue
        tokens = stripped.split()
        mutable = False
        if tokens and tokens[0] == "mut":
            mutable = True
            tokens = tokens[1:]
        if not tokens or tokens[0] != "prop":
            pending_effect = "unknown"
            continue
        tokens = tokens[1:]
        if not tokens:
            pending_effect = "unknown"
            continue
        name = tokens[0].split("(")[0].rstrip(":")
        params = ()
        ret: Type | None = None
        body: str | None = None
        head = stripped.split("prop", 1)[1].strip()
        if "->" in head:
            ret = parse_type(head.split("->", 1)[1].strip())
            head = head.split("->", 1)[0].strip()
        if "(" in head:
            param_text = head.split("(", 1)[1].rsplit(")", 1)[0]
            params = tuple(
                (p.split(":", 1)[0].strip(), parse_type(p.split(":", 1)[1].strip()) if ":" in p else Unknown())
                for p in _split_top(param_text)
                if p
            )
        if head.rstrip().endswith(":") and not ret:
            body, i = _read_block(lines, i)
        elif ":" in head and not ret:
            body = head.split(":", 1)[1].strip()
        if body:
            expr = parse_type(body)
        elif ret is not None:
            expr = ret
        else:
            expr = Unknown()
        is_callable = bool(params) or ret is not None
        if is_callable:
            expr = Callable(params, expr, pending_effect)
        declarations.props[name] = Decl(
            name=name, type=expr, mutable=mutable, effect=pending_effect,
            params=params, is_callable=is_callable, line=i,
        )
        pending_effect = "unknown"
    return declarations


def serialize_declarations(decl: Declarations, path: str = ""):
    return {
        "path": path,
        "source": decl.source,
        "props": {
            name: {
                "name": d.name,
                "type": serialize(d.type),
                "display": display(d.type),
                "mutable": d.mutable,
                "effect": d.effect,
                "isCallable": d.is_callable,
                "line": d.line,
            }
            for name, d in decl.props.items()
        },
        "aliases": {
            name: {"display": display(t), "type": serialize(t)}
            for name, t in decl.aliases.items()
        },
    }


# --- Type checker -----------------------------------------------------------

@dataclass
class Binding:
    type: Type
    mutable: bool = False
    effect: str = "unknown"
    declared: bool = False


@dataclass
class Fact:
    name: str
    scope: str
    line: int
    type: Type
    mutable: bool = False
    effect: str = "unknown"
    closures: list = field(default_factory=list)


class TypeChecker(ast.NodeVisitor):
    def __init__(self, file, declarations: Declarations, resolver, members: MemberTable):
        self.file = file
        self.path = file["path"]
        self.declarations = declarations
        self.resolver = resolver  # callable(name) -> Type | None, cross-file/import
        self.members = members
        self.scopes: list[dict] = [{"kind": "module", "name": "<module>", "bindings": {}}]
        self.class_id_stack: list = []
        self.errors: list[dict] = []
        self.facts: list[Fact] = []
        self.function_stack: list[dict] = []
        self.returns: list[Type] = []
        self.diverges = False
        self._seed_declarations()

    def _seed_declarations(self):
        """Pre-load value/property declarations into module scope.

        Function (callable) declarations are applied by ``check_function``; value
        declarations (``prop name: T``, ``mut prop name: T``) are seeded here so
        that module-level assignments layer the declared type on top of inference
        and inherit the declared mutability.
        """
        for name, decl in self.declarations.props.items():
            if isinstance(decl.type, Callable):
                continue
            self.scopes[0]["bindings"][name] = Binding(
                decl.type, mutable=decl.mutable, effect=decl.effect, declared=True,
            )
            self.facts.append(Fact(
                name=name, scope="<module>", line=1,
                type=decl.type, mutable=decl.mutable, effect=decl.effect,
            ))

    # -- diagnostics --
    def error(self, node, message, code="type"):
        self.errors.append({
            "path": self.path,
            "line": getattr(node, "lineno", 1),
            "column": getattr(node, "col_offset", 0),
            "message": message,
            "code": code,
        })

    # -- scopes --
    def current(self):
        return self.scopes[-1]

    def push(self, kind, name):
        self.scopes.append({"kind": kind, "name": name, "bindings": {}})

    def pop(self):
        return self.scopes.pop()

    def declare(self, name, binding: Binding):
        self.current()["bindings"][name] = binding
        self.facts.append(Fact(
            name=name, scope=self.current()["name"], line=1,
            type=binding.type, mutable=binding.mutable, effect=binding.effect,
        ))

    def lookup(self, name):
        for index in range(len(self.scopes) - 1, -1, -1):
            scope = self.scopes[index]
            if name in scope["bindings"]:
                binding = scope["bindings"][name]
                self.record_closure(name, binding, index)
                return binding
        return None

    def record_closure(self, name, binding, index):
        if not self.function_stack:
            return
        function = self.function_stack[-1]
        if index == len(self.scopes) - 1:
            return  # a local, not a capture
        if self.scopes[index]["kind"] == "function" and index not in function.get("seen_scopes", set()):
            function["captures"].append((name, binding))
            function["seen_scopes"].add(index)

    def resolve_declared(self, name):
        decl = self.declarations.props.get(name)
        if decl:
            return Binding(decl.type, mutable=decl.mutable, effect=decl.effect, declared=True)
        if name in self.declarations.aliases:
            return Binding(self.declarations.aliases[name], declared=True)
        return None

    def resolve_global(self, name):
        declared = self.resolve_declared(name)
        if declared:
            return declared
        resolved = self.resolver(name)
        if resolved is not None:
            return Binding(resolved)
        return None

    # -- helpers --
    def call_result(self, callee: Type):
        if isinstance(callee, Callable):
            return callee.ret
        return Unknown()

    def visit(self, node):
        if node is None:
            return Unknown()
        method = getattr(self, "visit_" + node.__class__.__name__, self.generic_visit)
        return method(node)

    def generic_visit(self, node):
        result = None
        for child in ast.iter_child_nodes(node):
            value = self.visit(child)
            if isinstance(value, Never):
                self.diverges = True
            elif value is not None and not isinstance(value, Unknown):
                result = value if result is None else join(result, value)
        return result

    def visit_Module(self, node):
        return self.generic_visit(node)

    # -- expressions --
    def visit_Constant(self, node):
        if node.value is None:
            return Primitive("None")
        return Primitive(type(node.value).__name__)

    def visit_Name(self, node):
        if isinstance(node.ctx, ast.Store):
            return Unknown()
        binding = self.lookup(node.id)
        if binding:
            return binding.type
        binding = self.resolve_global(node.id)
        if binding:
            return binding.type
        return Unknown()

    def visit_Attribute(self, node):
        if (
            isinstance(node.value, ast.Call)
            and isinstance(node.value.func, ast.Name)
            and node.value.func.id == "super"
            and not node.value.args
        ):
            parent = self.members.parent_of(self.class_id_stack[-1] if self.class_id_stack else None)
            member = self.members.lookup_id(parent, node.attr) if parent else None
            return member if member is not None else Unknown()
        receiver = self.visit(node.value)
        builtin = _builtin_member(receiver, node.attr)
        if builtin is not None:
            return builtin
        if isinstance(receiver, Record):
            for name, field_type in receiver.fields:
                if name == node.attr:
                    return field_type
        if isinstance(receiver, Named):
            member = self.members.lookup(receiver, node.attr)
            if member is not None:
                return member
        return Unknown()

    def visit_Subscript(self, node):
        value = self.visit(node.value)
        if isinstance(value, Record):
            key = node.slice
            if isinstance(key, ast.Constant) and isinstance(key.value, str):
                for name, field_type in value.fields:
                    if name == key.value:
                        return field_type
                return value.rest
        if isinstance(value, Container) and value.shape == "dict":
            return value.element
        if isinstance(value, Container) and value.shape in ("list", "set", "tuple", "frozenset"):
            return value.element
        return Unknown()

    def visit_List(self, node):
        element = make_union(self.visit(e) for e in node.elts) if node.elts else Unknown()
        return Container("list", element)

    def visit_Set(self, node):
        element = make_union(self.visit(e) for e in node.elts) if node.elts else Unknown()
        return Container("set", element)

    def visit_Tuple(self, node):
        element = make_union(self.visit(e) for e in node.elts) if node.elts else Unknown()
        return Container("tuple", element)

    def visit_Dict(self, node):
        fields = []
        for key_node, value_node in zip(node.keys, node.values):
            if isinstance(key_node, ast.Constant) and isinstance(key_node.value, str):
                fields.append((key_node.value, self.visit(value_node)))
        rest = make_union(self.visit(v) for v in node.values)
        return Record(tuple(fields), rest)

    def visit_BinOp(self, node):
        return self.visit(node.left) or Unknown()

    def visit_BoolOp(self, node):
        return make_union(self.visit(v) for v in node.values)

    def visit_UnaryOp(self, node):
        return self.visit(node.operand)

    def visit_Compare(self, node):
        return Primitive("bool")

    def visit_IfExp(self, node):
        return join(self.visit(node.body), self.visit(node.orelse))

    def visit_JoinedStr(self, node):
        return Primitive("str")

    def visit_Lambda(self, node):
        params = tuple(
            (arg.arg, parse_type(ast.unparse(arg.annotation)) if arg.annotation else Unknown())
            for arg in node.args.posonlyargs + node.args.args + node.args.kwonlyargs
        )
        return Callable(params, self.visit(node.body))

    def visit_ListComp(self, node):
        return Container("list", self.visit(node.elt))

    def visit_SetComp(self, node):
        return Container("set", self.visit(node.elt))

    def visit_DictComp(self, node):
        return Container("dict", self.visit(node.value), key=self.visit(node.key))

    def visit_GeneratorExp(self, node):
        return Container("list", self.visit(node.elt))

    def visit_Call(self, node):
        callee = self.visit(node.func)
        if isinstance(callee, Never):
            self.error(node, "cannot call a value of type never", "never-callee")
            return Never()
        arg_types = []
        for arg in node.args:
            arg_type = self.visit(arg)
            arg_types.append(arg_type)
            if isinstance(arg_type, Never):
                self.error(
                    arg,
                    f"argument of type never makes this call unreachable",
                    "never-arg",
                )
        keyword_types = {}
        for keyword in node.keywords:
            arg_type = self.visit(keyword.value)
            keyword_types[keyword.arg] = arg_type
            if isinstance(arg_type, Never):
                self.error(
                    keyword.value,
                    "argument of type never makes this call unreachable",
                    "never-arg",
                )
        if isinstance(callee, Callable):
            if any(isinstance(pt, Never) for _, pt in callee.params):
                self.error(node, "cannot call this function: it accepts a never parameter", "never-param")
            if callee.builtin:
                return self._builtin_call_result(callee, node, arg_types, keyword_types)
        return self.call_result(callee)

    def _builtin_call_result(self, callee, node, arg_types, keyword_types):
        """Refine implicit method results using the call's optional arguments."""
        builtin = callee.builtin
        receiver = callee.receiver
        if not receiver:
            return callee.ret
        kind, _, method = builtin.partition(".")
        if kind == "dict":
            if method in ("get", "setdefault", "pop"):
                key_node = node.args[0] if node.args else None
                result = _mapping_value(receiver, key_node)
                default = None
                if len(arg_types) > 1:
                    default = arg_types[1]
                else:
                    default = keyword_types.get("default")
                if method == "get" and default is None:
                    default = Primitive("None")
                if method == "setdefault" and default is None:
                    default = Primitive("None")
                if default is not None:
                    result = join(result, default)
                return result
            return callee.ret
        return callee.ret

    # -- statements --
    def visit_Expr(self, node):
        self.visit(node.value)
        return Unknown()

    def visit_Assign(self, node):
        value_type = self.visit(node.value)
        for target in node.targets:
            if isinstance(target, ast.Name):
                self.bind_name(target.id, value_type, mutable=False, line=target.lineno)
            elif isinstance(target, ast.Attribute):
                self.visit(target.value)
        return value_type

    def visit_AnnAssign(self, node):
        declared = parse_type(ast.unparse(node.annotation))
        if node.value:
            self.visit(node.value)
        if isinstance(node.target, ast.Name):
            self.bind_name(node.target.id, declared, mutable=False, declared_type=True, line=node.target.lineno)
        return declared

    def visit_AugAssign(self, node):
        if isinstance(node.target, ast.Name):
            self.bind_name(node.target.id, self.visit(node.value), mutable=True, line=node.target.lineno)
        return Unknown()

    def bind_name(self, name, type_, mutable=False, declared_type=False, line=None):
        mutable = mutable or is_mutable_type(type_)
        existing = self.current()["bindings"].get(name)
        if existing:
            # A declaration is authoritative: keep its type, merge mutability.
            if not existing.declared:
                existing.type = type_
            existing.mutable = existing.mutable or mutable
            return
        self.current()["bindings"][name] = Binding(type_, mutable=mutable, declared=declared_type)
        self.facts.append(Fact(
            name=name, scope=self.current()["name"], line=line if line is not None else 1,
            type=type_, mutable=mutable,
        ))

    def visit_Return(self, node):
        if node.value:
            self.returns.append(self.visit(node.value))
        else:
            self.returns.append(Primitive("None"))
        return Unknown()

    def visit_Raise(self, node):
        self.diverges = True
        if node.exc:
            self.visit(node.exc)
        return Never()

    def visit_If(self, node):
        self.visit(node.test)
        left = self.visit_statements(node.body)
        right = self.visit_statements(node.orelse)
        if left is None and right is None:
            return Unknown()
        return join(left or Unknown(), right or Unknown())

    def visit_statements(self, statements):
        result = None
        for statement in statements:
            value = self.visit(statement)
            if isinstance(value, Never):
                self.diverges = True
            if value is not None and not isinstance(value, Unknown):
                result = value if result is None else join(result, value)
        return result

    def visit_Try(self, node):
        result = self.visit_statements(node.body)
        for handler in node.handlers:
            if handler.name:
                self.current()["bindings"][handler.name] = Binding(Unknown())
            handled = self.visit_statements(handler.body)
            if result is None:
                result = handled
            elif handled is not None:
                result = join(result, handled)
        if node.orelse:
            other = self.visit_statements(node.orelse)
            result = other if result is None else join(result, other)
        if node.finalbody:
            self.visit_statements(node.finalbody)
        return result

    def visit_For(self, node):
        self.visit(node.iter)
        if isinstance(node.target, ast.Name):
            self.current()["bindings"][node.target.id] = Binding(Unknown(), mutable=True)
        self.visit_statements(node.body)
        if node.orelse:
            self.visit_statements(node.orelse)
        return Unknown()

    def visit_While(self, node):
        self.visit(node.test)
        self.visit_statements(node.body)
        if node.orelse:
            self.visit_statements(node.orelse)
        return Unknown()

    def visit_FunctionDef(self, node):
        return self.check_function(node)

    visit_AsyncFunctionDef = visit_FunctionDef

    def check_function(self, node):
        declared = self.resolve_declared(node.name)
        declared_callable = (
            declared.type
            if declared and isinstance(declared.type, Callable)
            else None
        )
        param_annotations = []
        args = node.args.posonlyargs + node.args.args + node.args.kwonlyargs

        # A method's receiver (``self``/``cls``) is typed as the enclosing class,
        # never Unknown. staticmethods have no implicit receiver.
        # Only functions directly contained by a class are methods.  Looking
        # through every enclosing scope would incorrectly type a nested
        # function such as ``def outer(): def inner(self): ...`` as a method.
        class_scope = self.scopes[-1] if self.scopes[-1]["kind"] == "class" else None
        class_name = class_scope["name"] if class_scope else None
        class_id = self.class_id_stack[-1] if self.class_id_stack else None
        decorators = {d.id for d in node.decorator_list if isinstance(d, ast.Name)}
        is_static = "staticmethod" in decorators
        receiver = None
        if class_name and not is_static and args and args[0].arg in ("self", "cls"):
            receiver = (args[0].arg, Named(class_name, class_id))

        for index, arg in enumerate(args):
            ann = parse_type(ast.unparse(arg.annotation)) if arg.annotation else None
            if ann is None and class_name and not is_static and index == 0 and arg.arg in ("self", "cls"):
                ann = Named(class_name, class_id)
            param_annotations.append((arg.arg, ann if ann is not None else Unknown()))
        ret_annotation = parse_type(ast.unparse(node.returns)) if node.returns else None

        effect = "unknown"
        for deco in node.decorator_list:
            if isinstance(deco, ast.Name) and deco.id in ("pure", "side_effect"):
                effect = deco.id
        if declared and declared.declared:
            effect = declared.effect

        # A declaration is authoritative: it layers on top of the code's own
        # annotations and inference. Fall back to the code annotation, then the
        # inferred type.
        if declared_callable:
            params = list(declared_callable.params)
            final_ret = declared_callable.ret
            effect = declared_callable.effect or effect
        else:
            params = param_annotations
            final_ret = ret_annotation

        # Declarations may omit the method receiver; self/cls is always the class.
        if receiver and (not params or params[0][0] != receiver[0]):
            params = [receiver] + params

        self.push("function", node.name)
        arg_lines = {a.arg: a.lineno for a in args}
        for name, ann in params:
            self.current()["bindings"][name] = Binding(ann)
            line = arg_lines.get(name, getattr(node, "lineno", 1))
            self.facts.append(Fact(name=name, scope=node.name, line=line, type=ann))
        function = {"captures": [], "seen_scopes": set()}
        self.function_stack.append(function)
        prev_returns, prev_diverges = self.returns, self.diverges
        self.returns = []
        self.diverges = False
        for statement in node.body:
            self.visit(statement)
        self.function_stack.pop()
        inferred_ret = make_union(self.returns)
        if not self.returns and self.diverges:
            inferred_ret = Never()
        if not self.returns and not self.diverges:
            inferred_ret = Primitive("None")
        if final_ret is None:
            final_ret = inferred_ret
        self.returns, self.diverges = prev_returns, prev_diverges
        captures = [(name, binding.type, binding.mutable) for name, binding in function["captures"]]
        self.pop()
        function_type = Callable(params, final_ret, effect)
        self.current()["bindings"][node.name] = Binding(function_type, effect=effect)
        self.facts.append(Fact(
            name=node.name, scope=self.current()["name"], line=node.lineno,
            type=function_type,
            effect=effect, closures=captures,
        ))

        # Purity check: a @pure function may not call a side-effecting one.
        if effect == "pure":
            self.check_purity(node)
        return final_ret

    def check_purity(self, node):
        # Re-walk just the call sites of this function to flag purity violations.
        class _Calls(ast.NodeVisitor):
            def __init__(self, checker, function):
                self.checker = checker
                self.function = function

            def visit_Call(self, call):
                callee = call.func
                if isinstance(callee, ast.Name):
                    binding = self.checker.lookup(callee.id)
                    if binding and binding.effect == "side_effect":
                        self.checker.error(
                            call, f"pure function {self.function.name} calls side-effecting {callee.id}", "purity",
                        )
                self.generic_visit(call)

        _Calls(self, node).visit(node)

    def visit_ClassDef(self, node):
        self.push("class", node.name)
        self.class_id_stack.append(
            self.members.class_id_for(self.path, node.name, node.lineno)
        )
        for statement in node.body:
            self.visit(statement)
        self.class_id_stack.pop()
        self.pop()
        return Named(node.name)

    def visit_NamedExpr(self, node):
        value = self.visit(node.value)
        if isinstance(node.target, ast.Name):
            self.bind_name(node.target.id, value, line=node.target.lineno)
        return value

    def visit_Match(self, node):
        self.visit(node.subject)
        results = [self.visit(case) for case in node.cases]
        return make_union(r for r in results if r is not None)

    def visit_match_case(self, node):
        self.visit(node.pattern)
        return self.visit_statements(node.body)

    def visit_With(self, node):
        for item in node.items:
            if item.optional_vars and isinstance(item.optional_vars, ast.Name):
                self.current()["bindings"][item.optional_vars.id] = Binding(Unknown())
        return self.visit_statements(node.body)

    def visit_AsyncWith(self, node):
        return self.visit_With(node)


def _attach_targets(t: Type, ids: list[str]) -> Type:
    """Attach resolved class ids to Named types inside a parsed type."""
    if isinstance(t, Named) and t.symbol_id is None and ids:
        return Named(t.name, ids[0])
    if isinstance(t, Union):
        remaining = list(ids)
        members = []
        for member in t.members:
            if isinstance(member, Named) and member.symbol_id is None and remaining:
                members.append(Named(member.name, remaining.pop(0)))
            else:
                members.append(member)
        return Union(tuple(members))
    return t


def symbol_type(symbol) -> Type:
    """Convert an indexed symbol's stored type into a Type.

    Annotations are parsed (so generics, unions, and containers survive);
    inferred literal types use their recorded primitive/container name.
    """
    source = symbol.get("typeSource")
    raw = symbol.get("type", "unknown")
    targets = symbol.get("typeTargets") or []
    if source == "annotation":
        return _attach_targets(parse_type(raw), targets)
    if source == "inferred":
        if raw == "list":
            return Container("list", Unknown())
        if raw == "dict":
            return Container("dict", Unknown(), key=Unknown())
        if raw == "set":
            return Container("set", Unknown())
        if raw == "tuple":
            return Container("tuple", Unknown())
        if raw in PRIMITIVES and raw not in ("list", "dict", "set", "tuple"):
            return Primitive(raw)
        return Named(raw, targets[0] if targets else None)
    return Unknown()


def _value_type(text: str) -> Type:
    """Best-effort type of a literal source fragment (``True``, ``{}``, …)."""
    if text in ("None",):
        return Primitive("None")
    if text in ("True", "False"):
        return Primitive("bool")
    try:
        node = ast.parse(text, mode="eval").body
    except (SyntaxError, RecursionError):
        return Unknown()
    if isinstance(node, ast.Constant):
        return Primitive("None") if node.value is None else Primitive(type(node.value).__name__)
    if isinstance(node, (ast.List, ast.ListComp)):
        return Container("list", Unknown())
    if isinstance(node, (ast.Dict, ast.DictComp)):
        return Container("dict", Unknown(), key=Unknown())
    if isinstance(node, (ast.Set, ast.SetComp)):
        return Container("set", Unknown())
    if isinstance(node, ast.Tuple):
        return Container("tuple", Unknown())
    if isinstance(node, ast.Name):
        return Unknown()  # a bare name needs scope resolution by the caller
    return Unknown()


class MemberTable:
    """Class members (methods and fields) resolved across files and inheritance."""

    def __init__(self, files):
        self.local = {}      # class symbol id -> {member: Type}
        self.bases = {}      # class symbol id -> [base ids]
        self.name_to_id = {}  # class name -> first class id
        self.class_locations = {}  # (path, name, line) -> class symbol id

        for file in files:
            symbols_by_scope = {}
            for s in file["symbols"]:
                symbols_by_scope.setdefault(s["scopeId"], []).append(s)
            classes_by_id = {c["id"]: c for c in file.get("classes", [])}
            for symbol in file["symbols"]:
                if symbol["kind"] != "class":
                    continue
                cid = symbol["id"]
                cls = classes_by_id.get(cid, {})
                self.bases[cid] = [b for b in cls.get("baseIds", []) if b]
                self.name_to_id.setdefault(symbol["name"], cid)
                self.class_locations[(file["path"], symbol["name"], symbol["line"])] = cid
                members = {}
                body = symbol.get("bodyScopeId")
                for s in symbols_by_scope.get(body, []):
                    if s["kind"] == "function":
                        params = tuple(
                            (p["name"], symbol_type(p))
                            for p in symbols_by_scope.get(s.get("bodyScopeId"), [])
                            if p["kind"] == "parameter"
                        )
                        members[s["name"]] = Callable(params, symbol_type(s))
                    elif s["kind"] == "variable":
                        members[s["name"]] = symbol_type(s)
                # Instance fields assigned via ``self.x`` in this class's methods.
                method_scopes = {
                    s.get("bodyScopeId")
                    for s in symbols_by_scope.get(body, [])
                    if s["kind"] == "function"
                }
                for assignment in file.get("assignments", []):
                    if assignment.get("scopeId") not in method_scopes:
                        continue
                    target = assignment.get("target", "")
                    if not target.startswith("self."):
                        continue
                    attr = target[len("self."):]
                    if attr in members:
                        continue
                    param_types = {
                        p["name"]: symbol_type(p)
                        for p in symbols_by_scope.get(assignment["scopeId"], [])
                        if p["kind"] == "parameter"
                    }
                    members[attr] = self._assignment_type(assignment, param_types)
                self.local[cid] = members

    def class_id_for(self, path, name, line):
        """Resolve a class by its source location, not just its name.

        Class names are allowed to repeat across modules (and even within a
        module), so the global name fallback is only a compatibility fallback
        for callers that do not have a source location.
        """
        return self.class_locations.get((path, name, line)) or self.name_to_id.get(name)

    @staticmethod
    def _assignment_type(assignment, param_types):
        if assignment.get("annotation"):
            return parse_type(assignment["annotation"])
        value = assignment.get("value")
        if value in param_types:
            return param_types[value]
        if value:
            return _value_type(value)
        return Unknown()

    def _lookup_id(self, cid, attr, seen):
        if cid is None or cid in seen:
            return None
        seen.add(cid)
        if attr in self.local.get(cid, {}):
            return self.local[cid][attr]
        for base in self.bases.get(cid, []):
            result = self._lookup_id(base, attr, seen)
            if result is not None:
                return result
        return None

    def lookup(self, named: Named, attr: str):
        cid = named.symbol_id or self.name_to_id.get(named.name)
        return self._lookup_id(cid, attr, set())

    def lookup_id(self, cid, attr: str):
        return self._lookup_id(cid, attr, set())

    def parent_of(self, cid):
        bases = self.bases.get(cid) or []
        return bases[0] if bases else None

    def member_set(self, cid):
        """All members (own + inherited) with the first definition winning."""
        result = {}
        seen = set()

        def collect(current):
            if current in seen:
                return
            seen.add(current)
            for name, type_ in self.local.get(current, {}).items():
                result.setdefault(name, type_)
            for base in self.bases.get(current, []):
                collect(base)

        collect(cid)
        return result


def _resolver_for(file, files_by_path, exports):
    """Build a cross-file name resolver for a single file."""
    module_bindings = {
        s["name"]: symbol_type(s)
        for s in file["symbols"]
        if s.get("scopeName") == "<module>"
    }
    import_targets = {}
    for alias in file.get("aliases", []):
        if alias.get("kind") == "import" and alias.get("target"):
            import_targets[alias["name"]] = alias["target"]
    for imp in file.get("imports", []):
        import_targets.setdefault(imp["name"], imp["target"])

    def resolver(name):
        if name in module_bindings:
            return module_bindings[name]
        if name in import_targets:
            target = import_targets[name]
            hit = exports.get(target)
            if hit:
                return symbol_type(hit)
        # A module-qualified import: ``import models as m; m.User`` resolves to
        # ``models.User``.
        return None

    return resolver


def analyze_types(files, declarations_by_path):
    """Run the type checker over every indexed file and return (errors, facts)."""
    files_by_path = {f["path"]: f for f in files}
    exports = {}
    for f in files:
        module = f.get("module", f["path"].rsplit(".", 1)[0].replace("/", "."))
        for s in f["symbols"]:
            if s.get("scopeName") == "<module>":
                exports[f"{module}.{s['name']}"] = s

    members = MemberTable(files)
    errors: list[dict] = []
    for f in files:
        declarations = declarations_by_path.get(f["path"]) or Declarations()
        resolver = _resolver_for(f, files_by_path, exports)
        try:
            tree = ast.parse(f["source"], filename=f["path"])
        except (SyntaxError, RecursionError):
            continue
        checker = TypeChecker(f, declarations, resolver, members)
        checker.visit(tree)
        errors.extend(checker.errors)
        _attach_facts(f, checker.facts)
    _attach_member_types(files, members)
    return errors


def _attach_member_types(files, members: MemberTable):
    """Attach a resolved type to every class member in the member tracker."""
    for file in files:
        symbols_by_id = {s["id"]: s for s in file["symbols"]}
        for cls in file.get("classes", []):
            for member in cls.get("memberTracker", {}).get("members", []):
                symbol = symbols_by_id.get(member.get("symbolId"))
                if symbol and symbol.get("computedType"):
                    member["type"] = symbol["computedType"]
                    member["mutable"] = symbol.get("mutable")
                    member["effect"] = symbol.get("effect")
                    member["closures"] = symbol.get("closures")
                else:
                    resolved = members.lookup_id(member.get("ownerId"), member["name"])
                    if resolved is not None:
                        member["type"] = display(resolved)
                        member["mutable"] = is_mutable_type(resolved)


def _attach_facts(file, facts):
    symbols = file["symbols"]
    by_key = {}
    by_scope_name = {}
    for s in symbols:
        by_key.setdefault((s["scopeName"], s["name"], s["line"]), []).append(s)
        by_scope_name.setdefault((s["scopeName"], s["name"]), []).append(s)

    for fact in facts:
        # Match facts to symbols by (scopeName, name, line). Function facts are
        # keyed by the enclosing scope name; locals by their function name.
        matches = by_key.get((fact.scope, fact.name, fact.line))
        if not matches:
            # Fall back to the same name within the scope, choosing the symbol
            # on the closest line (declaration-seeded facts use line 1).
            candidates = by_scope_name.get((fact.scope, fact.name))
            if candidates:
                matches = [min(candidates, key=lambda s: abs(s["line"] - fact.line))]
        if not matches:
            continue
        symbol = matches[0]
        symbol["computedType"] = display(fact.type)
        symbol["typeStruct"] = serialize(fact.type)
        # ``self`` and ``cls`` are implicit parameters: their source has no
        # annotation, but the checker can still infer the enclosing class.
        # Promote that inference to the indexed symbol so the inspector's
        # primary Type field is useful as well as the checked-type detail.
        if (
            symbol.get("kind") == "parameter"
            and symbol.get("name") in ("self", "cls")
            and symbol.get("typeSource") == "unknown"
            and isinstance(fact.type, Named)
        ):
            symbol["type"] = display(fact.type)
            symbol["typeSource"] = "inferred"
            if fact.type.symbol_id:
                symbol["typeTargets"] = [fact.type.symbol_id]
        symbol["mutable"] = fact.mutable
        if fact.effect != "unknown":
            symbol["effect"] = fact.effect
        if fact.closures:
            symbol["closures"] = [
                {"name": name, "type": display(t), "mutable": mutable}
                for name, t, mutable in fact.closures
            ]
