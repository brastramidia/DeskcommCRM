import type { SupabaseClient } from "@supabase/supabase-js";

import { estadoDaConexaoApos, type DesfechoDoGoogle } from "@/lib/agenda/google/erros";
import type { SituacaoDaConexao } from "@/lib/agenda/tipos";
import { logger } from "@/lib/logger";

/**
 * ESCREVE no banco a situação que `estadoDaConexaoApos` já sabia calcular.
 *
 * ─── A metade que faltava ──────────────────────────────────────────────────
 *
 * `estadoDaConexaoApos` (google/erros.ts) existe, está documentada e devolve o
 * estado certo para cada desfecho — `token_expired` para `reautenticar`,
 * `scope_missing` para falta de escopo, e assim por diante. Ela só nunca foi
 * CHAMADA: medido, zero ocorrências nos dois crons.
 *
 * O efeito disso numa instalação real: o token do Google expirou (app OAuth em
 * modo "Testing" expira o refresh token em 7 dias), o push tentou publicar 52
 * vezes seguidas, todas com HTTP 401 — e a conexão seguiu marcada `healthy`. A
 * tela dizia que estava tudo bem, e quem marcou um compromisso com convidado só
 * descobriu que nada saía porque foi conferir a caixa de entrada da pessoa.
 *
 * ─── Por que só escreve quando MUDA ────────────────────────────────────────
 *
 * O push roda a cada 5 minutos e percorre N compromissos. Gravar a situação a
 * cada iteração seria N escritas por rodada para dizer a mesma coisa — e ainda
 * mexeria em `updated_at`, que é o que alguém olha para saber quando a conexão
 * mudou de estado de verdade.
 */
export async function anotarSituacaoDaConexao(
  admin: SupabaseClient,
  conexaoId: string,
  desfecho: DesfechoDoGoogle,
  situacaoAtual: string | null | undefined,
): Promise<SituacaoDaConexao | null> {
  const nova = estadoDaConexaoApos(desfecho);
  // `null` = o desfecho é sobre um EVENTO, não sobre a conexão. Rebaixar a
  // conexão por um evento que sumiu desligaria a agenda inteira por um caso
  // isolado — é o que o comentário de `estadoDaConexaoApos` já determina.
  if (nova === null) return null;
  if (nova === situacaoAtual) return null;

  const { error } = await admin
    .from("calendar_connections")
    .update({ status: nova })
    .eq("id", conexaoId);

  if (error) {
    // Falha ALTO no log e não interrompe: o trabalho do cron é publicar o
    // compromisso, e perder a anotação de estado é ruim, mas parar a publicação
    // por causa dela seria pior.
    logger.error("[agenda-google] não consegui anotar a situação da conexão", {
      conexao: conexaoId,
      desfecho,
      alvo: nova,
      error: error.message,
    });
    return null;
  }

  logger.warn("[agenda-google] situação da conexão mudou", {
    conexao: conexaoId,
    de: situacaoAtual ?? "(desconhecida)",
    para: nova,
    desfecho,
  });
  return nova;
}
