"""Synthesize game SFX directly (no model — prompts failed 3x on short transients):
- pickaxe: сухой мягкий «тк» — полосовой шум ~280 Гц + лёгкий тумп 130 Гц, ~0.11с
- break:   разрушение блока — ниже и плотнее «тумк» ~190 Гц + тумп 85 Гц, ~0.22с
- purchase: приятный игровой поп — маримба из двух нот (E5 -> B5), ~0.24с
Deterministic (seeded). Writes *_1/2.ogg+mp3. Run: & <venv python> scripts/synth_sfx.py
"""
from __future__ import annotations

import subprocess
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets" / "audio"
FFMPEG = Path(r"C:\Users\Dmitriy Rogov\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.2-full_build\bin\ffmpeg.exe")
SR = 48000


def bandpass(x: np.ndarray, center: float, width: float) -> np.ndarray:
    """Гауссова полоса в FFT — тёплое «дерево», без звона."""
    X = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(len(x), 1.0 / SR)
    g = np.exp(-0.5 * ((freqs - center) / width) ** 2)
    return np.fft.irfft(X * g, n=len(x))


def env(n: int, attack_s: float, tau: float) -> np.ndarray:
    t = np.arange(n, dtype=np.float32) / SR
    return np.minimum(t / attack_s, 1.0) * np.exp(-t / tau)


def rng_of(seed: int) -> np.random.Generator:
    return np.random.default_rng(seed)


def knock(center: float, width: float, thump_f: float, dur: float, tau_n: float, tau_t: float, thump_amp: float, seed: int,
          upper: tuple = None) -> np.ndarray:
    """Удар по блоку: широкая шумовая полоса (текстура) + лёгкий тумп (тело).
    upper — (центр, ширина, доля) второй полосы: каменная крошка, убирает «пластмассу»."""
    n = int(SR * dur)
    t = np.arange(n, dtype=np.float32) / SR
    noise = bandpass(rng_of(seed).normal(0, 1, n).astype(np.float32), center, width) * env(n, 0.004, tau_n)
    if upper:
        uc, uw, ua = upper
        noise = noise + ua * bandpass(rng_of(seed + 1).normal(0, 1, n).astype(np.float32), uc, uw) * env(n, 0.003, tau_n * 0.7)
    thump = np.sin(2 * np.pi * thump_f * t) * env(n, 0.003, tau_t) * thump_amp
    x = noise + thump
    fade_in = int(0.0015 * SR)
    x[:fade_in] *= np.linspace(0, 1, fade_in, dtype=np.float32)
    return x


def collapse(dur: float = 0.30, seed: int = 21) -> np.ndarray:
    """Разрушение блока в духе майнкрафта: глубокий удар (фаза 1) + короткий
    низкочастотный развал (фаза 2) — финал читается как «блок добылся»,
    без шелеста крошек."""
    n = int(SR * dur)
    t = np.arange(n, dtype=np.float32) / SR
    # фаза 1: удар — глухой тумп + плотная низкая полоса
    hit_n = bandpass(rng_of(seed).normal(0, 1, n).astype(np.float32), 200, 130) * env(n, 0.004, 0.028)
    hit_t = np.sin(2 * np.pi * 75 * t) * env(n, 0.003, 0.032) * 0.85
    # фаза 2: развал — шум ниже и мягче, стартует с 45мс и гаснет
    mask = np.zeros(n, dtype=np.float32)
    s = int(0.045 * SR)
    mask[s:] = env(n - s, 0.020, 0.060) * 0.5
    fall = bandpass(rng_of(seed + 3).normal(0, 1, n).astype(np.float32), 240, 160) * mask
    x = hit_n + hit_t + fall
    fade_in = int(0.0015 * SR)
    x[:fade_in] *= np.linspace(0, 1, fade_in, dtype=np.float32)
    return x


def button_tap(thump_f: float, center: float, seed: int) -> np.ndarray:
    """Нажатие кнопки: короткий тёмный «ток» — шумовой тап + глухой тумп.
    Никаких нот — звук действия, а не уведомления."""
    n = int(SR * 0.10)
    t = np.arange(n, dtype=np.float32) / SR
    tap = bandpass(rng_of(seed).normal(0, 1, n).astype(np.float32), center, 200) * env(n, 0.003, 0.016)
    thump = np.sin(2 * np.pi * thump_f * t) * env(n, 0.003, 0.022) * 0.6
    x = tap + thump
    fade_in = int(0.0015 * SR)
    x[:fade_in] *= np.linspace(0, 1, fade_in, dtype=np.float32)
    return x


def save(x: np.ndarray, base: Path, db: float) -> None:
    peak = np.max(np.abs(x))
    x = x * (10 ** (db / 20) / peak)
    fade = int(0.02 * SR)
    x[-fade:] *= np.linspace(1, 0, fade, dtype=np.float32)
    pcm = (np.clip(x, -1, 1) * 32767).astype(np.int16)
    tmp = base.parent / "_s.wav"
    with wave.open(str(tmp), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    for fmt, codec, args in (("ogg", "libvorbis", ["-qscale:a", "5"]), ("mp3", "libmp3lame", ["-qscale:a", "2"])):
        out = base.with_suffix(f".{fmt}")
        subprocess.run([str(FFMPEG), "-y", "-loglevel", "error", "-i", str(tmp), "-codec:a", codec, *args, str(out)], check=True)
        print(f"OK {out.name} {len(x)/SR:.2f}s {out.stat().st_size // 1024} KB")
    tmp.unlink()


def main() -> None:
    # Кирка: каменный «тк» как в майнкрафте — широкая шумовая текстура, тумп почти неслышен
    # (пластмассовость = чистый синус; шумовые полосы дают камень)
    save(knock(250, 220, 120, 0.11, 0.026, 0.014, 0.30, seed=11, upper=(820, 320, 0.22)), ASSETS / "pickaxe_1", -3.0)
    save(knock(300, 250, 140, 0.10, 0.023, 0.013, 0.28, seed=12, upper=(950, 360, 0.20)), ASSETS / "pickaxe_2", -3.0)
    # Разрушение: глубокий удар + короткий развал — «блок добылся» читается явно
    save(collapse(dur=0.30, seed=21), ASSETS / "break_1", -2.5)
    save(collapse(dur=0.28, seed=22), ASSETS / "break_2", -2.5)
    # Покупка: короткий тёмный «ток» нажатой кнопки (не уведомление, без высоких нот)
    save(button_tap(150, 240, seed=31), ASSETS / "purchase_1", -3.0)
    save(button_tap(170, 300, seed=32), ASSETS / "purchase_2", -3.0)
    # Крит: акцентный удар — ниже и плотнее кирки, с явным весом, без металлического лязга
    save(knock(230, 190, 100, 0.14, 0.032, 0.024, 0.55, seed=41, upper=(620, 260, 0.16)), ASSETS / "crit_1", -2.5)
    save(knock(260, 210, 110, 0.13, 0.029, 0.022, 0.52, seed=42, upper=(680, 280, 0.15)), ASSETS / "crit_2", -2.5)


if __name__ == "__main__":
    main()
