import os
import json
import urllib.request
import time
from pathlib import Path
import logging
import threading

from src.infrastructure.kokoro.installer import KokoroInstaller

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
                                if os.path.exists(self.dest_path):
                                    try:
                                        os.remove(self.dest_path)
                                    except Exception:
                                        pass
                                self._is_running = False
                                if self._on_finished:
                                    self._on_finished(False, "Download cancelled")
                                return
                                
                            chunk = response.read(chunk_size)
                            if not chunk:
                                break
                            
                            out_file.write(chunk)
                            bytes_read += len(chunk)
                            
                            # Throttle progress updates to ~15 FPS to prevent UI freeze
                            current_time = time.time()
                            last_time = getattr(self, '_last_progress_time', 0)
                            if current_time - last_time > 0.05 or bytes_read == total_bytes:
                                if self._on_progress:
                                    self._on_progress(bytes_read, total_bytes)
                                self._last_progress_time = current_time
                    
                    # Ensure 100% progress is emitted if we broke out early
                    if self._on_progress:
                        self._on_progress(bytes_read, max(bytes_read, total_bytes))
                
                self._is_running = False
                if self._on_finished:
                    self._on_finished(True, "")
                return
            except Exception as e:
                logger.error(f"Download error for {self.url} (Attempt {attempt + 1}/{max_attempts}): {e}", exc_info=True)
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
        
        self._installers = {
            "kokoro": KokoroInstaller()
        }
        
        self._download_queue = []
        self._download_engine = None
        self._download_precision = None
        self._installed_precisions_cache = {}
        
    def add_progress_callback(self, cb):
        if cb not in self._progress_callbacks:
            self._progress_callbacks.append(cb)
            
    def add_complete_callback(self, cb):
        if cb not in self._complete_callbacks:
            self._complete_callbacks.append(cb)
            
    def _emit_progress(self, bytes_read: int, total_bytes: int, name: str):
        # Only log periodically to avoid log spam, maybe every 10MB or 10%?
        # Actually, let's just log once per file at the start and end, 
        # or just log when bytes_read == 0 or bytes_read == total_bytes.
        if bytes_read == 0 or bytes_read == total_bytes or bytes_read % (1024 * 1024 * 50) < 130000:
            logger.debug(f"Progress: {bytes_read}/{total_bytes} for {name}")
        for cb in self._progress_callbacks:
            cb(bytes_read, total_bytes, name)
            
    def _emit_complete(self, success: bool, error: str):
        for cb in self._complete_callbacks:
            cb(success, error)

    def download_model(self, engine_id: str, precision: str):
        logger.info(f"download_model called: engine={engine_id}, precision={precision}")
        if self._worker and self._worker.is_running():
            logger.warning("download_model: worker already running, ignoring")
            return
            
        installer = self._installers.get(engine_id)
        if not installer:
            self._emit_complete(False, f"Engine '{engine_id}' not supported.")
            return

        app_dir = Path(self.settings_manager.get_app_directory())
        queue = installer.get_download_queue(precision, app_dir)
        
        if not queue:
            logger.error(f"download_model: invalid precision '{precision}' for {engine_id}")
            self._emit_complete(False, f"Invalid precision: {precision}")
            return
            
        self._download_queue = queue
        self._download_engine = engine_id
        self._download_precision = precision
        logger.info(f"download_model: queue={[q['name'] for q in self._download_queue]}, starting...")
        self._process_queue()
        
    def _process_queue(self):
        if not self._download_queue:
            update = {"initialSetupComplete": True}
            if self._download_engine == "kokoro" and self._download_precision:
                update["kokoroPrecision"] = self._download_precision
            self.settings_manager.update_app_config(update)
            self._installed_precisions_cache.pop(self._download_engine, None)
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
        
    def delete_model(self, engine_id: str, precision: str = "") -> bool:
        installer = self._installers.get(engine_id)
        if not installer:
            return False
            
        app_dir = Path(self.settings_manager.get_app_directory())
        res = installer.delete_model(precision, app_dir)
        if res:
            self._installed_precisions_cache.pop(engine_id, None)
        return res
            
    def is_model_installed(self, engine_id: str, precision: str = "") -> bool:
        installer = self._installers.get(engine_id)
        if not installer:
            return False
        
        app_dir = Path(self.settings_manager.get_app_directory())
        return installer.is_installed(precision, app_dir)
            
    def get_installed_precisions(self, engine_id: str) -> list[str]:
        if engine_id in self._installed_precisions_cache:
            return self._installed_precisions_cache[engine_id]

        installer = self._installers.get(engine_id)
        if not installer:
            return []
            
        app_dir = Path(self.settings_manager.get_app_directory())
        
        # We assume Kokoro for config keys for now, to avoid breaking too much UI code
        saved_precision = self.settings_manager.get_app_config().get("kokoroPrecision", "") if engine_id == "kokoro" else ""
        
        installed = installer.get_installed_precisions(app_dir, saved_precision)
        self._installed_precisions_cache[engine_id] = installed
        return installed

    def is_download_running(self) -> bool:
        return self._worker is not None and self._worker.is_running()

    def get_engine_name(self, engine_id: str) -> str:
        installer = self._installers.get(engine_id)
        if installer:
            return installer.get_engine_name()
        return "Unknown"
