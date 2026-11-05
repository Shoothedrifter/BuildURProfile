"""Image provider adapters."""
"""Image provider selection for the private Agent process."""

from .cloudflare_images import CloudflareImageProvider
from .openai_images import OpenAIImageProvider


def create_image_provider(name: str):
    if name == "cloudflare":
        return CloudflareImageProvider()
    if name == "openai":
        return OpenAIImageProvider()
    raise ValueError("Unsupported IMAGE_PROVIDER")
