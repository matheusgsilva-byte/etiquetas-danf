# LabelHub Cloud

Sistema web (SaaS) para reunir etiquetas de envio em PDF de vários marketplaces — Mercado Livre, Shopee, Amazon, Magazine Luiza, TikTok Shop, Shein, AliExpress, Americanas e outros — em um único PDF pronto para a impressora térmica ou A4.

- Upload múltiplo com arrastar e soltar, progresso por arquivo e validação.
- Análise no servidor: páginas, tamanho, rotação, marketplace, nº de pedido e rastreio, miniaturas.
- Duplicidades (arquivo repetido, etiqueta idêntica, mesma remessa, já impressa antes) — sempre com decisão do usuário.
- Ordenação por marketplace, arquivo, pedido, data, upload ou arrastando; separação por marketplace.
- Saída 10 × 15, 10 × 10, A4 (1, 2 ou 4 por folha) ou tamanho original, preservando conteúdo vetorial e códigos de barras.
- Processamento assíncrono em fila, PDF validado antes de ser liberado, links de download temporários.
- Dashboard, histórico com filtros, retenção configurável (LGPD), equipe com convites, planos com limites.

Documentação detalhada:

- [docs/FUNCIONALIDADES.md](docs/FUNCIONALIDADES.md) — o que foi implementado, arquitetura, regras e LGPD
- [docs/DEPLOY.md](docs/DEPLOY.md) — implantação em nuvem (AWS, Railway/Render, VPS com Docker)

## Stack

| Camada | Tecnologia |
| --- | --- |
| Web | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS 4 |
| Banco | PostgreSQL + Prisma |
| Fila | Redis + BullMQ (processo `worker` separado) |
| Arquivos | Amazon S3 ou compatível (R2, MinIO, Spaces) — ou disco local em desenvolvimento |
| PDF | pdf-lib (montagem vetorial), pdf.js + @napi-rs/canvas (texto, miniaturas, recorte), qpdf (PDFs protegidos/danificados) |
| Auth | Sessões em banco com cookie httpOnly, bcrypt, recuperação de senha por e-mail |

## Rodar localmente

Pré-requisitos: Node.js 20.11+ (recomendado 22), PostgreSQL 14+, Redis 6+. Opcional: `qpdf` instalado no sistema.

```bash
npm install
cp .env.example .env          # ajuste DATABASE_URL, REDIS_URL e APP_SECRET
npx prisma migrate deploy     # cria as tabelas
npm run dev                   # web em http://localhost:3000
npm run dev:worker            # em outro terminal: processamento dos PDFs
```

Crie uma conta em `/cadastro` e use a opção **Unificar etiquetas PDF**.

Para gerar PDFs de exemplo (tamanhos, rotações e origens diferentes, duplicidades e arquivos inválidos):

```bash
npm run samples               # cria a pasta ./samples
```

### Com Docker

```bash
cp .env.example .env          # defina APP_SECRET
docker compose up --build     # Postgres, Redis, migração, web e worker
```

## Testes

```bash
npm test                      # motor de PDF + regras (sem banco)
npm run smoke                 # ponta a ponta contra a aplicação rodando (web + worker)
python3 tests/check_barcodes.py <pasta>   # opcional: lê os códigos de barras dos PDFs renderizados
```

`npm test` gera os PDFs de exemplo, analisa todos, unifica em seis configurações (original, 10×15, 10×10, A4 com 2 e 4 por folha, agrupado com separadores) e confere ordem, tamanho de página, avisos e rejeição de arquivos inválidos. Defina `LABELHUB_TEST_OUT=pasta LABELHUB_RENDER=1` para guardar os PDFs e as páginas renderizadas a 203 dpi e depois rodar `check_barcodes.py` nessa pasta.

`npm run smoke` cria duas empresas de teste, envia os exemplos, confere análise, duplicidades, confirmação obrigatória, ordem personalizada, geração, download pelo link temporário, validade do PDF e isolamento entre empresas.

## Variáveis de ambiente

Todas estão descritas em [.env.example](.env.example). As essenciais:

| Variável | Descrição |
| --- | --- |
| `APP_URL` | URL pública, sem barra final |
| `APP_SECRET` | Segredo (≥ 32 caracteres) para assinar links de download |
| `DATABASE_URL` | Conexão PostgreSQL |
| `REDIS_URL` | Conexão Redis |
| `STORAGE_DRIVER` | `s3` em produção, `local` em desenvolvimento |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`… | Armazenamento de objetos |
| `SMTP_URL`, `MAIL_FROM` | E-mails de recuperação de senha e convites |
| `ALLOW_PLAN_SELF_SERVICE` | Permite trocar de plano sem pagamento (desligue em produção) |

## Scripts

| Comando | O que faz |
| --- | --- |
| `npm run dev` / `npm run dev:worker` | Desenvolvimento (web / worker com recarga) |
| `npm run build` / `npm start` | Build e servidor web de produção |
| `npm run worker` | Worker de produção |
| `npm run db:migrate` | Aplica migrações (`prisma migrate deploy`) |
| `npm run samples` | Gera PDFs de etiquetas de exemplo |
| `npm test` / `npm run smoke` | Testes |

## Estrutura

```
prisma/                 schema e migrações
src/app/(auth)/         login, cadastro, recuperação de senha, convite
src/app/(app)/          dashboard, unificar, histórico, configurações, conta
src/app/api/            rotas da API (auth, lotes, arquivos, etiquetas, geração, histórico…)
src/components/         interface (área de envio, grade de etiquetas, impressão, resultado)
src/lib/pdf/            motor de PDF: carregamento, análise, layout, montagem, validação
src/lib/marketplaces/   registro de marketplaces (detecção, pedido, rastreio)
src/lib/storage/        S3 / disco local e links assinados
src/worker/             worker: análise, geração e limpeza por retenção
scripts/                exemplos de etiquetas e teste de ponta a ponta
tests/                  testes automatizados
```
