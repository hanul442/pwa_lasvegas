"""Render the dealer's call-outs to public/voice/*.mp3.

The voice is Kokoro-82M (Apache-2.0), blending a British and a deep American male voice, then
lowered a touch and given a little room with ffmpeg. Run once after changing lines.py:

  pip install kokoro-onnx soundfile
  # kokoro-v1.0.onnx and voices-v1.0.bin from github.com/thewh1teagle/kokoro-onnx/releases (model-files-v1.0)
  python scripts/voice/generate.py path/to/model-dir [id ...]
"""
import json, os, subprocess, sys, tempfile
import soundfile as sf
from kokoro_onnx import Kokoro
from lines import LINES

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'public', 'voice')
PITCH = 0.92  # about 1.4 semitones down; 0.9 starts to blur words
FILTER = ','.join([
    f'asetrate=24000*{PITCH}', 'aresample=24000', f'atempo={1 / PITCH:.4f}',
    'silenceremove=start_periods=1:start_threshold=-50dB:stop_periods=-1:stop_threshold=-50dB:stop_duration=0.15',
    'equalizer=f=110:t=q:w=1:g=3', 'equalizer=f=3500:t=q:w=1.5:g=-2', 'lowpass=f=9000',
    'aecho=0.85:0.6:35|62:0.16|0.09',  # a small room, not a hall
    'apad=pad_dur=0.12', 'loudnorm=I=-16:TP=-1.5:LRA=7', 'aresample=24000'
])


def main():
    model_dir, only = sys.argv[1], set(sys.argv[2:])
    k = Kokoro(os.path.join(model_dir, 'kokoro-v1.0.onnx'), os.path.join(model_dir, 'voices-v1.0.bin'))
    voice = k.get_voice_style('bm_lewis') * 0.6 + k.get_voice_style('am_onyx') * 0.4
    os.makedirs(OUT, exist_ok=True)
    for key, line in LINES.items():
        if only and key not in only:
            continue
        text, lang = line if isinstance(line, tuple) else (line, 'en-gb')
        samples, rate = k.create(text, voice=voice, speed=0.9, lang=lang)
        with tempfile.NamedTemporaryFile(suffix='.wav') as wav:
            sf.write(wav.name, samples, rate)
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', wav.name, '-af', FILTER, '-ac', '1',
                            '-c:a', 'libmp3lame', '-b:a', '48k', os.path.join(OUT, f'{key}.mp3')], check=True)
        print(key, text)
    with open(os.path.join(OUT, 'lines.json'), 'w') as f:
        json.dump(sorted(LINES), f, indent=0)
        f.write('\n')


if __name__ == '__main__':
    main()
