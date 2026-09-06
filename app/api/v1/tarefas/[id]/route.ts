/**
 * PATCH  /api/v1/tarefas/:id — muda o que veio, não encosta no resto.
 * DELETE /api/v1/tarefas/:id — apaga a tarefa.
 *
 * ⚠️ O CARIMBO DA CONCLUSÃO É DAQUI, não do cliente.
 *
 * `concluida_em` não está em nenhum schema de entrada: quem o escreve é esta
 * rota, com o relógio do servidor, no mesmo UPDATE que vira o booleano. Se o
 * navegador escolhesse a hora, "o que eu fechei hoje" passaria a depender do
 * relógio de quem clicou — e um relógio adiantado moveria a tarefa para amanhã.
 *
 * O banco cobra o par com um CHECK (`task_items_concluida_tem_carimbo`), então
 * um caminho futuro que esquecesse o carimbo falha alto em vez de gravar uma
 * tarefa concluída sem data de conclusão.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { COLUNAS_DA_TAREFA, tarefaPatchSchema } from "@/lib/schemas/tarefas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "task_items" });
  if (!authz.ok) return authz.response;
  const { id } = await params;

  const parsed = tarefaPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  const { concluida, ...resto } = parsed.data;
  const patch: Record<string, unknown> = { ...resto };
  if (concluida !== undefined) {
    patch.concluida = concluida;
    patch.concluida_em = concluida ? new Date().toISOString() : null;
  }
  // Limpar a data limpa a hora junto: `vence_com_hora` sem `vence_em` é o estado
  // que o CHECK do banco recusa, e quem tira o prazo não está pensando na hora.
  if (resto.vence_em === null) patch.vence_com_hora = false;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("task_items")
    .update(patch)
    .eq("organization_id", authz.org.orgId)
    .eq("user_id", authz.user.id)
    .eq("id", id)
    .select(COLUNAS_DA_TAREFA)
    .maybeSingle();

  if (error) return fail("internal_error", "Erro ao salvar a tarefa.", 500, { requestId });
  if (!data) return fail("not_found", "Tarefa não encontrada.", 404, { requestId });

  // A ação nomeia o que MUDOU, não a tabela: "task.updated" para toda edição
  // deixaria o log incapaz de responder quando algo foi concluído — que é a
  // única pergunta que alguém faz a este log.
  const action =
    concluida === undefined ? "task.updated" : concluida ? "task.completed" : "task.reopened";

  await audit({
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    action,
    resourceType: "task_items",
    resourceId: id,
    requestId,
  });

  return ok(data, { requestId });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "task_items" });
  if (!authz.ok) return authz.response;
  const { id } = await params;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("task_items")
    .delete()
    .eq("organization_id", authz.org.orgId)
    .eq("user_id", authz.user.id)
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) return fail("internal_error", "Erro ao apagar a tarefa.", 500, { requestId });
  if (!data) return fail("not_found", "Tarefa não encontrada.", 404, { requestId });

  await audit({
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    action: "task.deleted",
    resourceType: "task_items",
    resourceId: id,
    requestId,
  });

  return ok({ id }, { requestId });
}
