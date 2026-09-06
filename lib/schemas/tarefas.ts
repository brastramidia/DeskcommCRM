import { z } from "zod";

/**
 * O CONTRATO DAS TAREFAS PESSOAIS — um só, lido pela tela E pelas rotas.
 *
 * Mesma razão do `produtos.ts`: um schema por lado é como nasce controle
 * decorativo — a tela oferece um campo, a rota descarta o que não conhece, e a
 * pessoa clica em algo que não faz nada.
 */

/**
 * A escala de prioridade, 0 a 3, como no Lembretes.
 *
 * Inteiro e não texto porque a tela ORDENA por isto e o índice cobre
 * `order by prioridade desc`. Um vocabulário textual exigiria um CASE.
 */
export const PRIORIDADES = [0, 1, 2, 3] as const;
export type Prioridade = (typeof PRIORIDADES)[number];

/** O rótulo de cada nível. Passa por `t()` em quem desenha, nunca aqui. */
export const ROTULO_DA_PRIORIDADE: Record<Prioridade, string> = {
  0: "Sem prioridade",
  1: "Baixa",
  2: "Média",
  3: "Alta",
};

/** O sinal visual — o "!" do Lembretes. Nível 0 não desenha nada. */
export const SINAL_DA_PRIORIDADE: Record<Prioridade, string> = {
  0: "",
  1: "!",
  2: "!!",
  3: "!!!",
};

const nomeDaLista = z
  .string()
  .trim()
  .min(1, "a lista precisa de um nome")
  .max(80)
  // Espaço duplo some: "Trabalho  " e "Trabalho" são a mesma lista para quem
  // digitou, e a unique do banco os trataria como duas.
  .transform((v) => v.replace(/\s+/g, " "));

export const listaCreateSchema = z.object({ nome: nomeDaLista });
export const listaPatchSchema = z.object({ nome: nomeDaLista });

const prioridade = z
  .number()
  .int()
  .min(0)
  .max(3, "a prioridade vai de 0 a 3");

/**
 * O prazo chega como ISO-8601 UTC — a regra do `CLAUDE.md` para toda data na
 * API. Quem converte o horário local do formulário é a tela, no momento em que
 * o navegador ainda sabe o fuso de quem digitou.
 */
const vence_em = z.string().datetime({ offset: true }).nullable();

const corpoDaTarefa = {
  texto: z.string().trim().min(1, "a tarefa precisa de um texto").max(500),
  vence_em: vence_em.optional(),
  vence_com_hora: z.boolean().optional(),
  prioridade: prioridade.optional(),
};

/**
 * `vence_com_hora` sem `vence_em` é um estado que a tela não sabe desenhar, e o
 * banco tem CHECK para ele. Recusar aqui devolve 422 com o campo nomeado, em vez
 * de um 500 vindo da constraint.
 */
const horaExigeData = (v: { vence_em?: string | null; vence_com_hora?: boolean }) =>
  !v.vence_com_hora || v.vence_em != null;

export const tarefaCreateSchema = z
  .object({ lista_id: z.string().uuid(), ...corpoDaTarefa })
  .refine(horaExigeData, {
    message: "não dá para marcar um horário sem uma data",
    path: ["vence_com_hora"],
  });

/**
 * Tudo opcional: o PATCH muda o que veio e não encosta no resto.
 *
 * ⚠️ `concluida` entra aqui e NÃO no create — tarefa nasce pendente, sempre.
 * Aceitá-la na criação abriria a porta para "criar já concluída", que só existe
 * como engano de cliente e obrigaria o carimbo a ser inventado.
 *
 * `concluida_em` não entra em nenhum dos dois: quem carimba é a rota, com o
 * relógio do servidor. Deixar o cliente escolher a hora da conclusão faria o
 * relatório de "o que fechei hoje" depender do relógio do navegador.
 */
export const tarefaPatchSchema = z
  .object({
    texto: corpoDaTarefa.texto.optional(),
    vence_em: vence_em.optional(),
    vence_com_hora: z.boolean().optional(),
    prioridade: prioridade.optional(),
    concluida: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "nada para alterar" })
  // Só cobra a regra quando o PATCH mexe na hora: um PATCH que só marca
  // `concluida` não sabe nada sobre o prazo e não deve ser recusado por ele.
  .refine((v) => v.vence_com_hora !== true || v.vence_em !== null, {
    message: "não dá para marcar um horário sem uma data",
    path: ["vence_com_hora"],
  });

export type ListaCreate = z.infer<typeof listaCreateSchema>;
export type TarefaCreate = z.infer<typeof tarefaCreateSchema>;
export type TarefaPatch = z.infer<typeof tarefaPatchSchema>;

export interface TarefaLista {
  id: string;
  nome: string;
  created_at: string;
}

export interface Tarefa {
  id: string;
  lista_id: string;
  texto: string;
  concluida: boolean;
  concluida_em: string | null;
  vence_em: string | null;
  vence_com_hora: boolean;
  prioridade: number;
  created_at: string;
  updated_at: string;
}

/** As colunas que a tela e as rotas leem — uma lista, não duas. */
export const COLUNAS_DA_LISTA = "id, nome, created_at";
export const COLUNAS_DA_TAREFA =
  "id, lista_id, texto, concluida, concluida_em, vence_em, vence_com_hora, " +
  "prioridade, created_at, updated_at";

/**
 * Quanto tempo um prazo de DIA INTEIRO ainda vale depois do instante gravado.
 *
 * Uma tarefa sem hora é gravada como a meia-noite LOCAL do dia escolhido. Somar
 * 24h a esse instante dá a meia-noite local do dia seguinte — ou seja, o fim do
 * dia de quem marcou, em qualquer fuso, sem esta função precisar saber qual é.
 */
const UM_DIA_MS = 24 * 60 * 60 * 1000;

/**
 * A tarefa está vencida? É a regra do BADGE da sidebar, e ela mora aqui para o
 * contador do servidor e o desenho da linha na tela nunca discordarem.
 *
 * ⚠️ NADA DE `setHours()` AQUI. A versão óbvia — "fim do dia" via
 * `setHours(23,59,59)` — usa o fuso de QUEM EXECUTA: o navegador de quem marcou
 * num caso, o contêiner em UTC no outro. As duas respostas divergiriam por até
 * um dia inteiro, e o badge acusaria uma tarefa que a linha desenha como no
 * prazo. A aritmética de instante acerta nos dois lados por construção.
 */
export function estaVencida(
  t: Pick<Tarefa, "concluida" | "vence_em" | "vence_com_hora">,
  agora = new Date(),
): boolean {
  if (t.concluida || !t.vence_em) return false;
  const prazo = new Date(t.vence_em).getTime();
  return agora.getTime() >= (t.vence_com_hora ? prazo : prazo + UM_DIA_MS);
}

/**
 * O CORTE que a consulta do badge usa, do lado do banco.
 *
 * Devolve os dois instantes que separam vencido de no prazo, para a rota montar
 * o filtro sem repetir a aritmética acima — a regra continua tendo um dono só.
 */
export function cortesDeVencimento(agora = new Date()): { comHora: string; diaInteiro: string } {
  return {
    comHora: agora.toISOString(),
    diaInteiro: new Date(agora.getTime() - UM_DIA_MS).toISOString(),
  };
}
