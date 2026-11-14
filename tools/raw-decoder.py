import io
import sys

import rawpy
from PIL import Image


def main():
    data = sys.stdin.buffer.read()
    with rawpy.imread(io.BytesIO(data)) as raw:
        rgb = raw.postprocess(use_camera_wb=True, no_auto_bright=True, output_bps=8)
    image = Image.fromarray(rgb)
    image.thumbnail((1600, 1600))
    image.save(sys.stdout.buffer, format="JPEG", quality=92)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"RAW 解码失败：{error}", file=sys.stderr)
        sys.exit(1)
