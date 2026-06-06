import os
import logging
from pathlib import Path

from src.core.model_registry import ModelInstaller

logger = logging.getLogger(__name__)

class KokoroInstaller(ModelInstaller):
    """Installer for the Kokoro TTS engine."""
    
    def __init__(self):
        self.models_urls = {
            "fp32": "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/onnx/model.onnx",
            "fp16": "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/onnx/model_fp16.onnx",
            "int8": "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/onnx/model_quantized.onnx"
        }
        self.voices_url = "https://huggingface.co/fastrtc/kokoro-onnx/resolve/main/voices-v1.0.bin"

    def _get_models_dir(self, app_dir: Path) -> Path:
        return app_dir / "models" / "kokoro"

    def get_download_queue(self, precision: str, app_dir: Path) -> list[dict]:
        if precision not in self.models_urls:
            return []

        models_dir = self._get_models_dir(app_dir)
        os.makedirs(models_dir, exist_ok=True)

        onnx_dest = models_dir / f"kokoro-v1.0-{precision}.onnx"
        voices_dest = models_dir / "voices-v1.0.bin"

        queue = [
            {"url": self.models_urls[precision], "dest": str(onnx_dest), "name": f"kokoro-v1.0-{precision}.onnx"}
        ]
        
        if not voices_dest.exists():
            queue.append(
                {"url": self.voices_url, "dest": str(voices_dest), "name": "voices-v1.0.bin"}
            )
            
        return queue

    def is_installed(self, precision: str, app_dir: Path) -> bool:
        installed = self.get_installed_precisions(app_dir, saved_precision="")
        if precision:
            return precision in installed
        return len(installed) > 0

    def get_installed_precisions(self, app_dir: Path, saved_precision: str) -> list[str]:
        models_dir = self._get_models_dir(app_dir)
        if not (models_dir / "voices-v1.0.bin").exists():
            return []

        installed = []
        for p in ["fp32", "fp16", "int8"]:
            if (models_dir / f"kokoro-v1.0-{p}.onnx").exists():
                installed.append(p)
                
        # Support legacy un-suffixed model if present
        if (models_dir / "kokoro-v1.0.onnx").exists():
            if saved_precision and saved_precision not in installed:
                installed.append(saved_precision)
            elif not saved_precision and "fp32" not in installed:
                installed.append("fp32")
                
        return installed

    def delete_model(self, precision: str, app_dir: Path) -> bool:
        models_dir = self._get_models_dir(app_dir)
        try:
            precisions = [precision] if precision else ["fp32", "fp16", "int8"]
            for p in precisions:
                p_file = models_dir / f"kokoro-v1.0-{p}.onnx"
                if p_file.exists():
                    os.remove(p_file)
            
            if not precision:
                old_file = models_dir / "kokoro-v1.0.onnx"
                if old_file.exists():
                    os.remove(old_file)
            
            has_any = False
            for p in ["fp32", "fp16", "int8"]:
                if (models_dir / f"kokoro-v1.0-{p}.onnx").exists():
                    has_any = True
            if (models_dir / "kokoro-v1.0.onnx").exists():
                has_any = True
                
            if not has_any and (models_dir / "voices-v1.0.bin").exists():
                os.remove(models_dir / "voices-v1.0.bin")
                
            return True
        except Exception as e:
            logger.error(f"Failed to delete kokoro model: {e}")
            return False
