"use client";
import { useResumoDeTarefas } from "@/hooks/tarefas/useResumoDeTarefas";
import { useT } from "@/hooks/i18n/useT";
import { cn } from "@/lib/utils";

/**
 * O contador de tarefas vencidas ao lado de "Tarefas" na barra lateral.
 *
 * ⚠️ NÃO DESENHA ZERO. Um badge "0" é ruído permanente: ele ocupa o mesmo lugar
 * e a mesma cor de um alerta e treina quem olha a ignorá-lo, de modo que o dia
 * em que houver algo de verdade ele não será visto. Sem vencidas, nada aparece.
 *
 * Erro de carga também não desenha: dizer "0" quando a consulta falhou é a
 * mesma mentira que a bolinha de conexão evita ao cair para "unknown" — só que
 * aqui a resposta honesta é o silêncio, porque não há nada a comunicar.
 */
export function BadgeDeVencidas({ className }: { className?: string }) {
  const t = useT();
  const { data, isError } = useResumoDeTarefas();
  const vencidas = isError ? 0 : (data?.vencidas ?? 0);
  if (vencidas === 0) return null;

  // Acima de 99 o número deixa de informar e passa a empurrar o rótulo: quem
  // tem 100 tarefas vencidas e quem tem 340 vai fazer a mesma coisa.
  const rotulo = vencidas > 99 ? "99+" : String(vencidas);

  return (
    <span
      className={cn(
        "inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full",
        "bg-error px-1 text-[10px] font-medium leading-none text-white tabular-nums",
        className,
      )}
      title={t("Tarefas vencidas")}
      aria-label={`${vencidas} ${t("Tarefas vencidas")}`}
    >
      {rotulo}
    </span>
  );
}
