#!/usr/bin/env python3
"""Cuts the app's own font files (public/fonts/) out of the full Noto Sans KR and Archivo.

Run it again after adding a lot of new Korean text (tests/fonts.test.mjs says when):

  pip install fonttools brotli
  npm pack @expo-google-fonts/noto-sans-kr @fontsource-variable/archivo   # full fonts from npm (OFL)
  tar xzf expo-google-fonts-noto-sans-kr-*.tgz && mkdir ar && tar xzf fontsource-variable-archivo-*.tgz -C ar
  python3 scripts/fonts/build.py <folder holding package/ and ar/>

What it makes:
- noto-kr-{400,500,700}.woff2: every character the app's own text uses (about 1,000), so a screen
  never waits on more than one small file per weight.
- noto-kr-{400,500,700}-ext.woff2: the rest of the 2,350 everyday Hangul syllables (KS X 1001), for
  names and chat. The browser fetches it only when such a syllable is on screen.
- archivo.woff2: Archivo, Latin only, width 100–125 and weight 400–800 (what the CSS asks for).
"""
import pathlib, sys
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

root = pathlib.Path(__file__).resolve().parents[2]
src = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '.')
out = root / 'public' / 'fonts'
out.mkdir(exist_ok=True)

# Every character in the client and in server text the client shows.
used = set()
for folder in ('public', 'lib', 'worker'):
    for p in (root / folder).rglob('*'):
        if p.suffix in ('.js', '.mjs', '.html', '.css', '.json', '.webmanifest', '.svg'):
            used |= set(p.read_text(errors='ignore'))
core = {c for c in used if ord(c) >= 0x20 and ord(c) < 0x1F000 and c != '️'}
core |= {chr(c) for c in range(0x20, 0x7F)} | {chr(c) for c in range(0x3131, 0x3164)}

everyday = set()
for b1 in range(0xB0, 0xC9):
    for b2 in range(0xA1, 0xFF):
        try:
            everyday.add(bytes([b1, b2]).decode('euc-kr'))
        except UnicodeDecodeError:
            pass
ext = everyday - core

(root / 'scripts' / 'fonts' / 'core.txt').write_text(''.join(sorted(c for c in core if 0xAC00 <= ord(c) <= 0xD7A3)) + '\n')

def cut(font, chars, path):
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = ['*']
    opts.hinting = False
    opts.name_IDs = ['*']
    sub = subset.Subsetter(opts)
    sub.populate(text=''.join(chars))
    sub.subset(font)
    font.flavor = 'woff2'
    font.save(path)
    print(path.relative_to(root), path.stat().st_size // 1024, 'KB')

for weight, name in ((400, '400Regular'), (500, '500Medium'), (700, '700Bold')):
    ttf = src / 'package' / name / f'NotoSansKR_{name}.ttf'
    cut(TTFont(ttf), core, out / f'noto-kr-{weight}.woff2')
    cut(TTFont(ttf), ext, out / f'noto-kr-{weight}-ext.woff2')

archivo = instancer.instantiateVariableFont(TTFont(src / 'ar' / 'package' / 'files' / 'archivo-latin-wdth-normal.woff2'), {'wght': (400, 800), 'wdth': (100, 125)})
cut(archivo, {c for c in core if ord(c) < 0x3000}, out / 'archivo.woff2')
