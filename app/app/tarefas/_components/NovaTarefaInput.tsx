"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { Plus } from "@/lib/ui/icons";
import { useT } from "@/hooks/i18n/useT";

/**
 * O campo de adicionar. Enter cria e o campo continua focado — escrever cinco
 * tarefas seguidas é o caso comum, e obrigar um clique entre elas é o que faz
 * alguém desistir e voltar para o papel.
 */
export function NovaTarefaInput({ onCriar }: { onCriar: (texto: string) => void }) {
  const t = useT();
  const [texto, setTexto] = React.useState("");

  return (
    <div className="flex items-center gap-2 rounded-md border px-3 py-1.5 focus-within:ring-1 focus-within:ring-ring">
      <Plus size={16} className="shrink-0 text-muted-foreground" aria-hidden />
      <Input
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          const limpo = texto.trim();
          if (limpo === "") return;
          onCriar(limpo);
          setTexto("");
        }}
        placeholder={t("Nova tarefa")}
        aria-label={t("Nova tarefa")}
        className="h-7 border-0 px-0 py-0 shadow-none focus-visible:ring-0"
      />
    </div>
  );
}
