import { COLUNAS_DA_LISTA, type TarefaLista } from "@/lib/schemas/tarefas";
import type { createClient } from "@/lib/supabase/server";

/**
 * O client do servidor, como `createClient()` o devolve.
 *
 * Derivado e não redigitado: o tipo do `@supabase/ssr` carrega cinco
 * parâmetros genéricos que mudam entre versões, e escrevê-los à mão aqui faria
 * este arquivo quebrar num upgrade que não o toca.
 */
type ClientDoServidor = Awaited<ReturnType<typeof createClient>>;

/** A lista como a tela a desenha: o nome e quanto falta nela. */
export interface ListaComPendentes extends TarefaLista {
  pendentes: number;
}

/**
 * As listas de uma pessoa, cada uma com o número de tarefas pendentes.
 *
 * Vive aqui, e não dentro da rota, porque tem DOIS chamadores: o `GET
 * /api/v1/tarefas/listas` e o Server Component que pinta a tela no primeiro
 * render. Enquanto era código de rota, a página precisaria repetir a contagem —
 * e duas cópias da mesma regra divergem no dia em que uma delas ganhar um
 * filtro.
 */
export async function carregarListasComPendentes(
  supabase: ClientDoServidor,
  orgId: string,
  userId: string,
): Promise<{ listas: ListaComPendentes[]; erro: boolean }> {
  // Em paralelo: a segunda consulta não depende da primeira, e em sequência
  // somariam duas idas ao banco no caminho que abre a tela.
  const [listas, pendentes] = await Promise.all([
    supabase
      .from("task_lists")
      .select(COLUNAS_DA_LISTA)
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .order("created_at"),
    // Só a coluna do agrupamento. O PostgREST não faz `group by`, e uma ida ao
    // banco por lista — a alternativa — cresce com o número de listas justamente
    // na tela que as mostra todas.
    supabase
      .from("task_items")
      .select("lista_id")
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .eq("concluida", false),
  ]);

  if (listas.error || pendentes.error) return { listas: [], erro: true };

  const contagem = new Map<string, number>();
  for (const { lista_id } of (pendentes.data ?? []) as Array<{ lista_id: string }>) {
    contagem.set(lista_id, (contagem.get(lista_id) ?? 0) + 1);
  }

  return {
    listas: ((listas.data ?? []) as unknown as TarefaLista[]).map((l) => ({
      ...l,
      pendentes: contagem.get(l.id) ?? 0,
    })),
    erro: false,
  };
}
