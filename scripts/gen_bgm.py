"""Generate a chill game BGM candidate (music mode) into audio-src/ for review.
Run: & <audio-studio venv python> scripts/gen_bgm.py
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from mcp import Client, StdioServerParameters

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "audio-src"

PROMPT = ("Calm nostalgic sandbox game background music: slow sparse electric piano "
          "melody with lots of space between notes, warm soft synth pad, barely audible "
          "gentle percussion, cozy and gently cheerful with a light playful touch, "
          "minimal and airy, smooth seamless loop, no sudden changes")


async def main() -> None:
    OUT.mkdir(exist_ok=True)
    env = {
        **os.environ,
        "AUDIO_STUDIO_FFMPEG": r"C:\Users\Dmitriy Rogov\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.2-full_build\bin\ffmpeg.exe",
        "AUDIO_STUDIO_OUTPUT_DIR": str(OUT),
    }
    params = StdioServerParameters(command=sys.executable, args=["-m", "audio_studio_mcp"], env=env)
    async with Client(params, read_timeout_seconds=900) as c:
        gen = await call(c, "generate_audio", {
            "prompt": PROMPT, "audio_type": "music", "duration_seconds": 40,
            "variations": 2, "bpm": 75, "seed": 32, "title": "bgm_cat2",
            "original_idea": "calm nostalgic sandbox game bgm"})
        for i, cand in enumerate(gen["candidates"], 1):
            out = await call(c, "process_audio", {
                "input_audio": cand["path"], "trim_silence": False, "mono": True,
                "normalize": "loudness", "loudness_lufs": -18,
                "loop": True, "format": "ogg", "sample_rate": 48000})
            dest = OUT / f"bgm_cat2_{i}.ogg"
            dest.write_bytes(Path(out["path"]).read_bytes())
            print(f"OK {dest.name} {out['seconds']:.2f}s {dest.stat().st_size // 1024} KB")


async def call(client: Client, name: str, args: dict) -> dict:
    r = await client.call_tool(name, args)
    text = "".join(getattr(cc, "text", "") for cc in r.content)
    if r.is_error:
        sys.exit(f"FAILED: {name}\n{text}")
    return json.loads(text)


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
