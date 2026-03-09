import json
import shutil
from pathlib import Path
from typing import Dict, Optional, Any
from threading import Lock

from config.schema import AppConfig, AgentConfig, ProviderConfig

BASE_DIR = Path(__file__).resolve().parent.parent
WORKSPACE_DIR = BASE_DIR / ".workspace"
TEMPLATE_DIR = BASE_DIR / "template"


class ConfigManager:
    """配置管理器 - 支持动态修改和持久化"""

    _instance = None
    _lock = Lock()

    def __new__(cls, *args, **kwargs):
        """单例模式，确保全局只有一个配置管理器"""
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self, config_path: str | Path = WORKSPACE_DIR / "config.json"):
        if hasattr(self, '_initialized') and self._initialized:
            return
        self.config_path = Path(config_path)
        self._config: Optional[AppConfig] = None
        self._file_lock = Lock()
        self._load()
        self._initialized = True

    def _load(self) -> None:
        """从文件加载配置"""
        with self._file_lock:
            if not self.config_path.exists():
                example_path = self.config_path.parent / "config_example.json"
                if not example_path.exists():
                    example_path = BASE_DIR / "config_example.json"
                if example_path.exists():
                    shutil.copy2(example_path, self.config_path)
                    from loguru import logger
                    logger.info("[Config] config.json 不存在，已从 config_example.json 自动复制")
            if self.config_path.exists():
                with open(self.config_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                self._config = AppConfig(**data)
            else:
                self._config = AppConfig()

    def _save(self) -> None:
        """保存配置到文件"""
        with self._file_lock:
            with open(self.config_path, "w", encoding="utf-8") as f:
                json.dump(self._config.model_dump(), f, indent=4, ensure_ascii=False)

    @property
    def config(self) -> AppConfig:
        """获取当前配置"""
        return self._config

    def get_full_config(self) -> Dict[str, Any]:
        """获取完整配置字典"""
        return self._config.model_dump()

    def reload(self) -> None:
        """重新加载配置文件"""
        self._load()

    def get(self, path: str, default: Any = None) -> Any:
        """
        获取配置值，支持路径访问
        例如: get("agents.main.model") -> "gpt-4o-mini"
        """
        keys = path.split(".")
        value = self._config.model_dump()
        for key in keys:
            if isinstance(value, dict) and key in value:
                value = value[key]
            else:
                return default
        return value

    def set(self, path: str, value: Any) -> bool:
        """
        设置配置值并持久化
        例如: set("agents.main.model", "gpt-4")
        """
        keys = path.split(".")
        data = self._config.model_dump()

        # 导航到目标位置
        target = data
        for key in keys[:-1]:
            if key not in target:
                target[key] = {}
            target = target[key]

        # 设置值
        target[keys[-1]] = value

        # 重新构建配置对象并保存
        self._config = AppConfig(**data)
        self._save()
        return True

# 全局配置管理器实例
config_manager = ConfigManager()
