"use client";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useT } from "@/hooks/i18n/useT";
import { rotuloDoIndicador } from "@/lib/plataformas-de-anuncio/meta/tabela-de-campanhas";
import type { ResumoDeCampanhas } from "@/lib/plataformas-de-anuncio/meta/resumo";

/**
 * Os números do período, antes da tabela.
 *
 * ─── Por que CARTÃO e não gráfico ──────────────────────────────────────────
 *
 * A pergunta que traz alguém aqui é "quanto gastei e o que rendeu" — um valor
 * único por medida, sem série temporal. Um gráfico para três números seria
 * decoração, e ainda traria uma paleta de séries que esta tela não precisa.
 *
 * Por isso não há cor de dado nenhuma aqui: o número usa token de TEXTO
 * (`text-text`), o rótulo usa `text-text-muted`, e a única cor presente é a de
 * status — que aparece sempre com palavra ao lado, nunca sozinha.
 *
 * ─── A ressalva que não pode sumir ─────────────────────────────────────────
 *
 * `resultado.indicador` é por campanha. Conversas + cadastros + compras num
 * "total de resultados" é um número que não existe. Quando há mistura, o total
 * continua na tela — mas com etiqueta dizendo isso, e o custo médio sai de cena,
 * porque dividir dinheiro por unidades de tipos diferentes não tem significado.
 */

const TRACO = "—";

function Tile({
  rotulo,
  valor,
  detalhe,
}: {
  rotulo: string;
  valor: string;
  detalhe?: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{rotulo}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-text">{valor}</p>
      {detalhe && <div className="mt-1 text-xs text-text-muted">{detalhe}</div>}
    </Card>
  );
}

interface Props {
  resumo: ResumoDeCampanhas;
  moeda: string;
}

export function ResumoDoPeriodo({ resumo, moeda }: Props) {
  const t = useT();

  const dinheiro = (v: number | null, casas = 2) =>
    v === null
      ? TRACO
      : v.toLocaleString("pt-BR", {
          style: "currency",
          currency: moeda,
          minimumFractionDigits: casas,
          maximumFractionDigits: casas,
        });

  const numero = (v: number | null) => (v === null ? TRACO : v.toLocaleString("pt-BR"));

  const rotuloDoResultado = resumo.indicadorUnico
    ? rotuloDoIndicador(resumo.indicadorUnico)
    : null;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Tile rotulo={t("Valor gasto")} valor={dinheiro(resumo.gastoTotal)} />

      <Tile
        rotulo={t("Resultados")}
        valor={numero(resumo.resultadoTotal)}
        detalhe={
          resumo.indicadoresMisturados ? (
            // Status com PALAVRA, nunca cor sozinha: quem não distingue âmbar
            // continua lendo a ressalva.
            <Badge variant="warning" className="px-2 py-0 text-[11px] font-normal">
              {t("objetivos diferentes somados")}
            </Badge>
          ) : rotuloDoResultado ? (
            t(rotuloDoResultado)
          ) : undefined
        }
      />

      <Tile
        rotulo={t("Custo médio por resultado")}
        // Com objetivos misturados a divisão perde sentido — dinheiro por
        // "unidade de coisas diferentes" não é um custo.
        valor={resumo.indicadoresMisturados ? TRACO : dinheiro(resumo.custoMedioPorResultado)}
        detalhe={resumo.indicadoresMisturados ? t("não se calcula com objetivos misturados") : undefined}
      />

      <Tile
        rotulo={t("Campanhas entregando")}
        valor={`${resumo.ativas}`}
        detalhe={`${t("de")} ${resumo.total} ${t("no período")}`}
      />
    </div>
  );
}
