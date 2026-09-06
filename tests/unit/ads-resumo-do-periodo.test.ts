import { describe, expect, it } from "vitest";

import { resumirCampanhas } from "@/lib/plataformas-de-anuncio/meta/resumo";
import type { LinhaDeCampanha } from "@/lib/plataformas-de-anuncio/types";

/**
 * O resumo do período não pode inventar número.
 *
 * Dois riscos, e os dois já morderam esta tela em outra forma (é por isso que a
 * tabela carrega o rótulo do indicador ao lado de cada valor):
 *
 *  1. Somar resultados de OBJETIVOS diferentes. Conversas + cadastros + compras
 *     dá um total que não existe no mundo.
 *  2. Tratar ausência como zero. Campanha que não veiculou volta sem gasto, e
 *     um `?? 0` a somaria como medição real.
 */

function linha(p: Partial<LinhaDeCampanha> & { campanhaId: string }): LinhaDeCampanha {
  return {
    nome: "c",
    status: "ACTIVE",
    veiculacao: "ACTIVE",
    objetivo: null,
    resultado: { valor: null, custoPorResultado: null, indicador: null },
    gasto: null,
    impressoes: null,
    alcance: null,
    cpm: null,
    ctr: null,
    frequencia: null,
    cpc: null,
    hookRate: null,
    thruPlays: null,
    ...p,
  };
}

describe("resumo do período", () => {
  it("soma gasto e resultados quando o indicador é o mesmo", () => {
    const r = resumirCampanhas([
      linha({ campanhaId: "a", gasto: 100, resultado: { valor: 10, custoPorResultado: 10, indicador: "onsite_conversion.messaging_conversation_started_7d" } }),
      linha({ campanhaId: "b", gasto: 50, resultado: { valor: 5, custoPorResultado: 10, indicador: "onsite_conversion.messaging_conversation_started_7d" } }),
    ]);
    expect(r.gastoTotal).toBe(150);
    expect(r.resultadoTotal).toBe(15);
    expect(r.custoMedioPorResultado).toBe(10);
    expect(r.indicadoresMisturados).toBe(false);
    expect(r.indicadorUnico).toContain("messaging_conversation");
  });

  it("⚠️ acusa mistura quando os objetivos são diferentes", () => {
    const r = resumirCampanhas([
      linha({ campanhaId: "a", gasto: 100, resultado: { valor: 10, custoPorResultado: 10, indicador: "conversas" } }),
      linha({ campanhaId: "b", gasto: 50, resultado: { valor: 2, custoPorResultado: 25, indicador: "compras" } }),
    ]);
    // O total continua disponível — o que não pode é sair sem a ressalva.
    expect(r.resultadoTotal).toBe(12);
    expect(r.indicadoresMisturados).toBe(true);
    expect(r.indicadorUnico).toBeNull();
  });

  it("campanha PARADA não conta como mistura — ela tem indicador e não tem valor", () => {
    const r = resumirCampanhas([
      linha({ campanhaId: "a", gasto: 100, resultado: { valor: 10, custoPorResultado: 10, indicador: "conversas" } }),
      linha({ campanhaId: "b", gasto: null, resultado: { valor: null, custoPorResultado: null, indicador: "compras" } }),
    ]);
    expect(r.indicadoresMisturados).toBe(false);
    expect(r.indicadorUnico).toBe("conversas");
  });

  it("ausência NÃO é zero: sem nenhum gasto medido, o total é nulo", () => {
    const r = resumirCampanhas([linha({ campanhaId: "a" }), linha({ campanhaId: "b" })]);
    expect(r.gastoTotal).toBeNull();
    expect(r.resultadoTotal).toBeNull();
    expect(r.custoMedioPorResultado).toBeNull();
  });

  it("zero resultado não vira custo infinito nem custo zero", () => {
    const r = resumirCampanhas([
      linha({ campanhaId: "a", gasto: 80, resultado: { valor: 0, custoPorResultado: null, indicador: "conversas" } }),
    ]);
    expect(r.gastoTotal).toBe(80);
    expect(r.custoMedioPorResultado).toBeNull();
  });

  it("conta as ativas pela VEICULAÇÃO, não pelo status", () => {
    const r = resumirCampanhas([
      linha({ campanhaId: "a", status: "ACTIVE", veiculacao: "ACTIVE" }),
      // Campanha ligada cujo conjunto está pausado: não entrega nada.
      linha({ campanhaId: "b", status: "ACTIVE", veiculacao: "ADSET_PAUSED" }),
      linha({ campanhaId: "c", status: "PAUSED", veiculacao: "PAUSED" }),
    ]);
    expect(r.ativas).toBe(1);
    expect(r.total).toBe(3);
  });
});
