import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { carregarListasComPendentes } from "@/lib/tarefas/consultas";

import { TarefasClient } from "./_components/TarefasClient";

export const dynamic = "force-dynamic";

/**
 * TAREFAS — a área pessoal de quem usa o sistema, no formato do Lembretes.
 *
 * ─── Por que ela não tem nada a ver com o CRM ─────────────────────────────
 *
 * Todo o resto deste produto gira em torno de um cliente: conversa, lead, funil,
 * agenda. Esta tela é a única que gira em torno de QUEM ATENDE — "renovar o
 * certificado", "ligar para o contador". Amarrá-la a um contato obrigaria a
 * inventar um cliente para cada afazer interno, e a timeline do cliente
 * receberia linhas que não são dele.
 *
 * ─── O que a torna pessoal ───────────────────────────────────────────────
 *
 * `user_id = auth.uid()` na policy de `task_lists` e `task_items`, e repetido em
 * toda rota. Não é o papel na organização que separa uma lista da outra: dois
 * `admin` da mesma empresa não se veem aqui.
 *
 * ⚠️ E a policy NÃO tem o `fn_is_platform_admin()` que todas as outras tabelas
 * têm. Numa instalação de revendedor, o platform admin é o revendedor — o bypass
 * o deixaria ler a lista pessoal de quem contratou. O racional inteiro está no
 * cabeçalho da migration 0206.
 *
 * ─── A porta e a aresta ──────────────────────────────────────────────────
 *
 * Porta: grupo "Atividades" em `lib/navigation/registry.ts`.
 * Aresta de saída: o badge de vencidas no próprio item do menu
 * (`components/tarefas/BadgeDeVencidas.tsx`, alimentado por
 * `GET /api/v1/tarefas/resumo`) — é o que faz um prazo ser visto por quem não
 * lembrou de abrir esta tela, e o que impede a feature de ser uma ilha.
 */
export default async function TarefasPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  const supabase = await createClient();
  // Carregado no servidor para a coluna da esquerda não nascer vazia e piscar:
  // a lista de listas é o esqueleto da tela, e vê-la aparecer depois faz a
  // seleção pular debaixo do cursor.
  const { listas } = await carregarListasComPendentes(supabase, activeOrg.orgId, user.id);

  return <TarefasClient listasIniciais={listas} />;
}
