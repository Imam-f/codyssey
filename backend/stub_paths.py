"""Discover optional stub import roots without activating an environment."""
from pathlib import Path

STUB_SUFFIXES = ('.pyi', '.pxd')


def stub_roots(repository, paths=(), use_venv=False, missing=None):
    selected = list(paths)
    if use_venv:
        selected += [str(Path(repository, name)) for name in ('.venv', 'venv', 'env') if Path(repository, name).is_dir()]
    roots, seen = [], set()
    for value in selected:
        directory = Path(value).expanduser()
        if not directory.is_absolute(): directory = Path(repository, directory)
        directory = directory.resolve()
        if not directory.is_dir():
            if missing is not None: missing.append(str(directory))
            continue
        candidates = []
        if (directory / 'pyvenv.cfg').is_file() or (directory / 'Lib/site-packages').is_dir():
            candidates = [directory / 'Lib/site-packages', *sorted(directory.glob('lib/python*/site-packages')), *sorted(directory.glob('lib64/python*/site-packages'))]
        elif (directory / 'stdlib').is_dir() and (directory / 'stubs').is_dir():
            candidates = [directory / 'stdlib', *sorted(p for p in (directory / 'stubs').iterdir() if p.is_dir())]
        else:
            candidates = [directory]
        for candidate in candidates:
            if not candidate.is_dir(): continue
            candidate = candidate.resolve()
            if candidate in seen: continue
            seen.add(candidate)
            roots.append(candidate)
    return roots


def stub_module(root, relative):
    parts = list(relative.with_suffix('').parts)
    # Stub-only distributions use importable-package-stubs on disk.
    parts = [part.removesuffix('-stubs') for part in parts]
    if any(not part.isidentifier() for part in parts): return None
    if parts[-1] == '__init__': parts.pop()
    if (root / '__init__.pyi').is_file() or (root / '__init__.pxd').is_file():
        parts.insert(0, root.name.removesuffix('-stubs'))
    return '.'.join(parts) or None


def index_priority(file):
    return (not file.get('external', False), file['path'].endswith(('.py', '.pyx')))
