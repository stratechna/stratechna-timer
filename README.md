# Stratechna Timer

App de menu bar / system tray para macOS e Windows.  
Permite gerir cronómetros do portal Stratechna sem abrir o browser.

## Funcionalidades

- ⏱ Cronómetros em tempo real para Zoho Desk e Zoho Projects
- 📝 Registo manual de tempo
- 🔔 Notificações nativas ao submeter tempo
- 🔑 Sessão persistente (não precisa de login a cada abertura)
- 🖥 Menu bar no macOS com tempo activo visível inline
- 📥 System tray no Windows

## Build automático

Os binários são compilados automaticamente via GitHub Actions.

**Para gerar um novo build:**

```bash
# No CCX13 via SSH, dentro do repositório:
git tag v1.0.1
git push origin v1.0.1
```

Os ficheiros ficam disponíveis na página **Releases** do repositório.

## Instalação

### macOS
1. Descarrega o `.dmg` da página Releases
2. Abre e arrasta para Aplicações
3. Primeira abertura: clique direito → Abrir → Abrir mesmo assim

### Windows
1. Descarrega o `.msi` ou `.exe` da página Releases
2. Primeira execução: "Mais informações" → "Executar mesmo assim"

## Estrutura

```
stratechna-timer/
├── src/                    # Frontend (HTML + JS)
│   ├── index.html
│   └── app.js
├── src-tauri/              # Backend Rust
│   ├── src/
│   │   ├── main.rs
│   │   └── lib.rs          # Tray, janela, comandos
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── icons/
└── .github/workflows/
    └── build.yml           # CI/CD Mac + Windows
```
