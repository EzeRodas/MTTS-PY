import sys
import time
from pathlib import Path
from PySide6.QtCore import QCoreApplication
from src.core.settings_manager import SettingsManager
from src.core.model_manager import ModelManager

app = QCoreApplication(sys.argv)
sm = SettingsManager()
mm = ModelManager(sm)

def on_progress(bytes_read, total_bytes, name):
    print(f"Progress: {bytes_read}/{total_bytes} for {name}")

def on_complete(success, error):
    print(f"Complete: {success}, Error: {error}")
    app.quit()

mm.add_progress_callback(on_progress)
mm.add_complete_callback(on_complete)

# Ensure deleted
mm.delete_model("kokoro", "fp16")

print("First download...")
mm.download_model("kokoro", "fp16")
app.exec()

print("Deleting...")
mm.delete_model("kokoro", "fp16")

print("Second download immediately...")
mm.download_model("kokoro", "fp16")
app.exec()

