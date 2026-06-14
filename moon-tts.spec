# -*- mode: python ; coding: utf-8 -*-
import os
import sys
from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs

block_cipher = None

# Include frontend web assets (HTML, CSS, JS) inside the executable
datas = [
    ('src/ui/web', 'src/ui/web'),
] + collect_data_files('kokoro_onnx') + collect_data_files('language_tags') + collect_data_files('phonemizer') + collect_data_files('espeakng_loader')

a = Analysis(
    ['src/main.py'],
    pathex=[],
    binaries=collect_dynamic_libs('espeakng_loader'),
    datas=datas,
    hiddenimports=['sounddevice', 'soundfile', 'kokoro_onnx', 'dbus_next', 'pynput'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'PySide6.Qt3DCore',
        'PySide6.Qt3DAnimation',
        'PySide6.Qt3DInput',
        'PySide6.Qt3DLogic',
        'PySide6.Qt3DExtras',
        'PySide6.Qt3DRender',
        'PySide6.QtCharts',
        'PySide6.QtDataVisualization',
        'PySide6.QtBluetooth',
        'PySide6.QtSensors',
        'PySide6.QtNfc',
        'PySide6.QtMultimedia',
        'PySide6.QtMultimediaWidgets',
        'PySide6.QtSpatialAudio',
        'PySide6.QtSql',
        'PySide6.QtTest',
        'PySide6.QtWebSockets',
        'PySide6.QtHelp',
        'PySide6.QtPdf',
        'PySide6.QtPdfWidgets',
        'PySide6.QtRemoteObjects',
        'PySide6.QtStateMachine',
        'PySide6.QtScxml',
        'PySide6.QtTextToSpeech',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
# Filter out unnecessary binaries and datas to reduce size and prevent extraction failures
excluded_bin_patterns = [
    '3d', 'multimedia', 'bluetooth', 'sensors', 'nfc', 'charts', 
    'datavisualization', 'spatialaudio', 'sql', 'test', 'pdf', 
    'remoteobjects', 'scxml', 'texttospeech', 'bifrost', 'quick3d', 
    'designer', 'virtualkeyboard', 'location', 'websockets', 'help'
]

a.binaries = [
    (name, path, typecode) for name, path, typecode in a.binaries
    if not any(pat in name.lower() or pat in os.path.basename(path).lower() for pat in excluded_bin_patterns)
]

a.datas = [
    (name, path, typecode) for name, path, typecode in a.datas
    if not any(pat in name.lower() or pat in os.path.basename(path).lower() for pat in excluded_bin_patterns)
]

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='moon-tts',
    debug=False,
    contents_directory='.',
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='src/ui/web/assets/icon.png',
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='moon-tts',
)
