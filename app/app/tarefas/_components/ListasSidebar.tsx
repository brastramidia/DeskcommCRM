"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DotsThree, List, PencilSimple, Plus, Trash } from "@/lib/ui/icons";
import { useT } from "@/hooks/i18n/useT";
import { cn } from "@/lib/utils";
import type { ListaComPendentes } from "@/lib/tarefas/consultas";

interface Props {
  listas: ListaComPendentes[];
  ativa: string | null;
  onSelecionar: (id: string) => void;
  onCriar: (nome: string) => void;
  onRenomear: (id: string, nome: string) => void;
  onApagar: (id: string) => void;
}

/** A coluna da esquerda: as listas, e o que se faz com elas. */
export function ListasSidebar({
  listas,
  ativa,
  onSelecionar,
  onCriar,
  onRenomear,
  onApagar,
}: Props) {
  const t = useT();
  const [criando, setCriando] = React.useState(false);
  const [nova, setNova] = React.useState("");
  const [renomeando, setRenomeando] = React.useState<string | null>(null);
  const [rascunho, setRascunho] = React.useState("");
  // A confirmação guarda a lista INTEIRA, não só o id: o diálogo precisa dizer o
  // nome e quantas tarefas vão junto, e com o id ele teria de procurá-la de novo
  // numa lista que a mutação otimista já pode ter mudado.
  const [aApagar, setAApagar] = React.useState<ListaComPendentes | null>(null);

  function criar() {
    const limpo = nova.trim();
    setCriando(false);
    setNova("");
    if (limpo !== "") onCriar(limpo);
  }

  function renomear(id: string) {
    const limpo = rascunho.trim();
    setRenomeando(null);
    if (limpo !== "") onRenomear(id, limpo);
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col gap-2 border-r pr-3">
      <div className="flex items-center justify-between px-2">
        <h2 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
          {t("Minhas listas")}
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => setCriando(true)}
          aria-label={t("Nova lista")}
        >
          <Plus size={16} />
        </Button>
      </div>

      <ul className="space-y-0.5">
        {listas.map((lista) => (
          <li key={lista.id} className="group/lista">
            {renomeando === lista.id ? (
              <Input
                autoFocus
                value={rascunho}
                onChange={(e) => setRascunho(e.target.value)}
                onBlur={() => renomear(lista.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") renomear(lista.id);
                  if (e.key === "Escape") setRenomeando(null);
                }}
                className="h-8"
                aria-label={t("Renomear lista")}
              />
            ) : (
              <div
                className={cn(
                  "flex items-center gap-1 rounded-md border-l-2 pl-2 pr-1 text-sm transition-colors",
                  // `muted` (= surface-elevated) e não uma tinta de accent: sobre
                  // Paper o accent a 50% vira um azul saturado que nenhuma outra
                  // lista do produto usa. É o padrão das telas que já vivem em
                  // superfície clara.
                  //
                  // A BORDA no accent é o que separa selecionado de "passando o
                  // mouse": só o fundo não bastava, porque o hover usa o mesmo
                  // token em outra opacidade e os dois estados se confundiam.
                  ativa === lista.id
                    ? "border-l-accent bg-surface-elevated font-medium text-text"
                    : "border-l-transparent text-text-muted hover:bg-muted/40 hover:text-text",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelecionar(lista.id)}
                  aria-current={ativa === lista.id ? "true" : undefined}
                  className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left focus-visible:outline-none focus-visible:underline"
                >
                  {/* O ícone dá âncora visual à coluna: sem ele, a lista de
                      listas é uma pilha de palavras soltas, e nada distingue
                      "isto é uma lista" de "isto é um rótulo". */}
                  <List
                    size={15}
                    className={cn("shrink-0", ativa === lista.id ? "text-accent" : "text-text-subtle")}
                    aria-hidden
                  />
                  <span className="truncate">{lista.nome}</span>
                </button>

                {/* O contador só aparece quando há o que fazer: um "0" fixo ao
                    lado de toda lista é ruído que treina o olho a ignorar a
                    coluna inteira. */}
                {lista.pendentes > 0 && (
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {lista.pendentes}
                  </span>
                )}

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0 opacity-0 focus-visible:opacity-100 group-hover/lista:opacity-100"
                      aria-label={t("Opções da lista")}
                    >
                      <DotsThree size={16} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() => {
                        setRascunho(lista.nome);
                        setRenomeando(lista.id);
                      }}
                    >
                      <PencilSimple size={16} /> {t("Renomear")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setAApagar(lista)}>
                      <Trash size={16} /> {t("Apagar lista")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </li>
        ))}

        {criando && (
          <li>
            <Input
              autoFocus
              value={nova}
              onChange={(e) => setNova(e.target.value)}
              onBlur={criar}
              onKeyDown={(e) => {
                if (e.key === "Enter") criar();
                if (e.key === "Escape") {
                  setNova("");
                  setCriando(false);
                }
              }}
              placeholder={t("Nome da lista")}
              className="h-8"
              aria-label={t("Nova lista")}
            />
          </li>
        )}
      </ul>

      <AlertDialog open={aApagar !== null} onOpenChange={(o) => !o && setAApagar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("Apagar")} “{aApagar?.nome}”?
            </AlertDialogTitle>
            {/* O número entra na frase porque é o que a pessoa não tem como ver
                no momento de decidir: a lista que ela vai apagar pode não ser a
                que está aberta. */}
            <AlertDialogDescription>
              {aApagar && aApagar.pendentes > 0
                ? `${t("As tarefas dentro dela também somem — há")} ${aApagar.pendentes} ${t("pendentes")}. ${t("Não dá para desfazer.")}`
                : t("As tarefas dentro dela também somem. Não dá para desfazer.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancelar")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (aApagar) onApagar(aApagar.id);
                setAApagar(null);
              }}
            >
              {t("Apagar lista")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}
