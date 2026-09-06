import { beforeEach, describe, expect, it, vi } from "vitest";

import { anotarSituacaoDaConexao } from "@/lib/agenda/google/situacao";

/**
 * A conexão precisa contar o que aconteceu com ela.
 *
 * O defeito medido em produção: o token do Google expirou (app OAuth em modo
 * "Testing" expira o refresh token em 7 dias), o cron tentou publicar 52 vezes,
 * todas com HTTP 401 — e `calendar_connections.status` seguiu `healthy`. A tela
 * dizia "Agenda conectada" enquanto nada saía. Quem marcou um compromisso com
 * convidado só descobriu conferindo a caixa de entrada da pessoa.
 *
 * `estadoDaConexaoApos` já sabia calcular o estado certo. Faltava quem gravasse.
 */

function clienteFalso() {
  const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
  return { admin: { from: vi.fn().mockReturnValue({ update }) }, update };
}

beforeEach(() => vi.clearAllMocks());

describe("anotar a situação da conexão", () => {
  it("401 do Google vira token_expired no banco", async () => {
    const { admin, update } = clienteFalso();
    const novo = await anotarSituacaoDaConexao(admin as never, "c1", "reautenticar", "healthy");
    expect(novo).toBe("token_expired");
    expect(update).toHaveBeenCalledWith({ status: "token_expired" });
  });

  it("falta de escopo vira scope_missing", async () => {
    const { admin, update } = clienteFalso();
    expect(await anotarSituacaoDaConexao(admin as never, "c1", "sem_permissao", "healthy")).toBe(
      "scope_missing",
    );
    expect(update).toHaveBeenCalledWith({ status: "scope_missing" });
  });

  it("⚠️ desfecho sobre o EVENTO não rebaixa a conexão", async () => {
    // Um evento que sumiu lá é caso isolado. Desligar a agenda inteira por causa
    // dele é o erro que `estadoDaConexaoApos` documenta ao devolver null.
    const { admin, update } = clienteFalso();
    expect(await anotarSituacaoDaConexao(admin as never, "c1", "evento_sumiu", "healthy")).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it("não reescreve quando o estado já é o mesmo", async () => {
    // O push roda a cada 5 min sobre N compromissos. Gravar a cada iteração
    // seria N escritas por rodada dizendo a mesma coisa — e mexeria em
    // `updated_at`, que é o carimbo de quando a conexão mudou de verdade.
    const { admin, update } = clienteFalso();
    expect(
      await anotarSituacaoDaConexao(admin as never, "c1", "reautenticar", "token_expired"),
    ).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it("falha ao gravar não derruba o cron", async () => {
    const admin = {
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: { message: "banco fora" } }),
        }),
      }),
    };
    // O trabalho do cron é publicar o compromisso; perder a anotação é ruim,
    // parar a publicação por causa dela seria pior.
    await expect(
      anotarSituacaoDaConexao(admin as never, "c1", "reautenticar", "healthy"),
    ).resolves.toBeNull();
  });
});
