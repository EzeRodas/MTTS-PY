import numpy as np
import subprocess

samplerate = 24000
t = np.linspace(0, 1, samplerate, False)
audio = np.sin(2 * np.pi * 440 * t).astype(np.float32)

proc = subprocess.Popen(
    ["paplay", "--raw", "--channels=1", "--rate=24000", "--format=float32le"],
    stdin=subprocess.PIPE
)
proc.stdin.write(audio.tobytes())
proc.stdin.flush()
proc.stdin.close()
proc.wait()
