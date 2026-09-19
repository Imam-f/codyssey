# Layer types on top of inference for the repository layer.

# A keyed lookup may miss, so it returns a sum type.
prop get(key: str) -> User | None

@pure
prop active_users() -> list[User]
