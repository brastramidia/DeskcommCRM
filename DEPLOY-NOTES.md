# DEPLOY-NOTES — deploy desta VPS a partir do fork

> **Este arquivo descreve um caminho FORA do padrão do repo.** O
> [`docs/runbooks/deploy.md`](docs/runbooks/deploy.md) e a doutrina de packaging
> continuam valendo para quem instala o produto: lá a imagem vem do CI, pelo
> GHCR, e a VPS só puxa. Aqui a imagem é construída nesta máquina.
>
> A troca é deliberada e tem dono: esta instalação segue o fork
> `brastramidia/DeskcommCRM` e não espera merge no repositório de origem.
> Instaurado em 2026-09-03.

---

## O que muda em relação ao padrão

| | Padrão do repo | Aqui |
|---|---|---|
| Origem do código | `melgarafael/DeskcommCRM`, branch `main` | `brastramidia/DeskcommCRM` (remote `fork`) |
| Quem constrói | GitHub Actions | esta VPS |
| Onde a imagem vive | GHCR (`ghcr.io/...`) | disco desta VPS (`deskcomm-app:local`) |
| Validação antes do deploy | CI (verify, invariants, e2e, imagens-ok) | o que você rodar à mão, aqui |
| Serviços afetados | `app`, `worker`, `scheduler` | **só `app`** |

`worker` e `scheduler` continuam nas imagens oficiais do GHCR
(`:1.10.1`), com `pull_policy: missing`. Nada neste arquivo os toca.

---

## Estado do `.env` (já configurado)

```
APP_IMAGE="deskcomm-app:local"
APP_PULL_POLICY="never"
```

É isso que faz um `docker compose up -d` comum continuar usando a imagem local
em vez de buscar a do GHCR. Antes desta linha existir, qualquer `up -d` sem
variáveis na frente revertia para `ghcr.io/...:1.11.0` **em silêncio**, sem erro
nenhum.

Backup do `.env` anterior: `.env.bak.pre-imagem-local-*`.

---

## O fluxo padrão (subir uma feature nova)

Pré-requisito: o commit já está no fork, na branch `design-ajustes`.

```bash
cd /root/DeskcommCRM

# 1. Traz o código do fork.
git fetch fork && git merge --ff-only fork/design-ajustes

# 2. Reconstrói a imagem. ~5 min. O APP_VERSION vira a resposta do
#    /api/v1/health e é o que prova, depois, qual código está no ar.
env APP_VERSION="local-$(git rev-parse --short HEAD)" \
  docker compose -f docker-compose.prod.yml -f docker-compose.build.yml \
  --env-file .env build app

# 3. Sobe só o app. Não precisa de variável na frente: o .env já manda.
docker compose -f docker-compose.prod.yml --env-file .env up -d app

# 4. Confere (não pule).
curl -s https://crm.koracompany.com.br/api/v1/health | head -c 200; echo
curl -s -o /dev/null -w "raiz: %{http_code}\n" https://crm.koracompany.com.br/
```

**Esperado no passo 4:** `version` igual ao short SHA do passo 2, `status`
`healthy`, e raiz `307`. Um `404` na raiz significa roteamento quebrado — veja
"Armadilhas" abaixo.

---

## Armadilhas (cada uma já mordeu alguém)

### 1. `--ff-only` no merge, sempre

Se ele recusar, a VPS tem commit que o fork não tem. **Não force.** Descubra o
que é antes:

```bash
git log --oneline fork/design-ajustes..HEAD   # só na VPS
git log --oneline HEAD..fork/design-ajustes   # só no fork
```

Trabalho que existe só neste disco some se a VPS for reconstruída, e **nunca**
deve ser descartado por um `reset --hard` para "destravar" o merge. Empacote e
suba primeiro:

```bash
git bundle create /tmp/faltante.bundle fork/design-ajustes..design-ajustes
```

Depois baixe o arquivo, `git fetch` dele numa máquina com credencial e empurre
para o fork.

### 2. Nunca use `docker-compose.traefik.yml` nesta VPS

O runbook oficial manda passar os dois `-f` incluindo o do Traefik. **Isso vale
para VPS onde a hospedagem tem Traefik próprio.** Aqui não é o caso: o `caddy`
deste compose é quem ocupa 80/443, e o override do Traefik o desliga por
profile. Usá-lo derruba o domínio inteiro.

Como conferir de que tipo é esta máquina:

```bash
docker ps --format '{{.Names}} {{.Ports}}' | grep -E '0.0.0.0:(80|443)'
# caddy aparecendo = esta VPS. Nada aparecendo = Traefik da hospedagem.
```

### 3. `docker-compose.build.yml` só no `build`, nunca no `up`

Ele também redefine `worker` e `scheduler` para `deskcomm-worker:local` e
`deskcomm-scheduler:local`, com `pull_policy: never`. Essas imagens **não
existem** neste disco. Um `up -d` (sem nomear serviço) com esse override
tentaria recriar os dois e falharia.

Por isso o passo 3 usa só `-f docker-compose.prod.yml` e nomeia `app`.

### 4. `update.sh` desfaz o `.env`

`hostgator-setup-kit/update.sh` chama `gravar_imagens .env`, que **sobrescreve
`APP_IMAGE` e `APP_PULL_POLICY`** sem perguntar. Rodá-lo devolve esta instalação
para a imagem do GHCR.

Isso não é bug: é o script de atualização do produto, e ele existe para o
caminho padrão. Enquanto esta instalação seguir o fork, **não rode `update.sh`**
— e se rodar por engano, reponha as duas linhas do `.env` e refaça o passo 3.

### 5. A imagem existe só neste disco

Não está em registry nenhum e não está no git. Se esta VPS for reconstruída,
migrada ou tiver o Docker limpo (`docker system prune -a`), a imagem some e o
`pull_policy: never` faz o `up -d` **falhar** em vez de baixar algo. A
recuperação é o passo 2 (rebuild), que precisa do código — daí a armadilha 1
importar tanto.

---

## Voltar para a imagem oficial

Quando fizer sentido abandonar este caminho:

```bash
cd /root/DeskcommCRM
sed -i 's|^APP_IMAGE=.*|APP_IMAGE="ghcr.io/melgarafael/deskcommcrm:1.11.0"|' .env
sed -i 's|^APP_PULL_POLICY=.*|APP_PULL_POLICY="missing"|' .env
docker compose -f docker-compose.prod.yml --env-file .env up -d app
```

Troque `1.11.0` pela versão desejada. Depois disso o `update.sh` volta a ser
seguro, e este arquivo pode ser apagado.

---

## Migrations

O build não aplica migration nenhuma. Se o código novo depender de schema,
aplique **antes** do passo 3:

```bash
set -a && . ./.env && set +a
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 --single-transaction \
  -f supabase/migrations/<arquivo>.sql
```

Esta instalação **não tem** `supabase_migrations.schema_migrations` — não há
livro-razão de migrations no banco, apesar do que o `MANIFEST.md` afirma. O
controle do que já foi aplicado é o próprio `MANIFEST.md` e o histórico do git.
