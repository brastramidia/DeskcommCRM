"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import type { Tarefa, TarefaPatch } from "@/lib/schemas/tarefas";
import type { ListaComPendentes } from "@/lib/tarefas/consultas";

import { ListasSidebar } from "./ListasSidebar";
import { NovaTarefaInput } from "./NovaTarefaInput";
import { TarefaLinha } from "./TarefaLinha";

const LISTAS_KEY = ["tarefas", "listas"];
/** A MESMA chave do `useResumoDeTarefas` — é o badge da barra lateral. */
const RESUMO_KEY = ["tarefas", "resumo"];
const tarefasKey = (listaId: string) => ["tarefas", "itens", listaId];

type Filtro = "pendentes" | "todas" | "concluidas";

const FILTROS: Array<{ id: Filtro; label: string }> = [
  { id: "pendentes", label: "Pendentes" },
  { id: "todas", label: "Todas" },
  { id: "concluidas", label: "Concluídas" },
];

/**
 * A tela de Tarefas: listas à esquerda, tarefas da lista selecionada à direita.
 *
 * ⚠️ TODA mutação invalida TRÊS chaves, e nenhuma é dispensável:
 *   - as tarefas da lista aberta (o que se vê),
 *   - as listas (o contador de pendentes ao lado de cada nome),
 *   - o resumo (o badge de vencidas na barra lateral do app).
 *
 * A terceira é a que se esquece, e o sintoma é o pior tipo: o badge fica aceso
 * depois de a última tarefa vencida ser concluída, e a pessoa clica de novo
 * achando que o clique não pegou.
 */
export function TarefasClient({ listasIniciais }: { listasIniciais: ListaComPendentes[] }) {
  const t = useT();
  const qc = useQueryClient();

  const { data: listas = [] } = useQuery({
    queryKey: LISTAS_KEY,
    queryFn: () => apiClient.get<ListaComPendentes[]>("/api/v1/tarefas/listas"),
    initialData: listasIniciais,
  });

  const [escolhida, setEscolhida] = React.useState<string | null>(listasIniciais[0]?.id ?? null);
  const [filtro, setFiltro] = React.useState<Filtro>("pendentes");
  const [soPrioritarias, setSoPrioritarias] = React.useState(false);

  /**
   * A lista realmente aberta: a escolhida, enquanto ela existir; a primeira, se
   * não existir mais.
   *
   * ⚠️ DERIVADA, não sincronizada por efeito. A versão com `useEffect` renderizava
   * uma vez apontando para uma lista apagada — e é nesse quadro que a consulta de
   * tarefas dispara com o id morto, devolve 404 e pinta um erro que some sozinho.
   * Aqui o estado impossível não chega a existir.
   */
  const ativa = listas.some((l) => l.id === escolhida) ? escolhida : (listas[0]?.id ?? null);

  const { data: tarefas, isLoading } = useQuery({
    queryKey: tarefasKey(ativa ?? ""),
    queryFn: () => apiClient.get<Tarefa[]>(`/api/v1/tarefas?lista_id=${ativa}`),
    enabled: ativa !== null,
  });

  function revalidar() {
    qc.invalidateQueries({ queryKey: LISTAS_KEY });
    qc.invalidateQueries({ queryKey: RESUMO_KEY });
    if (ativa) qc.invalidateQueries({ queryKey: tarefasKey(ativa) });
  }

  const criarLista = useMutation({
    mutationFn: (nome: string) => apiClient.post<ListaComPendentes>("/api/v1/tarefas/listas", { nome }),
    onError: showApiError,
    // Abre a lista recém-criada: quem acabou de nomeá-la vai escrever nela.
    //
    // O `setQueryData` antes do `setEscolhida` não é otimização, é correção: a
    // lista aberta é DERIVADA do que está em cache, e sem semear o cache a
    // recém-criada não estaria lá — a derivação cairia na primeira lista e a
    // seleção só pularia para a certa quando a revalidação voltasse.
    onSuccess: (lista) => {
      qc.setQueryData<ListaComPendentes[]>(LISTAS_KEY, (antes) => [...(antes ?? []), lista]);
      setEscolhida(lista.id);
      revalidar();
    },
  });

  const renomearLista = useMutation({
    mutationFn: ({ id, nome }: { id: string; nome: string }) =>
      apiClient.patch(`/api/v1/tarefas/listas/${id}`, { nome }),
    onError: showApiError,
    onSuccess: revalidar,
  });

  const apagarLista = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/v1/tarefas/listas/${id}`),
    onError: showApiError,
    onSuccess: revalidar,
  });

  const criarTarefa = useMutation({
    mutationFn: (texto: string) => apiClient.post("/api/v1/tarefas", { lista_id: ativa, texto }),
    onError: showApiError,
    onSuccess: revalidar,
  });

  const alterarTarefa = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TarefaPatch }) =>
      apiClient.patch(`/api/v1/tarefas/${id}`, patch),
    onError: showApiError,
    onSuccess: revalidar,
  });

  const apagarTarefa = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/v1/tarefas/${id}`),
    onError: showApiError,
    onSuccess: revalidar,
  });

  const listaAtiva = listas.find((l) => l.id === ativa) ?? null;

  const visiveis = React.useMemo(() => {
    let itens = tarefas ?? [];
    if (filtro === "pendentes") itens = itens.filter((i) => !i.concluida);
    if (filtro === "concluidas") itens = itens.filter((i) => i.concluida);
    if (soPrioritarias) itens = itens.filter((i) => i.prioridade > 0);
    return itens;
  }, [tarefas, filtro, soPrioritarias]);

  return (
    <div className="flex h-full gap-4">
      <ListasSidebar
        listas={listas}
        ativa={ativa}
        onSelecionar={setEscolhida}
        onCriar={(nome) => criarLista.mutate(nome)}
        onRenomear={(id, nome) => renomearLista.mutate({ id, nome })}
        onApagar={(id) => apagarLista.mutate(id)}
      />

      <section className="min-w-0 flex-1 space-y-4">
        {listaAtiva === null ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <p className="text-sm font-medium">{t("Nenhuma lista ainda")}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("Crie uma lista para começar a anotar o que precisa fazer.")}
            </p>
          </div>
        ) : (
          <>
            <header className="space-y-3">
              <h1 className="truncate text-xl font-semibold tracking-tight">{listaAtiva.nome}</h1>

              <div className="flex flex-wrap items-center gap-1">
                {FILTROS.map((f) => (
                  <Button
                    key={f.id}
                    type="button"
                    size="sm"
                    variant={filtro === f.id ? "secondary" : "ghost"}
                    onClick={() => setFiltro(f.id)}
                  >
                    {t(f.label)}
                  </Button>
                ))}
                <span aria-hidden className="mx-1 h-4 w-px bg-border" />
                <Button
                  type="button"
                  size="sm"
                  variant={soPrioritarias ? "secondary" : "ghost"}
                  onClick={() => setSoPrioritarias((v) => !v)}
                  aria-pressed={soPrioritarias}
                >
                  {t("Só prioritárias")}
                </Button>
              </div>
            </header>

            <NovaTarefaInput onCriar={(texto) => criarTarefa.mutate(texto)} />

            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            ) : visiveis.length === 0 ? (
              <p className={cn("px-2 py-6 text-center text-sm text-muted-foreground")}>
                {filtro === "pendentes" && !soPrioritarias
                  ? t("Nada pendente por aqui.")
                  : t("Nenhuma tarefa com esse filtro.")}
              </p>
            ) : (
              <ul className="divide-y">
                {visiveis.map((tarefa) => (
                  <TarefaLinha
                    key={tarefa.id}
                    tarefa={tarefa}
                    onAlterar={(id, patch) => alterarTarefa.mutate({ id, patch })}
                    onApagar={(id) => apagarTarefa.mutate(id)}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}
