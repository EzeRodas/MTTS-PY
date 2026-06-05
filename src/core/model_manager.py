import os
import json
import urllib.request
import time
from pathlib import Path
import logging
import threading

logger = logging.getLogger(__name__)

class DownloadWorker:
    def __init__(self, url: str, dest_path: str):
        self.url = url
        self.dest_path = dest_path
        self._is_cancelled = False
        self._is_running = False
        self._on_progress = None
        self._on_finished = None
        
    def set_callbacks(self, on_progress, on_finished):
        self._on_progress = on_progress
        self._on_finished = on_finished

    def start(self):
        self._is_running = True
        threading.Thread(target=self.run, daemon=True).start()
        
    def cancel(self):
        self._is_cancelled = True
        
    def is_running(self):
        return self._is_running
        
    def run(self):
        max_attempts = 4
        for attempt in range(max_attempts):
            if self._is_cancelled:
                self._is_running = False
                if self._on_finished:
                    self._on_finished(False, "Download cancelled")
                return
                
            if attempt > 0 and os.path.exists(self.dest_path):
                os.remove(self.dest_path)
                
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
                                self._is_running = False
                                if self._on_finished:
                                    self._on_finished(False, "Download cancelled")
                                return
                                
                            chunk = response.read(chunk_size)
                            if not chunk:
                                break
                            
                            out_file.write(chunk)
                            bytes_read += len(chunk)
                            if self._on_progress:
                                self._on_progress(bytes_read, total_bytes)
                
                self._is_running = False
                if self._on_finished:
                    self._on_finished(True, "")
                return
            except Exception as e:
                logger.error(f"Download error for {self.url} (Attempt {attempt + 1}/{max_attempts}): {e}")
                if os.path.exists(self.dest_path):
                    os.remove(self.dest_path)
                    
                if attempt < max_attempts - 1:
                    delay = 2 ** attempt
                    wait_time = 0
                    while wait_time < delay:
                        if self._is_cancelled:
                            self._is_running = False
                            if self._on_finished:
                                self._on_finished(False, "Download cancelled")
                            return
                        time.sleep(0.5)
                        wait_time += 0.5
                else:
                    self._is_running = False
                    if self._on_finished:
                        self._on_finished(False, str(e))


class ModelManager:
    def __init__(self, settings_manager):
        self.settings_manager = settings_manager
        self._worker = None
        self._progress_callbacks = []
        self._complete_callbacks = []
        
        self.models_urls = {
            "fp32": "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/onnx/model.onnx",
            "fp16": "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/onnx/model_fp16.onnx",
            "int8": "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/onnx/model_quantized.onnx"
        }
        self.voices_url = "https://huggingface.co/fastrtc/kokoro-onnx/resolve/main/voices-v1.0.bin"
        
        self._download_queue = []
        self._download_precision = None
        self._installed_precisions_cache = None
        
    def add_progress_callback(self, cb):
        if cb not in self._progress_callbacks:
            self._progress_callbacks.append(cb)
            
    def add_complete_callback(self, cb):
        if cb not in self._complete_callbacks:
            self._complete_callbacks.append(cb)
            
    def _emit_progress(self, bytes_read: int, total_bytes: int, name: str):
        for cb in self._progress_callbacks:
            cb(bytes_read, total_bytes, name)
            
    def _emit_complete(self, success: bool, error: str):
        for cb in self._complete_callbacks:
            cb(success, error)

    def download_model(self, precision: str):
        logger.info(f"download_model called: precision={precision}")
        if self._worker and self._worker.is_running():
            logger.warning("download_model: worker already running, ignoring")
            return
            
        if precision not in self.models_urls:
            logger.error(f"download_model: invalid precision '{precision}'")
            self._emit_complete(False, f"Invalid precision: {precision}")
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
            update = {"initialSetupComplete": True}
            if self._download_precision:
                update["kokoroPrecision"] = self._download_precision
            self.settings_manager.update_app_config(update)
            self._installed_precisions_cache = None
            self._emit_complete(True, "")
            return
            
        current = self._download_queue.pop(0)
        self._start_download_worker(current["url"], current["dest"], current["name"])
        
    def _start_download_worker(self, url: str, dest: str, name: str):
        self._worker = DownloadWorker(url, dest)
        self._current_download_name = name
        self._worker.set_callbacks(self._on_worker_progress, self._on_worker_finished)
        self._worker.start()
        
    def _on_worker_progress(self, bytes_read: int, total_bytes: int):
        name = getattr(self, "_current_download_name", "")
        self._emit_progress(bytes_read, total_bytes, name)
        
    def _on_worker_finished(self, success: bool, error: str):
        if success:
            self._process_queue()
        else:
            self._download_queue.clear()
            self._emit_complete(False, error)
        
    def delete_model(self, precision: str = ""):
        app_dir = Path(self.settings_manager.get_app_directory())
        models_dir = app_dir / "models" / "kokoro"
        
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
            self._installed_precisions_cache = None
            return True
        except Exception as e:
            logger.error(f"Failed to delete model: {e}")
            return False
            
    def is_model_installed(self, precision: str = "") -> bool:
        installed = self.get_installed_precisions()
        if not installed:
            return False
            
        if precision:
            return precision in installed
        return len(installed) > 0
            
    def get_installed_precisions(self) -> list[str]:
        if self._installed_precisions_cache is not None:
            return self._installed_precisions_cache

        app_dir = Path(self.settings_manager.get_app_directory())
        models_dir = app_dir / "models" / "kokoro"
        if not (models_dir / "voices-v1.0.bin").exists():
            self._installed_precisions_cache = []
            return []
            
        installed = []
        for p in ["fp32", "fp16", "int8"]:
            if (models_dir / f"kokoro-v1.0-{p}.onnx").exists():
                installed.append(p)
        if (models_dir / "kokoro-v1.0.onnx").exists():
            saved = self.settings_manager.get_app_config().get("kokoroPrecision", "fp32")
            if saved not in installed:
                installed.append(saved)
                
        self._installed_precisions_cache = installed
        return installed

    def is_download_running(self) -> bool:
        return self._worker is not None and self._worker.is_running()
