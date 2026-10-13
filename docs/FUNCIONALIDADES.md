# Funcionalidades e arquitetura

## Visão geral

```
Navegador ──HTTPS──▶ Next.js (web)
                       │  rotas /api: autenticação, lotes, upload, decisões, histórico
                       ├──▶ PostgreSQL (empresas, lotes, arquivos, etiquetas, jobs, auditoria)
                       ├──▶ S3 / disco (PDFs enviados, miniaturas, PDFs gerados)
                       └──▶ Redis (fila BullMQ)
                                 │
                                 ▼
                       Worker (processo separado, escalável)
                         • análise de cada PDF enviado
                         • geração do PDF unificado
                         • limpeza por retenção a cada 15 min
```

O servidor web nunca processa PDFs pesados: ele grava o arquivo e coloca um job na fila. A interface acompanha o progresso consultando a API, então o usuário pode navegar pela plataforma enquanto o lote é processado.

## Fluxo

1. **Nova unificação** — o usuário arrasta vários PDFs (de marketplaces diferentes). O lote é criado no primeiro envio; cada arquivo sobe em paralelo (3 por vez) com barra de progresso.
2. **Validação no upload** — extensão/tipo, assinatura `%PDF-`, tamanho e quantidade de arquivos do plano, espaço de armazenamento.
3. **Análise (worker)** — para cada página: tamanho exibido, rotação, texto, marketplace, nº do pedido, rastreio, área com conteúdo, impressão digital visual e miniatura. PDFs protegidos só com senha de proprietário ou danificados são normalizados pelo `qpdf`; arquivos corrompidos ou que não são PDF recebem mensagem de erro clara e não entram no lote.
4. **Revisão** — tabela de arquivos (nome, origem, tamanho, páginas, status, remover, reprocessar) e grade de etiquetas com miniatura, marketplace, pedido, tamanho e duplicidades.
5. **Organização** — ordenar por marketplace, nome do arquivo, data de importação, nº do pedido, ordem de upload ou arrastar e soltar (mouse, toque ou teclado). A ordem é gravada no servidor.
6. **Impressão** — formato, etiquetas por folha (A4), tamanho real ou ajuste ao espaço, margem, giro automático, recorte de margens brancas, linhas de corte, separação por marketplace e páginas separadoras. O painel mostra quantas etiquetas e páginas o PDF terá.
7. **Gerar PDF unificado** — se houver duplicidades sem decisão, a geração pede confirmação. O worker monta o PDF, **reabre e valida** (nº e tamanho das páginas), grava, confere o tamanho gravado e só então libera o download.
8. **Resultado** — resumo (etiquetas, páginas, arquivos, descartadas, tempo, tamanho, por marketplace, avisos de redução), visualizar e baixar por link temporário.
9. **Histórico** — a operação fica registrada com filtros por data, marketplace, nome e status.

## Preservação de qualidade

- As páginas de origem são incorporadas como Form XObjects (`pdf-lib` → `embedPage`): textos, códigos de barras e QR Codes continuam **vetoriais**; nada é rasterizado. Imagens embutidas mantêm a resolução original.
- **Tamanho real por padrão**: a etiqueta é colocada a 100% e só é reduzida se não couber. Abaixo de 80% o sistema avisa qual etiqueta foi reduzida.
- **Giro automático** só acontece quando melhora o aproveitamento (ex.: etiqueta em paisagem numa página 10×15 em retrato).
- A rotação original da página (`/Rotate`) é respeitada.
- **Recorte de margens** usa a área com conteúdo detectada na análise (útil para etiquetas Shopee/ML que vêm em A4) e só é aplicado quando há margem branca relevante.
- No formato **Original** as páginas são copiadas integralmente.

Validação feita no desenvolvimento: as saídas nos seis formatos foram renderizadas a 203 dpi (resolução de impressora térmica) e todos os códigos de barras de teste foram lidos, inclusive etiquetas reduzidas a 66% e etiquetas que eram imagem.

## Detecção de marketplace e identificadores

`src/lib/marketplaces/index.ts` contém o registro. Cada marketplace tem padrões de texto, de nome de arquivo, de nº de pedido e de rastreio. O texto da etiqueta pesa mais que o nome do arquivo; páginas sem texto (etiquetas que são imagem) herdam o marketplace predominante do arquivo ou o indicado no nome do arquivo.

**Adicionar um marketplace:** inclua um item em `MARKETPLACES` com `id`, `name`, `color` e os padrões. Nada mais precisa mudar — filtros, gráficos e badges usam o registro.

Os padrões de pedido foram escritos a partir dos formatos públicos conhecidos de cada plataforma. Vale conferir com etiquetas reais da sua operação e ajustar as expressões se algum campo não for reconhecido (a unificação funciona mesmo sem o nº do pedido).

## Duplicidades

| Tipo | Como é detectado |
| --- | --- |
| Arquivo repetido | mesmo SHA-256 de outro arquivo do lote |
| Etiqueta idêntica | mesma impressão digital visual da página renderizada |
| Mesma remessa | mesmo código de rastreio, ou mesmo nº de pedido no mesmo marketplace |
| Já impressa antes | a remessa já saiu em um PDF gerado pela empresa nos últimos 60 dias |

A primeira ocorrência (ordem de upload) é a original. Nada é removido automaticamente: cada duplicidade fica pendente até o usuário escolher **Manter** ou **Remover** (individualmente ou em lote). Se tentar gerar com pendências, o sistema pede confirmação. O PDF gerado registra quantas etiquetas foram mantidas e descartadas.

Páginas em branco são sinalizadas mas não entram na comparação visual.

## Sem planos nem cotas

Todas as contas têm acesso a tudo, sem limite de etiquetas, páginas, armazenamento ou usuários. Ficam apenas limites técnicos, que protegem o servidor (`src/lib/plans.ts`): até **20 PDFs por unificação** e **100 MB por arquivo**.

Lotes grandes (ex.: 20 arquivos × 300 páginas = 6.000 etiquetas) são montados em blocos de 240 etiquetas. Cada bloco é validado e gravado em disco, e no fim os blocos são juntados com o qpdf. A memória fica abaixo de 1 GB e o tempo fica entre 20 s e 1,5 min, conforme a ordem das etiquetas. O PDF final é enviado ao armazenamento por streaming.

## Equipe

Proprietário, administradores e operadores. Administradores convidam por e-mail (o link também aparece na tela para compartilhar), removem membros e alteram configurações. Todos os dados são da empresa: membros veem o mesmo histórico.

## Segurança e LGPD

- **Isolamento**: toda consulta filtra pela empresa da sessão; chaves de armazenamento são `org/<id>/…` e conferidas antes de gerar links. O teste `npm run smoke` confirma que outra empresa recebe 404.
- **Sessões** com token aleatório em cookie httpOnly/SameSite; no banco fica só o hash. Troca de senha encerra as outras sessões.
- **Senhas** com bcrypt (custo 12); respostas idênticas para e-mail existente ou não; limite de tentativas por IP e por e-mail (Redis).
- **CSRF**: escrita na API exige mesma origem, além do SameSite.
- **Downloads** por links assinados e temporários (padrão 5 min) — pré-assinados do S3 ou HMAC no armazenamento local.
- **Cabeçalhos**: CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy.
- **Criptografia em repouso** no S3 (SSE-AES256) quando usado com a AWS.
- **Retenção configurável**: PDFs enviados, miniaturas e PDFs gerados são apagados automaticamente após o prazo; opção de apagar os PDFs de origem logo após gerar.
- **Minimização**: o banco guarda apenas nº de pedido e rastreio (para duplicidades) — não guarda nomes nem endereços dos destinatários.
- **Auditoria**: login, geração, download, visualização, exclusões e mudanças de configuração ficam em `AuditLog` (sem conteúdo das etiquetas).
- **Eliminação**: o proprietário pode excluir a empresa com todos os arquivos e dados (tela Conta).

## Resiliência

- Jobs com novas tentativas automáticas (análise: 3; geração: 2) e backoff exponencial.
- Estado do lote fica no banco: uma falha não perde arquivos, ordem nem decisões; o lote volta para "pronto" e pode ser gerado de novo.
- Saída incompleta nunca é publicada: se algo falhar após gravar, o arquivo é apagado.
- Gravação atômica no disco local; verificação de tamanho após gravar no S3.
- Jobs presos há mais de 2 horas (ex.: worker reiniciado) são encerrados com mensagem.
- Worker encerra com elegância (SIGTERM aguarda os jobs em andamento).

## Limitações conhecidas e próximos passos

- Uma página de PDF é tratada como uma etiqueta. PDFs que trazem várias etiquetas na mesma página (ex.: A4 com 4 etiquetas) são unificados como estão; dividir automaticamente essas páginas é uma evolução natural (a área de conteúdo já é detectada na análise).
- O upload passa pelo servidor web (simples e seguro). Para arquivos muito grandes, a evolução é upload direto ao S3 com URL pré-assinada.
- Cobrança dos planos não está integrada.
- Integração direta com APIs dos marketplaces (baixar etiquetas automaticamente) não faz parte desta versão.
