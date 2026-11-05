"""Provider-neutral image result and failure contract for the avatar Skill."""

from dataclasses import dataclass


@dataclass(frozen=True)
class GeneratedImage:
    bytes: bytes
    mime: str = "image/png"


class ImageProviderError(RuntimeError):
    def __init__(self, code: str, retryable: bool = False) -> None:
        super().__init__(code)
        self.code = code
        self.retryable = retryable
