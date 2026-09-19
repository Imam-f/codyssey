from dataclasses import dataclass
from typing import TypeAlias


UserId: TypeAlias = str


@dataclass
class Entity:
    id: str

    def identity(self) -> str:
        return self.id


@dataclass
class User(Entity):
    name: str
    email: str
    active: bool = True

    def display_name(self) -> str:
        label: str = self.name.strip()
        return label or self.email


@dataclass
class Admin(User):
    permissions: list[str] | None = None

    def can_access(self, resource: str) -> bool:
        permissions = self.permissions or []
        return resource in permissions


class ServiceError(Exception):
    pass


class UserNotFound(ServiceError):
    pass
