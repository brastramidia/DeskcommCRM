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

  /**
   * ⚠️ `.data` NÃO É OPCIONAL AQUI — e omiti-lo foi o defeito que derrubou esta
   * tela em produção.
   *
   * `apiClient` devolve o CORPO CRU da resposta, e toda rota `/api/v1` responde
   * no envelope `{ data, meta }` (lib/api/wrappers.ts). Quem consome desembrulha,
   * como `useChannelSessions` já fazia. Tipar o genérico como o array direto é
   * uma afirmação que o TypeScript aceita sem conferir: em runtime chega o objeto.
   *
   * O modo de falha foi traiçoeiro. O primeiro render usa `initialData`, que vem
   * do Server Component e É um array — a tela abria e funcionava. Só na primeira
   * revalidação `listas` virava `{data:[…]}`, e o render seguinte morria em
   * `listas.some is not a function`, dentro do boundary de erro do segmento.
   */
  const { data: listas = [] } = useQuery({
    queryKey: LISTAS_KEY,
    queryFn: async () =>
      (await apiClient.get<{ data: ListaComPendentes[] }>("/api/v1/tarefas/listas")).data,
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
    queryFn: async () =>
      (await apiClient.get<{ data: Tarefa[] }>(`/api/v1/tarefas?lista_id=${ativa}`)).data,
    enabled: ativa !== null,
  });

  function revalidar() {
    qc.invalidateQueries({ queryKey: LISTAS_KEY });
    qc.invalidateQueries({ queryKey: RESUMO_KEY });
    if (ativa) qc.invalidateQueries({ queryKey: tarefasKey(ativa) });
  }

  const criarLista = useMutation({
    // Idem: o `onSuccess` abaixo LÊ esta resposta para abrir a lista recém-criada.
    // As outras mutações não leem a delas, e por isso não precisam do desembrulho.
    mutationFn: async (nome: string) =>
      (await apiClient.post<{ data: ListaComPendentes }>("/api/v1/tarefas/listas", { nome })).data,
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
    /*
      A SUPERFÍCIE CLARA, DECLARADA — não herdada.

      O shell (`AppShell`) pinta `bg-background`, que nesta instalação é a paleta
      Ink, ESCURA. Tela que não declara nada nasce escura, e foi o que aconteceu
      aqui: Tarefas destoava de Follow-ups, Desempenho e Configurações.

      `data-superficie="clara"` é o mecanismo do produto para isso (ver o bloco
      em `app/globals.css`): ele redefine os tokens de cor para esta subárvore,
      sem tocar no tema escolhido pela pessoa e sem congelar a cor de marca do
      revendedor. O `-m-6` + `p-6` anula o padding do `<main>` para o claro
      chegar até a borda — senão sobra uma moldura escura em volta, que é o que
      denuncia um tema aplicado pela metade. Mesmo desenho de `metrics/page.tsx`.
    */
    <div
      data-superficie="clara"
      className="-m-6 flex min-h-[calc(100%+3rem)] gap-4 bg-bg p-6 text-text"
    >
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
