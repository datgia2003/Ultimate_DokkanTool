"""Compose the game's thumbnail layers using Dokkan Eclipse's card-icon layout."""
from io import BytesIO
from pathlib import Path
import hashlib
import threading
import requests
from PIL import Image

_lock = threading.Lock()
_root = Path(__file__).resolve().parents[2] / '.runtime' / 'game-thumbnails'
_cdn = 'https://cdn.dokkan-eclipse.com/layout/image/'


def _layer(relative):
    path = _root / 'layers' / relative
    if not path.is_file():
        response = requests.get(_cdn + relative, timeout=15)
        response.raise_for_status()
        data = response.content
        with Image.open(BytesIO(data)) as check:
            check.verify()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    with Image.open(path) as source:
        return source.convert('RGBA')


def game_thumbnail(card, portrait_path):
    rarity = int(card.get('rarity') or 0)
    element = int(card.get('element') or 0)
    if rarity not in range(6) or element not in (*range(5), *range(10, 15), *range(20, 25)):
        return portrait_path
    eza = bool(card.get('optimal_awakening_grow_type'))
    stamp = Path(portrait_path).stat()
    key = hashlib.sha256(f'v3:{card["id"]}:{rarity}:{element}:{eza}:{portrait_path}:{stamp.st_mtime_ns}'.encode()).hexdigest()[:24]
    output = _root / (key + '.png')
    if output.is_file():
        return output
    with _lock:
        if output.is_file():
            return output
        canvas = Image.new('RGBA', (216, 216))
        # Eclipse's desktop .card-art-icon: 144 x 135. Use this layout for
        # every layer; the small-card rules belong to a different container.
        left, top, width, height = 32, 32, 144, 135

        def paste(image, x, y, height=None, width=None):
            if height is not None:
                size = (round(image.width * height / image.height), round(height))
            else:
                size = (round(width), round(image.height * width / image.width))
            image = image.resize(size, Image.Resampling.LANCZOS)
            canvas.alpha_composite(image, (round(x), round(y)))
            return size

        base = _layer(f'character/character_thumb_bg/cha_base_{element % 10:02d}_{rarity:02d}.png')
        # The base wrapper uses flex align-items:center; the PNG is square,
        # so its top is above the rectangular wrapper's top.
        base_height = base.height * width / base.width
        paste(base, left, top + (height - base_height) / 2, width=width)
        with Image.open(portrait_path) as portrait:
            portrait = portrait.convert('RGBA')
            portrait = portrait.resize(
                (round(portrait.width * 180 / portrait.height), 180),
                Image.Resampling.LANCZOS,
            )
            # Local portraits have different transparent margins. Center the
            # visible artwork on the frame instead of offsetting the full PNG.
            bounds = portrait.getchannel('A').getbbox()
            if bounds:
                center_x = left + width / 2
                center_y = top + height / 2
                canvas.alpha_composite(portrait, (
                    round(center_x - (bounds[0] + bounds[2]) / 2),
                    round(center_y - (bounds[1] + bounds[3]) / 2),
                ))
        rare = _layer(f'character/cha_rare_sm_{["n", "r", "sr", "ssr", "ur", "lr"][rarity]}.png')
        paste(rare, left - width * .16, top + height * 1.22 - 86, height=86)
        kind = _layer(f'character/cha_type_icon_{element:02d}.png')
        paste(kind, left + width * 1.18 - kind.width * 64 / kind.height, top - height * .12, height=64)
        if eza:
            badge = _layer('charamenu/dokkan/dok_img_kyokugen.png')
            paste(badge, left + width * 1.22 - badge.width * 70 / badge.height, top + height * 1.18 - 70, height=70)
        output.parent.mkdir(parents=True, exist_ok=True)
        canvas.save(output)
    return output


def game_badge(kind, value):
    """Standalone ingame icon with transparent atlas padding removed."""
    if kind == 'rarity' and value in range(6):
        relative = f'character/cha_rare_sm_{["n", "r", "sr", "ssr", "ur", "lr"][value]}.png'
    elif kind == 'element' and value in (*range(5), *range(10, 15), *range(20, 25)):
        relative = f'character/cha_type_icon_{value:02d}.png'
    else:
        return None
    output = _root / f'badge-v1-{kind}-{value}.png'
    with _lock:
        if not output.is_file():
            icon = _layer(relative)
            bounds = icon.getchannel('A').getbbox()
            if bounds:
                icon = icon.crop(bounds)
            output.parent.mkdir(parents=True, exist_ok=True)
            icon.save(output)
    return output
