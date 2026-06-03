import os
import json
import urllib.request
from pathlib import Path
import logging
from PySide6.QtCore import QObject, Signal, QThread, Slot

logger = logging.getLogger(__name__)

class DownloadWorker(QThread):
    progress = Signal(int, int)  # bytes_read, total_bytes
    finished = Signal(bool, str) # success, error_message
    
    def __init__(self, url: str, dest_path: str):
        super().__init__()
        self.url = url
        self.dest_path = dest_path
        self._is_cancelled = False
        
    def cancel(self):
        self._is_cancelled = True
        
    def run(self):
        try:
            req = urllib.request.Request(self.url, headers={'User-Agent': 'Moon-TTS'})
            with urllib.request.urlopen(req) as response:
                total_length = response.getheader('Content-Length')
                if total_length is None:
                    total_bytes = 0
                else:
                    total_bytes = int(total_length)
                
                bytes_read = 0
                chunk_size = 1024 * 128  # 128 KB chunks
                
                with open(self.dest_path, 'wb') as out_file:
                    while True:
                        if self._is_cancelled:
                            out_file.close()
                            os.remove(self.dest_path)
                            self.finished.emit(False, "Download cancelled")
                            return
                            
                        chunk = response.read(chunk_size)
                        if not chunk:
                            break
                        
                        out_file.write(chunk)
                        bytes_read += len(chunk)
                        self.progress.emit(bytes_read, total_bytes)
            
            self.finished.emit(True, "")
        except Exception as e:
            logger.error(f"Download error for {self.url}: {e}")
            if os.path.exists(self.dest_path):
                os.remove(self.dest_path)
            self.finished.emit(False, str(e))


class ModelManager(QObject):
    download_progress = Signal(int, int, str) # bytes_read, total_bytes, current_file_name
    download_complete = Signal(bool, str) # success, error
    
    def __init__(self, settings_manager):
        super().__init__()
        self.settings_manager = settings_manager
        self._worker = None
        
        self.models_urls = {
            "fp32": "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/onnx/model.onnx",
            "fp16": "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/onnx/model_fp16.onnx",
            "int8": "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/onnx/model_quantized.onnx"
        }
        self.voices_url = "https://huggingface.co/fastrtc/kokoro-onnx/resolve/main/voices-v1.0.bin"
        
        self._download_queue = []
        self._download_precision = None
        
    def download_model(self, precision: str):
        logger.info(f"download_model called: precision={precision}")
        if self._worker and self._worker.isRunning():
            logger.warning("download_model: worker already running, ignoring")
            return
            
        if precision not in self.models_urls:
            logger.error(f"download_model: invalid precision '{precision}'")
            self.download_complete.emit(False, f"Invalid precision: {precision}")
            return
            
        app_dir = Path(self.settings_manager.get_app_directory())
        models_dir = app_dir / "models" / "kokoro"
        logger.info(f"download_model: creating dir {models_dir}")
        os.makedirs(models_dir, exist_ok=True)
        
        onnx_dest = models_dir / f"kokoro-v1.0-{precision}.onnx"
        voices_dest = models_dir / "voices-v1.0.bin"
        
        self._download_queue = [
            {"url": self.models_urls[precision], "dest": str(onnx_dest), "name": f"kokoro-v1.0-{precision}.onnx"}
        ]
        if not voices_dest.exists():
            self._download_queue.append(
                {"url": self.voices_url, "dest": str(voices_dest), "name": "voices-v1.0.bin"}
            )
        
        self._download_precision = precision
        logger.info(f"download_model: queue={[q['name'] for q in self._download_queue]}, starting...")
        self._process_queue()
        
    def _process_queue(self):
        if not self._download_queue:
            # Finished everything successfully
            
            # Record that initial setup is complete and store precision
            update = {"initialSetupComplete": True}
            if self._download_precision:
                update["kokoroPrecision"] = self._download_precision
            self.settings_manager.update_app_config(update)
            self.download_complete.emit(True, "")
            return
            
        current = self._download_queue.pop(0)
        self._start_download_worker(current["url"], current["dest"], current["name"])
        
    def _start_download_worker(self, url: str, dest: str, name: str):
        self._worker = DownloadWorker(url, dest)
        self._current_download_name = name
        self._worker.progress.connect(self._on_worker_progress)
        self._worker.finished.connect(self._on_worker_finished)
        self._worker.start()
        
    @Slot(int, int)
    def _on_worker_progress(self, bytes_read: int, total_bytes: int):
        name = getattr(self, "_current_download_name", "")
        self.download_progress.emit(bytes_read, total_bytes, name)
        
    @Slot(bool, str)
    def _on_worker_finished(self, success: bool, error: str):
        if success:
            self._process_queue()
        else:
            self._download_queue.clear()
            self.download_complete.emit(False, error)
        
    def delete_model(self, precision: str = ""):
        app_dir = Path(self.settings_manager.get_app_directory())
        models_dir = app_dir / "models" / "kokoro"
        
        try:
            precisions = [precision] if precision else ["fp32", "fp16", "int8"]
            for p in precisions:
                p_file = models_dir / f"kokoro-v1.0-{p}.onnx"
                if p_file.exists():
                    os.remove(p_file)
            
            # If no precision specified, also delete default/old file
            if not precision:
                old_file = models_dir / "kokoro-v1.0.onnx"
                if old_file.exists():
                    os.remove(old_file)
            
            # Check if any model remains
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
            logger.error(f"Failed to delete model: {e}")
            return False
            
    def is_model_installed(self, precision: str = "") -> bool:
        app_dir = Path(self.settings_manager.get_app_directory())
        models_dir = app_dir / "models" / "kokoro"
        if not (models_dir / "voices-v1.0.bin").exists():
            return False
            
        if precision:
            # Check precision specific file, but also fallback to the default/old file if it matches
            if (models_dir / f"kokoro-v1.0-{precision}.onnx").exists():
                return True
            if (models_dir / "kokoro-v1.0.onnx").exists():
                # If old file exists, we check if the stored precision matches
                saved = self.settings_manager.get_app_config().get("kokoroPrecision", "")
                return saved == precision
            return False
        else:
            return (
                (models_dir / "kokoro-v1.0.onnx").exists() or
                (models_dir / "kokoro-v1.0-fp32.onnx").exists() or
                (models_dir / "kokoro-v1.0-fp16.onnx").exists() or
                (models_dir / "kokoro-v1.0-int8.onnx").exists()
            )
            
    def get_installed_precisions(self) -> list[str]:
        app_dir = Path(self.settings_manager.get_app_directory())
        models_dir = app_dir / "models" / "kokoro"
        if not (models_dir / "voices-v1.0.bin").exists():
            return []
            
        installed = []
        for p in ["fp32", "fp16", "int8"]:
            if (models_dir / f"kokoro-v1.0-{p}.onnx").exists():
                installed.append(p)
        if (models_dir / "kokoro-v1.0.onnx").exists():
            saved = self.settings_manager.get_app_config().get("kokoroPrecision", "fp32")
            if saved not in installed:
                installed.append(saved)
        return installed

    def is_download_running(self) -> bool:
        return self._worker is not None and self._worker.isRunning()
