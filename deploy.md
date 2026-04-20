# Deploy (DigitalOcean Droplet) — Painel MedVet Piquet (Vite/React)

Este projeto é um **frontend Vite**. Em produção, o fluxo correto é:

- **build** local/CI (`npm run build`) → gera `dist/`
- **servidor web** (recomendado: **Nginx**) servindo os arquivos estáticos do `dist/`

> Observação: rodar `npm run dev` em produção (Vite dev server) **não é recomendado**.

---

## Verificar se “roda no Droplet”

Dentro do projeto:

```bash
npm ci
npm run build
```

Se o build concluir e gerar a pasta `dist/`, o deploy em Droplet é viável.

Você pode testar o build localmente servindo o `dist/`:

```bash
npx serve -s dist -l 4173
```

Abra `http://localhost:4173`.

---

## Deploy recomendado: Nginx servindo o `dist/`

### 1) Copiar arquivos do build para o servidor

No Droplet, escolha uma pasta para hospedar o site. Exemplo:

- **Pasta do site**: `/var/www/medvetpiquet.com.br/painel`

Estrutura no servidor (exemplo real):

```bash
cd /var/www
cd medvetpiquet.com.br
mkdir -p painel
cd painel
pwd
# /var/www/medvetpiquet.com.br/painel
```

Copie o conteúdo do `dist/` para essa pasta (exemplo com `rsync`):

```bash
sudo mkdir -p /var/www/medvetpiquet.com.br/painel
sudo rsync -av --delete dist/ /var/www/medvetpiquet.com.br/painel/
sudo chown -R www-data:www-data /var/www/medvetpiquet.com.br/painel
```

---

## Deploy automático via GitHub (pull + build + publish no Nginx)

Aqui vão 2 jeitos comuns. O mais simples (e muito usado) é **GitHub Actions fazendo SSH no Droplet** e executando o deploy.

### Pré-requisitos no Droplet

- Node.js instalado (versão compatível com o projeto)
- Nginx instalado e apontando o `root` para:
  - `/var/www/medvetpiquet.com.br/painel`
- Um diretório para o repositório (exemplo abaixo: `/opt/petcare_source`)

Crie o diretório do repo e faça o primeiro clone:

```bash
sudo mkdir -p /opt/petcare_source
sudo chown -R $USER:$USER /opt/petcare_source
cd /opt/petcare_source
git clone <URL_DO_SEU_REPO_GITHUB> .
```

> Dica: nesse modelo, o repositório fica em `/opt/petcare_source` e o “publicado” fica em `/var/www/medvetpiquet.com.br/painel`.

### Opção A (recomendado): GitHub Actions faz SSH e executa deploy

1) No GitHub, crie **Secrets** do repositório (Settings → Secrets and variables → Actions):

- `DROPLET_HOST` (IP ou host do Droplet)
- `DROPLET_USER` (ex.: `root` ou um usuário sudo)
- `DROPLET_SSH_KEY` (chave privada **sem senha** para SSH)

2) Crie o workflow em `.github/workflows/deploy.yml` no seu repositório:

```yaml
name: Deploy (Droplet)

on:
  push:
    branches: [ "main" ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1.2.0
        with:
          host: ${{ secrets.DROPLET_HOST }}
          username: ${{ secrets.DROPLET_USER }}
          key: ${{ secrets.DROPLET_SSH_KEY }}
          script: |
            set -e

            cd /opt/petcare_source
            git fetch --all
            git reset --hard origin/main

            sudo rsync -av --delete dist/ /var/www/medvetpiquet.com.br/painel/

            npm ci
            npm run build

            sudo nginx -t
            sudo systemctl reload nginx
```

### Opção B: GitHub Actions só gera o `dist/` e envia ao Droplet

Esse modelo evita instalar Node no Droplet para build (o build acontece no GitHub), e o servidor só recebe o `dist/`.

Resumo do que muda:

- O workflow roda `npm ci` + `npm run build` no runner do GitHub
- Depois faz `rsync/scp` do `dist/` para `/var/www/medvetpiquet.com.br/painel`

---

### 2) Instalar e testar Nginx

```bash
sudo apt update
sudo apt install -y nginx
sudo nginx -t
sudo systemctl enable --now nginx
```

### 3) Configuração Nginx (domínio + SPA + cache de assets)

Você já tem um template pronto no projeto:

- `E:\Developer\Projetos\pet-piquet\piquet\painel.medvetpiquet.com.br`

Ele contempla:

- **Domínio**: `painel.medvetpiquet.com.br`
- **SPA fallback** (React Router): `try_files ... /index.html`
- **Cache agressivo** para `dist/assets/*`
- **Porta HTTP adicional**: `7500` (para acesso via `IP:7500`, se desejado)
- **443/80** como “managed by Certbot” (Let’s Encrypt)

Depois de colocar esse arquivo em `/etc/nginx/sites-available/` (ou incluir em `conf.d`), habilite e recarregue:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## Porta 7500 (HTTP)

Se você quiser acessar também via **porta 7500**, a configuração já inclui:

- `listen 7500;`

Lembre de liberar:

- **Firewall do Droplet / Security Group da DigitalOcean**: porta **7500/TCP**
- **UFW (se estiver usando)**:

```bash
sudo ufw allow 7500/tcp
```

Acesso:

- `http://IP_DO_DROPLET:7500`

---

## PM2: o projeto “aceita rodar” via PM2?

### Resposta prática

- **Como Vite dev server (npm run dev)**: tecnicamente dá, mas **não é indicado em produção**.
- **Como site estático (`dist/`)**: sim, você pode usar PM2 para manter um servidor Node simples (ex.: `serve`) no ar.

### Exemplo: PM2 + `serve` na porta 7500

No Droplet, no diretório do projeto (ou em qualquer diretório que contenha `dist/`):

```bash
npm i -g pm2
npm i -g serve
pm2 start serve --name painel-medvet -- -s dist -l 7500
pm2 save
pm2 startup
```

Nesse cenário, você pode:

- acessar direto em `http://IP:7500`, **ou**
- colocar Nginx na frente (443) fazendo proxy para `127.0.0.1:7500`.

---

## Sobre `location` no Nginx

Depende do tipo de aplicação:

- **App Node (backend) atrás do Nginx (PM2)**: precisa de `location / { proxy_pass ... }` para encaminhar ao Node.
- **Frontend Vite (estático)**: não precisa de `proxy_pass`. O essencial é um `location /` com `try_files` para SPA:

```nginx
location / {
  try_files $uri $uri/ /index.html;
}
```

Recomendado também ter um `location /assets/` com cache para os arquivos versionados do Vite.

---

## Checklist rápido de validação no Droplet

```bash
sudo nginx -t
curl -I http://127.0.0.1:7500 2>/dev/null || true
curl -I http://localhost 2>/dev/null || true
```

E no navegador:

- `https://painel.medvetpiquet.com.br`
- `http://IP_DO_DROPLET:7500` (se você habilitou/abriu a porta)

