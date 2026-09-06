import { describe, expect, it } from "vitest";

import {
  cortesDeVencimento,
  estaVencida,
  tarefaCreateSchema,
  tarefaPatchSchema,
  listaCreateSchema,
} from "@/lib/schemas/tarefas";
import { montarPrazo, paraCampoDeData, paraCampoDeHora } from "@/lib/tarefas/datas";

/**
 * O PRAZO É ONDE ESTA FEATURE PODE MENTIR SEM NINGUÉM PERCEBER.
 *
 * Uma tarefa que vira "vencida" um dia antes do que devia não quebra nada
 * visível: ela só aparece em vermelho, e o badge da barra lateral acusa um
 * número que não corresponde a nada. É o tipo de erro que se descobre semanas
 * depois, quando alguém deixa de confiar no contador — e aí a feature inteira
 * vira decoração.
 *
 * Por isso a regra de vencimento tem um dono só (`estaVencida`) e é medida aqui
 * nos dois regimes: com horário e de dia inteiro.
 */

/** Meia-noite LOCAL do dia dado — como a tela grava um prazo sem horário. */
function meiaNoiteLocal(ano: number, mes: number, dia: number): string {
  return new Date(ano, mes - 1, dia, 0, 0, 0, 0).toISOString();
}

describe("estaVencida", () => {
  it("tarefa concluída nunca está vencida, mesmo com prazo no passado", () => {
    expect(
      estaVencida(
        { concluida: true, vence_em: meiaNoiteLocal(2020, 1, 1), vence_com_hora: false },
        new Date(2026, 8, 5),
      ),
    ).toBe(false);
  });

  it("tarefa sem prazo nunca está vencida", () => {
    expect(
      estaVencida({ concluida: false, vence_em: null, vence_com_hora: false }, new Date()),
    ).toBe(false);
  });

  it("com horário: vence no instante marcado", () => {
    const prazo = new Date(2026, 8, 12, 14, 0, 0).toISOString();
    const base = { concluida: false, vence_em: prazo, vence_com_hora: true };
    expect(estaVencida(base, new Date(2026, 8, 12, 13, 59))).toBe(false);
    expect(estaVencida(base, new Date(2026, 8, 12, 14, 1))).toBe(true);
  });

  it("⚠️ dia inteiro: NÃO vence durante o próprio dia — só quando ele acaba", () => {
    // É a regressão que este arquivo existe para impedir. A implementação óbvia
    // ("vence_em < agora") pintaria de vermelho, às 9h da manhã, uma tarefa
    // marcada para HOJE — e a pessoa ainda tem o dia inteiro para fazê-la.
    const base = {
      concluida: false,
      vence_em: meiaNoiteLocal(2026, 9, 12),
      vence_com_hora: false,
    };
    expect(estaVencida(base, new Date(2026, 8, 12, 9, 0))).toBe(false);
    expect(estaVencida(base, new Date(2026, 8, 12, 23, 59))).toBe(false);
    expect(estaVencida(base, new Date(2026, 8, 13, 0, 1))).toBe(true);
  });

  it("os cortes da consulta do badge concordam com a regra da tela", () => {
    // O contador do servidor filtra por instante; a linha da tela chama
    // `estaVencida`. Discordar faria o badge acusar o que a lista não mostra.
    const agora = new Date(2026, 8, 13, 10, 0);
    const { comHora, diaInteiro } = cortesDeVencimento(agora);

    const deDiaInteiro = meiaNoiteLocal(2026, 9, 12);
    expect(new Date(deDiaInteiro) < new Date(diaInteiro)).toBe(
      estaVencida({ concluida: false, vence_em: deDiaInteiro, vence_com_hora: false }, agora),
    );

    const comRelogio = new Date(2026, 8, 13, 9, 0).toISOString();
    expect(new Date(comRelogio) < new Date(comHora)).toBe(
      estaVencida({ concluida: false, vence_em: comRelogio, vence_com_hora: true }, agora),
    );
  });
});

describe("conversão entre o prazo gravado e os campos do formulário", () => {
  it("ida e volta preserva o dia escolhido", () => {
    const iso = montarPrazo("2026-09-12", null);
    expect(iso).not.toBeNull();
    expect(paraCampoDeData(iso as string)).toBe("2026-09-12");
  });

  it("⚠️ o dia sobrevive a fuso a oeste do UTC", () => {
    // `toISOString().slice(0,10)` devolveria "2026-09-11" para a meia-noite de
    // São Paulo — o dia ANTERIOR ao que a pessoa escolheu. É o bug que
    // `paraCampoDeData` existe para não ter.
    const iso = meiaNoiteLocal(2026, 9, 12);
    expect(paraCampoDeData(iso)).toBe("2026-09-12");
  });

  it("com horário, ida e volta preserva a hora local", () => {
    const iso = montarPrazo("2026-09-12", "14:30");
    expect(paraCampoDeHora(iso as string)).toBe("14:30");
    expect(paraCampoDeData(iso as string)).toBe("2026-09-12");
  });

  it("sem horário, o instante é a meia-noite local — a âncora da regra do dia inteiro", () => {
    expect(montarPrazo("2026-09-12", null)).toBe(meiaNoiteLocal(2026, 9, 12));
  });

  it("data inválida devolve null em vez de um instante inventado", () => {
    expect(montarPrazo("", null)).toBeNull();
    expect(montarPrazo("nao-e-data", null)).toBeNull();
  });
});

describe("contrato de entrada", () => {
  const lista_id = "11111111-2222-4000-8000-333333333333";

  it("recusa horário sem data — o estado que o CHECK do banco também recusa", () => {
    const r = tarefaCreateSchema.safeParse({
      lista_id,
      texto: "sem data",
      vence_com_hora: true,
    });
    expect(r.success).toBe(false);
  });

  it("aceita tarefa mínima: só a lista e o texto", () => {
    expect(tarefaCreateSchema.safeParse({ lista_id, texto: "ligar para o contador" }).success).toBe(
      true,
    );
  });

  it("não aceita `concluida` na CRIAÇÃO — tarefa nasce pendente", () => {
    const r = tarefaCreateSchema.safeParse({ lista_id, texto: "x", concluida: true });
    // O Zod descarta a chave desconhecida; o que importa é ela não chegar ao banco.
    expect(r.success && "concluida" in r.data).toBe(false);
  });

  it("recusa prioridade fora de 0–3", () => {
    expect(tarefaCreateSchema.safeParse({ lista_id, texto: "x", prioridade: 4 }).success).toBe(false);
    expect(tarefaCreateSchema.safeParse({ lista_id, texto: "x", prioridade: -1 }).success).toBe(
      false,
    );
  });

  it("recusa PATCH vazio: pedido que não muda nada é engano de cliente", () => {
    expect(tarefaPatchSchema.safeParse({}).success).toBe(false);
  });

  it("PATCH que só conclui não é barrado pela regra do horário", () => {
    // A regra só vale quando o PATCH mexe no prazo. Cobrá-la sempre reprovaria
    // o clique mais comum da tela.
    expect(tarefaPatchSchema.safeParse({ concluida: true }).success).toBe(true);
  });

  it("PATCH pode limpar o prazo com null", () => {
    expect(tarefaPatchSchema.safeParse({ vence_em: null }).success).toBe(true);
  });

  it("nome de lista em branco é recusado, e o espaço duplo é normalizado", () => {
    expect(listaCreateSchema.safeParse({ nome: "   " }).success).toBe(false);
    const r = listaCreateSchema.safeParse({ nome: "Trabalho   urgente" });
    expect(r.success && r.data.nome).toBe("Trabalho urgente");
  });
});
