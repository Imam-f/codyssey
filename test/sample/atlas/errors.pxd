# Layer types on top of inference for errors.py.

# A mutable module-level registry (dict member / mutability).
mut prop _registry: dict[str, str]

# abort always raises: its return type is never.
prop abort(message: str) -> never
