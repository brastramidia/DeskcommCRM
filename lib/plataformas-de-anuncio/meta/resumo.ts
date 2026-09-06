import type { LinhaDeCampanha } from "@/lib/plataformas-de-anuncio/types";

/**
 * O RESUMO DO PERÍODO — os três números que se lê antes da tabela.
 *
 * ⚠️ A ARMADILHA QUE ESTE ARQUIVO EXISTE PARA NÃO CAIR.
 *
 * `resultado.indicador` é POR CAMPANHA. Uma conta pode ter, no mesmo período,
 * campanha otimizada para conversas no WhatsApp, outra para cadastro e outra
 * para compra. Somar as três num "total de resultados" produz um número que não
 * significa nada — e pior, com aparência de significar.
 *
 * É a mesma regra que a tabela já aplica ao carregar o rótulo do indicador ao
 * lado de cada número, em vez de deixar "15" solto na coluna.
 *
 * A saída então declara o que sabe: quando há UM indicador só, ele vem em
 * `indicadorUnico` e a tela pode escrever "12 conversas iniciadas". Quando há
 * mais de um, `indicadoresMisturados` fica true e a tela é obrigada a dizer isso
 * — o número continua disponível, mas nunca sem a ressalva.
 *
 * ⚠️ E nada de `?? 0`. Ausência não é zero: campanha que não veiculou volta sem
 * gasto, e transformá-la em 0 aqui somaria uma medição que não houve. Só entram
 * na conta as linhas que trouxeram valor; se nenhuma trouxe, o total é `null` e
 * a tela mostra "—", como as células da tabela já fazem.
 */
export interface ResumoDeCampanhas {
  gastoTotal: number | null;
  resultadoTotal: number | null;
  /** O indicador comum a todas as campanhas com resultado, ou null se houver mistura. */
  indicadorUnico: string | null;
  indicadoresMisturados: boolean;
  /** gasto ÷ resultados. Null quando não houve resultado — divisão por zero não é "custo zero". */
  custoMedioPorResultado: number | null;
  ativas: number;
  total: number;
}

/** Soma só o que existe; devolve null se nada existir. */
function somaOuNulo(valores: Array<number | null>): number | null {
  const presentes = valores.filter((v): v is number => v !== null);
  return presentes.length === 0 ? null : presentes.reduce((a, b) => a + b, 0);
}

export function resumirCampanhas(linhas: LinhaDeCampanha[]): ResumoDeCampanhas {
  const gastoTotal = somaOuNulo(linhas.map((l) => l.gasto));
  const resultadoTotal = somaOuNulo(linhas.map((l) => l.resultado.valor));

  // Só conta o indicador de quem REALMENTE teve resultado: uma campanha parada
  // volta com o indicador preenchido e o valor nulo, e deixá-la entrar aqui
  // acusaria "mistura" numa conta que tem um objetivo só.
  const indicadores = new Set(
    linhas
      .filter((l) => l.resultado.valor !== null && l.resultado.indicador !== null)
      .map((l) => l.resultado.indicador as string),
  );

  const custoMedioPorResultado =
    gastoTotal !== null && resultadoTotal !== null && resultadoTotal > 0
      ? gastoTotal / resultadoTotal
      : null;

  return {
    gastoTotal,
    resultadoTotal,
    indicadorUnico: indicadores.size === 1 ? [...indicadores][0]! : null,
    indicadoresMisturados: indicadores.size > 1,
    custoMedioPorResultado,
    // `veiculacao` e não `status`: é ela que diz se está ENTREGANDO. Uma campanha
    // ACTIVE cujo conjunto está pausado não entrega nada, e contá-la como ativa
    // no resumo explicaria mal a tabela logo abaixo, onde ela aparece pausada.
    ativas: linhas.filter((l) => l.veiculacao === "ACTIVE").length,
    total: linhas.length,
  };
}
