# Layer types on top of inference for the domain models.

# A record type with named members (dict member analysis).
type UserProfile = { id: str, name: str, email: str }

# A variant / sum type.
type Identity = str | UserProfile
