"""Query-only failures. No reservation, login or payment entrypoints."""
class QueryError(RuntimeError):
    pass

class SiteLayoutChanged(QueryError):
    pass

class QueryConditionMismatch(QueryError):
    pass

class SearchResultUnavailable(QueryError):
    pass

class GuardBlocked(QueryError):
    def __init__(self, message, *, explicit=True, code="GUARD_BLOCKED"):
        super().__init__(message)
        self.explicit = explicit
        self.code = code
