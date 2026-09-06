/**
 * GET  /api/v1/tarefas?lista_id=… — as tarefas de uma lista.
 * POST /api/v1/tarefas — cria uma tarefa dentro de uma lista.
 *
 * A ordem da leitura é a que a tela desenha, e é a mesma do índice
 * `task_items_lista_ordem_idx`: pendentes primeiro, as mais urgentes no topo, e
 * entre iguais a que vence antes.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { COLUNAS_DA_TAREFA, tarefaCreateSchema } from "@/lib/schemas/tarefas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "task_items" });
  if (!authz.ok) return authz.response;

  const listaId = req.nextUrl.searchParams.get("lista_id")?.trim();
  if (!listaId) {
    return fail("validation_failed", "Informe a lista.", 422, { requestId });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("task_items")
    .select(COLUNAS_DA_TAREFA)
    .eq("organization_id", authz.org.orgId)
    .eq("user_id", authz.user.id)
    .eq("lista_id", listaId)
    .order("concluida")
    .order("prioridade", { ascending: false })
    // `nullsFirst: false` porque tarefa SEM prazo não é a mais urgente: ela não
    // tem prazo nenhum, e deve cair depois de todas as que têm.
    .order("vence_em", { nullsFirst: false })
    .order("created_at")
    .limit(1000);

  if (error) return fail("internal_error", "Erro ao carregar as tarefas.", 500, { requestId });
  return ok(data ?? [], { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "task_items" });
  if (!authz.ok) return authz.response;

  const parsed = tarefaCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("task_items")
    .insert({
      ...parsed.data,
      organization_id: authz.org.orgId,
      user_id: authz.user.id,
    })
    .select(COLUNAS_DA_TAREFA)
    .single();

  if (error) {
    // 23503 = a lista não existe, ou não é sua (a RLS a torna invisível, e a FK
    // não encontra a linha). "Lista não encontrada" é a leitura honesta dos dois.
    if (error.code === "23503") {
      return fail("not_found", "Lista não encontrada.", 404, { requestId });
    }
    return fail("internal_error", "Erro ao criar a tarefa.", 500, { requestId });
  }

  await audit({
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    action: "task.created",
    resourceType: "task_items",
    resourceId: (data as unknown as { id: string }).id,
    requestId,
  });

  return ok(data, { requestId, status: 201 });
}
