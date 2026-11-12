"""Generate all game SFX via audio-studio MCP (Stable Audio 3) and process to OGG 48k.

Run with the audio-studio venv python:
  & "C:/Users/Dmitriy Rogov/tools/audio-studio-mcp/.venv/Scripts/python.exe" scripts/gen_sfx.py

Writes candidates into audio-src/ (WAV + .json sidecars) and processed
variants into assets/audio/ (OGG 48kHz mono, <name>_<n>.ogg).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

from mcp import Client, StdioServerParameters

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "audio-src"
ASSETS = ROOT / "assets" / "audio"
# ffmpeg не в PATH текущих сессий (ставился через winget) — полный путь
FFMPEG = Path(os.environ.get("AUDIO_STUDIO_FFMPEG",
    r"C:\Users\Dmitriy Rogov\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.2-full_build\bin\ffmpeg.exe"))

SFX = [
    # pickaxe/break/purchase — СИНТЕЗ (scripts/synth_sfx.py): pickaxe, break, purchase, crit — не перегенерируются моделью
    {
        "name": "tier", "seconds": 3.5,
        "fields": {
            "sound_source": "mine elevator",
            "sound_action": "deep whoosh descending, then a soft landing thud",
            "sound_material": "heavy iron chains, low rumble",
            "sound_space": "inside a mine shaft, medium distance, cavernous tail",
        },
    },
    {
        "name": "prestige", "seconds": 3.5,
        "fields": {
            "sound_source": "triumphant game chime",
            "sound_action": "ascending arpeggio of three notes, then a soft glowing chord",
            "sound_material": "glassy bells, warm sparkle",
            "sound_space": "close mic, dry, bright",
        },
    },
    {
        "name": "mutation", "seconds": 3.5,
        "fields": {
            "sound_source": "magic shimmer",
            "sound_action": "rising shimmering sweep, then a mysterious pulsing glow",
            "sound_material": "crystalline sparkle, airy synth",
            "sound_space": "close mic, dry",
        },
    },
]


async def main() -> None:
    # Регенерация выборочно: python gen_sfx.py pickaxe purchase — только эти звуки
    only = set(a for a in sys.argv[1:] if not a.startswith("-"))
    OUT.mkdir(exist_ok=True)
    ASSETS.mkdir(exist_ok=True)
    env = {
        **os.environ,
        "AUDIO_STUDIO_FFMPEG": r"C:\Users\Dmitriy Rogov\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.2-full_build\bin\ffmpeg.exe",
        "AUDIO_STUDIO_OUTPUT_DIR": str(OUT),
    }
    params = StdioServerParameters(
        command=sys.executable, args=["-m", "audio_studio_mcp"], env=env)
    async with Client(params, read_timeout_seconds=900) as c:
        for s in SFX:
            if only and s["name"] not in only:
                continue
            # seed: свой на звук (иначе регенерация с тем же seed даёт почти тот же звук);
            # negative работает только при cfg != 1
            gen = await call(c, "generate_audio", {
                "audio_type": "sfx", "duration_seconds": s["seconds"],
                "variations": 2, "seed": s.get("seed", 42), "title": s["name"],
                "cfg": s.get("cfg", 1.0), "negative_prompt": s.get("negative") or None,
                "original_idea": s["name"], **s["fields"]})
            for i, cand in enumerate(gen["candidates"], 1):
                # process_audio: только wav/ogg/flac — ogg делаем им, mp3 конвертирует ffmpeg
                out = await call(c, "process_audio", {
                    "input_audio": cand["path"], "trim_silence": True, "mono": True,
                    "normalize": "peak", "peak_ceiling_db": -1,
                    "format": "ogg", "sample_rate": 48000})
                ogg = ASSETS / f"{s['name']}_{i}.ogg"
                ogg.write_bytes(Path(out["path"]).read_bytes())
                print(f"OK {ogg.name} {out['seconds']:.2f}s {ogg.stat().st_size // 1024} KB")
                mp3 = ASSETS / f"{s['name']}_{i}.mp3"
                subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", str(ogg),
                                "-codec:a", "libmp3lame", "-qscale:a", "5", str(mp3)], check=True)
                print(f"OK {mp3.name} {mp3.stat().st_size // 1024} KB")


async def call(client: Client, name: str, args: dict) -> dict:
    r = await client.call_tool(name, args)
    text = "".join(getattr(cc, "text", "") for cc in r.content)
    if r.is_error:
        sys.exit(f"FAILED: {name}\n{text}")
    return json.loads(text)


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
