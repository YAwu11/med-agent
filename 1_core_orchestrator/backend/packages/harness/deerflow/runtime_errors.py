class FatalToolExecutionError(RuntimeError):
    """Infrastructure-level tool failure that must abort the current run."""


__all__ = ["FatalToolExecutionError"]