"""
Lê os códigos de barras das páginas renderizadas (PNG a 203 dpi, resolução de
impressora térmica) e confere se continuam legíveis após a unificação.

    python3 tests/check_barcodes.py <pasta-com-pngs>

Requer opencv-contrib-python (cv2.barcode). A pasta deve conter samples/codigos-esperados.json.
"""
import glob
import os
import sys

import cv2

import json

# Os exemplos trazem códigos EAN-13 (vetoriais e em imagem). O leitor do OpenCV
# decodifica EAN/UPC; por isso a verificação de legibilidade usa esses códigos.
EXPECTED = set()


def decode(path):
    img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    det = cv2.barcode.BarcodeDetector()
    found = set()
    # O localizador do OpenCV é sensível a escala e a códigos vizinhos: tenta a
    # imagem em 0° e 90°, em algumas escalas e também em faixas horizontais.
    for rot in (None, cv2.ROTATE_90_CLOCKWISE):
        base = img if rot is None else cv2.rotate(img, rot)
        for scale in (1.0, 1.5, 0.75):
            im = base if scale == 1.0 else cv2.resize(base, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
            candidates = [im]
            h = im.shape[0]
            step = max(1, h // 6)
            candidates += [im[y:y + step * 2] for y in range(0, h - step, step)]
            for c in candidates:
                res = det.detectAndDecodeMulti(c)
                if res[0]:
                    found.update(i for i in res[1] if i)
    return found


def main(folder):
    with open(os.path.join(folder, "samples", "codigos-esperados.json")) as f:
        EXPECTED.update(json.load(f)["ean13"])
    by_scenario = {}
    for png in sorted(glob.glob(os.path.join(folder, "saida-*-p*.png"))):
        scenario = os.path.basename(png).rsplit("-p", 1)[0]
        by_scenario.setdefault(scenario, set()).update(decode(png))
    failed = False
    for scenario, found in sorted(by_scenario.items()):
        missing = EXPECTED - found
        status = "OK" if not missing else "FALTANDO " + ", ".join(sorted(missing))
        if missing:
            failed = True
        print(f"{scenario:28s} lidos {len(found & EXPECTED):2d}/{len(EXPECTED)}  {status}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
