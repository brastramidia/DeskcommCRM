"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CalendarBlank, CheckCircle, Flag, Trash } from "@/lib/ui/icons";
import { useT } from "@/hooks/i18n/useT";
import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";
import { cn } from "@/lib/utils";
import {
  estaVencida,
  PRIORIDADES,
  ROTULO_DA_PRIORIDADE,
  SINAL_DA_PRIORIDADE,
  type Prioridade,
  type Tarefa,
  type TarefaPatch,
} from "@/lib/schemas/tarefas";
import { formatarPrazo, montarPrazo, paraCampoDeData, paraCampoDeHora } from "@/lib/tarefas/datas";

interface Props {
  tarefa: Tarefa;
  onAlterar: (id: string, patch: TarefaPatch) => void;
  onApagar: (id: string) => void;
}

/**
 * Uma linha da lista — o checkbox, o texto e o que pende sobre ele.
 *
 * ⚠️ O texto é um `<button>`, não um `<div onClick>`. Editar uma tarefa é ação,
 * e ação precisa chegar pelo teclado: com `div`, quem navega por Tab passa
 * direto por todas as tarefas da lista e não consegue editar nenhuma.
 */
export function TarefaLinha({ tarefa, onAlterar, onApagar }: Props) {
  const t = useT();
  const locale = useLocaleDeData();

  const [editando, setEditando] = React.useState(false);
  const [rascunho, setRascunho] = React.useState(tarefa.texto);

  const vencida = estaVencida(tarefa);
  const sinal = SINAL_DA_PRIORIDADE[tarefa.prioridade as Prioridade] ?? "";

  function salvarTexto() {
    const limpo = rascunho.trim();
    setEditando(false);
    // Texto vazio não apaga a tarefa: apagar é uma ação com botão próprio, e
    // fazer o campo vazio deletar transformaria um Backspace a mais em perda
    // silenciosa. Volta ao que era.
    if (limpo === "" || limpo === tarefa.texto) {
      setRascunho(tarefa.texto);
      return;
    }
    onAlterar(tarefa.id, { texto: limpo });
  }

  return (
    <li className="group flex items-start gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/40">
      {/* O círculo do Lembretes. Vazio quando pendente, preenchido quando feito. */}
      <button
        type="button"
        onClick={() => onAlterar(tarefa.id, { concluida: !tarefa.concluida })}
        aria-pressed={tarefa.concluida}
        aria-label={tarefa.concluida ? t("Reabrir tarefa") : t("Concluir tarefa")}
        className="mt-0.5 shrink-0 rounded-full text-text-muted transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {tarefa.concluida ? (
          <CheckCircle size={20} weight="fill" className="text-primary" />
        ) : (
          <span
            aria-hidden
            className={cn(
              "block h-5 w-5 rounded-full border-2",
              vencida ? "border-error" : "border-muted-foreground/40",
            )}
          />
        )}
      </button>

      <div className="min-w-0 flex-1">
        {editando ? (
          <Input
            autoFocus
            value={rascunho}
            onChange={(e) => setRascunho(e.target.value)}
            onBlur={salvarTexto}
            onKeyDown={(e) => {
              if (e.key === "Enter") salvarTexto();
              if (e.key === "Escape") {
                setRascunho(tarefa.texto);
                setEditando(false);
              }
            }}
            className="h-7 py-0"
            aria-label={t("Editar tarefa")}
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditando(true)}
            className="block w-full text-left text-sm focus-visible:outline-none focus-visible:underline"
          >
            {sinal && (
              <span className="mr-1 font-semibold text-error" aria-hidden>
                {sinal}
              </span>
            )}
            <span className={cn(tarefa.concluida && "text-muted-foreground line-through")}>
              {tarefa.texto}
            </span>
            {/* O sinal visual é cor + "!", que não chegam a leitor de tela. */}
            {tarefa.prioridade > 0 && (
              <span className="sr-only">
                {" — "}
                {t(ROTULO_DA_PRIORIDADE[tarefa.prioridade as Prioridade])}
              </span>
            )}
          </button>
        )}

        {tarefa.vence_em && (
          <span
            className={cn(
              "mt-0.5 block text-xs",
              vencida ? "font-medium text-error" : "text-muted-foreground",
            )}
          >
            {formatarPrazo(tarefa.vence_em, tarefa.vence_com_hora, locale, t)}
            {vencida && <span className="sr-only"> — {t("vencida")}</span>}
          </span>
        )}
      </div>

      {/* Aparecem no hover e no foco. `focus-within` não é detalhe: sem ele,
          quem chega por Tab move o foco para um botão invisível. */}
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <EditorDePrazo tarefa={tarefa} onAlterar={onAlterar} />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={t("Prioridade")}>
              <Flag size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {PRIORIDADES.map((p) => (
              <DropdownMenuItem
                key={p}
                onSelect={() => onAlterar(tarefa.id, { prioridade: p })}
                className={cn(tarefa.prioridade === p && "font-semibold")}
              >
                {SINAL_DA_PRIORIDADE[p] && (
                  <span className="mr-1 text-error" aria-hidden>
                    {SINAL_DA_PRIORIDADE[p]}
                  </span>
                )}
                {t(ROTULO_DA_PRIORIDADE[p])}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-error"
          onClick={() => onApagar(tarefa.id)}
          aria-label={t("Apagar tarefa")}
        >
          <Trash size={16} />
        </Button>
      </div>
    </li>
  );
}

/**
 * O prazo, num popover.
 *
 * O par data + horário é um estado só, e por isso vive num formulário próprio
 * em vez de dois controles soltos na linha: marcar a hora antes da data seria
 * um estado que o banco recusa (`task_items_hora_exige_data`), e a única forma
 * honesta de impedi-lo é o horário não existir enquanto não houver dia.
 */
function EditorDePrazo({
  tarefa,
  onAlterar,
}: {
  tarefa: Tarefa;
  onAlterar: (id: string, patch: TarefaPatch) => void;
}) {
  const t = useT();
  const [aberto, setAberto] = React.useState(false);
  const [dia, setDia] = React.useState("");
  const [comHora, setComHora] = React.useState(false);
  const [hora, setHora] = React.useState("09:00");

  /**
   * Semeia o formulário com o que está gravado, no ATO de abrir.
   *
   * ⚠️ Isto já foi um `useEffect` com `aberto` na lista de dependências, e o
   * lint reprovou com razão: semear por efeito significa renderizar uma vez com
   * o rascunho velho e só então corrigi-lo. Fechar sem salvar e reabrir
   * mostrava, por um quadro, o rascunho abandonado como se fosse o prazo. Aqui o
   * estado nasce certo, porque abrir é um EVENTO e não uma consequência.
   */
  function aoAbrir(abrindo: boolean) {
    if (abrindo) {
      setDia(tarefa.vence_em ? paraCampoDeData(tarefa.vence_em) : "");
      setComHora(tarefa.vence_com_hora);
      setHora(tarefa.vence_em && tarefa.vence_com_hora ? paraCampoDeHora(tarefa.vence_em) : "09:00");
    }
    setAberto(abrindo);
  }

  function salvar() {
    if (dia === "") return;
    const vence_em = montarPrazo(dia, comHora ? hora : null);
    if (!vence_em) return;
    onAlterar(tarefa.id, { vence_em, vence_com_hora: comHora });
    setAberto(false);
  }

  function limpar() {
    onAlterar(tarefa.id, { vence_em: null, vence_com_hora: false });
    setAberto(false);
  }

  return (
    <Popover open={aberto} onOpenChange={aoAbrir}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("h-7 w-7", tarefa.vence_em && "text-primary")}
          aria-label={t("Data e horário")}
        >
          <CalendarBlank size={16} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-3">
        <div className="space-y-1.5">
          <label htmlFor={`dia-${tarefa.id}`} className="text-xs font-medium text-muted-foreground">
            {t("Data")}
          </label>
          <Input
            id={`dia-${tarefa.id}`}
            type="date"
            value={dia}
            onChange={(e) => setDia(e.target.value)}
          />
        </div>

        <div className="flex items-center justify-between">
          <label htmlFor={`hora-switch-${tarefa.id}`} className="text-xs font-medium text-muted-foreground">
            {t("Definir horário")}
          </label>
          <Switch
            id={`hora-switch-${tarefa.id}`}
            checked={comHora}
            onCheckedChange={setComHora}
            disabled={dia === ""}
          />
        </div>

        {comHora && (
          <Input
            type="time"
            value={hora}
            onChange={(e) => setHora(e.target.value)}
            aria-label={t("Horário")}
          />
        )}

        <div className="flex justify-between gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={limpar} disabled={!tarefa.vence_em}>
            {t("Limpar")}
          </Button>
          <Button type="button" size="sm" onClick={salvar} disabled={dia === ""}>
            {t("Salvar")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
