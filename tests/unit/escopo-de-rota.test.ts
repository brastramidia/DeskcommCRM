import { describe, expect, it } from "vitest";

import { podeAbrirPagina, CASA_DO_ESCOPO } from "@/lib/auth/escopo-de-rota";

/**
 * A guarda de páginas do colaborador.
 *
 * O que ela impede: uma pessoa de fora, convidada para tocar projetos, digitar
 * `/app/inbox` na barra de endereço e ler as conversas de WhatsApp dos clientes.
 * Esconder o item do menu não faz nada contra isso.
 */
describe("escopo de rota", () => {
  it("quem tem acesso completo abre qualquer página", () => {
    for (const p of ["/app/inbox", "/app/contacts", "/app/tarefas", "/app/projetos"]) {
      expect(podeAbrirPagina(p, "completo")).toBe(true);
    }
  });

  it("⚠️ o colaborador NÃO alcança nenhuma tela do CRM", () => {
    for (const p of [
      "/app/inbox",
      "/app/contacts",
      "/app/kanban",
      "/app/tarefas", // as tarefas PESSOAIS do dono
      "/app/ads/meta",
      "/app/metrics",
      "/app/settings/tenant",
      "/app/team",
    ]) {
      expect(podeAbrirPagina(p, "projetos"), p).toBe(false);
    }
  });

  it("o colaborador alcança Projetos e o detalhe de um projeto", () => {
    expect(podeAbrirPagina("/app/projetos", "projetos")).toBe(true);
    expect(podeAbrirPagina("/app/projetos/abc-123", "projetos")).toBe(true);
  });

  it("alcança o próprio perfil e a própria segurança", () => {
    // Trocar o próprio nome e senha não expõe dado de cliente, e negá-lo
    // prenderia a pessoa numa conta que ela não consegue ajustar.
    expect(podeAbrirPagina("/app/settings/profile", "projetos")).toBe(true);
    expect(podeAbrirPagina("/app/settings/security", "projetos")).toBe(true);
  });

  it("⚠️ prefixo não vaza para rota vizinha de nome parecido", () => {
    // `startsWith` cru diria SIM para isto, e seria outra rota.
    expect(podeAbrirPagina("/app/projetos-secretos", "projetos")).toBe(false);
    expect(podeAbrirPagina("/app/settings/profile-do-cliente", "projetos")).toBe(false);
  });

  it("cada escopo tem uma casa para onde voltar", () => {
    expect(CASA_DO_ESCOPO.projetos).toBe("/app/projetos");
    expect(CASA_DO_ESCOPO.completo).toBe("/app/inbox");
  });
});
