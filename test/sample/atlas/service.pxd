# Layer types on top of inference for the service layer.

# Mutating operations are tagged side-effecting.
@side_effect
prop create_member(name: str, email: str) -> User

@side_effect
prop update_email(user_id: str, email: str) -> User
