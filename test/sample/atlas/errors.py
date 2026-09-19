from .models import ServiceError

_registry = {}


def abort(message: str):
    """Raise immediately; a function that only raises has type ``never``."""
    raise ServiceError(message)


def make_counter(start: int):
    """Return a closure that captures ``current``."""
    current = start

    def increment():
        return current + 1

    return increment
