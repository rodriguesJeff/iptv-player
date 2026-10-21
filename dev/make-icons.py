"""Generate app icons (play triangle on blue gradient) without external deps."""
import os
import struct
import sys
import zlib

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')


def png(path, w, h):
    rows = []
    tri_h = min(w, h) * 0.5
    cx, cy = w / 2 + tri_h * 0.1, h / 2
    for y in range(h):
        row = bytearray([0])
        for x in range(w):
            t = (x + y) / (w + h)
            r, g, b = int(20 + 27 * t), int(60 + 69 * t), int(140 + 107 * t)
            # right-pointing triangle centred on (cx, cy)
            dx, dy = x - (cx - tri_h / 2), abs(y - cy)
            if 0 <= dx <= tri_h and dy <= (tri_h - dx) * 0.58:
                r, g, b = 255, 255, 255
            row += bytes((r, g, b))
        rows.append(bytes(row))
    raw = zlib.compress(b''.join(rows), 9)

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)))
        f.write(chunk(b'IDAT', raw))
        f.write(chunk(b'IEND', b''))


targets = [
    ('tizen/icon.png', 512, 423),
    ('android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png', 144, 144),
    ('android/app/src/main/res/mipmap-mdpi/ic_launcher.png', 48, 48),
    ('android/app/src/main/res/drawable-xhdpi/banner.png', 320, 180),
]
for rel, w, h in targets:
    png(os.path.join(ROOT, rel), w, h)
    sys.stdout.write('wrote %s (%dx%d)\n' % (rel, w, h))
