"""
Visual parity check for the Shipping Invoice PDF (dev tool; needs Python + pypdfium2 + Pillow).

  python scripts/compare-shipping-pdf.py <reference.pdf> <generated.pdf> <out-dir>
  python scripts/compare-shipping-pdf.py --extract-logo <reference.pdf> <logo.png>

For each page pair it writes:
  page<N>-side.png     reference (left) | generated (right)
  page<N>-overlay.png  black = ink in both, red = only in reference, blue = only in generated
and prints the share of ink pixels that match (a 1px tolerance absorbs anti-aliasing).
"""
import sys

import pypdfium2 as pdfium
from PIL import Image, ImageChops, ImageFilter

SCALE = 2


def render(path):
    pdf = pdfium.PdfDocument(path)
    return [pdf[i].render(scale=SCALE).to_pil().convert('L') for i in range(len(pdf))]


def ink(img):
    return img.point(lambda v: 255 if v < 200 else 0)


def compare(ref_path, gen_path, out_dir):
    import os
    os.makedirs(out_dir, exist_ok=True)
    refs, gens = render(ref_path), render(gen_path)
    print(f'pages: reference={len(refs)} generated={len(gens)}')
    for index, (ref, gen) in enumerate(zip(refs, gens), start=1):
        if gen.size != ref.size:
            print(f'page {index}: size differs {ref.size} vs {gen.size}')
            gen = gen.resize(ref.size)
        ref_ink, gen_ink = ink(ref), ink(gen)
        ref_grown = ref_ink.filter(ImageFilter.MaxFilter(3))
        gen_grown = gen_ink.filter(ImageFilter.MaxFilter(3))
        only_ref = ImageChops.subtract(ref_ink, gen_grown)
        only_gen = ImageChops.subtract(gen_ink, ref_grown)
        total = max(1, sum(1 for v in ref_ink.getdata() if v))
        miss = sum(1 for v in only_ref.getdata() if v)
        extra = sum(1 for v in only_gen.getdata() if v)
        print(f'page {index}: ink match {100 * (1 - miss / total):.2f}%  (missing {miss}px, extra {extra}px of {total}px)')
        overlay = Image.new('RGB', ref.size, 'white')
        both = ImageChops.multiply(ref_ink, gen_grown)
        overlay.paste((0, 0, 0), mask=both)
        overlay.paste((230, 30, 30), mask=only_ref)
        overlay.paste((30, 80, 230), mask=only_gen)
        overlay.save(os.path.join(out_dir, f'page{index}-overlay.png'))
        side = Image.new('L', (ref.width * 2 + 20, ref.height), 255)
        side.paste(ref, (0, 0))
        side.paste(gen, (ref.width + 20, 0))
        side.save(os.path.join(out_dir, f'page{index}-side.png'))


def extract_logo(ref_path, out_path):
    import pypdf
    image = pypdf.PdfReader(ref_path).pages[0].images[0].image
    image.save(out_path)
    print('saved logo', out_path, image.size)


if __name__ == '__main__':
    if sys.argv[1] == '--extract-logo':
        extract_logo(sys.argv[2], sys.argv[3])
    else:
        compare(sys.argv[1], sys.argv[2], sys.argv[3])
