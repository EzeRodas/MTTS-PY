import re
with open('src/ui/bridge.py', 'r') as f:
    content = f.read()

# 1. Add signals
signals_text = """
    setup_finished = Signal()
    download_progress = Signal(int, int, str)
    download_complete = Signal(bool, str)
"""
content = re.sub(r'(class Bridge\(QObject\):[^a-zA-Z]+)(app_ready = Signal\(\))', r'\1\2' + signals_text, content)

# 2. Add set_controller connections
conn_text = """
        mm = self._controller.get_model_manager()
        if mm:
            mm.download_progress.connect(self.download_progress.emit)
            mm.download_complete.connect(self.download_complete.emit)
"""
content = re.sub(r'(def set_controller\(self, controller\):.*?self\._controller = controller)', r'\1' + conn_text, content, flags=re.DOTALL)

# 3. Add slots
slots_text = """
    # =========================================================================
    # Model Management
    # =========================================================================

    @Slot(str)
    def downloadModel(self, precision: str):
        if self._controller:
            mm = self._controller.get_model_manager()
            if mm:
                mm.download_model(precision)

    @Slot(result=bool)
    def deleteModel(self) -> bool:
        if self._controller:
            mm = self._controller.get_model_manager()
            if mm:
                return mm.delete_model()
        return False

    @Slot(result=bool)
    def isModelInstalled(self) -> bool:
        if self._controller:
            mm = self._controller.get_model_manager()
            if mm:
                return mm.is_model_installed()
        return False

    @Slot()
    def finishSetup(self):
        self.setup_finished.emit()

    @Slot()
    def skipSetup(self):
        if self._controller:
            self._controller.update_app_config({"initialSetupComplete": True})
        self.setup_finished.emit()
"""
content = content + slots_text

with open('src/ui/bridge.py', 'w') as f:
    f.write(content)
