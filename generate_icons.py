#!/usr/bin/env python3
"""
Gera os ícones PNG necessários para o Tauri a partir do SVG da extensão.
Corre no CCX13 após copiar o SVG do container.
"""
import subprocess
import os

SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="22" fill="#880000"/>
  <text x="64" y="88" font-family="Arial,sans-serif" font-weight="900"
    font-size="72" fill="white" text-anchor="middle">S</text>
</svg>"""

SIZES = [32, 128]
ICONS_DIR = "/tmp/tauri-icons"
os.makedirs(ICONS_DIR, exist_ok=True)

svg_path = f"{ICONS_DIR}/icon.svg"
with open(svg_path, "w") as f:
    f.write(SVG)

print("A gerar ícones PNG...")
for size in SIZES:
    out = f"{ICONS_DIR}/icon_{size}.png"
    subprocess.run(["rsvg-convert", "-w", str(size), "-h", str(size), "-o", out, svg_path], check=True)
    print(f"  ✓ {size}x{size}")

# 128@2x = 256px
out_2x = f"{ICONS_DIR}/icon_256.png"
subprocess.run(["rsvg-convert", "-w", "256", "-h", "256", "-o", out_2x, svg_path], check=True)
print("  ✓ 256x256 (128@2x)")

# icon.png principal (para tray — 32px)
subprocess.run(["cp", f"{ICONS_DIR}/icon_32.png", f"{ICONS_DIR}/icon.png"], check=True)

print(f"\nÍcones gerados em {ICONS_DIR}")
print("Ficheiros:")
for f in os.listdir(ICONS_DIR):
    print(f"  {f}")
