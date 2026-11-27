# Turns record.mjs's frames into docs/screenshots: python3 scripts/readme-media/make.py (needs Pillow).
import json
import os
import tempfile
from PIL import Image, ImageDraw, ImageFilter

FRAMES = os.path.join(tempfile.gettempdir(), 'yarc-readme-media')
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'docs', 'screenshots')
GIFS = {'spaces': 'spaces.gif', 'command': 'command-bar.gif', 'split': 'split-view.gif', 'peek': 'peek.gif', 'canvases': 'canvases.gif'}
STILLS = {'split': 'split-view.png', 'peek': 'peek.png'}
WIDTH = 1088
ARROW = [(0, 0), (0, 17), (4.5, 13), (7.5, 20), (10, 19), (7, 12.5), (12.5, 12.5)]


def with_cursor(im, at):
    if at:
        scale = WIDTH / 1360
        x, y = at[0] * scale, at[1] * scale
        ImageDraw.Draw(im).polygon([(x + px * 1.1, y + py * 1.1) for px, py in ARROW], fill='black', outline='white', width=1)
    return im


def gif(name, out):
    frames = json.load(open(os.path.join(FRAMES, name + '.json')))
    images, durations, previous = [], [], None
    for f in frames:
        im = Image.open(f['file']).convert('RGB')
        im = with_cursor(im.resize((WIDTH, round(WIDTH * im.height / im.width)), Image.LANCZOS), f['cursor'])
        if previous is not None and f['fade']:
            for alpha in (0.33, 0.66):
                images.append(Image.blend(previous, im, alpha))
                durations.append(60)
        images.append(im)
        durations.append(f['hold'])
        previous = im
    # One palette for every frame, so colours don't flicker between them.
    keys = images[:: max(1, len(images) // 8)]
    mosaic = Image.new('RGB', (WIDTH, keys[0].height * (len(keys) + 1)))
    for i, k in enumerate(keys):
        mosaic.paste(k, (0, i * k.height))
    # The traffic lights are a few pixels; without extra weight the palette has no red or green for them.
    corner = images[0].crop((0, 0, 90, 30))
    for x in range(0, WIDTH, 90):
        for y in range(len(keys) * keys[0].height, mosaic.height, 30):
            mosaic.paste(corner, (x, y))
    palette = mosaic.quantize(colors=255, method=Image.Quantize.MEDIANCUT)
    frames = [i.quantize(palette=palette, dither=Image.Dither.NONE) for i in images]
    frames[0].save(out, save_all=True, append_images=frames[1:], duration=durations, loop=0, optimize=True, disposal=1)


def png(im, out):
    im.save(out, optimize=True)


def last_frame(name, out):
    frames = json.load(open(os.path.join(FRAMES, name + '.json')))
    png(Image.open(frames[-1]['file']).convert('RGB'), out)


def floating_player(out):
    player = json.load(open(os.path.join(FRAMES, 'floating', 'player.json')))
    main = Image.open(os.path.join(FRAMES, 'floating', '000-main.png')).convert('RGBA')
    window = Image.open(os.path.join(FRAMES, 'floating', 'player.png')).convert('RGBA')
    scale = main.width / player['main']['width']
    x, y = round((player['bounds']['x'] - player['main']['x']) * scale), round((player['bounds']['y'] - player['main']['y']) * scale)
    shadow = Image.new('RGBA', main.size)
    shadow.paste(Image.new('RGBA', window.size, (0, 0, 0, 110)), (x, y + 12), window)
    composite = Image.alpha_composite(main, shadow.filter(ImageFilter.GaussianBlur(22)))
    composite.alpha_composite(window, (x, y))
    png(composite.convert('RGB'), out)


def made(name):
    return os.path.exists(os.path.join(FRAMES, name))


for name, file in GIFS.items():
    if made(name):
        gif(name, os.path.join(OUT, file))
for name, file in STILLS.items():
    if made(name):
        last_frame(name, os.path.join(OUT, file))
if made('hero'):
    png(Image.open(os.path.join(FRAMES, 'hero', '000-hero.png')).convert('RGB'), os.path.join(OUT, 'sidebar.png'))
if made('little'):
    png(Image.open(os.path.join(FRAMES, 'little', 'little.png')).convert('RGBA'), os.path.join(OUT, 'little-window.png'))
if made('floating'):
    floating_player(os.path.join(OUT, 'floating-player.png'))
