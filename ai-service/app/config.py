"""Settings for ai-service. Everything comes from env vars — no secrets here."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = (
        "postgres://groundtruth:groundtruth_dev@localhost:5432/groundtruth"
    )
    openai_api_key: str = ""
    cloudinary_cloud_name: str = ""
    cloudinary_api_key: str = ""
    cloudinary_api_secret: str = ""
    cors_origins: str = "http://localhost:3000"
    embedding_model: str = "text-embedding-3-small"
    embedding_dim: int = 1536

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def cloudinary_configured(self) -> bool:
        return bool(
            self.cloudinary_cloud_name
            and self.cloudinary_api_key
            and self.cloudinary_api_secret
        )

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
