/**
 * GET /api/v1/tarefas/resumo — quantas tarefas estão vencidas.
 *
 * É a fonte do BADGE no item "Tarefas" da barra lateral, e a razão de Tarefas
 * não ser uma ilha: sem ele, uma tarefa com prazo só é vista por quem lembra de
 * abrir a tela — que é exatamente quem não precisava do prazo.
 *
 * ⚠️ CONTA no banco, não traz linha. `head: true` + `count: "exact"` devolve só
 * o número: esta rota roda em toda navegação (o badge vive na casca do app), e
 * trazer as linhas para contá-las no Node faria o custo crescer com o tamanho da
 * lista justamente no caminho mais quente do sistema.
 *
 * O par de cortes vem de `cortesDeVencimento`, o mesmo módulo que a tela usa
 * para desenhar a linha em vermelho — regra de vencimento tem um dono só.
 */
import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { cortesDeVencimento } from "@/lib/schemas/tarefas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export interface ResumoDeTarefas {
  vencidas: number;
}

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "task_items" });
  if (!authz.ok) return authz.response;

  const { comHora, diaInteiro } = cortesDeVencimento();

  const supabase = await createClient();
  const { count, error } = await supabase
    .from("task_items")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", authz.org.orgId)
    .eq("user_id", authz.user.id)
    .eq("concluida", false)
    .not("vence_em", "is", null)
    // Tarefa com hora vence no instante; tarefa de dia inteiro só quando o dia
    // acaba — 24h depois da meia-noite local que ficou gravada.
    .or(
      `and(vence_com_hora.eq.true,vence_em.lt.${comHora}),` +
        `and(vence_com_hora.eq.false,vence_em.lt.${diaInteiro})`,
    );

  if (error) return fail("internal_error", "Erro ao contar as tarefas.", 500, { requestId });

  const data: ResumoDeTarefas = { vencidas: count ?? 0 };
  return ok(data, { requestId });
}
