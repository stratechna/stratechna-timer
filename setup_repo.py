#!/usr/bin/env python3
"""
setup_repo.py — Inicializa o repositório stratechna-timer no CCX13 e faz push para GitHub.
Corre em: ssh -i ~/.ssh/itkey root@95.217.8.239 'python3 /tmp/setup_repo.py'
"""
import subprocess
import os
import sys

REPO_DIR = "/opt/stratechna/stratechna-timer"
GITHUB_ORG = "Stratechna"
REPO_NAME = "stratechna-timer"
REMOTE = f"git@github.com:{GITHUB_ORG}/{REPO_NAME}.git"

def run(cmd, cwd=None, check=True):
    print(f"  $ {cmd}")
    r = subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True)
    if r.stdout.strip(): print(f"    {r.stdout.strip()}")
    if r.stderr.strip() and r.returncode != 0: print(f"    ERR: {r.stderr.strip()}")
    if check and r.returncode != 0:
        print(f"ERRO: comando falhou (código {r.returncode})")
        sys.exit(1)
    return r

print("=" * 60)
print("Stratechna Timer — Setup Repositório GitHub")
print("=" * 60)

# ── 1. Verificar SSH para GitHub ──────────────────────────────
print("\n[1/5] A verificar acesso SSH ao GitHub...")
r = run("ssh -o StrictHostKeyChecking=no -T git@github.com 2>&1 || true", check=False)
output = r.stdout + r.stderr
if "successfully authenticated" in output.lower() or "hi " in output.lower():
    print("  ✓ SSH GitHub OK")
else:
    print("  ✗ SSH para GitHub não está configurado no CCX13.")
    print("  Adiciona a chave pública do CCX13 ao GitHub:")
    pub = run("cat ~/.ssh/itkey.pub 2>/dev/null || cat ~/.ssh/id_rsa.pub 2>/dev/null || ssh-keygen -t ed25519 -C 'ccx13@stratechna.pt' -f ~/.ssh/id_ed25519 -N '' && cat ~/.ssh/id_ed25519.pub", check=False)
    print(f"\n  Chave pública:\n  {pub.stdout.strip()}")
    print("\n  Vai a https://github.com/settings/keys e adiciona esta chave.")
    print("  Depois corre este script novamente.")
    sys.exit(1)

# ── 2. Criar directório e copiar ficheiros ────────────────────
print(f"\n[2/5] A preparar directório {REPO_DIR}...")
os.makedirs(REPO_DIR, exist_ok=True)

# Copiar ficheiros do /tmp para o repo
run(f"cp -r /tmp/stratechna-timer/. {REPO_DIR}/")
print("  ✓ Ficheiros copiados")

# ── 3. Gerar ícones ───────────────────────────────────────────
print("\n[3/5] A gerar ícones...")
icons_dir = f"{REPO_DIR}/src-tauri/icons"
os.makedirs(icons_dir, exist_ok=True)

SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="22" fill="#880000"/>
  <text x="64" y="88" font-family="Arial,sans-serif" font-weight="900"
    font-size="72" fill="white" text-anchor="middle">S</text>
</svg>"""

svg_path = "/tmp/icon_src.svg"
with open(svg_path, "w") as f:
    f.write(SVG)

# Verificar se rsvg-convert está disponível
has_rsvg = run("which rsvg-convert", check=False).returncode == 0
has_convert = run("which convert", check=False).returncode == 0

if has_rsvg:
    for size, name in [(32, "32x32.png"), (128, "128x128.png"), (256, "128x128@2x.png"), (32, "icon.png")]:
        run(f"rsvg-convert -w {size} -h {size} -o {icons_dir}/{name} {svg_path}")
    print("  ✓ Ícones gerados com rsvg-convert")
elif has_convert:
    for size, name in [(32, "32x32.png"), (128, "128x128.png"), (256, "128x128@2x.png"), (32, "icon.png")]:
        run(f"convert -background none -resize {size}x{size} {svg_path} {icons_dir}/{name}")
    print("  ✓ Ícones gerados com ImageMagick")
else:
    # Usar Python PIL como fallback
    try:
        from PIL import Image, ImageDraw
        for size, name in [(32, "32x32.png"), (128, "128x128.png"), (256, "128x128@2x.png"), (32, "icon.png")]:
            img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
            draw = ImageDraw.Draw(img)
            r = int(size * 0.17)
            draw.rounded_rectangle([0, 0, size-1, size-1], radius=r, fill=(136, 0, 0, 255))
            img.save(f"{icons_dir}/{name}")
        print("  ✓ Ícones gerados com PIL (sem texto — install rsvg-convert para melhor qualidade)")
    except ImportError:
        print("  ! Nenhum conversor disponível. A criar ícones placeholder...")
        # Criar PNG mínimo válido (1x1 vermelho escalado)
        import struct, zlib
        def make_png(size):
            def chunk(name, data):
                c = struct.pack('>I', len(data)) + name + data
                return c + struct.pack('>I', zlib.crc32(c[4:]) & 0xffffffff)
            r, g, b = 136, 0, 0
            raw = b''.join(b'\x00' + bytes([r, g, b, 255] * size) for _ in range(size))
            compressed = zlib.compress(raw)
            return (b'\x89PNG\r\n\x1a\n' +
                    chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)) +
                    chunk(b'IDAT', compressed) +
                    chunk(b'IEND', b''))
        for size, name in [(32, "32x32.png"), (128, "128x128.png"), (256, "128x128@2x.png"), (32, "icon.png")]:
            with open(f"{icons_dir}/{name}", "wb") as f:
                f.write(make_png(size))
        print("  ✓ Ícones placeholder criados")

# Criar icon.icns placeholder para macOS (o Tauri gera-o automaticamente)
with open(f"{icons_dir}/icon.icns", "wb") as f:
    f.write(b"icns\x00\x00\x00\x08")  # header mínimo — substituído pelo build
with open(f"{icons_dir}/icon.ico", "wb") as f:
    # ICO mínimo válido (1 imagem 1x1)
    f.write(b'\x00\x00\x01\x00\x01\x00\x01\x01\x00\x00\x01\x00\x18\x00' +
            b'\x28\x00\x00\x00\x16\x00\x00\x00' +
            b'\x28\x00\x00\x00\x01\x00\x00\x00\x02\x00\x00\x00\x01\x00' +
            b'\x18\x00\x00\x00\x00\x00\x04\x00\x00\x00\x00\x00\x00\x00' +
            b'\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00' +
            b'\x88\x00\x00\x00\x00\x00\x00\x00')

print("  ✓ Placeholders .icns e .ico criados")

# ── 4. Git init e commit ──────────────────────────────────────
print("\n[4/5] A inicializar repositório Git...")
run("git config --global user.email 'it@stratechna.pt'", check=False)
run("git config --global user.name 'Stratechna IT'", check=False)

is_git = os.path.exists(f"{REPO_DIR}/.git")
if not is_git:
    run("git init", cwd=REPO_DIR)
    run(f"git remote add origin {REMOTE}", cwd=REPO_DIR)
    print("  ✓ Repositório inicializado")
else:
    r = run("git remote get-url origin", cwd=REPO_DIR, check=False)
    if REMOTE not in r.stdout:
        run("git remote remove origin", cwd=REPO_DIR, check=False)
        run(f"git remote add origin {REMOTE}", cwd=REPO_DIR)
    print("  ✓ Repositório já existia")

run("git add -A", cwd=REPO_DIR)
run('git commit -m "feat: initial Tauri app — menu bar / system tray para Mac e Windows"', cwd=REPO_DIR)
print("  ✓ Commit criado")

# ── 5. Push e criar primeira tag ─────────────────────────────
print("\n[5/5] A fazer push para GitHub...")
run("git branch -M main", cwd=REPO_DIR)
run("git push -u origin main", cwd=REPO_DIR)
run("git tag v1.0.0", cwd=REPO_DIR)
run("git push origin v1.0.0", cwd=REPO_DIR)

print("\n" + "=" * 60)
print("✓ Concluído!")
print(f"\nRepositório: https://github.com/{GITHUB_ORG}/{REPO_NAME}")
print(f"Build a correr em: https://github.com/{GITHUB_ORG}/{REPO_NAME}/actions")
print("\nO GitHub Actions vai compilar Mac (DMG) e Windows (MSI/EXE).")
print("Quando terminar (~15 min), os ficheiros ficam em Releases.")
print("=" * 60)
