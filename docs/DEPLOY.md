# Implantação em nuvem

O LabelHub roda como dois processos a partir da mesma imagem/código:

| Processo | Comando | Escala |
| --- | --- | --- |
| Web | `npm run start` (porta 3000) | horizontal, atrás de um balanceador |
| Worker | `npm run worker` | horizontal; cada instância processa `WORKER_CONCURRENCY` gerações em paralelo |

Serviços gerenciados necessários: **PostgreSQL**, **Redis** e **armazenamento de objetos S3 (ou compatível)**. Com mais de uma instância, use sempre `STORAGE_DRIVER=s3` — o disco local só funciona quando web e worker compartilham a mesma pasta.

Antes de cada versão, aplique as migrações: `npx prisma migrate deploy`.

Verificação de saúde: `GET /api/health` (200 quando banco e Redis respondem).

## Checklist de produção

- [ ] `APP_URL` com `https://` e `APP_SECRET` longo e aleatório (`openssl rand -base64 48`)
- [ ] `STORAGE_DRIVER=s3` e bucket **privado** (sem acesso público)
- [ ] `ALLOW_PLAN_SELF_SERVICE=false`
- [ ] `SMTP_URL` configurado (recuperação de senha e convites)
- [ ] Backups automáticos do PostgreSQL
- [ ] Redis com persistência (AOF) ou gerenciado
- [ ] Worker com memória suficiente: ~1 GB por geração simultânea de lotes grandes
- [ ] HTTPS no balanceador (os cookies de sessão são `Secure` em produção)

## Opção 1 — AWS (São Paulo, `sa-east-1`)

1. **S3**: crie um bucket privado (ex.: `labelhub-arquivos`), com bloqueio de acesso público. Uma regra de ciclo de vida que apague objetos com mais de 400 dias é uma rede de segurança extra (a retenção do app apaga antes).
2. **RDS PostgreSQL** (16) em subnets privadas.
3. **ElastiCache Redis** (7) em subnets privadas.
4. **ECR**: `docker build -t labelhub .` e envie a imagem.
5. **ECS Fargate** (ou App Runner para o web):
   - Serviço `web`: imagem, comando padrão, porta 3000, atrás de um ALB com certificado ACM. Health check `/api/health`.
   - Serviço `worker`: mesma imagem, comando `npm run worker`, sem porta. 1 vCPU / 2 GB é um bom começo.
   - Tarefa avulsa `migrate`: comando `npx prisma migrate deploy` a cada versão.
6. **IAM**: dê à task role permissão `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket` no bucket. Deixe `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` vazios para usar a role.
7. Variáveis: `APP_URL`, `APP_SECRET`, `DATABASE_URL`, `REDIS_URL`, `STORAGE_DRIVER=s3`, `S3_BUCKET`, `S3_REGION=sa-east-1`, `SMTP_URL`, `MAIL_FROM` (use Secrets Manager para segredos).
8. **Auto Scaling**: escale o worker pela CPU ou pelo tamanho da fila; o web pela CPU/requisições.

## Opção 2 — Railway / Render

1. Crie PostgreSQL e Redis gerenciados na plataforma.
2. Crie um serviço web a partir do repositório (Dockerfile). Comando de pre-deploy/release: `npx prisma migrate deploy`.
3. Crie um segundo serviço (worker/background) a partir do mesmo repositório com comando `npm run worker`.
4. Use Cloudflare R2 (ou S3) como armazenamento: `STORAGE_DRIVER=s3`, `S3_ENDPOINT=https://<conta>.r2.cloudflarestorage.com`, `S3_REGION=auto`, `S3_BUCKET`, chaves de API do R2.

## Opção 3 — Uma VM com Docker (VPS)

```bash
git clone <repositorio> labelhub && cd labelhub
cp .env.example .env    # APP_URL=https://seu-dominio, APP_SECRET, SMTP...
docker compose up -d --build
```

O `docker-compose.yml` sobe Postgres, Redis, migração, web e worker com armazenamento local em volume compartilhado. Coloque um proxy com HTTPS na frente (Caddy, Nginx ou Traefik) apontando para a porta 3000. Faça backup dos volumes `pgdata` e `storage`.

## Observações

- O primeiro `npm install` cria o `package-lock.json`; versione-o para builds reproduzíveis (`npm ci`).
- A imagem inclui `qpdf` (para PDFs protegidos por senha de proprietário) e `openssl` (Prisma).
- `@napi-rs/canvas` usa binários pré-compilados para Linux x64/arm64 (glibc); a imagem usa Debian bookworm.
- Logs vão para stdout/stderr; conecte ao CloudWatch, Datadog ou similar.
