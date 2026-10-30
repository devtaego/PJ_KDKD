"""효과음: 짧은 소리를 코드로 만들어(wav) 재생. 소리 파일을 따로 넣지 않아도 됨.

play("roll") 처럼 부르면 됨. enabled = False면 조용히.
Windows는 winsound, 맥은 afplay, 리눅스는 aplay/paplay.
"""
import math
import os
import random
import struct
import subprocess
import sys
import tempfile
import time
import wave

RATE = 22050
enabled = True
_files = {}
_last = {}


def _tone(freq, dur, vol=0.5, decay=8.0, shape="sine", start=0.0):
    n = int(dur * RATE)
    out = []
    for i in range(n):
        t = i / RATE
        f = freq(t) if callable(freq) else freq
        ph = 2 * math.pi * f * t
        if shape == "sine":
            v = math.sin(ph)
        elif shape == "tri":
            v = 2 / math.pi * math.asin(math.sin(ph))
        else:
            v = 1.0 if math.sin(ph) >= 0 else -1.0
        env = min(1.0, t / 0.004) * math.exp(-decay * t)
        out.append(v * vol * env)
    return [0.0] * int(start * RATE) + out


def _noise(dur, vol=0.5, decay=40.0, seed=1, start=0.0, lowpass=0.3):
    rnd = random.Random(seed)
    n = int(dur * RATE)
    out, prev = [], 0.0
    for i in range(n):
        t = i / RATE
        prev = prev + lowpass * (rnd.uniform(-1, 1) - prev)  # 살짝 둥근 잡음
        out.append(prev * vol * math.exp(-decay * t) * min(1.0, t / 0.002))
    return [0.0] * int(start * RATE) + out


def _mix(*tracks):
    n = max(len(t) for t in tracks)
    return [sum(t[i] for t in tracks if i < len(t)) for i in range(n)]


def _make(name):
    if name == "click":
        return _tone(1400, 0.05, 0.25, 60)
    if name == "pop":
        return _tone(lambda t: 600 + 900 * t / 0.08, 0.09, 0.3, 30)
    if name == "place":  # 돌/기물 탁
        return _mix(_noise(0.07, 0.9, 70, 3, lowpass=0.5), _tone(220, 0.08, 0.4, 45))
    if name == "move":
        return _mix(_noise(0.06, 0.6, 80, 5, lowpass=0.4), _tone(330, 0.06, 0.25, 55))
    if name == "shake":  # 컵 안에서 달그락
        return _mix(*[_noise(0.03, 0.7, 120, k, start=k * 0.045, lowpass=0.6) for k in range(4)])
    if name == "roll":  # 주사위가 펠트 위로 굴러감
        rnd = random.Random(9)
        return _mix(*[_noise(0.04, rnd.uniform(0.4, 0.8), 90, k, start=k * 0.055 + rnd.uniform(0, 0.02),
                             lowpass=0.55) for k in range(9)])
    if name == "thud":  # 티배깅 쿵
        return _mix(_tone(lambda t: 120 - 60 * t / 0.15, 0.16, 0.8, 18), _noise(0.05, 0.5, 60, 7, lowpass=0.2))
    if name == "win":
        notes = [523, 659, 784, 1047]
        return _mix(*[_tone(f, 0.28, 0.32, 6, "tri", start=i * 0.11) for i, f in enumerate(notes)])
    if name == "lose":
        return _mix(_tone(392, 0.3, 0.3, 5, "tri"), _tone(311, 0.45, 0.3, 4, "tri", start=0.22))
    if name == "join":
        return _mix(_tone(660, 0.12, 0.25, 15), _tone(880, 0.15, 0.25, 12, start=0.09))
    return []


def _path(name):
    if name not in _files:
        data = _make(name)
        if not data:
            return None
        path = os.path.join(tempfile.gettempdir(), f"kidk_{name}.wav")
        with wave.open(path, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(RATE)
            w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, v)) * 30000)) for v in data))
        _files[name] = path
    return _files[name]


def play(name):
    """효과음 재생 (실패해도 게임은 계속)."""
    if not enabled:
        return
    now = time.monotonic()
    if now - _last.get(name, 0) < 0.05:
        return
    _last[name] = now
    try:
        path = _path(name)
        if not path:
            return
        if sys.platform == "win32":
            import winsound
            winsound.PlaySound(path, winsound.SND_FILENAME | winsound.SND_ASYNC | winsound.SND_NODEFAULT)
        elif sys.platform == "darwin":
            subprocess.Popen(["afplay", path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            for cmd in (["paplay", path], ["aplay", "-q", path]):
                try:
                    subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    break
                except OSError:
                    continue
    except Exception:
        pass


def play_later(widget, name, ms):
    widget.after(int(ms), lambda: play(name))
