import type { Escopo } from "@/lib/auth/types";

/**
 * A LISTA BRANCA DE PÁGINAS do escopo `projetos`.
 *
 * ⚠️ Esconder o item do menu não é proteção — quem digitar `/app/inbox` na barra
 * de endereço chega lá. Esta guarda roda no layout de `/app`, do lado do
 * servidor, ANTES de qualquer página renderizar.
 *
 * ─── Por que lista branca, e não lista negra ───────────────────────────────
 *
 * Uma lista do que é PROIBIDO envelhece errado: a tela nova de amanhã não está
 * nela e nasce liberada. A lista do que é PERMITIDO envelhece do lado seguro —
 * a tela nova nasce fechada, e abri-la é um ato deliberado que aparece no diff.
 *
 * O mesmo raciocínio de `NavDestination.escopos` e do gate de `requireRole`. As
 * três camadas dizem a mesma coisa em lugares diferentes de propósito: o menu
 * esconde, a rota de página redireciona, a rota de API recusa. Nenhuma delas
 * sozinha é a proteção — a RLS do banco, que vem na fase 2, é a última.
 */
const PERMITIDO_EM_PROJETOS: readonly string[] = [
  "/app/projetos",
  // O perfil é da PESSOA, não da operação: trocar o próprio nome, idioma e
  // senha não expõe dado de cliente nenhum, e negá-lo prenderia o colaborador
  // numa conta que ele não consegue ajustar.
  "/app/settings/profile",
  "/app/settings/security",
];

/** Para onde o colaborador vai quando pede uma página que não é dele. */
export const CASA_DO_ESCOPO: Record<Escopo, string> = {
  completo: "/app/inbox",
  projetos: "/app/projetos",
};

/**
 * Esta pessoa pode abrir esta página?
 *
 * O casamento é por PREFIXO de segmento (`/app/projetos/123` entra por
 * `/app/projetos`), e nunca por `startsWith` cru — este responderia "sim" para
 * `/app/projetos-secretos`, que é outra rota.
 */
export function podeAbrirPagina(pathname: string, escopo: Escopo): boolean {
  if (escopo === "completo") return true;
  return PERMITIDO_EM_PROJETOS.some(
    (base) => pathname === base || pathname.startsWith(`${base}/`),
  );
}
