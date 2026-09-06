/**
 * PATCH  /api/v1/tarefas/listas/:id — renomeia.
 * DELETE /api/v1/tarefas/listas/:id — apaga a lista E as tarefas dentro dela.
 *
 * O cascade é do SCHEMA (`task_items.lista_id ... on delete cascade`), não de um
 * laço aqui: apagar as tarefas em código deixaria órfãs toda vez que a segunda
 * chamada falhasse no meio, e a tela mostraria uma lista que não existe mais.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { COLUNAS_DA_LISTA, listaPatchSchema } from "@/lib/schemas/tarefas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "task_lists" });
  if (!authz.ok) return authz.response;
  const { id } = await params;

  const parsed = listaPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("task_lists")
    .update(parsed.data)
    .eq("organization_id", authz.org.orgId)
    .eq("user_id", authz.user.id)
    .eq("id", id)
    .select(COLUNAS_DA_LISTA)
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return fail("conflict", "Você já tem uma lista com esse nome.", 409, { requestId });
    }
    return fail("internal_error", "Erro ao renomear a lista.", 500, { requestId });
  }
  // `maybeSingle` devolve null quando a RLS barrou ou o id não é seu — os dois
  // são "não existe para você", e 404 é a resposta honesta.
  if (!data) return fail("not_found", "Lista não encontrada.", 404, { requestId });

  await audit({
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    action: "task_list.renamed",
    resourceType: "task_lists",
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
  const authz = await requireRole("viewer", { requestId, resource: "task_lists" });
  if (!authz.ok) return authz.response;
  const { id } = await params;

  const supabase = await createClient();
  // Confere que a linha existia ANTES de auditar: sem isso, um DELETE barrado
  // pela RLS devolveria sucesso e gravaria auditoria de algo que não aconteceu.
  const { data, error } = await supabase
    .from("task_lists")
    .delete()
    .eq("organization_id", authz.org.orgId)
    .eq("user_id", authz.user.id)
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) return fail("internal_error", "Erro ao apagar a lista.", 500, { requestId });
  if (!data) return fail("not_found", "Lista não encontrada.", 404, { requestId });

  await audit({
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    action: "task_list.deleted",
    resourceType: "task_lists",
    resourceId: id,
    requestId,
  });

  return ok({ id }, { requestId });
}
