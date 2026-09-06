"use client";
import { useQuery } from "@tanstack/react-query";

import type { ResumoDeTarefas } from "@/app/api/v1/tarefas/resumo/route";
import { apiClient } from "@/lib/api/client";

/**
 * Quantas tarefas pessoais estão vencidas — a fonte do badge na barra lateral.
 *
 * Poll de 60s, e não os 30s do sinal de conexão: um número caindo é incidente e
 * se mede em segundos; um prazo vencendo se mede em horas. Metade da frequência
 * pela metade do custo, na mesma casca que já roda em toda tela.
 */
export function useResumoDeTarefas() {
  return useQuery({
    queryKey: ["tarefas", "resumo"],
    queryFn: () => apiClient.get<ResumoDeTarefas>("/api/v1/tarefas/resumo"),
    refetchInterval: 60_000,
    // A tela de Tarefas invalida esta chave ao concluir algo: sem isso, marcar a
    // última vencida deixaria o badge aceso por até um minuto, e o usuário
    // clicaria de novo achando que não pegou.
    staleTime: 30_000,
  });
}
