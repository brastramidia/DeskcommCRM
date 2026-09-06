import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { ESCOPO_PADRAO } from "@/lib/auth/types";

export const dynamic = "force-dynamic";

/**
 * PROJETOS — a única área que o escopo `projetos` alcança.
 *
 * ⚠️ ESTA PÁGINA AINDA É UM MARCO, e é deliberado. A fase 1 entrega o ACESSO —
 * escopo, navegação, guarda de rota e convite — e nada mais. As tabelas, o
 * quadro e o checklist vêm depois.
 *
 * Ela existe agora porque sem destino não há como CONFERIR a fase 1: o convite
 * levaria a lugar nenhum, e "o colaborador não vê o CRM" seria uma afirmação sem
 * teste. Com ela, o percurso inteiro é verificável por uma pessoa — convidar,
 * aceitar, entrar, e tentar alcançar o que não é dela.
 */
export default async function ProjetosPage() {
  const user = await requireAuth();
  const t = (texto: string) => traduzir(texto, user.idioma);
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  const ehColaborador = (activeOrg.escopo ?? ESCOPO_PADRAO) === "projetos";

  return (
    <div
      data-superficie="clara"
      className="-m-6 flex min-h-[calc(100%+3rem)] flex-col gap-6 bg-bg p-6 text-text"
    >
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Projetos")}</h1>
        <p className="mt-1 text-sm text-text-muted">
          {ehColaborador
            ? t("Aqui vão aparecer os projetos em que você foi incluído.")
            : t("Os projetos de cliente, em quadro — status, responsáveis e checklist.")}
        </p>
      </header>

      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-sm font-medium">{t("Área em construção")}</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-text-muted">
          {t(
            "O acesso já está valendo — o quadro de projetos, o checklist e o histórico chegam em seguida.",
          )}
        </p>
      </div>
    </div>
  );
}
