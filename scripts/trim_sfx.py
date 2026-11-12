"""Cut SFX to their transient (game-like short hit): find energy peak/attack,
crop a tight window with fade-out, normalize, write ogg+mp3.
Run: & <audio-studio venv python> scripts/trim_sfx.py
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets" / "audio"
FFMPEG = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
    r"C:\Users\Dmitriy Rogov\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.2-full_build\bin\ffmpeg.exe")

SR = 48000
# имя -> (мс до пика, мс длительность после старта)
PLAN = {"pickaxe": (60, 420), "purchase": (30, 700)}


def load_wav(src: Path, tmp: Path) -> np.ndarray:
    wav = tmp / "t.wav"
    subprocess.run([str(FFMPEG), "-y", "-loglevel", "error", "-i", str(src),
                    "-ac", "1", "-ar", str(SR), str(wav)], check=True)
    raw = wav.read_bytes()
    return np.frombuffer(raw[44:], dtype=np.int16).astype(np.float32) / 32768.0


def save(clip: np.ndarray, base: Path) -> None:
    fade = int(0.08 * SR)
    clip[-fade:] *= np.linspace(1, 0, fade, dtype=np.float32)
    peak = np.max(np.abs(clip))
    if peak > 0:
        clip *= 0.891 / peak  # -1 dBFS
    pcm = (clip * 32767).astype(np.int16)
    tmp = base.parent / "_t.wav"
    import wave
    with wave.open(str(tmp), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    for fmt, args in (("ogg", ["-qscale:a", "5"]), ("mp3", ["-qscale:a", "2"])):
        out = base.with_suffix(f".{fmt}")
        subprocess.run([str(FFMPEG), "-y", "-loglevel", "error", "-i", str(tmp),
                        "-codec:a", "libmp3lame" if fmt == "mp3" else "libvorbis", *args, str(out)], check=True)
        print(f"OK {out.name} {len(clip)/SR:.2f}s {out.stat().st_size // 1024} KB")
    tmp.unlink()


def main() -> None:
    with tempfile.TemporaryDirectory() as td:
        for name, (pre_ms, total_ms) in PLAN.items():
            for i in (1, 2):
                src = ASSETS / f"{name}_{i}.ogg"
                x = load_wav(src, Path(td))
                win = SR // 100  # 10 мс RMS-окна
                n = len(x) // win
                rms = np.sqrt(np.mean(x[:n * win].reshape(n, win) ** 2, axis=1))
                peak = int(np.argmax(rms))
                peak_ms = peak * 10
                if name == "purchase":
                    # blip с двумя нотами: старт по первому всплеску, конец по последнему
                    # значимому (>= 20% пика) + хвост 200мс, потолок 900мс
                    start = int(np.argmax(rms >= 0.2 * rms[peak]))
                    burst = [j for j, v in enumerate(rms) if v >= 0.2 * rms[peak]]
                    end_ms = min(900, (burst[-1] + 1) * 10 + 200)
                else:
                    # удар: окно вокруг пика энергии (пик может быть не в начале файла!)
                    start = max(0, peak_ms - pre_ms)
                    end_ms = start + total_ms
                clip = x[start * SR // 1000: end_ms * SR // 1000].copy()
                want = (end_ms - start) * SR // 1000
                if len(clip) < want:
                    clip = np.pad(clip, (0, want - len(clip)))
                print(f"{name}_{i}: пик {peak_ms}мс, вырез {start}..{end_ms}мс", file=sys.stderr)
                save(clip, ASSETS / f"{name}_{i}")


if __name__ == "__main__":
    main()
