import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O PREÂMBULO DE AUTENTICAÇÃO NÃO PODE VOLTAR A SER UMA FILA.
 *
 * `loadAuthUser` faz três perguntas: quem é você (GoTrue), você é admin de
 * plataforma, e de quais organizações você participa. As DUAS últimas dependem
 * só do `user.id` — nunca uma da outra —, mas eram feitas em sequência.
 *
 * Medido nesta instalação: 154 ms por ida ao banco (a VPS está no Brasil e o
 * Supabase em ca-central-1). Em fila, o preâmbulo custava ~460 ms; e ele roda ao
 * menos DUAS vezes por página (o layout monta a casca, a página chama de novo),
 * o que dava ~920 ms de rede para responder a mesma pergunta sobre a mesma
 * pessoa — antes de qualquer tela começar o próprio trabalho.
 *
 * ─── Como este teste prova concorrência sem medir tempo ────────────────────
 *
 * Nada de `Date.now()` nem de limiar em milissegundos: isso reprova sozinho num
 * CI carregado e não prova nada. Aqui a consulta de `platform_admins` só resolve
 * DEPOIS que a de `user_organizations` começar.
 *
 * Em paralelo, as duas partem juntas, o sinal chega e tudo resolve. Em fila, a
 * primeira espera um sinal que só a segunda emitiria — e a segunda nunca começa.
 * O teste então ESTOURA O TEMPO em vez de passar, que é o desfecho certo para
 * uma regressão a sequencial.
 */

let memershipsComecou: () => void;
const esperaMemberships = new Promise<void>((r) => {
  memershipsComecou = r;
});

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {} }),
}));
vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("redirect");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "u1", email: "a@b.c", user_metadata: {} } },
        error: null,
      }),
    },
    from: (tabela: string) => {
      const ehPA = tabela === "platform_admins";
      const valor = async () => {
        if (ehPA) {
          // Só termina quando a OUTRA consulta tiver partido.
          await esperaMemberships;
          return { data: null, error: null };
        }
        memershipsComecou();
        return { data: [], error: null };
      };
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        is: () => (ehPA ? { maybeSingle: valor } : chain),
        order: () => chain,
        maybeSingle: valor,
        then: (r: (v: unknown) => unknown) => valor().then(r),
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("preâmbulo de autenticação", () => {
  it(
    "dispara platform_admins e user_organizations JUNTAS, não em fila",
    async () => {
      const { loadAuthUser } = await import("@/lib/auth/server");
      const user = await loadAuthUser();
      // Chegar aqui já é a prova: em sequência, o await acima nunca retornaria.
      expect(user?.id).toBe("u1");
    },
    // Curto de propósito: uma regressão a sequencial reprova em 2s, e não depois
    // do timeout padrão da suíte.
    2000,
  );
});
