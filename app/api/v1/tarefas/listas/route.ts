/**
 * GET  /api/v1/tarefas/listas — as listas de quem está logado, com o número de
 *      tarefas pendentes de cada uma.
 * POST /api/v1/tarefas/listas — cria uma lista.
 *
 * ⚠️ `viewer` basta, e é de propósito: a área é PESSOAL. O que protege a lista
 * de uma pessoa não é o papel dela na organização — é `user_id = auth.uid()`, na
 * policy e repetido aqui. Exigir `manager` daria a um atendente o direito de não
 * ter uma lista de afazeres, o que não é uma regra de negócio, é um acidente.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { COLUNAS_DA_LISTA, listaCreateSchema, type TarefaLista } from "@/lib/schemas/tarefas";
import { carregarListasComPendentes } from "@/lib/tarefas/consultas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "task_lists" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const { listas, erro } = await carregarListasComPendentes(
    supabase,
    authz.org.orgId,
    authz.user.id,
  );

  if (erro) return fail("internal_error", "Erro ao carregar as listas.", 500, { requestId });
  return ok(listas, { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "task_lists" });
  if (!authz.ok) return authz.response;

  const parsed = listaCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("task_lists")
    .insert({
      ...parsed.data,
      organization_id: authz.org.orgId,
      // O dono vem da SESSÃO, nunca do corpo. É a regra do CLAUDE.md para
      // organization_id, e vale igual para o dono de um dado pessoal.
      user_id: authz.user.id,
    })
    .select(COLUNAS_DA_LISTA)
    .single();

  if (error) {
    if (error.code === "23505") {
      return fail("conflict", "Você já tem uma lista com esse nome.", 409, { requestId });
    }
    return fail("internal_error", "Erro ao criar a lista.", 500, { requestId });
  }

  await audit({
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    action: "task_list.created",
    resourceType: "task_lists",
    resourceId: (data as unknown as { id: string }).id,
    requestId,
  });

  return ok({ ...(data as unknown as TarefaLista), pendentes: 0 }, { requestId, status: 201 });
}
