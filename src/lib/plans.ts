/**
 * Limites técnicos do sistema. Não há planos: todas as contas têm acesso a tudo,
 * sem cotas de etiquetas, arquivos, armazenamento ou usuários.
 *
 * Os únicos valores abaixo existem para proteger o servidor (memória e tempo de
 * upload), não para restringir o uso.
 */
export const LIMITS = {
  /** Arquivos PDF por unificação (ex.: 20 arquivos de 300 páginas = 6.000 etiquetas). */
  maxFilesPerBatch: 20,
  /** Tamanho máximo de UM arquivo PDF enviado. */
  maxFileSizeMb: 100,
  /** Prazo máximo de retenção configurável. */
  maxRetentionDays: 3650,
};

export type Limits = typeof LIMITS;

export const MB = 1024 * 1024;
