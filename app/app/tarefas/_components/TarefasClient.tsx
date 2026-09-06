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

  /**
   * O QUE PRECISA VOLTAR AO SERVIDOR DEPOIS DE UMA MUDANÇA — E O QUE NÃO.
   *
   * Antes havia um `revalidar()` que invalidava as TRÊS chaves em toda mutação:
   * as tarefas da lista, o contador de pendentes de cada lista e o badge de
   * vencidas. Marcar uma tarefa como concluída custava a gravação MAIS três
   * recarregamentos completos — e cada um deles paga o preâmbulo de
   * autenticação e a viagem até o banco (medido: 154 ms por ida, VPS no Brasil,
   * Supabase em ca-central-1). Dava ~1,7 s até o círculo mudar de estado.
   *
   * O conserto tem duas metades:
   *
   *  1. A resposta do servidor JÁ TRAZ a linha atualizada. Usá-la para corrigir
   *     o cache é de graça; buscá-la de novo é pagar duas vezes pela mesma
   *     informação.
   *  2. O contador de pendentes muda de forma conhecida (±1), então ele é
   *     ajustado aqui em vez de recontado lá.
   *
   * O badge de vencidas é o único que ainda volta ao servidor — e só quando a
   * mudança PODE tê-lo afetado (conclusão ou prazo). Editar o texto de uma
   * tarefa não mexe em vencimento nenhum e não gera chamada. Preferi recarregá-lo
   * a calcular vencimento no cliente: a regra tem um dono só (`estaVencida`), e
   * duplicá-la aqui criaria a segunda cópia que este código evita em toda parte.
   */
  const chave = ativa ? tarefasKey(ativa) : null;

  /** Ajusta o contador de pendentes de uma lista sem ir ao servidor. */
  function ajustarPendentes(listaId: string, delta: number) {
    qc.setQueryData<ListaComPendentes[]>(LISTAS_KEY, (antes) =>
      (antes ?? []).map((l) =>
        l.id === listaId ? { ...l, pendentes: Math.max(0, l.pendentes + delta) } : l,
      ),
    );
  }

  /** Recarrega só o badge, e só quem chama decide se ele foi afetado. */
  function recarregarBadge() {
    qc.invalidateQueries({ queryKey: RESUMO_KEY });
  }

  const criarLista = useMutation({
    mutationFn: async (nome: string) =>
      (await apiClient.post<{ data: ListaComPendentes }>("/api/v1/tarefas/listas", { nome })).data,
    onError: showApiError,
    // Abre a lista recém-criada: quem acabou de nomeá-la vai escrever nela.
    //
    // O `setQueryData` antes do `setEscolhida` não é otimização, é correção: a
    // lista aberta é DERIVADA do que está em cache, e sem semear o cache a
    // recém-criada não estaria lá — a derivação cairia na primeira lista e a
    // seleção só pularia para a certa quando a revalidação voltasse.
    //
    // Lista nova nasce vazia: nada a recarregar.
    onSuccess: (lista) => {
      qc.setQueryData<ListaComPendentes[]>(LISTAS_KEY, (antes) => [...(antes ?? []), lista]);
      setEscolhida(lista.id);
    },
  });

  const renomearLista = useMutation({
    mutationFn: ({ id, nome }: { id: string; nome: string }) =>
      apiClient.patch(`/api/v1/tarefas/listas/${id}`, { nome }),
    onError: showApiError,
    // Renomear não mexe em contagem nem em prazo: só o nome, e no cache.
    onSuccess: (_r, { id, nome }) => {
      qc.setQueryData<ListaComPendentes[]>(LISTAS_KEY, (antes) =>
        (antes ?? []).map((l) => (l.id === id ? { ...l, nome } : l)),
      );
    },
  });

  const apagarLista = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/v1/tarefas/listas/${id}`),
    onError: showApiError,
    // Apagar leva as tarefas junto (cascade do banco), e entre elas pode haver
    // vencidas — por isso o badge volta ao servidor aqui.
    onSuccess: (_r, id) => {
      qc.setQueryData<ListaComPendentes[]>(LISTAS_KEY, (antes) =>
        (antes ?? []).filter((l) => l.id !== id),
      );
      qc.removeQueries({ queryKey: tarefasKey(id) });
      recarregarBadge();
    },
  });

  const criarTarefa = useMutation({
    mutationFn: async (texto: string) =>
      (await apiClient.post<{ data: Tarefa }>("/api/v1/tarefas", { lista_id: ativa, texto })).data,
    onError: showApiError,
    // Tarefa nasce pendente e SEM prazo: soma um no contador e não toca no badge.
    onSuccess: (tarefa) => {
      if (chave) qc.setQueryData<Tarefa[]>(chave, (antes) => [...(antes ?? []), tarefa]);
      ajustarPendentes(tarefa.lista_id, +1);
    },
  });

  const alterarTarefa = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: TarefaPatch }) =>
      (await apiClient.patch<{ data: Tarefa }>(`/api/v1/tarefas/${id}`, patch)).data,

    /**
     * ⚠️ A MUDANÇA APARECE ANTES DE O SERVIDOR CONFIRMAR — é isto que tira a
     * sensação de travamento ao clicar no círculo.
     *
     * `cancelQueries` primeiro, e não é detalhe: uma busca em voo que voltasse
     * depois desta linha traria o estado ANTIGO e desfaria o clique na tela,
     * sozinha, sem erro nenhum.
     *
     * `concluida_em` acompanha `concluida` aqui pelo mesmo motivo que o banco
     * tem um CHECK para isso: tarefa concluída sem carimbo é um estado que não
     * existe, e deixá-lo aparecer por um instante na tela seria mentir barato.
     */
    onMutate: async ({ id, patch }) => {
      if (!chave) return { anterior: undefined };
      await qc.cancelQueries({ queryKey: chave });
      const anterior = qc.getQueryData<Tarefa[]>(chave);
      qc.setQueryData<Tarefa[]>(chave, (antes) =>
        (antes ?? []).map((t) =>
          t.id === id
            ? {
                ...t,
                ...patch,
                ...(patch.concluida === undefined
                  ? {}
                  : { concluida_em: patch.concluida ? new Date().toISOString() : null }),
              }
            : t,
        ),
      );
      if (patch.concluida !== undefined) {
        const alvo = anterior?.find((t) => t.id === id);
        if (alvo) ajustarPendentes(alvo.lista_id, patch.concluida ? -1 : +1);
      }
      return { anterior };
    },

    // Desfaz o otimismo e mostra o erro: a tela volta ao que o servidor tem.
    onError: (erro, _v, ctx) => {
      if (chave && ctx?.anterior) qc.setQueryData(chave, ctx.anterior);
      qc.invalidateQueries({ queryKey: LISTAS_KEY });
      showApiError(erro);
    },

    // A linha do servidor é a autoridade: substitui a versão otimista.
    onSuccess: (tarefa, { patch }) => {
      if (chave) {
        qc.setQueryData<Tarefa[]>(chave, (antes) =>
          (antes ?? []).map((t) => (t.id === tarefa.id ? tarefa : t)),
        );
      }
      if (patch.concluida !== undefined || patch.vence_em !== undefined) recarregarBadge();
    },
  });

  const apagarTarefa = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/v1/tarefas/${id}`),
    onError: showApiError,
    onSuccess: (_r, id) => {
      const alvo = chave ? qc.getQueryData<Tarefa[]>(chave)?.find((t) => t.id === id) : undefined;
      if (chave) {
        qc.setQueryData<Tarefa[]>(chave, (antes) => (antes ?? []).filter((t) => t.id !== id));
      }
      if (alvo && !alvo.concluida) ajustarPendentes(alvo.lista_id, -1);
      // A apagada podia ser uma vencida — só então o badge muda.
      if (alvo?.vence_em) recarregarBadge();
    },
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
