import { format, isToday, isTomorrow, isYesterday, type Locale } from "date-fns";

/**
 * A CONVERSÃO ENTRE O PRAZO GRAVADO E OS CAMPOS DO FORMULÁRIO.
 *
 * O banco guarda um instante (`timestamptz`). O formulário oferece `<input
 * type="date">` e `<input type="time">`, que falam em hora LOCAL. Este arquivo
 * é a única ponte entre os dois — e existe separado da tela para ser testável
 * sem montar árvore de React.
 *
 * ⚠️ A regra que amarra tudo: uma tarefa SEM horário é gravada como a
 * meia-noite LOCAL do dia escolhido. É o que faz `vence_em + 24h` ser o fim do
 * dia de quem marcou, em qualquer fuso, sem ninguém precisar guardar o fuso.
 * Ver `estaVencida` em `lib/schemas/tarefas.ts`.
 */

/** O instante gravado → o valor de um `<input type="date">` (hora local). */
export function paraCampoDeData(iso: string): string {
  const d = new Date(iso);
  // Nada de `toISOString().slice(0,10)`: isso devolve o dia em UTC, que a oeste
  // do meridiano é o dia ANTERIOR ao que a pessoa escolheu.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** O instante gravado → o valor de um `<input type="time">` (hora local). */
export function paraCampoDeHora(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Os campos do formulário → o instante a gravar.
 *
 * `hora` nula significa prazo de dia inteiro, e então o instante é a meia-noite
 * local — a âncora que a regra de vencimento assume.
 */
export function montarPrazo(dia: string, hora: string | null): string | null {
  const [ano, mes, diaDoMes] = dia.split("-").map(Number);
  if (!ano || !mes || !diaDoMes) return null;
  const [h, m] = hora ? hora.split(":").map(Number) : [0, 0];
  // Construtor por componentes, não `new Date("2026-09-12")`: a string ISO só
  // com data é interpretada como UTC pela especificação, e a com hora como
  // local — a mesma função devolveria dias diferentes conforme o campo horário
  // estivesse preenchido.
  const d = new Date(ano, mes - 1, diaDoMes, h ?? 0, m ?? 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * O prazo como quem marcou o lê.
 *
 * "Hoje" e "Amanhã" no lugar da data porque é assim que se pensa em prazo curto
 * — e prazo curto é a maioria dos que existem numa lista pessoal. Passar de
 * "12 de set" a "Hoje" é o que faz a linha ser lida sem calcular nada.
 */
export function formatarPrazo(
  vence_em: string,
  vence_com_hora: boolean,
  locale: Locale,
  t: (texto: string) => string,
): string {
  const d = new Date(vence_em);
  const hora = vence_com_hora ? format(d, "HH:mm", { locale }) : "";

  let dia: string;
  if (isToday(d)) dia = t("Hoje");
  else if (isTomorrow(d)) dia = t("Amanhã");
  else if (isYesterday(d)) dia = t("Ontem");
  // Ano só quando NÃO é o corrente: "12 de set de 2026" numa lista inteira de
  // 2026 é ruído em toda linha.
  else if (d.getFullYear() === new Date().getFullYear()) dia = format(d, "d MMM", { locale });
  else dia = format(d, "d MMM yyyy", { locale });

  return hora ? `${dia}, ${hora}` : dia;
}
