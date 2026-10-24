import logging
from collections.abc import Callable

from pydantic import ValidationError

from app.repositories.settings import SettingsRepository
from app.schemas.settings import AppSettings, SectionName

logger = logging.getLogger(__name__)

Listener = Callable[[AppSettings], None]


class SettingsStore:
    """Database-backed runtime settings with change notification."""

    def __init__(self, repository: SettingsRepository) -> None:
        self.repository = repository
        self._listeners: list[Listener] = []
        stored = repository.load()
        try:
            self._current = AppSettings.model_validate(stored or {})
        except ValidationError:
            logger.warning("Stored settings are invalid; falling back to defaults per section")
            self._current = _lenient(stored or {})

    @property
    def current(self) -> AppSettings:
        return self._current

    def subscribe(self, listener: Listener) -> None:
        self._listeners.append(listener)

    def replace(self, value: AppSettings) -> AppSettings:
        self._current = value
        self.repository.save(value.model_dump(mode="json"))
        for listener in self._listeners:
            listener(value)
        return value

    def reset_section(self, section: SectionName) -> AppSettings:
        data = self._current.model_dump(mode="json")
        data.pop(section, None)
        return self.replace(AppSettings.model_validate(data))


def _lenient(data: dict[str, object]) -> AppSettings:
    result = AppSettings()
    for name in AppSettings.model_fields:
        section = data.get(name)
        if not isinstance(section, dict):
            continue
        try:
            merged = AppSettings.model_validate({name: section})
        except ValidationError:
            continue
        setattr(result, name, getattr(merged, name))
    return result
