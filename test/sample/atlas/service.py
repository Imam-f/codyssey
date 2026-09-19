from .models import User as UserModel, UserNotFound
from .repository import UserRepository

# File-local aliases retain their declaration and assignment history.
Account = UserModel
Member = Account


class BaseService:
    def __init__(self, repository: UserRepository):
        self.repository = repository


class UserService(BaseService):
    """Application operations for user accounts."""

    def find_user(self, user_id: str) -> UserModel:
        user: UserModel | None = self.repository.get(user_id)
        if user is None:
            raise UserNotFound(user_id)
        return user

    def update_email(self, user_id: str, email: str) -> UserModel:
        user: UserModel | None = self.repository.get(user_id)
        if user is None:
            raise UserNotFound(user_id)
        normalized: str = email.strip().lower()
        previous: str = user.email

        if normalized == previous:
            return user

        user.email = normalized
        self.repository.save(user)
        return user

    def create_member(self, name: str, email: str) -> Member:
        member: Member = Member(id=email, name=name, email=email)
        self.repository.save(member)
        return member


class AuditedUserService(UserService):
    def update_email(self, user_id: str, email: str) -> UserModel:
        result: UserModel = super().update_email(user_id, email)
        return result
