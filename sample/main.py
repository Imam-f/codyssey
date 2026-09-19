from atlas.models import Admin
from atlas.repository import CachedUserRepository
from atlas.service import AuditedUserService


def main() -> None:
    repository = CachedUserRepository()
    service = AuditedUserService(repository)
    admin: Admin = Admin(id="1", name="Ada", email="ada@example.com")
    repository.save(admin)
    service.update_email(admin.id, "ada@atlas.dev")


if __name__ == "__main__":
    main()
