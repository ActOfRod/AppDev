from pathlib import Path
from PIL import Image, ImageDraw

image = Image.new('RGBA', (2048, 2048))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((16, 16, 2032, 2032), radius=420, fill='#111827')
draw.rounded_rectangle((100, 100, 1948, 1948), radius=350, outline='#8b72ff', width=48)
draw.line([(430, 550), (900, 1510), (1550, 550)], fill='#8b72ff', width=190, joint='curve')
draw.polygon([(950, 590), (1510, 970), (950, 1350)], fill='#29b6a1')
image = image.resize((512, 512), Image.Resampling.LANCZOS)
public = Path(__file__).resolve().parents[1] / 'public'
public.mkdir(exist_ok=True)
image.save(public / 'icon.png')
image.save(public / 'icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print('Generated public/icon.png (512x512) and multi-size public/icon.ico')
