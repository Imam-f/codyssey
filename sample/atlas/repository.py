from .models import User


class Repository:
    def __init__(self):
        self._items: dict[str, User] = {}

    def get(self, key: str) -> User | None:
        return self._items.get(key)

    def save(self, user: User) -> None:
        self._items[user.id] = user


class UserRepository(Repository):
    def active_users(self) -> list[User]:
        return [user for user in self._items.values() if user.active]


class CachedUserRepository(UserRepository):
    def get(self, key: str) -> User | None:
        result: User | None = super().get(key)
        return result
