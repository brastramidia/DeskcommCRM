/**
 * O DESEMBRULHO DO ENVELOPE — o defeito que derrubou esta tela em produção.
 *
 * `apiClient` devolve o CORPO CRU da resposta, e toda rota `/api/v1` responde
 * `{ data, meta }`. O código tipava o genérico como o array direto — afirmação
 * que o TypeScript aceita sem conferir — e usava o objeto como array.
 *
 * ⚠️ POR QUE O TIPO NÃO PEGOU, E POR QUE ESTE TESTE PRECISA EXISTIR:
 *
 * `apiClient.get<T>()` devolve `T` porque QUEM CHAMA declara `T`. Não há nada
 * para o compilador conferir contra a resposta real. Só um teste que devolva o
 * formato VERDADEIRO da rota separa a afirmação do fato.
 *
 * E o modo de falha era traiçoeiro: o primeiro render usa `initialData`, que vem
 * do Server Component e É um array — a tela abria, dava para criar lista. Só na
 * revalidação `listas` virava `{data:[…]}` e o render seguinte morria em
 * `listas.some is not a function`. Um teste que só montasse a tela com
 * `initialData` passaria verde; por isso os casos abaixo forçam a revalidação.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api/client", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() },
}));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (texto: string) => texto }));
vi.mock("@/hooks/i18n/useLocaleDeData", () => ({ useLocaleDeData: () => undefined }));

import { apiClient } from "@/lib/api/client";
import { TarefasClient } from "./TarefasClient";

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const LISTA = {
  id: "11111111-2222-4000-8000-333333333333",
  nome: "Trabalho",
  created_at: "2026-09-01T00:00:00Z",
  pendentes: 0,
};

/** `staleTime: 0` força a revalidação que o `initialData` mascarava. */
function envolver(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TarefasClient — o envelope das rotas /api/v1", () => {
  it("sobrevive à revalidação das listas, que chega como { data }", async () => {
    vi.mocked(apiClient.get).mockImplementation(async (path: string) =>
      path.startsWith("/api/v1/tarefas/listas")
        ? ({ data: [LISTA] } as unknown)
        : ({ data: [] } as unknown),
    );

    envolver(<TarefasClient listasIniciais={[LISTA]} />);

    // Antes do conserto isto estourava `listas.some is not a function` no render
    // seguinte à revalidação, e o boundary do segmento mostrava "Algo deu errado".
    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith("/api/v1/tarefas/listas");
    });
    // `findAllByText`: o nome aparece duas vezes de propósito — na coluna das
    // listas e no <h1> da lista aberta. O que este caso prova é que a tela
    // SOBREVIVEU à revalidação, não quantas vezes o nome aparece.
    expect((await screen.findAllByText("Trabalho")).length).toBeGreaterThan(0);
  });

  it("a tela nasce vazia sem quebrar quando não há lista nenhuma", async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [] } as unknown as never);

    envolver(<TarefasClient listasIniciais={[]} />);

    expect(await screen.findByText("Nenhuma lista ainda")).toBeTruthy();
  });

  it("as tarefas da lista aberta também vêm embrulhadas", async () => {
    const TAREFA = {
      id: "44444444-5555-4000-8000-666666666666",
      lista_id: LISTA.id,
      texto: "ligar para o contador",
      concluida: false,
      concluida_em: null,
      vence_em: null,
      vence_com_hora: false,
      prioridade: 0,
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
    };
    vi.mocked(apiClient.get).mockImplementation(async (path: string) =>
      path.startsWith("/api/v1/tarefas/listas")
        ? ({ data: [LISTA] } as unknown)
        : ({ data: [TAREFA] } as unknown),
    );

    envolver(<TarefasClient listasIniciais={[LISTA]} />);

    // Se o desembrulho faltar aqui, `itens.filter` estoura dentro do useMemo.
    expect(await screen.findByText("ligar para o contador")).toBeTruthy();
  });
});
