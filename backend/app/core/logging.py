import logging

from app.core.config import Settings


def configure_logging(settings: Settings) -> None:
    logging.basicConfig(
        level=settings.log_level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    # httpx logs every request at INFO; the engine watchdog alone polls every few seconds.
    logging.getLogger("httpx").setLevel(logging.WARNING)
